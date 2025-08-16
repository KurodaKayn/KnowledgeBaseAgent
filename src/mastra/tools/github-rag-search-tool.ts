import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "@octokit/rest";

export interface DocumentChunk {
  content: string;
  source: string;
  title?: string;
  section?: string;
}

class GitHubRAGSearchService {
  private octokit: Octokit;
  private repoOwner: string;
  private repoName: string;
  private isInitialized: boolean = false;
  private knowledgeBase: DocumentChunk[] = [];

  constructor(repoUrl: string, githubToken?: string) {
    const [owner, repo] = repoUrl.split("/");

    this.octokit = new Octokit({
      auth: githubToken || process.env.GITHUB_TOKEN,
    });

    this.repoOwner = owner;
    this.repoName = repo;
  }

  async performAction({
    action,
    query,
    maxResults = 3,
    forceReload = false,
  }: {
    action: "init" | "search" | "status";
    query?: string;
    maxResults?: number;
    forceReload?: boolean;
  }) {
    switch (action) {
      case "init":
        return this.initializeKnowledgeBase(forceReload);

      case "search":
        if (!query) {
          return { success: false, error: "需要提供query参数" };
        }
        return this.searchKnowledgeBase(query, maxResults);

      case "status":
        return this.getStatus();

      default:
        return { success: false, error: "无效的操作类型" };
    }
  }

  private async initializeKnowledgeBase(forceReload: boolean = false) {
    if (this.isInitialized && !forceReload) {
      return {
        success: true,
        message: "知识库已经初始化",
        documentsCount: this.knowledgeBase.length,
        cached: true,
      };
    }

    const markdownFiles = await this.getMarkdownFiles("", true);

    const filesWithContent = await Promise.all(
      markdownFiles.map(async (file) => {
        const content = await this.getFileContent(file.path);
        return {
          name: file.name,
          path: file.path,
          content,
        };
      })
    );

    this.knowledgeBase = [];

    for (const doc of filesWithContent) {
      const chunks = this.splitMarkdownIntoChunks(
        doc.content,
        doc.path,
        doc.name
      );
      this.knowledgeBase.push(...chunks);
    }

    this.isInitialized = true;

    return {
      success: true,
      message: `知识库初始化成功，加载了 ${filesWithContent.length} 个文档，生成 ${this.knowledgeBase.length} 个文档块`,
      documentsCount: filesWithContent.length,
      chunksCount: this.knowledgeBase.length,
      cached: false,
    };
  }

  private async searchKnowledgeBase(query: string, maxResults: number) {
    if (!this.isInitialized || this.knowledgeBase.length === 0) {
      const initResult = await this.initializeKnowledgeBase();
      if (!initResult.success) {
        return {
          success: false,
          error: "无法初始化知识库进行搜索",
        };
      }
    }

    const queryLower = query.toLowerCase();

    const scoredResults = this.knowledgeBase
      .map((doc) => ({
        ...doc,
        score: this.calculateRelevanceScore(doc, queryLower),
      }))
      .filter((doc) => doc.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    const contextualResults = scoredResults.map(({ score, ...result }) => ({
      ...result,
      relevantContent: this.extractRelevantContent(result.content, query),
      summary: this.generateSummary(result.content),
    }));

    return {
      success: true,
      query,
      results: contextualResults,
      count: contextualResults.length,
      totalDocuments: this.knowledgeBase.length,
    };
  }

  private getStatus() {
    return {
      success: true,
      initialized: this.isInitialized,
      documentsCount: this.knowledgeBase.length,
      message: this.isInitialized
        ? `知识库已初始化，包含 ${this.knowledgeBase.length} 个文档块`
        : "知识库未初始化",
    };
  }

  private async getMarkdownFiles(
    path: string,
    recursive: boolean
  ): Promise<Array<{ name: string; path: string; sha: string }>> {
    const files: Array<{ name: string; path: string; sha: string }> = [];

    const response = await this.octokit.rest.repos.getContent({
      owner: this.repoOwner,
      repo: this.repoName,
      path,
    });

    const contents = Array.isArray(response.data)
      ? response.data
      : [response.data];

    for (const item of contents) {
      if ("type" in item) {
        if (item.type === "file" && item.name.toLowerCase().endsWith(".md")) {
          files.push({
            name: item.name,
            path: item.path,
            sha: item.sha,
          });
        } else if (item.type === "dir" && recursive) {
          const subFiles = await this.getMarkdownFiles(item.path, recursive);
          files.push(...subFiles);
        }
      }
    }

    return files;
  }

  private async getFileContent(filePath: string): Promise<string> {
    const response = await this.octokit.rest.repos.getContent({
      owner: this.repoOwner,
      repo: this.repoName,
      path: filePath,
    });

    if ("content" in response.data) {
      return Buffer.from(response.data.content, "base64").toString("utf-8");
    }

    return "";
  }

  private splitMarkdownIntoChunks(
    content: string,
    path: string,
    fileName: string
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const lines = content.split("\n");

    let currentChunk = "";
    let currentTitle = "";
    let currentSection = "";
    let chunkLineCount = 0;
    const maxChunkLines = 50;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith("# ")) {
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            source: path,
            title: currentTitle || fileName,
            section: currentSection,
          });
        }
        currentTitle = trimmedLine.substring(2).trim();
        currentSection = currentTitle;
        currentChunk = line + "\n";
        chunkLineCount = 1;
      } else if (trimmedLine.startsWith("## ")) {
        if (currentChunk.trim() && chunkLineCount > 5) {
          chunks.push({
            content: currentChunk.trim(),
            source: path,
            title: currentTitle || fileName,
            section: currentSection,
          });
          currentChunk = "";
          chunkLineCount = 0;
        }
        currentSection = trimmedLine.substring(3).trim();
        currentChunk += line + "\n";
        chunkLineCount++;
      } else {
        currentChunk += line + "\n";
        chunkLineCount++;

        if (chunkLineCount >= maxChunkLines) {
          chunks.push({
            content: currentChunk.trim(),
            source: path,
            title: currentTitle || fileName,
            section: currentSection,
          });
          currentChunk = "";
          chunkLineCount = 0;
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        source: path,
        title: currentTitle || fileName,
        section: currentSection,
      });
    }

    return chunks.filter((chunk) => chunk.content.length > 50);
  }

  private calculateRelevanceScore(
    doc: DocumentChunk,
    queryLower: string
  ): number {
    const contentLower = doc.content.toLowerCase();
    const titleLower = (doc.title || "").toLowerCase();
    const sectionLower = (doc.section || "").toLowerCase();

    let score = 0;

    const titleMatches = (titleLower.match(new RegExp(queryLower, "g")) || [])
      .length;
    const sectionMatches = (
      sectionLower.match(new RegExp(queryLower, "g")) || []
    ).length;
    const contentMatches = (
      contentLower.match(new RegExp(queryLower, "g")) || []
    ).length;

    score += titleMatches * 10;
    score += sectionMatches * 5;
    score += contentMatches * 1;

    const queryWords = queryLower.split(/\s+/);
    for (const word of queryWords) {
      if (word.length > 2) {
        if (titleLower.includes(word)) score += 3;
        if (sectionLower.includes(word)) score += 2;
        if (contentLower.includes(word)) score += 1;
      }
    }

    return score;
  }

  private extractRelevantContent(content: string, query: string): string {
    const sentences = content.split(/[.!?]\s+/);
    const queryWords = query.toLowerCase().split(/\s+/);

    const relevantSentences = sentences.filter((sentence) => {
      const sentenceLower = sentence.toLowerCase();
      return queryWords.some(
        (word) => word.length > 2 && sentenceLower.includes(word)
      );
    });

    if (relevantSentences.length > 0) {
      return relevantSentences.slice(0, 3).join(". ") + ".";
    }

    return content.substring(0, 300) + "...";
  }

  private generateSummary(content: string): string {
    const firstParagraph = content.split("\n\n")[0];
    const summary =
      firstParagraph.length > 150
        ? firstParagraph.substring(0, 147) + "..."
        : firstParagraph;

    return summary.replace(/^#+\s*/, "");
  }
}

export const createGitHubRAGSearchTool = (
  repoUrl: string,
  githubToken?: string
) => {
  const service = new GitHubRAGSearchService(repoUrl, githubToken);

  return createTool({
    id: "github-rag-search",
    description: "从GitHub仓库加载markdown文档并进行知识检索搜索",
    inputSchema: z.object({
      action: z
        .enum(["init", "search", "status"])
        .describe("操作类型：初始化知识库、搜索或获取状态"),
      query: z.string().optional().describe("搜索查询"),
      maxResults: z.number().optional().default(3).describe("最大返回结果数"),
      forceReload: z
        .boolean()
        .optional()
        .default(false)
        .describe("是否强制重新加载知识库"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string().optional(),
      documentsCount: z.number().optional(),
      chunksCount: z.number().optional(),
      cached: z.boolean().optional(),
      query: z.string().optional(),
      results: z
        .array(
          z.object({
            content: z.string(),
            source: z.string(),
            title: z.string().optional(),
            section: z.string().optional(),
            relevantContent: z.string().optional(),
            summary: z.string().optional(),
          })
        )
        .optional(),
      count: z.number().optional(),
      totalDocuments: z.number().optional(),
      initialized: z.boolean().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ context }) => {
      return await service.performAction({
        action: context.action,
        query: context.query,
        maxResults: context.maxResults,
        forceReload: context.forceReload,
      });
    },
  });
};

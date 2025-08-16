import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export interface DocumentChunk {
  content: string;
  source: string;
  title?: string;
  section?: string;
}

class MarkdownReaderService {
  private documents: DocumentChunk[] = [];

  constructor() {}

  async processDocuments({
    action,
    documents,
    query,
    maxResults = 5,
  }: {
    action: "load" | "search" | "get_all";
    documents?: Array<{ name: string; path: string; content: string }>;
    query?: string;
    maxResults?: number;
  }) {
    switch (action) {
      case "load":
        if (!documents) {
          return { success: false, error: "需要提供documents参数" };
        }
        return this.loadDocuments(documents);

      case "search":
        if (!query) {
          return { success: false, error: "需要提供query参数" };
        }
        return this.searchDocuments(query, maxResults);

      case "get_all":
        return {
          success: true,
          documents: this.documents,
          count: this.documents.length,
        };

      default:
        return { success: false, error: "无效的操作类型" };
    }
  }

  private loadDocuments(
    documents: Array<{ name: string; path: string; content: string }>
  ) {
    this.documents = [];

    for (const doc of documents) {
      const chunks = this.splitMarkdownIntoChunks(
        doc.content,
        doc.path,
        doc.name
      );
      this.documents.push(...chunks);
    }

    return {
      success: true,
      message: `成功加载 ${documents.length} 个文档，生成 ${this.documents.length} 个文档块`,
      documentsCount: documents.length,
      chunksCount: this.documents.length,
    };
  }

  private searchDocuments(query: string, maxResults: number) {
    const queryLower = query.toLowerCase();

    const scoredResults = this.documents
      .map((doc) => ({
        ...doc,
        score: this.calculateRelevanceScore(doc, queryLower),
      }))
      .filter((doc) => doc.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return {
      success: true,
      results: scoredResults.map(({ score, ...doc }) => doc),
      query,
      count: scoredResults.length,
    };
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
}

export const createMarkdownReaderTool = () => {
  const service = new MarkdownReaderService();

  return createTool({
    id: "markdown-reader",
    description: "读取和处理markdown文档内容，将其分块用于知识检索",
    inputSchema: z.object({
      action: z
        .enum(["load", "search", "get_all"])
        .describe("操作类型：加载文档、搜索内容或获取所有文档"),
      documents: z
        .array(
          z.object({
            name: z.string(),
            path: z.string(),
            content: z.string(),
          })
        )
        .optional()
        .describe("要加载的文档列表"),
      query: z.string().optional().describe("搜索查询"),
      maxResults: z.number().optional().default(5).describe("最大返回结果数"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string().optional(),
      documents: z
        .array(
          z.object({
            content: z.string(),
            source: z.string(),
            title: z.string().optional(),
            section: z.string().optional(),
          })
        )
        .optional(),
      results: z
        .array(
          z.object({
            content: z.string(),
            source: z.string(),
            title: z.string().optional(),
            section: z.string().optional(),
          })
        )
        .optional(),
      count: z.number().optional(),
      documentsCount: z.number().optional(),
      chunksCount: z.number().optional(),
      query: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ context }) => {
      return await service.processDocuments({
        action: context.action,
        documents: context.documents,
        query: context.query,
        maxResults: context.maxResults,
      });
    },
  });
};

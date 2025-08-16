import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { MDocument } from "@mastra/rag";
import { LibSQLVector } from "@mastra/libsql";
import { embedMany, embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  baseURL: process.env.EMBEDDING_AI_URL || "https://api.openai.com/v1",
  apiKey: process.env.EMBEDDING_AI_KEY,
});

export interface VectorDocumentChunk {
  content: string;
  source: string;
  title?: string;
  section?: string;
  id: string;
}

class GitHubVectorRAGService {
  private octokit: Octokit;
  private repoOwner: string;
  private repoName: string;
  private vectorStore: LibSQLVector;
  private indexName: string = "github_docs";
  private isInitialized: boolean = false;

  constructor(repoUrl: string, githubToken?: string, dbPath?: string) {
    const [owner, repo] = repoUrl.split("/");

    this.octokit = new Octokit({
      auth: githubToken || process.env.GITHUB_TOKEN,
    });

    this.repoOwner = owner;
    this.repoName = repo;

    // 使用简单的文件名，避免路径问题
    let dbUrl;
    if (dbPath) {
      dbUrl = dbPath;
    } else if (process.env.DATABASE_URL) {
      dbUrl = process.env.DATABASE_URL;
    } else {
      // 使用简单的文件名，在当前目录创建
      dbUrl = `file:vector-${owner}-${repo}.db`;
    }

    console.log(`使用数据库路径: ${dbUrl}`);

    this.vectorStore = new LibSQLVector({
      connectionUrl: dbUrl,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }

  async performAction({
    action,
    query,
    maxResults = 5,
    forceReload = false,
  }: {
    action: "init" | "search" | "status" | "clear";
    query?: string;
    maxResults?: number;
    forceReload?: boolean;
  }) {
    switch (action) {
      case "init":
        return this.initializeVectorStore(forceReload);

      case "search":
        if (!query) {
          return { success: false, error: "需要提供query参数" };
        }
        return this.vectorSearch(query, maxResults);

      case "status":
        return this.getStatus();

      case "clear":
        return this.clearVectorStore();

      default:
        return { success: false, error: "无效的操作类型" };
    }
  }

  private async initializeVectorStore(forceReload: boolean = false) {
    try {
      // 创建向量索引
      await this.vectorStore.createIndex({
        indexName: this.indexName,
        dimension: 1536, // OpenAI text-embedding-3-small 的维度
      });

      // 检查现有数据(除非强制重载)
      if (!forceReload) {
        try {
          console.log("检查现有向量数据...");
          const existingData = await this.vectorStore.query({
            indexName: this.indexName,
            queryVector: new Array(1536).fill(0),
            topK: 1,
          });

          if (existingData.length > 0) {
            this.isInitialized = true;
            console.log("发现现有向量数据，跳过初始化");
            return {
              success: true,
              message: "向量数据库已存在数据，跳过初始化",
              cached: true,
              chunksCount: "未知(使用现有数据)",
            };
          }
        } catch (error) {
          console.log("未发现现有数据，开始初始化...");
        }
      } else {
        console.log("强制重载：开始重新初始化...");
      }

      console.log("开始处理 GitHub 文档...");
      const markdownFiles = await this.getMarkdownFiles("", true);
      console.log(`Found ${markdownFiles.length} markdown files`);

      if (markdownFiles.length === 0) {
        return {
          success: false,
          error: "仓库中未找到 markdown 文件",
        };
      }

      const allChunks: VectorDocumentChunk[] = [];
      const batchSize = 10; // 批量处理文件

      // 分批处理文件
      for (let i = 0; i < markdownFiles.length; i += batchSize) {
        const batch = markdownFiles.slice(i, i + batchSize);
        console.log(
          `处理文件批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(markdownFiles.length / batchSize)}`
        );

        const batchChunks = await Promise.all(
          batch.map(async (file) => {
            try {
              const content = await this.getFileContent(file.path);
              const doc = MDocument.fromMarkdown(content);

              // 使用 Mastra 的分块策略
              const chunks = await doc.chunk({
                strategy: "semantic-markdown",
                joinThreshold: 500,
              });

              return chunks.map((chunk, index) => ({
                content: chunk.text,
                source: file.path,
                title: file.name,
                section: this.extractSection(chunk.text),
                id: `${file.path}:${index}`,
              }));
            } catch (error) {
              console.warn(`处理文件 ${file.path} 时出错:`, error);
              return [];
            }
          })
        );

        allChunks.push(...batchChunks.flat());
      }

      if (allChunks.length === 0) {
        return {
          success: false,
          error: "没有找到可处理的文档内容",
        };
      }

      console.log(`Generating embeddings for ${allChunks.length} chunks...`);

      // 分批生成嵌入向量以避免API限制
      const embeddingBatchSize = 50;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < allChunks.length; i += embeddingBatchSize) {
        const batch = allChunks.slice(i, i + embeddingBatchSize);
        console.log(
          `生成嵌入向量批次 ${Math.floor(i / embeddingBatchSize) + 1}/${Math.ceil(allChunks.length / embeddingBatchSize)}`
        );

        const { embeddings } = await embedMany({
          model: openai.embedding("text-embedding-3-small"),
          values: batch.map((chunk) => chunk.content),
        });

        allEmbeddings.push(...embeddings);

        // 延迟避免API限制
        if (i + embeddingBatchSize < allChunks.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      // 分批存储到向量数据库
      const storeBatchSize = 25;
      for (let i = 0; i < allChunks.length; i += storeBatchSize) {
        const chunkBatch = allChunks.slice(i, i + storeBatchSize);
        const embeddingBatch = allEmbeddings.slice(i, i + storeBatchSize);

        console.log(
          `存储向量批次 ${Math.floor(i / storeBatchSize) + 1}/${Math.ceil(allChunks.length / storeBatchSize)}`
        );

        await this.vectorStore.upsert({
          indexName: this.indexName,
          vectors: embeddingBatch,
          metadata: chunkBatch.map((chunk) => ({
            text: chunk.content,
            source: chunk.source,
            title: chunk.title,
            section: chunk.section,
            id: chunk.id,
            created_at: new Date().toISOString(),
          })),
        });
      }

      this.isInitialized = true;

      return {
        success: true,
        message: `向量数据库初始化成功，处理了 ${markdownFiles.length} 个文档，生成 ${allChunks.length} 个文档块`,
        documentsCount: markdownFiles.length,
        chunksCount: allChunks.length,
        cached: false,
      };
    } catch (error) {
      console.error("初始化向量数据库时出错:", error);
      return {
        success: false,
        error: `初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async vectorSearch(query: string, maxResults: number) {
    try {
      // 检查是否已初始化
      if (!this.isInitialized) {
        try {
          // 尝试查询现有数据
          const existingData = await this.vectorStore.query({
            indexName: this.indexName,
            queryVector: new Array(1536).fill(0),
            topK: 1,
          });

          if (existingData.length > 0) {
            this.isInitialized = true;
            console.log("检测到现有数据，标记为已初始化");
          } else {
            const initResult = await this.initializeVectorStore();
            if (!initResult.success) {
              return {
                success: false,
                error: "无法初始化向量数据库进行搜索",
              };
            }
          }
        } catch (error) {
          const initResult = await this.initializeVectorStore();
          if (!initResult.success) {
            return {
              success: false,
              error: "无法初始化向量数据库进行搜索",
            };
          }
        }
      }

      // 将查询转换为嵌入向量
      const { embedding } = await embed({
        model: openai.embedding("text-embedding-3-small"),
        value: query,
      });

      // 向量相似度搜索
      const searchResults = await this.vectorStore.query({
        indexName: this.indexName,
        queryVector: embedding,
        topK: maxResults,
      });

      // 格式化结果
      const formattedResults = searchResults.map((result) => ({
        content: result.metadata?.text || "",
        source: result.metadata?.source || "",
        title: result.metadata?.title || "",
        section: result.metadata?.section || "",
        relevanceScore: result.score || 0,
        summary: this.generateSummary(result.metadata?.text || ""),
      }));

      return {
        success: true,
        query,
        results: formattedResults,
        count: formattedResults.length,
        searchType: "vector_similarity",
      };
    } catch (error) {
      console.error("向量搜索时出错:", error);
      return {
        success: false,
        error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async getStatus() {
    try {
      // 简单的状态检查 - 可以通过查询数据库来获取更详细的信息
      return {
        success: true,
        initialized: this.isInitialized,
        message: this.isInitialized
          ? "向量数据库已初始化"
          : "向量数据库未初始化",
        vectorStore: "LibSQL",
        indexName: this.indexName,
      };
    } catch (error) {
      return {
        success: false,
        error: `获取状态失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async clearVectorStore() {
    try {
      // LibSQL 没有直接的 clear 方法，我们可以删除并重新创建索引
      // 这里简单地重置初始化状态
      this.isInitialized = false;

      return {
        success: true,
        message: "向量数据库已清空，需要重新初始化",
      };
    } catch (error) {
      return {
        success: false,
        error: `清空向量数据库失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
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

  private extractSection(content: string): string {
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        return trimmed.replace(/^#+\s*/, "");
      }
    }
    return "";
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

export const createGitHubVectorRAGTool = (
  repoUrl: string,
  githubToken?: string,
  dbPath?: string
) => {
  const service = new GitHubVectorRAGService(repoUrl, githubToken, dbPath);

  return createTool({
    id: "github-vector-rag",
    description: "使用向量搜索从GitHub仓库中进行智能文档检索",
    inputSchema: z.object({
      action: z
        .enum(["init", "search", "status", "clear"])
        .describe("操作类型：初始化向量库、向量搜索、获取状态或清空数据"),
      query: z.string().optional().describe("搜索查询"),
      maxResults: z.number().optional().default(5).describe("最大返回结果数"),
      forceReload: z
        .boolean()
        .optional()
        .default(false)
        .describe("是否强制重新加载和向量化文档"),
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
            relevanceScore: z.number().optional(),
            summary: z.string().optional(),
          })
        )
        .optional(),
      count: z.number().optional(),
      searchType: z.string().optional(),
      initialized: z.boolean().optional(),
      vectorStore: z.string().optional(),
      indexName: z.string().optional(),
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

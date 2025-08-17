import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { LibSQLVector } from "@mastra/libsql";
import { embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  baseURL: process.env.EMBEDDING_AI_URL || "https://api.openai.com/v1",
  apiKey: process.env.EMBEDDING_AI_KEY,
});

/**
 * 向量搜索工具 - 在向量数据库中搜索相关内容
 */
export const vectorSearchTool = createTool({
  id: "vector-search-tool",
  description: "在向量数据库中搜索与查询相关的内容",
  inputSchema: z.object({
    query: z.string().describe("搜索查询"),
    indexName: z.string().default("github_docs").describe("索引名称"),
    maxResults: z.number().optional().default(5).describe("最大返回结果数"),
    dbPath: z.string().optional().describe("数据库路径"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    query: z.string(),
    results: z.array(z.object({
      content: z.string(),
      source: z.string(),
      title: z.string().optional(),
      section: z.string().optional(),
      relevanceScore: z.number(),
      summary: z.string(),
    })),
    count: z.number(),
  }),
  execute: async ({ context }) => {
    const { query, indexName, maxResults, dbPath } = context;

    try {
      // 初始化向量存储
      const vectorStore = new LibSQLVector({
        connectionUrl: dbPath || process.env.DATABASE_URL || "file:vector-store.db",
        authToken: process.env.DATABASE_AUTH_TOKEN,
      });

      // 将查询转换为嵌入向量
      const { embedding } = await embed({
        model: openai.embedding("text-embedding-3-small"),
        value: query,
      });

      // 向量相似度搜索
      const searchResults = await vectorStore.query({
        indexName,
        queryVector: embedding,
        topK: maxResults || 5,
      });

      // 格式化结果
      const formattedResults = searchResults.map(result => ({
        content: result.metadata?.text || "",
        source: result.metadata?.source || "",
        title: result.metadata?.title || "",
        section: result.metadata?.section || "",
        relevanceScore: result.score || 0,
        summary: generateSummary(result.metadata?.text || ""),
      }));

      return {
        success: true,
        query,
        results: formattedResults,
        count: formattedResults.length,
      };
    } catch (error) {
      return {
        success: false,
        query,
        results: [],
        count: 0,
      };
    }
  },
});

/**
 * 生成内容摘要
 */
function generateSummary(content: string): string {
  const firstParagraph = content.split("\n\n")[0];
  const summary = firstParagraph.length > 150
    ? firstParagraph.substring(0, 147) + "..."
    : firstParagraph;

  return summary.replace(/^#+\s*/, "");
}
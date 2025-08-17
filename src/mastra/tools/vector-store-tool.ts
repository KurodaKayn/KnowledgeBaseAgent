import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { LibSQLVector } from "@mastra/libsql";
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  baseURL: process.env.EMBEDDING_AI_URL || "https://api.openai.com/v1",
  apiKey: process.env.EMBEDDING_AI_KEY,
});

/**
 * 向量存储工具 - 存储文档块到向量数据库
 */
export const vectorStoreTool = createTool({
  id: "vector-store-tool",
  description: "将文档块存储到向量数据库中",
  inputSchema: z.object({
    chunks: z.array(z.object({
      content: z.string(),
      source: z.string(),
      title: z.string().optional(),
      section: z.string().optional(),
      id: z.string(),
    })),
    indexName: z.string().default("github_docs").describe("索引名称"),
    dbPath: z.string().optional().describe("数据库路径"),
    batchSize: z.number().optional().default(50).describe("批处理大小"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    storedCount: z.number(),
  }),
  execute: async ({ context }) => {
    const { chunks, indexName, dbPath, batchSize } = context;

    try {
      // 初始化向量存储
      const vectorStore = new LibSQLVector({
        connectionUrl: dbPath || process.env.DATABASE_URL || "file:vector-store.db",
        authToken: process.env.DATABASE_AUTH_TOKEN,
      });

      // 创建向量索引
      await vectorStore.createIndex({
        indexName,
        dimension: 1536, // OpenAI text-embedding-3-small 的维度
      });

      // 分批生成嵌入向量
      const allEmbeddings: number[][] = [];
      
      for (let i = 0; i < chunks.length; i += batchSize || 50) {
        const batch = chunks.slice(i, i + (batchSize || 50));
        
        console.log(`生成嵌入向量批次 ${Math.floor(i / (batchSize || 50)) + 1}/${Math.ceil(chunks.length / (batchSize || 50))}`);

        const { embeddings } = await embedMany({
          model: openai.embedding("text-embedding-3-small"),
          values: batch.map(chunk => chunk.content),
        });

        allEmbeddings.push(...embeddings);

        // 延迟避免API限制
        if (i + (batchSize || 50) < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // 分批存储到向量数据库
      const storeBatchSize = 25;
      for (let i = 0; i < chunks.length; i += storeBatchSize) {
        const chunkBatch = chunks.slice(i, i + storeBatchSize);
        const embeddingBatch = allEmbeddings.slice(i, i + storeBatchSize);

        console.log(`存储向量批次 ${Math.floor(i / storeBatchSize) + 1}/${Math.ceil(chunks.length / storeBatchSize)}`);

        await vectorStore.upsert({
          indexName,
          vectors: embeddingBatch,
          metadata: chunkBatch.map(chunk => ({
            text: chunk.content,
            source: chunk.source,
            title: chunk.title,
            section: chunk.section,
            id: chunk.id,
            created_at: new Date().toISOString(),
          })),
        });
      }

      return {
        success: true,
        message: `成功存储 ${chunks.length} 个文档块到向量数据库`,
        storedCount: chunks.length,
      };
    } catch (error) {
      return {
        success: false,
        message: `向量存储失败: ${error instanceof Error ? error.message : String(error)}`,
        storedCount: 0,
      };
    }
  },
});
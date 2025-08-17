import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { LibSQLVector } from "@mastra/libsql";
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { apiConfig, databaseConfig, processingConfig } from "../../config";

const openai = createOpenAI({
  baseURL: apiConfig.ai.embedding.baseUrl,
  apiKey: apiConfig.ai.embedding.apiKey,
});

/**
 * 向量存储工具 - 存储文档块到向量数据库
 */
export const vectorStoreTool = createTool({
  id: "vector-store-tool",
  description: "将文档块存储到向量数据库中",
  inputSchema: z.object({
    chunks: z.array(
      z.object({
        content: z.string(),
        source: z.string(),
        title: z.string().optional(),
        section: z.string().optional(),
        id: z.string(),
      })
    ),
    indexName: z
      .string()
      .default(processingConfig.vector.defaultIndexName)
      .describe("索引名称"),
    dbPath: z.string().optional().describe("数据库路径"),
    batchSize: z
      .number()
      .optional()
      .default(processingConfig.vector.embeddingBatchSize)
      .describe("批处理大小"),
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
        connectionUrl: dbPath || databaseConfig.vector.url,
        authToken: databaseConfig.vector.authToken,
      });

      // 创建向量索引
      await vectorStore.createIndex({
        indexName,
        dimension: apiConfig.ai.embedding.dimension,
      });

      // 分批生成嵌入向量
      const allEmbeddings: number[][] = [];

      const effectiveBatchSize =
        batchSize || processingConfig.vector.embeddingBatchSize;

      for (let i = 0; i < chunks.length; i += effectiveBatchSize) {
        const batch = chunks.slice(i, i + effectiveBatchSize);

        console.log(
          `生成嵌入向量批次 ${Math.floor(i / effectiveBatchSize) + 1}/${Math.ceil(chunks.length / effectiveBatchSize)}`
        );

        const { embeddings } = await embedMany({
          model: openai.embedding(apiConfig.ai.embedding.model),
          values: batch.map((chunk) => chunk.content),
        });

        allEmbeddings.push(...embeddings);

        // 延迟避免API限制
        if (i + effectiveBatchSize < chunks.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, processingConfig.vector.apiDelay)
          );
        }
      }

      // 分批存储到向量数据库
      const storeBatchSize = processingConfig.vector.storeBatchSize;
      for (let i = 0; i < chunks.length; i += storeBatchSize) {
        const chunkBatch = chunks.slice(i, i + storeBatchSize);
        const embeddingBatch = allEmbeddings.slice(i, i + storeBatchSize);

        console.log(
          `存储向量批次 ${Math.floor(i / storeBatchSize) + 1}/${Math.ceil(chunks.length / storeBatchSize)}`
        );

        await vectorStore.upsert({
          indexName,
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

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { MDocument } from "@mastra/rag";
import { processingConfig } from "../../config";

/**
 * 文档处理工具 - 将markdown文档分块处理
 */
export const documentProcessTool = createTool({
  id: "document-process-tool",
  description: "处理文档内容，将其分块并提取关键信息",
  inputSchema: z.object({
    content: z.string().describe("文档内容"),
    filePath: z.string().describe("文件路径"),
    chunkStrategy: z
      .literal("semantic-markdown")
      .optional()
      .default(processingConfig.document.chunkStrategy)
      .describe("分块策略"),
    chunkSize: z
      .number()
      .optional()
      .default(processingConfig.document.chunkSize)
      .describe("分块大小"),
    joinThreshold: z
      .number()
      .optional()
      .default(processingConfig.document.joinThreshold)
      .describe("合并阈值"),
  }),
  outputSchema: z.object({
    chunks: z.array(
      z.object({
        content: z.string(),
        source: z.string(),
        title: z.string().optional(),
        section: z.string().optional(),
        id: z.string(),
      })
    ),
    totalChunks: z.number(),
  }),
  execute: async ({ context }) => {
    const { content, filePath, chunkStrategy, joinThreshold } = context;

    try {
      // 使用 Mastra 的文档处理功能
      const doc = MDocument.fromMarkdown(content);

      // 分块处理
      const chunks = await doc.chunk({
        strategy: chunkStrategy,
        joinThreshold,
      });

      // 转换为标准格式
      const processedChunks = chunks.map((chunk, index) => ({
        content: chunk.text,
        source: filePath,
        title: extractTitle(chunk.text),
        section: extractSection(chunk.text),
        id: `${filePath}:${index}`,
      }));

      return {
        chunks: processedChunks,
        totalChunks: processedChunks.length,
      };
    } catch (error) {
      throw new Error(
        `文档处理失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
});

/**
 * 提取文档标题
 */
function extractTitle(content: string): string | undefined {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.replace(/^#+\s*/, "");
    }
  }
  return undefined;
}

/**
 * 提取文档章节
 */
function extractSection(content: string): string | undefined {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/^#+\s*/, "");
    }
  }
  return undefined;
}

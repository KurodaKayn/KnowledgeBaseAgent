import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { RuntimeContext } from "@mastra/core/runtime-context";
import {
  githubSearchTool,
  githubContentTool,
  documentProcessTool,
  vectorStoreTool,
  vectorSearchTool,
} from "../tools";
import { processingConfig } from "../../config";

const checkInitializationStep = createStep({
  id: "check-initialization",
  description: "检查是否需要初始化向量数据库",
  inputSchema: z.object({
    query: z.string(),
    repoUrl: z.string(),
    githubToken: z.string().optional(),
    indexName: z.string(),
    dbPath: z.string().optional(),
    maxResults: z.number(),
    forceReload: z.boolean(),
    batchSize: z.number(),
  }),
  outputSchema: z.object({
    needsInitialization: z.boolean(),
    query: z.string(),
    repoUrl: z.string(),
    githubToken: z.string().optional(),
    indexName: z.string(),
    dbPath: z.string().optional(),
    maxResults: z.number(),
    forceReload: z.boolean(),
    batchSize: z.number(),
  }),
  execute: async ({ inputData }) => {
    if (inputData.forceReload) {
      return {
        needsInitialization: true,
        ...inputData,
      };
    }

    try {
      const testResult = await vectorSearchTool.execute({
        context: {
          query: "test",
          indexName: inputData.indexName,
          maxResults: 1,
          dbPath: inputData.dbPath,
        },
        runtimeContext: new RuntimeContext(),
      });

      return {
        needsInitialization: !testResult.success || testResult.count === 0,
        ...inputData,
      };
    } catch (error) {
      return {
        needsInitialization: true,
        ...inputData,
      };
    }
  },
});

const initializeVectorStoreStep = createStep({
  id: "initialize-vector-store",
  description: "初始化向量数据库：搜索文件 → 处理文档 → 存储向量",
  inputSchema: z.object({
    needsInitialization: z.boolean(),
    query: z.string(),
    repoUrl: z.string(),
    githubToken: z.string().optional(),
    indexName: z.string(),
    dbPath: z.string().optional(),
    maxResults: z.number(),
    forceReload: z.boolean(),
    batchSize: z.number(),
  }),
  outputSchema: z.object({
    initialized: z.boolean(),
    processedFiles: z.number(),
    storedChunks: z.number(),
    message: z.string(),
    query: z.string(),
    indexName: z.string(),
    dbPath: z.string().optional(),
    maxResults: z.number(),
  }),
  execute: async ({ inputData }) => {
    if (!inputData.needsInitialization) {
      return {
        initialized: false,
        processedFiles: 0,
        storedChunks: 0,
        message: "使用现有向量库数据",
        query: inputData.query,
        indexName: inputData.indexName,
        dbPath: inputData.dbPath,
        maxResults: inputData.maxResults,
      };
    }

    // 1. 搜索GitHub文件
    const searchResult = await githubSearchTool.execute({
      context: {
        repoUrl: inputData.repoUrl,
        githubToken: inputData.githubToken,
        path: "",
        recursive: true,
      },
      runtimeContext: new RuntimeContext(),
    });

    if (searchResult.files.length === 0) {
      return {
        initialized: false,
        processedFiles: 0,
        storedChunks: 0,
        message: "仓库中未找到markdown文件",
        query: inputData.query,
        indexName: inputData.indexName,
        dbPath: inputData.dbPath,
        maxResults: inputData.maxResults,
      };
    }

    // 2. 处理文档
    const allChunks: any[] = [];
    let processedFiles = 0;

    for (let i = 0; i < searchResult.files.length; i += inputData.batchSize) {
      const batch = searchResult.files.slice(i, i + inputData.batchSize);
      console.log(
        `处理文件批次 ${Math.floor(i / inputData.batchSize) + 1}/${Math.ceil(searchResult.files.length / inputData.batchSize)}`
      );

      const batchChunks = await Promise.all(
        batch.map(async (file) => {
          try {
            const contentResult = await githubContentTool.execute({
              context: {
                repoUrl: inputData.repoUrl,
                filePath: file.path,
                githubToken: inputData.githubToken,
              },
              runtimeContext: new RuntimeContext(),
            });

            const processResult = await documentProcessTool.execute({
              context: {
                content: contentResult.content,
                filePath: file.path,
                chunkStrategy: processingConfig.document.chunkStrategy,
                chunkSize: processingConfig.document.chunkSize,
                joinThreshold: processingConfig.document.joinThreshold,
              },
              runtimeContext: new RuntimeContext(),
            });

            processedFiles++;
            return processResult.chunks;
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
        initialized: false,
        processedFiles,
        storedChunks: 0,
        message: "没有找到可处理的文档内容",
        query: inputData.query,
        indexName: inputData.indexName,
        dbPath: inputData.dbPath,
        maxResults: inputData.maxResults,
      };
    }

    // 3. 存储到向量数据库
    const storeResult = await vectorStoreTool.execute({
      context: {
        chunks: allChunks,
        indexName: inputData.indexName,
        dbPath: inputData.dbPath,
        batchSize: processingConfig.vector.storeBatchSize,
      },
      runtimeContext: new RuntimeContext(),
    });

    return {
      initialized: true,
      processedFiles,
      storedChunks: storeResult.storedCount,
      message: storeResult.message,
      query: inputData.query,
      indexName: inputData.indexName,
      dbPath: inputData.dbPath,
      maxResults: inputData.maxResults,
    };
  },
});

const searchAndAnswerStep = createStep({
  id: "search-and-answer",
  description: "在向量数据库中搜索并生成答案",
  inputSchema: z.object({
    initialized: z.boolean(),
    processedFiles: z.number(),
    storedChunks: z.number(),
    message: z.string(),
    query: z.string(),
    indexName: z.string(),
    dbPath: z.string().optional(),
    maxResults: z.number(),
  }),
  outputSchema: z.object({
    answer: z.string(),
    sources: z.array(z.string()),
    relevantContext: z.string(),
    query: z.string(),
    initialized: z.boolean(),
    processedFiles: z.number(),
    storedChunks: z.number(),
  }),
  execute: async ({ inputData, mastra }) => {
    // 进行向量搜索
    const searchResult = await vectorSearchTool.execute({
      context: {
        query: inputData.query,
        indexName: inputData.indexName,
        maxResults: inputData.maxResults,
        dbPath: inputData.dbPath,
      },
      runtimeContext: new RuntimeContext(),
    });

    if (!searchResult.success || searchResult.results.length === 0) {
      return {
        answer: "抱歉，我在知识库中没有找到相关信息来回答您的问题。",
        sources: [],
        relevantContext: "",
        query: inputData.query,
        initialized: inputData.initialized,
        processedFiles: inputData.processedFiles,
        storedChunks: inputData.storedChunks,
      };
    }

    // 构建上下文和来源
    const relevantContext = searchResult.results
      .map((result) => `来源: ${result.source}\n${result.content}`)
      .join("\n\n---\n\n");

    const sources = [
      ...new Set(searchResult.results.map((result) => result.source)),
    ];

    // 生成答案
    const contextPrompt = `基于以下搜索结果，请用中文详细回答用户的问题："${inputData.query}"

搜索结果:
${relevantContext}

请提供一个准确、详细的中文答案，并在答案中明确指出信息来源。如果信息不足，请诚实说明。`;

    const agent = mastra?.getAgent("knowledgeAgent");
    if (!agent) {
      return {
        answer: "系统错误：无法访问知识代理",
        sources,
        relevantContext,
        query: inputData.query,
        initialized: inputData.initialized,
        processedFiles: inputData.processedFiles,
        storedChunks: inputData.storedChunks,
      };
    }

    try {
      const { text } = await agent.generate([
        { role: "user", content: contextPrompt },
      ]);

      return {
        answer: text || "无法生成答案",
        sources,
        relevantContext,
        query: inputData.query,
        initialized: inputData.initialized,
        processedFiles: inputData.processedFiles,
        storedChunks: inputData.storedChunks,
      };
    } catch (error) {
      return {
        answer: `生成答案时出错: ${error instanceof Error ? error.message : String(error)}`,
        sources,
        relevantContext,
        query: inputData.query,
        initialized: inputData.initialized,
        processedFiles: inputData.processedFiles,
        storedChunks: inputData.storedChunks,
      };
    }
  },
});

export const githubRagWorkflow = createWorkflow({
  id: "github-rag-workflow",
  description: "GitHub RAG工作流：智能检查 → 条件初始化 → 向量搜索 → 生成答案",
  inputSchema: z.object({
    query: z.string().describe("用户查询内容"),
    repoUrl: z.string().describe("GitHub仓库URL，格式为 owner/repo"),
    githubToken: z.string().optional().describe("GitHub访问令牌"),
    indexName: z
      .string()
      .optional()
      .default(processingConfig.vector.defaultIndexName)
      .describe("向量索引名称"),
    dbPath: z.string().optional().describe("数据库路径"),
    maxResults: z
      .number()
      .optional()
      .default(processingConfig.workflow.maxResults)
      .describe("最大搜索结果数"),
    forceReload: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否强制重新初始化"),
    batchSize: z
      .number()
      .optional()
      .default(processingConfig.workflow.batchSize)
      .describe("文档处理批次大小"),
  }),
  outputSchema: z.object({
    answer: z.string(),
    sources: z.array(z.string()),
    relevantContext: z.string(),
    query: z.string(),
    initialized: z.boolean().describe("是否进行了初始化"),
    processedFiles: z.number().describe("处理的文件数量"),
    storedChunks: z.number().describe("存储的文档块数量"),
  }),
})
  .map(async ({ inputData }) => {
    return {
      query: inputData.query,
      repoUrl: inputData.repoUrl,
      githubToken: inputData.githubToken,
      indexName:
        inputData.indexName || processingConfig.vector.defaultIndexName,
      dbPath: inputData.dbPath,
      maxResults: inputData.maxResults || processingConfig.workflow.maxResults,
      forceReload: inputData.forceReload || false,
      batchSize: inputData.batchSize || processingConfig.workflow.batchSize,
    };
  })
  .then(checkInitializationStep)
  .then(initializeVectorStoreStep)
  .then(searchAndAnswerStep)
  .commit();

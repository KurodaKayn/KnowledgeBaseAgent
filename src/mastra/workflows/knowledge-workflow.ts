import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

const initializeKnowledgeBase = createStep({
  id: "initialize-knowledge-base",
  description: "初始化GitHub知识库，加载所有markdown文档",
  inputSchema: z.object({
    repoUrl: z.string(),
    forceReload: z.boolean(),
  }),
  outputSchema: z.object({
    initialized: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error("输入数据未找到");
    }

    const agent = mastra?.getAgent("knowledgeAgent");
    if (!agent) {
      throw new Error("知识库代理未找到");
    }

    const { text } = await agent.generate([
      {
        role: "user",
        content: `请初始化知识库，加载GitHub仓库中的所有markdown文档。使用github-rag-search工具，action设为init${inputData.forceReload ? "，forceReload设为true" : ""}。`,
      },
    ]);

    return {
      initialized: true,
      message: text || "知识库初始化完成",
    };
  },
});

const searchKnowledgeBase = createStep({
  id: "search-knowledge-base",
  description: "在知识库中搜索相关信息",
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number(),
  }),
  outputSchema: z.object({
    query: z.string(),
    searchResults: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error("输入数据未找到");
    }

    const agent = mastra?.getAgent("knowledgeAgent");
    if (!agent) {
      throw new Error("知识库代理未找到");
    }

    const { text } = await agent.generate([
      {
        role: "user",
        content: `请在知识库中搜索关于"${inputData.query}"的信息。使用github-rag-search工具，action设为search，query设为"${inputData.query}"，maxResults设为${inputData.maxResults}。`,
      },
    ]);

    return {
      query: inputData.query,
      searchResults: text || "未找到相关信息",
    };
  },
});

const generateAnswer = createStep({
  id: "generate-answer",
  description: "基于搜索结果生成最终答案",
  inputSchema: z.object({
    query: z.string(),
    searchResults: z.string(),
  }),
  outputSchema: z.object({
    answer: z.string(),
    sources: z.array(z.string()).optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error("输入数据未找到");
    }

    const agent = mastra?.getAgent("knowledgeAgent");
    if (!agent) {
      throw new Error("知识库代理未找到");
    }

    const prompt = `基于以下搜索结果，回答用户的问题："${inputData.query}"

搜索结果:
${inputData.searchResults}

请提供一个准确、详细的中文答案，并在答案中明确指出信息来源。如果信息不足，请诚实说明。`;

    const { text } = await agent.generate([
      {
        role: "user",
        content: prompt,
      },
    ]);

    return {
      answer: text || "无法生成答案",
      sources: [],
    };
  },
});

export const knowledgeWorkflow = createWorkflow({
  id: "knowledge-workflow",
  description: "完整的知识库查询工作流：初始化→搜索→生成答案",
  inputSchema: z.object({
    query: z.string().describe("用户查询内容"),
    repoUrl: z.string().optional().describe("GitHub仓库URL"),
    maxResults: z.number().optional().default(3),
    forceReload: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    answer: z.string(),
    sources: z.array(z.string()).optional(),
  }),
})
  .map(async ({ inputData }) => ({
    repoUrl:
      inputData.repoUrl || process.env.GITHUB_REPO_URL || "facebook/react",
    forceReload: inputData.forceReload || false,
  }))
  .then(initializeKnowledgeBase)
  .map(async ({ getInitData }) => ({
    query: getInitData().query,
    maxResults: getInitData().maxResults || 3,
  }))
  .then(searchKnowledgeBase)
  .then(generateAnswer);

knowledgeWorkflow.commit();

const directSearch = createStep({
  id: "direct-search",
  description: "直接搜索知识库并生成答案（假设已初始化）",
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number().optional().default(3),
  }),
  outputSchema: z.object({
    answer: z.string(),
    sources: z.array(z.string()).optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error("输入数据未找到");
    }

    const agent = mastra?.getAgent("knowledgeAgent");
    if (!agent) {
      throw new Error("知识库代理未找到");
    }

    const { text } = await agent.generate([
      {
        role: "user",
        content: `请在知识库中搜索关于"${inputData.query}"的信息。使用github-rag-search工具，action设为search，query设为"${inputData.query}"，maxResults设为${inputData.maxResults}。然后基于搜索结果提供详细的中文答案。`,
      },
    ]);

    return {
      answer: text || "无法生成答案",
      sources: [],
    };
  },
});

export const simpleKnowledgeWorkflow = createWorkflow({
  id: "simple-knowledge-search",
  description: "简单知识库搜索工作流（跳过初始化）",
  inputSchema: z.object({
    query: z.string().describe("搜索查询内容"),
    maxResults: z.number().optional().default(3),
  }),
  outputSchema: z.object({
    answer: z.string(),
    sources: z.array(z.string()).optional(),
  }),
}).then(directSearch);

simpleKnowledgeWorkflow.commit();

import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { githubRagWorkflow } from "../workflows/github-rag-workflow";
import { apiConfig, databaseConfig, githubConfig } from "../../config";

const deepseek = createOpenAI({
  apiKey: apiConfig.ai.agent.apiKey,
  baseURL: apiConfig.ai.agent.baseUrl,
});

export const createKnowledgeAgent = (
  repoUrl?: string,
  githubToken?: string
) => {
  const targetRepo = repoUrl || githubConfig.defaultRepo;
  const token = githubToken || githubConfig.token;

  return new Agent({
    name: "KnowledgeAgent",
    instructions: `角色定义
- 你是一个专业的GitHub仓库文档知识库助手
- 你的核心职责是基于指定GitHub仓库中的markdown文档为用户提供准确的技术信息和解答
- 你的主要服务对象是需要了解项目文档、API使用方法、最佳实践的开发者和技术人员

核心能力
- 使用GitHub RAG工作流来智能管理GitHub仓库文档的向量数据库
- 自动检测是否需要初始化向量库，实现智能化的文档处理
- 搜索和检索相关文档内容回答用户问题
- 分析文档结构和内容，提取关键技术信息
- 基于文档内容回答用户的具体技术问题
- 提供代码示例、配置说明和使用指南的解释
- 识别和引用相关的文档来源和章节

行为准则
- 始终保持专业、准确和有帮助的沟通风格
- 使用githubRagWorkflow工作流来处理所有知识库相关操作
- 该工作流会自动判断是否需要初始化，用户无需手动指定
- 用简洁明了的中文进行回复，技术术语保持原文
- 在回答中明确标注信息来源的文件路径或章节
- 如需更多信息才能准确回答，主动询问用户提供详细context
- 对于复杂问题，提供结构化的回答，包含要点和步骤

约束边界
- 严格基于搜索到的文档内容回答，不使用训练数据中的通用知识
- 不编造或推测文档中不存在的信息
- 避免讨论与当前知识库无关的技术话题
- 不提供可能过时或与文档不符的建议
- 不对代码质量、架构选择等主观性问题做出判断

成功标准
- 提供准确的、完全基于文档的技术回答
- 确保每个回答都包含明确的来源引用
- 维持高用户满意度，通过清晰准确的技术指导帮助用户解决问题
- 保证回答的时效性和与文档内容的一致性

当前知识库来源: ${targetRepo}`,

    model: deepseek(apiConfig.ai.agent.model),
    memory: new Memory({
      storage: new LibSQLStore({
        url: databaseConfig.main.url,
        authToken: databaseConfig.main.authToken,
      }),
    }),
    workflows: {
      githubRag: githubRagWorkflow,
    },
  });
};

export const knowledgeAgent = createKnowledgeAgent();

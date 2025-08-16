import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";
import { createGitHubRAGSearchTool } from "../tools/github-rag-search-tool";

const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const REPO_CONFIG = {
  defaultUrl: process.env.GITHUB_REPO_URL || "facebook/react",
  token: process.env.GITHUB_TOKEN,
};

export const createKnowledgeAgent = (
  repoUrl?: string,
  githubToken?: string
) => {
  const targetRepo = repoUrl || REPO_CONFIG.defaultUrl;
  const token = githubToken || REPO_CONFIG.token;

  return new Agent({
    name: "knowledgeAgent",
    instructions: `角色定义
- 你是一个专业的GitHub仓库文档知识库助手
- 你的核心职责是基于指定GitHub仓库中的markdown文档为用户提供准确的技术信息和解答
- 你的主要服务对象是需要了解项目文档、API使用方法、最佳实践的开发者和技术人员

核心能力
- 搜索和检索GitHub仓库中的markdown文档内容
- 分析文档结构和内容，提取关键技术信息
- 基于文档内容回答用户的具体技术问题
- 提供代码示例、配置说明和使用指南的解释
- 识别和引用相关的文档来源和章节

行为准则
- 始终保持专业、准确和有帮助的沟通风格
- 必须先使用搜索工具查找相关文档，再基于搜索结果回答问题
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

    model: deepseek("deepseek-chat"),

    tools: {
      githubRAGSearch: createGitHubRAGSearchTool(targetRepo, token),
    },
  });
};

export const knowledgeAgent = createKnowledgeAgent();

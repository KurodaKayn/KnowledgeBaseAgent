## Introduction

本项目为使用Mastra这一TypeScript框架构建的AI Agent项目，具备以下功能：

- **知识库智能问答**：基于GitHub仓库文档的AI助手
- **向量化搜索**：使用语义搜索技术提供精准答案
- **对话记忆**：支持聊天记录保存和上下文理解
- **工作流引擎**：支持复杂的多步骤AI工作流

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 环境变量配置

在项目根目录创建 `.env` 文件，配置以下必需变量：

```bash
#necessary
AGENT_KEY=sk-XXXXXXXX
EMBEDDING_AI_KEY=sk-XXXXXX

AGENT_URL="https://api.deepseek.com"
EMBEDDING_AI_URL="https://aihubmix.com/v1"

#optional
GITHUB_TOKEN=XXXXXXXXXX   #如果是public的仓库没有也没关系，但是可能会导致请求次数受限
```

### 3. 运行项目

```bash
# 开发模式
npm run dev

# 构建项目
npm run build

# 生产模式
npm run start
```

### 4. 使用知识库Agent

项目启动后，knowledge-agent会自动：

1. **首次运行**：检测目标GitHub仓库，下载并向量化所有markdown文档
2. **后续运行**：使用缓存的向量数据，直接提供搜索服务
3. **智能问答**：基于仓库文档内容回答技术问题
4. **记忆对话**：保存聊天历史，支持上下文理解

## 项目特性

### 智能RAG系统

- **语义搜索**：理解查询意图而非简单关键词匹配
- **文档分块**：智能分割长文档，提取精准片段
- **向量缓存**：首次处理后永久缓存，大幅提升响应速度

### 持久化记忆

- **对话历史**：自动保存所有聊天记录
- **语义召回**：从历史对话中找到相关上下文
- **工作记忆**：记住用户偏好和重要信息

### 性能优化

- **批量处理**：分批处理大量文档，避免API限制
- **智能缓存**：避免重复计算嵌入向量
- **增量更新**：支持仓库内容更新时的增量处理

## 注意事项

构建后首次使用会因为还没有处理好数据而导致回复较慢，尤其是当仓库中的markdown文本数量极大时
可以在控制台中查看过程
效果如下

```
处理文件批次 1/8
处理文件批次 2/8
处理文件批次 3/8
处理文件批次 4/8
处理文件批次 5/8
处理文件批次 6/8
处理文件批次 7/8
处理文件批次 8/8
生成嵌入向量批次 1/14
.
.
.
生成嵌入向量批次 14/14
存储向量批次 1/27
.
.
.
存储向量批次 27/27
```

## 参考文档

- [Mastra官方文档](https://mastra.ai/docs)
- [RAG构建指南](https://dev.to/couchbase/building-multi-agent-workflows-using-mastra-ai-and-couchbase-198n)

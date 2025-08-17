/**
 * 应用配置类型定义
 */

export interface ApiConfig {
  /** AI模型配置 */
  ai: {
    /** Agent使用的AI服务配置 */
    agent: {
      apiKey: string;
      baseUrl: string;
      model: string;
    };
    /** 嵌入模型配置 */
    embedding: {
      apiKey: string;
      baseUrl: string;
      model: string;
      dimension: number;
    };
  };
}

export interface DatabaseConfig {
  /** 主数据库配置 */
  main: {
    url: string;
    authToken?: string;
  };
  /** 向量数据库配置 */
  vector: {
    url: string;
    authToken?: string;
  };
}

export interface GitHubConfig {
  /** 默认仓库URL */
  defaultRepo: string;
  /** GitHub访问令牌 */
  token?: string;
}

export interface ProcessingConfig {
  /** 文档处理配置 */
  document: {
    /** 分块策略 */
    chunkStrategy: "semantic-markdown";
    /** 默认分块大小 */
    chunkSize: number;
    /** 合并阈值 */
    joinThreshold: number;
  };
  /** 向量处理配置 */
  vector: {
    /** 默认索引名称 */
    defaultIndexName: string;
    /** 嵌入批处理大小 */
    embeddingBatchSize: number;
    /** 存储批处理大小 */
    storeBatchSize: number;
    /** API调用延迟（毫秒） */
    apiDelay: number;
  };
  /** 工作流配置 */
  workflow: {
    /** 默认最大搜索结果数 */
    maxResults: number;
    /** 文档处理批次大小 */
    batchSize: number;
  };
}

export interface LoggingConfig {
  /** 日志器名称 */
  name: string;
  /** 日志级别 */
  level: "debug" | "info" | "warn" | "error";
}

/**
 * 完整的应用配置接口
 */
export interface AppConfig {
  api: ApiConfig;
  database: DatabaseConfig;
  github: GitHubConfig;
  processing: ProcessingConfig;
  logging: LoggingConfig;
}

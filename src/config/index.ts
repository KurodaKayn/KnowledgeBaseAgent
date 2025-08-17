import { AppConfig } from "./types";

/**
 * 获取环境变量，支持默认值
 */
function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

/**
 * 获取可选的环境变量
 */
function getOptionalEnvVar(key: string): string | undefined {
  return process.env[key];
}

/**
 * 创建应用配置
 */
export function createAppConfig(): AppConfig {
  return {
    api: {
      ai: {
        agent: {
          apiKey: getEnvVar("AGENT_KEY"),
          baseUrl: getEnvVar("AGENT_URL"),
          model: getEnvVar("AGENT_MODEL", "deepseek-chat"),
        },
        embedding: {
          apiKey: getEnvVar("EMBEDDING_AI_KEY"),
          baseUrl: getEnvVar("EMBEDDING_AI_URL", "https://api.openai.com/v1"),
          model: getEnvVar("EMBEDDING_MODEL", "text-embedding-3-small"),
          dimension: parseInt(getEnvVar("EMBEDDING_DIMENSION", "1536")),
        },
      },
    },
    database: {
      main: {
        url: getEnvVar("DATABASE_URL", "file:../mastra.db"),
        authToken: getOptionalEnvVar("DATABASE_AUTH_TOKEN"),
      },
      vector: {
        url: getEnvVar("VECTOR_DATABASE_URL", "file:vector-store.db"),
        authToken: getOptionalEnvVar("VECTOR_DATABASE_AUTH_TOKEN"),
      },
    },
    github: {
      defaultRepo: getEnvVar("GITHUB_REPO_URL", "facebook/react"),
      token: getOptionalEnvVar("GITHUB_TOKEN"),
    },
    processing: {
      document: {
        chunkStrategy: "semantic-markdown",
        chunkSize: parseInt(getEnvVar("CHUNK_SIZE", "1000")),
        joinThreshold: parseInt(getEnvVar("JOIN_THRESHOLD", "500")),
      },
      vector: {
        defaultIndexName: getEnvVar("DEFAULT_INDEX_NAME", "github_docs"),
        embeddingBatchSize: parseInt(getEnvVar("EMBEDDING_BATCH_SIZE", "50")),
        storeBatchSize: parseInt(getEnvVar("STORE_BATCH_SIZE", "25")),
        apiDelay: parseInt(getEnvVar("API_DELAY", "200")),
      },
      workflow: {
        maxResults: parseInt(getEnvVar("MAX_SEARCH_RESULTS", "5")),
        batchSize: parseInt(getEnvVar("WORKFLOW_BATCH_SIZE", "10")),
      },
    },
    logging: {
      name: getEnvVar("LOGGER_NAME", "Mastra"),
      level: getEnvVar("LOG_LEVEL", "info") as any,
    },
  };
}

/**
 * 全局配置实例
 */
export const config = createAppConfig();

/**
 * 导出配置的各个部分以便于使用
 */
export const {
  api: apiConfig,
  database: databaseConfig,
  github: githubConfig,
  processing: processingConfig,
  logging: loggingConfig,
} = config;

// 导出类型
export * from "./types";

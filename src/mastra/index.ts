import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { githubRagWorkflow } from "./workflows";
import { knowledgeAgent } from "./agents/knowledge-agent";
import { databaseConfig, loggingConfig } from "../config";

export const mastra = new Mastra({
  workflows: {
    githubRagWorkflow,
  },
  agents: { knowledgeAgent },
  storage: new LibSQLStore({
    url: databaseConfig.main.url,
    authToken: databaseConfig.main.authToken,
  }),
  logger: new PinoLogger({
    name: loggingConfig.name,
    level: loggingConfig.level,
  }),
});

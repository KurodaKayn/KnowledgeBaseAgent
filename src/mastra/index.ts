import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { githubRagWorkflow } from "./workflows";
import { knowledgeAgent } from "./agents/knowledge-agent";

export const mastra = new Mastra({
  workflows: {
    githubRagWorkflow,
  },
  agents: { knowledgeAgent },
  storage: new LibSQLStore({
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
});

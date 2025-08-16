import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import {
  knowledgeWorkflow,
  simpleKnowledgeWorkflow,
} from "./workflows/knowledge-workflow";
import { knowledgeAgent } from "./agents/knowledge-agent";

export const mastra = new Mastra({
  workflows: {
    knowledgeWorkflow,
    simpleKnowledgeWorkflow,
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

import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { weatherWorkflow } from "./workflows/weather-workflow";
import {
  knowledgeWorkflow,
  simpleKnowledgeWorkflow,
} from "./workflows/knowledge-workflow";
import { weatherAgent } from "./agents/weather-agent";
import { knowledgeAgent } from "./agents/knowledge-agent";

export const mastra = new Mastra({
  workflows: {
    weatherWorkflow,
    knowledgeWorkflow,
    simpleKnowledgeWorkflow,
  },
  agents: { weatherAgent, knowledgeAgent },
  storage: new LibSQLStore({
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
});

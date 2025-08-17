import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { githubConfig } from "../../config";

/**
 * GitHub文件内容获取工具
 */
export const githubContentTool = createTool({
  id: "github-content-tool",
  description: "获取GitHub仓库中指定文件的内容",
  inputSchema: z.object({
    repoUrl: z.string().describe("GitHub仓库URL，格式为 owner/repo"),
    filePath: z.string().describe("文件路径"),
    githubToken: z.string().optional().describe("GitHub访问令牌"),
  }),
  outputSchema: z.object({
    content: z.string(),
    filePath: z.string(),
    sha: z.string(),
  }),
  execute: async ({ context }) => {
    const { repoUrl, filePath, githubToken } = context;
    const [owner, repo] = repoUrl.split("/");

    const octokit = new Octokit({
      auth: githubToken || githubConfig.token,
    });

    try {
      const response = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      if ("content" in response.data) {
        const content = Buffer.from(response.data.content, "base64").toString(
          "utf-8"
        );
        return {
          content,
          filePath,
          sha: response.data.sha,
        };
      }

      throw new Error("文件内容获取失败");
    } catch (error) {
      throw new Error(
        `获取文件内容失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
});

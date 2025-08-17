import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Octokit } from "@octokit/rest";

/**
 * GitHub搜索工具 - 获取GitHub仓库中的markdown文件
 */
export const githubSearchTool = createTool({
  id: "github-search-tool",
  description: "搜索GitHub仓库中的markdown文件",
  inputSchema: z.object({
    repoUrl: z.string().describe("GitHub仓库URL，格式为 owner/repo"),
    githubToken: z.string().optional().describe("GitHub访问令牌"),
    path: z.string().optional().default("").describe("搜索路径"),
    recursive: z.boolean().optional().default(true).describe("是否递归搜索"),
  }),
  outputSchema: z.object({
    files: z.array(z.object({
      name: z.string(),
      path: z.string(),
      sha: z.string(),
    })),
    totalCount: z.number(),
  }),
  execute: async ({ context }) => {
    const { repoUrl, githubToken, path, recursive } = context;
    const [owner, repo] = repoUrl.split("/");

    const octokit = new Octokit({
      auth: githubToken || process.env.GITHUB_TOKEN,
    });

    const files: Array<{ name: string; path: string; sha: string }> = [];

    async function getMarkdownFiles(searchPath: string, isRecursive: boolean): Promise<void> {
      try {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: searchPath,
        });

        const contents = Array.isArray(response.data) ? response.data : [response.data];

        for (const item of contents) {
          if ("type" in item) {
            if (item.type === "file" && item.name.toLowerCase().endsWith(".md")) {
              files.push({
                name: item.name,
                path: item.path,
                sha: item.sha,
              });
            } else if (item.type === "dir" && isRecursive) {
              await getMarkdownFiles(item.path, isRecursive);
            }
          }
        }
      } catch (error) {
        console.warn(`搜索路径 ${searchPath} 时出错:`, error);
      }
    }

    await getMarkdownFiles(path || "", recursive || true);

    return {
      files,
      totalCount: files.length,
    };
  },
});
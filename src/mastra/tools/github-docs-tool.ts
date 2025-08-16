import { createTool } from "@mastra/core/tools";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

export interface GitHubFile {
  name: string;
  path: string;
  content: string;
  sha: string;
}

class GitHubDocsService {
  private octokit: Octokit;
  private repoOwner: string;
  private repoName: string;

  constructor(repoUrl: string, githubToken?: string) {
    const [owner, repo] = repoUrl.split("/");

    this.octokit = new Octokit({
      auth: githubToken || process.env.GITHUB_TOKEN,
    });

    this.repoOwner = owner;
    this.repoName = repo;
  }

  async getDocuments({
    path = "",
    recursive = true,
  }: {
    path?: string;
    recursive?: boolean;
  }) {
    const markdownFiles = await this.getMarkdownFiles(path, recursive);

    const filesWithContent = await Promise.all(
      markdownFiles.map(async (file) => {
        const content = await this.getFileContent(file.path);
        return {
          name: file.name,
          path: file.path,
          content,
          sha: file.sha,
        };
      })
    );

    return {
      success: true,
      files: filesWithContent,
      count: filesWithContent.length,
    };
  }

  private async getMarkdownFiles(
    path: string,
    recursive: boolean
  ): Promise<Array<{ name: string; path: string; sha: string }>> {
    const files: Array<{ name: string; path: string; sha: string }> = [];

    const response = await this.octokit.rest.repos.getContent({
      owner: this.repoOwner,
      repo: this.repoName,
      path,
    });

    const contents = Array.isArray(response.data)
      ? response.data
      : [response.data];

    for (const item of contents) {
      if ("type" in item) {
        if (item.type === "file" && item.name.toLowerCase().endsWith(".md")) {
          files.push({
            name: item.name,
            path: item.path,
            sha: item.sha,
          });
        } else if (item.type === "dir" && recursive) {
          const subFiles = await this.getMarkdownFiles(item.path, recursive);
          files.push(...subFiles);
        }
      }
    }

    return files;
  }

  private async getFileContent(filePath: string): Promise<string> {
    const response = await this.octokit.rest.repos.getContent({
      owner: this.repoOwner,
      repo: this.repoName,
      path: filePath,
    });

    if ("content" in response.data) {
      return Buffer.from(response.data.content, "base64").toString("utf-8");
    }

    return "";
  }
}

export const createGitHubDocsTool = (repoUrl: string, githubToken?: string) => {
  const service = new GitHubDocsService(repoUrl, githubToken);

  return createTool({
    id: "github-docs-reader",
    description: "读取GitHub仓库中的markdown文档",
    inputSchema: z.object({
      path: z.string().optional().describe("仓库中的路径，默认为根目录"),
      recursive: z
        .boolean()
        .optional()
        .default(true)
        .describe("是否递归搜索子目录"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      files: z
        .array(
          z.object({
            name: z.string(),
            path: z.string(),
            content: z.string(),
            sha: z.string(),
          })
        )
        .optional(),
      count: z.number().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ context }) => {
      return await service.getDocuments({
        path: context.path,
        recursive: context.recursive,
      });
    },
  });
};

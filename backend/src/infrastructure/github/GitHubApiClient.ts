import { Octokit } from '@octokit/rest';
import {
  IGitHubApiClient,
  RepoInfo,
  BranchInfo,
  CreatePrParams,
  PrInfo,
} from './IGitHubApiClient';

// Re-export types for backward compatibility
export { RepoInfo, BranchInfo, CreatePrParams, PrInfo };

/**
 * Client for GitHub API operations
 * Handles PR creation, repo info fetching
 * Implements IGitHubApiClient port from domain
 */
export class GitHubApiClient implements IGitHubApiClient {
  private octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit({
      auth: token || process.env.GITHUB_TOKEN,
    });
  }

  async getRepoInfo(owner: string, repo: string): Promise<RepoInfo> {
    const { data } = await this.octokit.repos.get({
      owner,
      repo,
    });

    return {
      owner: data.owner.login,
      name: data.name,
      defaultBranch: data.default_branch,
      private: data.private,
    };
  }

  async listBranches(owner: string, repo: string): Promise<BranchInfo[]> {
    // First get repo info for default branch
    const repoInfo = await this.getRepoInfo(owner, repo);

    // Then list all branches
    const { data } = await this.octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    return data.map(branch => ({
      name: branch.name,
      isDefault: branch.name === repoInfo.defaultBranch,
    }));
  }

  async createPullRequest(params: CreatePrParams): Promise<PrInfo> {
    const { data } = await this.octokit.pulls.create({
      owner: params.owner,
      repo: params.repo,
      title: params.title,
      body: params.body,
      head: params.head,
      base: params.base,
    });

    return {
      number: data.number,
      url: data.html_url,
      title: data.title,
    };
  }

  async branchExists(owner: string, repo: string, branch: string): Promise<boolean> {
    try {
      await this.octokit.repos.getBranch({
        owner,
        repo,
        branch,
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 404) {
        return false;
      }
      throw error;
    }
  }

  async forkRepository(owner: string, repo: string): Promise<{ owner: string; name: string }> {
    const { data } = await this.octokit.repos.createFork({
      owner,
      repo,
    });

    return {
      owner: data.owner.login,
      name: data.name,
    };
  }
}

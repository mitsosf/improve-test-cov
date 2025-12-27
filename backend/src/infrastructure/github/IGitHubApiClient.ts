/**
 * Port for GitHub API operations (PR creation, repo info)
 * Infrastructure provides the adapter implementation
 */

export interface RepoInfo {
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
}

export interface BranchInfo {
  name: string;
  isDefault: boolean;
}

export interface CreatePrParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PrInfo {
  number: number;
  url: string;
  title: string;
}

export interface IGitHubApiClient {
  /**
   * Get repository information
   */
  getRepoInfo(owner: string, repo: string): Promise<RepoInfo>;

  /**
   * List branches in a repository
   */
  listBranches(owner: string, repo: string): Promise<BranchInfo[]>;

  /**
   * Create a pull request
   */
  createPullRequest(params: CreatePrParams): Promise<PrInfo>;

  /**
   * Check if a branch exists
   */
  branchExists(owner: string, repo: string, branch: string): Promise<boolean>;
}

export const GITHUB_API_CLIENT = Symbol('IGitHubApiClient');

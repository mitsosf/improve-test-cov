/**
 * Port for Git operations (clone, branch, commit, push)
 * Infrastructure provides the adapter implementation
 */

export interface CloneOptions {
  repoUrl: string;
  targetDir: string;
  branch?: string;
}

export interface CommitAndPushOptions {
  workDir: string;
  branch: string;
  message: string;
  files: string[];
}

export interface IGitHubService {
  /**
   * Clone a repository to a target directory
   */
  clone(options: CloneOptions): Promise<void>;

  /**
   * Create a new branch in the repository
   */
  createBranch(workDir: string, branchName: string): Promise<void>;

  /**
   * Commit and push changes to remote
   */
  commitAndPush(options: CommitAndPushOptions): Promise<void>;

  /**
   * Clean up a working directory
   */
  cleanupWorkDir(workDir: string): Promise<void>;

  /**
   * Generate a unique branch name for a file
   */
  generateBranchName(filePath: string): string;

  /**
   * Get a temporary directory path for a job
   */
  getTempDir(jobId: string): string;
}

export const GITHUB_SERVICE = Symbol('IGitHubService');

import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { IGitHubService, CloneOptions, CommitAndPushOptions } from './IGitHubService';
import { GitHubApiClient, PrInfo } from './GitHubApiClient';

// Re-export types for backward compatibility
export { CloneOptions, CommitAndPushOptions };

export interface CreatePrOptions {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
}

/**
 * Service for Git operations (clone, branch, commit, push)
 * Executed on the host machine (not in sandbox) for security
 * Implements IGitHubService port from domain
 */
export class GitHubService implements IGitHubService {
  private apiClient: GitHubApiClient;
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN || '';
    this.apiClient = new GitHubApiClient(this.token);
  }

  private createGit(workDir: string): SimpleGit {
    const options: Partial<SimpleGitOptions> = {
      baseDir: workDir,
      binary: 'git',
      maxConcurrentProcesses: 1,
    };
    return simpleGit(options);
  }

  async clone(options: CloneOptions): Promise<void> {
    const { repoUrl, targetDir, branch } = options;

    // Ensure target directory exists
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Add token to URL for private repos
    const authenticatedUrl = this.getAuthenticatedUrl(repoUrl);

    const git = simpleGit();
    const cloneOptions = branch ? ['--branch', branch, '--single-branch'] : [];

    await git.clone(authenticatedUrl, targetDir, cloneOptions);
  }

  async createBranch(workDir: string, branchName: string): Promise<void> {
    const git = this.createGit(workDir);
    await git.checkoutLocalBranch(branchName);
  }

  async commitAndPush(options: CommitAndPushOptions): Promise<void> {
    const { workDir, branch, message, files } = options;
    const git = this.createGit(workDir);

    // Configure git user for commit
    await git.addConfig('user.email', 'coverage-improver@automated.local');
    await git.addConfig('user.name', 'Coverage Improver Bot');

    // Stage files
    await git.add(files);

    // Commit
    await git.commit(message);

    // Push to remote
    await git.push('origin', branch, ['--set-upstream']);
  }

  async createPullRequest(options: CreatePrOptions): Promise<PrInfo> {
    return this.apiClient.createPullRequest({
      owner: options.owner,
      repo: options.repo,
      title: options.title,
      body: options.body,
      head: options.branch,
      base: options.baseBranch,
    });
  }

  async getRepoInfo(owner: string, repo: string) {
    return this.apiClient.getRepoInfo(owner, repo);
  }

  async cleanupWorkDir(workDir: string): Promise<void> {
    if (existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  generateBranchName(filePath: string): string {
    const fileName = filePath.split('/').pop()?.replace('.ts', '') || 'file';
    const timestamp = Date.now();
    return `improve-coverage/${fileName}-${timestamp}`;
  }

  getTempDir(jobId: string): string {
    const baseDir = process.env.TEMP_DIR || join(process.cwd(), 'tmp');
    return join(baseDir, `job-${jobId}`);
  }

  private getAuthenticatedUrl(repoUrl: string): string {
    if (!this.token) {
      return repoUrl;
    }

    // Convert HTTPS URL to include token
    // https://github.com/user/repo.git -> https://token@github.com/user/repo.git
    if (repoUrl.startsWith('https://github.com')) {
      return repoUrl.replace('https://github.com', `https://${this.token}@github.com`);
    }

    return repoUrl;
  }
}

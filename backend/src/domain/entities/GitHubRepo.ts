import { v4 as uuidv4 } from 'uuid';

export interface GitHubRepoProps {
  id?: string;
  url: string;
  owner: string;
  name: string;
  branch: string;           // The tracked branch
  defaultBranch: string;    // The repo's default branch (for reference)
  lastAnalyzedAt?: Date | null;
  createdAt?: Date;
}

/**
 * Entity representing a GitHub repository being tracked for coverage
 */
export class GitHubRepo {
  private readonly _id: string;
  private readonly _url: string;
  private readonly _owner: string;
  private readonly _name: string;
  private readonly _branch: string;
  private readonly _defaultBranch: string;
  private _lastAnalyzedAt: Date | null;
  private readonly _createdAt: Date;

  private constructor(props: GitHubRepoProps) {
    this._id = props.id || uuidv4();
    this._url = props.url;
    this._owner = props.owner;
    this._name = props.name;
    this._branch = props.branch;
    this._defaultBranch = props.defaultBranch;
    this._lastAnalyzedAt = props.lastAnalyzedAt || null;
    this._createdAt = props.createdAt || new Date();
  }

  static create(props: Omit<GitHubRepoProps, 'id' | 'createdAt'>): GitHubRepo {
    GitHubRepo.validateUrl(props.url);
    return new GitHubRepo(props);
  }

  static reconstitute(props: GitHubRepoProps): GitHubRepo {
    return new GitHubRepo(props);
  }

  static fromGitHubUrl(url: string): { owner: string; name: string } {
    const match = url.match(/github\.com[/:](.+?)\/(.+?)(?:\.git)?$/);
    if (!match) {
      throw new Error(`Invalid GitHub URL: ${url}`);
    }
    return { owner: match[1], name: match[2] };
  }

  private static validateUrl(url: string): void {
    if (!url || url.trim() === '') {
      throw new Error('Repository URL cannot be empty');
    }
    if (!url.includes('github.com')) {
      throw new Error('Only GitHub repositories are supported');
    }
  }

  get id(): string {
    return this._id;
  }

  get url(): string {
    return this._url;
  }

  get owner(): string {
    return this._owner;
  }

  get name(): string {
    return this._name;
  }

  get branch(): string {
    return this._branch;
  }

  get fullName(): string {
    return `${this._owner}/${this._name}`;
  }

  get defaultBranch(): string {
    return this._defaultBranch;
  }

  get lastAnalyzedAt(): Date | null {
    return this._lastAnalyzedAt;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get cloneUrl(): string {
    return `https://github.com/${this._owner}/${this._name}.git`;
  }

  markAsAnalyzed(): void {
    this._lastAnalyzedAt = new Date();
  }

  equals(other: GitHubRepo): boolean {
    return this._id === other._id;
  }
}

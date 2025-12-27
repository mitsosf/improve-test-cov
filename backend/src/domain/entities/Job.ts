import { v4 as uuidv4 } from 'uuid';
import { JobStatus } from '../value-objects/JobStatus';
import { GitHubPrUrl } from '../value-objects/GitHubPrUrl';

export type JobType = 'analysis' | 'improvement';
export type AiProvider = 'claude' | 'openai';

export interface JobProps {
  id?: string;
  type: JobType;
  repositoryId: string;
  status?: JobStatus;
  progress?: number;
  error?: string | null;
  createdAt?: Date;
  updatedAt?: Date;

  // Analysis-specific fields
  repositoryUrl?: string;
  branch?: string;
  filesFound?: number;
  filesBelowThreshold?: number;

  // Improvement-specific fields
  fileId?: string;
  filePath?: string;
  aiProvider?: AiProvider;
  prUrl?: GitHubPrUrl | null;
}

/**
 * Unified entity representing either an analysis job or an improvement job.
 * Analysis jobs: clone repo, run tests with coverage, store results
 * Improvement jobs: generate tests for a file, create PR
 */
export class Job {
  private readonly _id: string;
  private readonly _type: JobType;
  private readonly _repositoryId: string;
  private _status: JobStatus;
  private _progress: number;
  private _error: string | null;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  // Analysis-specific
  private readonly _repositoryUrl: string | null;
  private readonly _branch: string | null;
  private _filesFound: number;
  private _filesBelowThreshold: number;

  // Improvement-specific
  private readonly _fileId: string | null;
  private readonly _filePath: string | null;
  private readonly _aiProvider: AiProvider | null;
  private _prUrl: GitHubPrUrl | null;

  private constructor(props: JobProps) {
    this._id = props.id || uuidv4();
    this._type = props.type;
    this._repositoryId = props.repositoryId;
    this._status = props.status || JobStatus.pending();
    this._progress = props.progress || 0;
    this._error = props.error || null;
    this._createdAt = props.createdAt || new Date();
    this._updatedAt = props.updatedAt || new Date();

    // Analysis-specific
    this._repositoryUrl = props.repositoryUrl || null;
    this._branch = props.branch || null;
    this._filesFound = props.filesFound || 0;
    this._filesBelowThreshold = props.filesBelowThreshold || 0;

    // Improvement-specific
    this._fileId = props.fileId || null;
    this._filePath = props.filePath || null;
    this._aiProvider = props.aiProvider || null;
    this._prUrl = props.prUrl || null;
  }

  /**
   * Create an analysis job
   */
  static createAnalysis(props: {
    repositoryId: string;
    repositoryUrl: string;
    branch: string;
  }): Job {
    return new Job({
      type: 'analysis',
      repositoryId: props.repositoryId,
      repositoryUrl: props.repositoryUrl,
      branch: props.branch,
    });
  }

  /**
   * Create an improvement job
   */
  static createImprovement(props: {
    repositoryId: string;
    fileId: string;
    filePath: string;
    aiProvider: AiProvider;
  }): Job {
    return new Job({
      type: 'improvement',
      repositoryId: props.repositoryId,
      fileId: props.fileId,
      filePath: props.filePath,
      aiProvider: props.aiProvider,
    });
  }

  static reconstitute(props: JobProps): Job {
    return new Job(props);
  }

  // Common getters
  get id(): string {
    return this._id;
  }

  get type(): JobType {
    return this._type;
  }

  get repositoryId(): string {
    return this._repositoryId;
  }

  get status(): JobStatus {
    return this._status;
  }

  get progress(): number {
    return this._progress;
  }

  get error(): string | null {
    return this._error;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  // Analysis-specific getters
  get repositoryUrl(): string | null {
    return this._repositoryUrl;
  }

  get branch(): string | null {
    return this._branch;
  }

  get filesFound(): number {
    return this._filesFound;
  }

  get filesBelowThreshold(): number {
    return this._filesBelowThreshold;
  }

  // Improvement-specific getters
  get fileId(): string | null {
    return this._fileId;
  }

  get filePath(): string | null {
    return this._filePath;
  }

  get aiProvider(): AiProvider | null {
    return this._aiProvider;
  }

  get prUrl(): GitHubPrUrl | null {
    return this._prUrl;
  }

  // State transitions
  start(): void {
    this.transitionTo(JobStatus.running());
    this._progress = 0;
  }

  updateProgress(progress: number): void {
    if (!this._status.isRunning) {
      throw new Error('Cannot update progress for non-running job');
    }
    if (progress < 0 || progress > 100) {
      throw new Error(`Progress must be between 0 and 100, got ${progress}`);
    }
    this._progress = progress;
    this._updatedAt = new Date();
  }

  /**
   * Complete an analysis job with results
   */
  completeAnalysis(filesFound: number, filesBelowThreshold: number): void {
    if (this._type !== 'analysis') {
      throw new Error('completeAnalysis can only be called on analysis jobs');
    }
    this.transitionTo(JobStatus.completed());
    this._progress = 100;
    this._filesFound = filesFound;
    this._filesBelowThreshold = filesBelowThreshold;
  }

  /**
   * Complete an improvement job with PR URL
   */
  completeImprovement(prUrl: GitHubPrUrl): void {
    if (this._type !== 'improvement') {
      throw new Error('completeImprovement can only be called on improvement jobs');
    }
    this.transitionTo(JobStatus.completed());
    this._prUrl = prUrl;
    this._progress = 100;
  }

  fail(error: string): void {
    this.transitionTo(JobStatus.failed());
    this._error = error;
  }

  private transitionTo(newStatus: JobStatus): void {
    if (!this._status.canTransitionTo(newStatus)) {
      throw new Error(`Invalid status transition from ${this._status.value} to ${newStatus.value}`);
    }
    this._status = newStatus;
    this._updatedAt = new Date();
  }

  equals(other: Job): boolean {
    return this._id === other._id;
  }
}

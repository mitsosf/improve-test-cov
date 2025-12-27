import { v4 as uuidv4 } from 'uuid';
import { CoveragePercentage, FilePath } from '../value-objects';

export type CoverageFileStatus = 'pending' | 'improving' | 'improved';

export interface CoverageFileProps {
  id?: string;
  repositoryId: string;
  path: FilePath;
  coveragePercentage: CoveragePercentage;
  uncoveredLines: number[];
  status?: CoverageFileStatus;
  projectDir?: string; // Relative path to project directory containing package.json (e.g., 'ui/' for monorepos)
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Entity representing a TypeScript file with its coverage data
 */
export class CoverageFile {
  private readonly _id: string;
  private readonly _repositoryId: string;
  private readonly _path: FilePath;
  private _coveragePercentage: CoveragePercentage;
  private _uncoveredLines: number[];
  private _status: CoverageFileStatus;
  private readonly _projectDir: string | null;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(props: CoverageFileProps) {
    this._id = props.id || uuidv4();
    this._repositoryId = props.repositoryId;
    this._path = props.path;
    this._coveragePercentage = props.coveragePercentage;
    this._uncoveredLines = [...props.uncoveredLines];
    this._status = props.status || 'pending';
    this._projectDir = props.projectDir || null;
    this._createdAt = props.createdAt || new Date();
    this._updatedAt = props.updatedAt || new Date();
  }

  static create(props: Omit<CoverageFileProps, 'id' | 'status' | 'createdAt' | 'updatedAt'>): CoverageFile {
    return new CoverageFile(props);
  }

  static reconstitute(props: CoverageFileProps): CoverageFile {
    return new CoverageFile(props);
  }

  get id(): string {
    return this._id;
  }

  get repositoryId(): string {
    return this._repositoryId;
  }

  get path(): FilePath {
    return this._path;
  }

  get coveragePercentage(): CoveragePercentage {
    return this._coveragePercentage;
  }

  get uncoveredLines(): number[] {
    return [...this._uncoveredLines];
  }

  get status(): CoverageFileStatus {
    return this._status;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get projectDir(): string | null {
    return this._projectDir;
  }

  needsImprovement(threshold: number = 80): boolean {
    return this._coveragePercentage.isBelow(threshold) && this._status === 'pending';
  }

  markAsImproving(): void {
    if (this._status !== 'pending') {
      throw new Error(`Cannot start improving file in status: ${this._status}`);
    }
    this._status = 'improving';
    this._updatedAt = new Date();
  }

  markAsImproved(newCoverage: CoveragePercentage, newUncoveredLines: number[]): void {
    if (this._status !== 'improving') {
      throw new Error(`Cannot mark as improved from status: ${this._status}`);
    }
    this._coveragePercentage = newCoverage;
    this._uncoveredLines = [...newUncoveredLines];
    this._status = 'improved';
    this._updatedAt = new Date();
  }

  resetToPending(): void {
    this._status = 'pending';
    this._updatedAt = new Date();
  }

  updateCoverage(coverage: CoveragePercentage, uncoveredLines: number[]): void {
    this._coveragePercentage = coverage;
    this._uncoveredLines = [...uncoveredLines];
    this._updatedAt = new Date();
  }

  equals(other: CoverageFile): boolean {
    return this._id === other._id;
  }
}

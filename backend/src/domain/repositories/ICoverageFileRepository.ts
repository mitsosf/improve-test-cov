import { CoverageFile } from '../entities/CoverageFile';

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Repository interface (port) for CoverageFile entity persistence
 */
export interface ICoverageFileRepository {
  save(file: CoverageFile): Promise<void>;
  saveMany(files: CoverageFile[]): Promise<void>;
  findById(id: string): Promise<CoverageFile | null>;
  findByRepositoryId(repositoryId: string): Promise<CoverageFile[]>;
  findByRepositoryIdPaginated(
    repositoryId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<CoverageFile>>;
  findByPath(repositoryId: string, path: string): Promise<CoverageFile | null>;
  findBelowThreshold(repositoryId: string, threshold: number): Promise<CoverageFile[]>;
  delete(id: string): Promise<void>;
  deleteByRepositoryId(repositoryId: string): Promise<void>;
}

export const COVERAGE_FILE_REPOSITORY = Symbol('ICoverageFileRepository');

// Repository DTOs
export interface RepositoryDto {
  id: string;
  url: string;
  name: string;
  branch: string;
  defaultBranch: string;
  lastAnalyzedAt: Date | null;
  createdAt: Date;
}

export interface CreateRepositoryRequest {
  url: string;
  branch?: string;
}

// Coverage DTOs
export interface CoverageFileDto {
  id: string;
  path: string;
  coveragePercentage: number;
  uncoveredLines: number[];
  status: 'pending' | 'improving' | 'improved';
  projectDir: string | null;
}

export interface PaginationDto {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CoverageReportDto {
  repository: RepositoryDto;
  files: CoverageFileDto[];
  summary: {
    totalFiles: number;
    averageCoverage: number;
    filesBelowThreshold: number;
  };
  pagination?: PaginationDto;
}

// Job DTOs
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AiProvider = 'claude' | 'openai';

export interface JobDto {
  id: string;
  repositoryId: string;
  repositoryName: string;
  fileIds: string[];
  filePaths: string[];
  fileCount: number;
  status: JobStatus;
  progress: number;
  aiProvider: AiProvider;
  prUrl: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJobRequest {
  repositoryId: string;
  fileIds: string[];
  aiProvider?: AiProvider;
}

export interface JobListDto {
  jobs: JobDto[];
  total: number;
}

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

export interface AnalyzeRepositoryRequest {
  branch?: string;
}

export interface BranchesDto {
  branches: string[];
  defaultBranch: string;
  allTracked: boolean;
}

export interface PaginatedRepositoriesDto {
  repositories: RepositoryDto[];
  pagination: PaginationDto;
}

// Coverage DTOs
export type CoverageFileStatus = 'pending' | 'improving' | 'improved';

export interface CoverageFileDto {
  id: string;
  path: string;
  coveragePercentage: number;
  uncoveredLines: number[];
  status: CoverageFileStatus;
  projectDir: string | null;
  needsImprovement: boolean;
}

export interface CoverageSummaryDto {
  totalFiles: number;
  averageCoverage: number;
  filesBelowThreshold: number;
  filesImproving: number;
  filesImproved: number;
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
  summary: CoverageSummaryDto;
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

// Analysis Job DTOs
export type AnalysisJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AnalysisJobDto {
  id: string;
  repositoryId: string;
  repositoryUrl: string;
  branch: string;
  status: AnalysisJobStatus;
  progress: number;
  error: string | null;
  filesFound: number;
  filesBelowThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

// API Response wrapper
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}

// WebSocket events
export interface JobProgressEvent {
  jobId: string;
  progress: number;
  message: string;
}

export interface JobCompletedEvent {
  jobId: string;
  prUrl: string;
}

export interface JobFailedEvent {
  jobId: string;
  error: string;
}

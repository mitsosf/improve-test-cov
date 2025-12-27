import type {
  RepositoryDto,
  CoverageReportDto,
  JobDto,
  JobListDto,
  BulkJobDto,
  AiProvider,
  BranchesDto,
  AnalysisJobDto,
} from '@coverage-improver/shared';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText })) as { message?: string };
    throw new Error(errorData.message || `HTTP ${response.status}`);
  }

  // Handle empty responses (for DELETE etc)
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

// Repository API
export async function getBranches(url: string): Promise<BranchesDto> {
  return request<BranchesDto>(`/repositories/branches?url=${encodeURIComponent(url)}`);
}

export async function createRepository(url: string, branch?: string): Promise<RepositoryDto> {
  return request<RepositoryDto>('/repositories', {
    method: 'POST',
    body: JSON.stringify({ url, branch }),
  });
}

export async function listRepositories(): Promise<RepositoryDto[]> {
  return request<RepositoryDto[]>('/repositories');
}

export async function deleteRepository(id: string): Promise<void> {
  return request<void>(`/repositories/${id}`, { method: 'DELETE' });
}

export async function analyzeRepository(id: string, branch?: string): Promise<AnalysisJobDto> {
  return request<AnalysisJobDto>(`/repositories/${id}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ branch }),
  });
}

export async function getAnalysisJob(repoId: string, jobId: string): Promise<AnalysisJobDto> {
  return request<AnalysisJobDto>(`/repositories/${repoId}/analysis/${jobId}`);
}

export async function getCoverage(
  repoId: string,
  page?: number,
  limit?: number,
): Promise<CoverageReportDto> {
  const params = new URLSearchParams();
  if (page) params.set('page', page.toString());
  if (limit) params.set('limit', limit.toString());
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<CoverageReportDto>(`/repositories/${repoId}/coverage${query}`);
}

// Jobs API
export async function createJob(
  repositoryId: string,
  fileId: string,
  aiProvider: AiProvider = 'claude'
): Promise<JobDto> {
  return request<JobDto>('/jobs', {
    method: 'POST',
    body: JSON.stringify({ repositoryId, fileId, aiProvider }),
  });
}

export async function listJobs(repositoryId?: string): Promise<JobListDto> {
  const query = repositoryId ? `?repositoryId=${repositoryId}` : '';
  return request<JobListDto>(`/jobs${query}`);
}

export async function cancelJob(id: string): Promise<void> {
  return request<void>(`/jobs/${id}`, { method: 'DELETE' });
}

export async function createBulkJobs(
  repositoryId: string,
  fileIds: string[],
  aiProvider: AiProvider = 'claude',
): Promise<BulkJobDto> {
  return request<BulkJobDto>('/jobs/bulk', {
    method: 'POST',
    body: JSON.stringify({ repositoryId, fileIds, aiProvider }),
  });
}

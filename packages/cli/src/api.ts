import type {
  RepositoryDto,
  CoverageReportDto,
  JobDto,
  JobListDto,
  BulkJobDto,
  CreateRepositoryRequest,
  CreateJobRequest,
  CreateBulkJobRequest,
  AiProvider,
} from './types.js';

let apiUrl = 'http://localhost:3000/api';

export function setApiUrl(url: string): void {
  apiUrl = url;
}

export function getApiUrl(): string {
  return apiUrl;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
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

  return response.json() as Promise<T>;
}

// Repository API
export async function createRepository(url: string, branch?: string): Promise<RepositoryDto> {
  return request<RepositoryDto>('/repositories', {
    method: 'POST',
    body: JSON.stringify({ url, branch } as CreateRepositoryRequest),
  });
}

export async function listRepositories(): Promise<RepositoryDto[]> {
  return request<RepositoryDto[]>('/repositories');
}

export async function getRepository(id: string): Promise<RepositoryDto> {
  return request<RepositoryDto>(`/repositories/${id}`);
}

export async function analyzeRepository(id: string, branch?: string): Promise<CoverageReportDto> {
  return request<CoverageReportDto>(`/repositories/${id}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ branch }),
  });
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
    body: JSON.stringify({ repositoryId, fileId, aiProvider } as CreateJobRequest),
  });
}

export async function listJobs(repositoryId?: string): Promise<JobListDto> {
  const query = repositoryId ? `?repositoryId=${repositoryId}` : '';
  return request<JobListDto>(`/jobs${query}`);
}

export async function getJob(id: string): Promise<JobDto> {
  return request<JobDto>(`/jobs/${id}`);
}

export async function cancelJob(id: string): Promise<void> {
  await request<void>(`/jobs/${id}`, { method: 'DELETE' });
}

export async function createBulkJobs(
  repositoryId: string,
  fileIds: string[],
  aiProvider: AiProvider = 'claude',
): Promise<BulkJobDto> {
  return request<BulkJobDto>('/jobs/bulk', {
    method: 'POST',
    body: JSON.stringify({ repositoryId, fileIds, aiProvider } as CreateBulkJobRequest),
  });
}

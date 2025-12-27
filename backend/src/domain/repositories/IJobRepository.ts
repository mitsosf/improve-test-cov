import { Job, JobType } from '../entities';

/**
 * Repository interface (port) for unified Job entity persistence
 */
export interface IJobRepository {
  save(job: Job): Promise<void>;
  findById(id: string): Promise<Job | null>;
  findByRepositoryId(repositoryId: string, type?: JobType): Promise<Job[]>;
  findByFileId(fileId: string): Promise<Job[]>;
  findPending(limit?: number, type?: JobType): Promise<Job[]>;
  findPendingByRepositoryId(repositoryId: string, type?: JobType): Promise<Job | null>;
  findLatestByRepositoryId(repositoryId: string, type?: JobType): Promise<Job | null>;
  findRunning(type?: JobType): Promise<Job[]>;
  findAll(type?: JobType): Promise<Job[]>;
  delete(id: string): Promise<void>;
}

export const JOB_REPOSITORY = Symbol('IJobRepository');

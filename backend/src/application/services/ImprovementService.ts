import {
  Job,
  IJobRepository,
  ICoverageFileRepository,
} from '../../domain';
import { AiProvider } from '../../domain/entities/Job';

/**
 * Application service for test improvement use cases.
 * Orchestrates domain objects for improvement operations.
 */
export class ImprovementService {
  constructor(
    private readonly jobRepo: IJobRepository,
    private readonly coverageFileRepo: ICoverageFileRepository,
  ) {}

  /**
   * Start a test improvement job for one or more files.
   * Returns existing active job if one exists for any of the files.
   */
  async startImprovement(
    repositoryId: string,
    fileIds: string[],
    aiProvider: AiProvider = 'claude',
  ): Promise<{ job: Job; isExisting: boolean }> {
    if (fileIds.length === 0) {
      throw new Error('At least one file is required');
    }

    // Validate all coverage files exist and get their paths
    const coverageFiles = await Promise.all(
      fileIds.map(async (id) => {
        const file = await this.coverageFileRepo.findById(id);
        if (!file) {
          throw new Error(`Coverage file not found: ${id}`);
        }
        return file;
      })
    );

    // Check for existing pending/running job for any of these files
    for (const fileId of fileIds) {
      const existingJobs = await this.jobRepo.findByFileId(fileId);
      const activeJob = existingJobs.find(j =>
        j.status.value === 'pending' || j.status.value === 'running'
      );
      if (activeJob) {
        return { job: activeJob, isExisting: true };
      }
    }

    // Create new improvement job with all files
    const job = Job.createImprovement({
      repositoryId,
      fileIds,
      filePaths: coverageFiles.map(f => f.path.value),
      aiProvider,
    });

    // Mark all files as improving
    for (const coverageFile of coverageFiles) {
      coverageFile.markAsImproving();
      await this.coverageFileRepo.save(coverageFile);
    }
    await this.jobRepo.save(job);

    return { job, isExisting: false };
  }

  /**
   * Cancel a pending or running job.
   */
  async cancel(jobId: string): Promise<Job> {
    const job = await this.jobRepo.findById(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (job.status.value !== 'pending' && job.status.value !== 'running') {
      throw new Error(`Cannot cancel job in ${job.status.value} status`);
    }

    job.fail('Cancelled by user');
    await this.jobRepo.save(job);

    // Reset file status if this was an improvement job
    for (const fileId of job.fileIds) {
      const coverageFile = await this.coverageFileRepo.findById(fileId);
      if (coverageFile) {
        coverageFile.resetToPending();
        await this.coverageFileRepo.save(coverageFile);
      }
    }

    return job;
  }
}

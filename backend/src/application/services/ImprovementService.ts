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
   * Start a test improvement job for a file.
   * Returns existing active job if one exists.
   */
  async startImprovement(
    repositoryId: string,
    fileId: string,
    aiProvider: AiProvider = 'claude',
  ): Promise<{ job: Job; isExisting: boolean }> {
    // Validate coverage file exists
    const coverageFile = await this.coverageFileRepo.findById(fileId);
    if (!coverageFile) {
      throw new Error(`Coverage file not found: ${fileId}`);
    }

    // Check for existing pending/running job for this file
    const existingJobs = await this.jobRepo.findByFileId(fileId);
    const activeJob = existingJobs.find(j =>
      j.status.value === 'pending' || j.status.value === 'running'
    );
    if (activeJob) {
      return { job: activeJob, isExisting: true };
    }

    // Create new improvement job
    const job = Job.createImprovement({
      repositoryId,
      fileId,
      filePath: coverageFile.path.value,
      aiProvider,
    });

    // Mark file as improving
    coverageFile.markAsImproving();
    await this.coverageFileRepo.save(coverageFile);
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
    if (job.fileId) {
      const coverageFile = await this.coverageFileRepo.findById(job.fileId);
      if (coverageFile) {
        coverageFile.resetToPending();
        await this.coverageFileRepo.save(coverageFile);
      }
    }

    return job;
  }
}

import { Job } from '../../../domain/entities/Job';
import { GitHubRepo } from '../../../domain/entities/GitHubRepo';
import { CoverageFile } from '../../../domain/entities/CoverageFile';
import { CoveragePercentage } from '../../../domain/value-objects/CoveragePercentage';
import { FilePath } from '../../../domain/value-objects/FilePath';
import { GitHubPrUrl } from '../../../domain/value-objects/GitHubPrUrl';
import { createTestDatabase } from './database';
import { SqliteJobRepository } from './JobRepository';
import { SqliteGitHubRepoRepository } from './GitHubRepoRepository';
import { SqliteCoverageFileRepository } from './CoverageFileRepository';

describe('SqliteJobRepository', () => {
  let jobRepo: SqliteJobRepository;
  let repoRepo: SqliteGitHubRepoRepository;
  let fileRepo: SqliteCoverageFileRepository;
  let testRepo: GitHubRepo;
  let testFile: CoverageFile;

  beforeEach(async () => {
    const db = createTestDatabase();
    jobRepo = new SqliteJobRepository(db);
    repoRepo = new SqliteGitHubRepoRepository(db);
    fileRepo = new SqliteCoverageFileRepository(db);

    // Create test repository and file
    testRepo = GitHubRepo.create({
      url: 'https://github.com/user/repo',
      owner: 'user',
      name: 'repo',
      branch: 'main',
      defaultBranch: 'main',
    });
    await repoRepo.save(testRepo);

    testFile = CoverageFile.create({
      repositoryId: testRepo.id,
      path: FilePath.create('src/utils.ts'),
      coveragePercentage: CoveragePercentage.create(50),
      uncoveredLines: [10, 20, 30],
    });
    await fileRepo.save(testFile);
  });

  describe('save and findById', () => {
    it('should save and retrieve an improvement job', async () => {
      const job = Job.createImprovement({
        repositoryId: testRepo.id,
        fileIds: [testFile.id],
        filePaths: ['src/utils.ts'],
        aiProvider: 'claude',
      });

      await jobRepo.save(job);
      const found = await jobRepo.findById(job.id);

      expect(found).not.toBeNull();
      expect(found!.repositoryId).toBe(testRepo.id);
      expect(found!.aiProvider).toBe('claude');
      expect(found!.status.isPending).toBe(true);
      expect(found!.type).toBe('improvement');
      expect(found!.fileIds).toEqual([testFile.id]);
      expect(found!.filePaths).toEqual(['src/utils.ts']);
    });

    it('should save and retrieve an analysis job', async () => {
      const job = Job.createAnalysis({
        repositoryId: testRepo.id,
        repositoryUrl: 'https://github.com/user/repo',
        branch: 'main',
      });

      await jobRepo.save(job);
      const found = await jobRepo.findById(job.id);

      expect(found).not.toBeNull();
      expect(found!.repositoryId).toBe(testRepo.id);
      expect(found!.repositoryUrl).toBe('https://github.com/user/repo');
      expect(found!.branch).toBe('main');
      expect(found!.status.isPending).toBe(true);
      expect(found!.type).toBe('analysis');
    });

    it('should update job status', async () => {
      const job = Job.createImprovement({
        repositoryId: testRepo.id,
        fileIds: [testFile.id],
        filePaths: ['src/utils.ts'],
        aiProvider: 'claude',
      });

      await jobRepo.save(job);
      job.start();
      job.updateProgress(50);
      await jobRepo.save(job);

      const found = await jobRepo.findById(job.id);
      expect(found!.status.isRunning).toBe(true);
      expect(found!.progress).toBe(50);
    });

    it('should save completed improvement job with PR URL', async () => {
      const job = Job.createImprovement({
        repositoryId: testRepo.id,
        fileIds: [testFile.id],
        filePaths: ['src/utils.ts'],
        aiProvider: 'claude',
      });

      await jobRepo.save(job);
      job.start();
      job.completeImprovement(GitHubPrUrl.create('https://github.com/user/repo/pull/123'));
      await jobRepo.save(job);

      const found = await jobRepo.findById(job.id);
      expect(found!.status.isCompleted).toBe(true);
      expect(found!.prUrl?.value).toBe('https://github.com/user/repo/pull/123');
    });

    it('should save completed analysis job with file counts', async () => {
      const job = Job.createAnalysis({
        repositoryId: testRepo.id,
        repositoryUrl: 'https://github.com/user/repo',
        branch: 'main',
      });

      await jobRepo.save(job);
      job.start();
      job.completeAnalysis(10, 3);
      await jobRepo.save(job);

      const found = await jobRepo.findById(job.id);
      expect(found!.status.isCompleted).toBe(true);
      expect(found!.filesFound).toBe(10);
      expect(found!.filesBelowThreshold).toBe(3);
    });
  });

  describe('findPending', () => {
    it('should return pending jobs', async () => {
      const job1 = Job.createImprovement({
        repositoryId: testRepo.id,
        fileIds: [testFile.id],
        filePaths: ['src/utils.ts'],
        aiProvider: 'claude',
      });
      const job2 = Job.createImprovement({
        repositoryId: testRepo.id,
        fileIds: [testFile.id],
        filePaths: ['src/other.ts'],
        aiProvider: 'openai',
      });

      await jobRepo.save(job1);
      await jobRepo.save(job2);
      job2.start();
      await jobRepo.save(job2);

      const pending = await jobRepo.findPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(job1.id);
    });

    it('should filter pending jobs by type', async () => {
      const analysisJob = Job.createAnalysis({
        repositoryId: testRepo.id,
        repositoryUrl: 'https://github.com/user/repo',
        branch: 'main',
      });
      const improvementJob = Job.createImprovement({
        repositoryId: testRepo.id,
        fileIds: [testFile.id],
        filePaths: ['src/utils.ts'],
        aiProvider: 'claude',
      });

      await jobRepo.save(analysisJob);
      await jobRepo.save(improvementJob);

      const pendingAnalysis = await jobRepo.findPending(10, 'analysis');
      expect(pendingAnalysis).toHaveLength(1);
      expect(pendingAnalysis[0].type).toBe('analysis');

      const pendingImprovement = await jobRepo.findPending(10, 'improvement');
      expect(pendingImprovement).toHaveLength(1);
      expect(pendingImprovement[0].type).toBe('improvement');
    });
  });

  describe('findPendingByRepositoryId', () => {
    it('should return active job for repository', async () => {
      const job = Job.createImprovement({
        repositoryId: testRepo.id,
        fileIds: [testFile.id],
        filePaths: ['src/utils.ts'],
        aiProvider: 'claude',
      });

      await jobRepo.save(job);
      const found = await jobRepo.findPendingByRepositoryId(testRepo.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(job.id);
    });

    it('should return null when no active job', async () => {
      const found = await jobRepo.findPendingByRepositoryId(testRepo.id);
      expect(found).toBeNull();
    });
  });

  describe('findByRepositoryId with type filter', () => {
    it('should filter jobs by type', async () => {
      const analysisJob = Job.createAnalysis({
        repositoryId: testRepo.id,
        repositoryUrl: 'https://github.com/user/repo',
        branch: 'main',
      });
      const improvementJob = Job.createImprovement({
        repositoryId: testRepo.id,
        fileIds: [testFile.id],
        filePaths: ['src/utils.ts'],
        aiProvider: 'claude',
      });

      await jobRepo.save(analysisJob);
      await jobRepo.save(improvementJob);

      const analysisJobs = await jobRepo.findByRepositoryId(testRepo.id, 'analysis');
      expect(analysisJobs).toHaveLength(1);
      expect(analysisJobs[0].type).toBe('analysis');

      const improvementJobs = await jobRepo.findByRepositoryId(testRepo.id, 'improvement');
      expect(improvementJobs).toHaveLength(1);
      expect(improvementJobs[0].type).toBe('improvement');

      const allJobs = await jobRepo.findByRepositoryId(testRepo.id);
      expect(allJobs).toHaveLength(2);
    });
  });
});

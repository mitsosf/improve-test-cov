import {
  Job,
  IJobRepository,
  IGitHubRepoRepository,
  ICoverageFileRepository,
  CoverageFile,
  CoveragePercentage,
  GitHubPrUrl,
  AiProvider,
} from '../../domain';
import {
  IGitHubService,
  IGitHubApiClient,
  ICoverageParser,
  ICommandRunner,
  ClaudeProvider,
  OpenAiProvider,
} from '../../infrastructure';
import { CoverageService } from './CoverageService';
import { join, basename } from 'path';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

export interface JobProgressCallback {
  (jobId: string, progress: number, message: string): void;
}

/**
 * Job orchestrator - handles job lifecycle and delegates business logic.
 * Analysis jobs: delegates to CoverageService
 * Improvement jobs: generates tests for files, creates PR
 */
export class JobProcessor {
  private progressCallback?: JobProgressCallback;
  private readonly coverageService: CoverageService;
  private readonly coverageThreshold: number;

  constructor(
    private readonly jobRepo: IJobRepository,
    private readonly repoRepository: IGitHubRepoRepository,
    private readonly coverageFileRepo: ICoverageFileRepository,
    private readonly githubService: IGitHubService,
    private readonly githubApiClient: IGitHubApiClient,
    private readonly coverageParser: ICoverageParser,
    private readonly commandRunner: ICommandRunner,
  ) {
    this.coverageThreshold = parseInt(process.env.COVERAGE_THRESHOLD || '80', 10);
    this.coverageService = new CoverageService(
      repoRepository,
      coverageFileRepo,
      githubService,
      coverageParser,
      commandRunner,
    );
  }

  setProgressCallback(callback: JobProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Process the next pending job of any type
   */
  async processNextJob(): Promise<Job | null> {
    const pendingJobs = await this.jobRepo.findPending(1);
    if (pendingJobs.length === 0) {
      return null;
    }

    const job = pendingJobs[0];

    // Check if there's already a running job of the same type for the same repo
    const runningJobs = await this.jobRepo.findRunning(job.type);
    if (job.type === 'analysis' && runningJobs.length > 0) {
      return null; // Only one analysis job at a time
    }
    if (job.type === 'improvement') {
      const repoRunningJobs = runningJobs.filter(j => j.repositoryId === job.repositoryId);
      if (repoRunningJobs.length > 0) {
        return null; // One improvement job per repo at a time
      }
    }

    return this.executeJob(job);
  }

  /**
   * Execute a job based on its type
   */
  async executeJob(job: Job): Promise<Job> {
    if (job.type === 'analysis') {
      return this.executeAnalysisJob(job);
    } else {
      return this.executeImprovementJob(job);
    }
  }

  // ============= ANALYSIS JOB EXECUTION =============

  private async executeAnalysisJob(job: Job): Promise<Job> {
    const workDir = this.githubService.getTempDir(job.id);

    try {
      job.start();
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 5, 'Starting analysis');

      // Delegate to CoverageService with progress updates
      const result = await this.coverageService.analyze(
        job.repositoryId,
        job.repositoryUrl!,
        job.branch || 'main',
        workDir,
        (progress, message) => {
          job.updateProgress(progress);
          this.jobRepo.save(job);
          this.emitProgress(job.id, progress, message);
        },
      );

      // Complete job
      job.completeAnalysis(result.filesFound, result.filesBelowThreshold);
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 100, `Analysis complete: ${result.filesFound} files, ${result.filesBelowThreshold} below threshold`);

      return job;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      job.fail(errorMessage);
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 0, `Failed: ${errorMessage}`);
      return job;
    } finally {
      await this.githubService.cleanupWorkDir(workDir);
    }
  }

  // ============= IMPROVEMENT JOB EXECUTION =============

  private async executeImprovementJob(job: Job): Promise<Job> {
    let clonePath: string | null = null;

    try {
      job.start();
      await this.jobRepo.save(job);
      const fileCount = job.fileCount;
      this.emitProgress(job.id, 5, `Starting improvement for ${fileCount} file${fileCount > 1 ? 's' : ''}`);

      const repository = await this.repoRepository.findById(job.repositoryId);
      if (!repository) {
        throw new Error(`Repository not found: ${job.repositoryId}`);
      }

      // Load all coverage files
      const coverageFiles = await Promise.all(
        job.fileIds.map(async (id) => {
          const file = await this.coverageFileRepo.findById(id);
          if (!file) {
            throw new Error(`Coverage file not found: ${id}`);
          }
          return file;
        })
      );

      await this.updateAndSaveProgress(job, 10, 'Cloning repository');

      clonePath = this.githubService.getTempDir(job.id);
      await this.githubService.clone({
        repoUrl: repository.url,
        targetDir: clonePath,
        branch: repository.defaultBranch,
      });

      await this.updateAndSaveProgress(job, 15, 'Installing dependencies');
      // Use first file's project dir (they should all be in the same project)
      const projectDir = coverageFiles[0].projectDir
        ? join(clonePath, coverageFiles[0].projectDir)
        : clonePath;

      const packageManager = this.commandRunner.detectPackageManager(projectDir);
      await this.commandRunner.installDependencies(projectDir, packageManager);

      await this.updateAndSaveProgress(job, 20, 'Creating branch');

      // Generate branch name from first file, or use generic for multi-file
      const branchName = fileCount === 1
        ? this.githubService.generateBranchName(coverageFiles[0].path.value)
        : this.githubService.generateBranchName(`${fileCount}-files`);
      await this.githubService.createBranch(clonePath, branchName);

      // Prepare file contexts for AI
      const filesToImprove = coverageFiles.map(cf => {
        const sourceFilePath = join(clonePath!, cf.path.value);
        if (!existsSync(sourceFilePath)) {
          throw new Error(`Source file not found: ${cf.path.value}`);
        }
        return {
          filePath: cf.path.value,
          fileContent: readFileSync(sourceFilePath, 'utf-8'),
          uncoveredLines: cf.uncoveredLines,
        };
      });

      await this.updateAndSaveProgress(job, 30, `Generating tests for ${fileCount} file${fileCount > 1 ? 's' : ''}`);

      // Get AI provider and generate tests for all files
      const aiProvider = this.getAiProvider(job.aiProvider!);
      await aiProvider.generateTests({
        files: filesToImprove,
        projectDir: clonePath,
      });

      await this.updateAndSaveProgress(job, 50, 'Validating generated tests');

      // Validate that test files were created
      const changedFiles = this.getChangedFiles(clonePath);
      const testFiles = changedFiles.filter(f => this.isTestFile(f));

      if (testFiles.length === 0) {
        throw new Error('AI failed to create any test files');
      }

      // Validate test content
      for (const testFile of testFiles) {
        const testPath = join(clonePath, testFile);
        const testContent = readFileSync(testPath, 'utf-8');
        if (!this.isValidTestContent(testContent)) {
          throw new Error(`Invalid test content in ${testFile}`);
        }
      }

      // Reset any non-test files the AI may have touched
      this.resetNonTestFiles(clonePath);

      const finalChangedFiles = this.getChangedFiles(clonePath);
      const invalidFiles = finalChangedFiles.filter(f => !this.isTestFile(f));
      if (invalidFiles.length > 0) {
        throw new Error(`Invalid files modified: ${invalidFiles.join(', ')}`);
      }

      await this.updateAndSaveProgress(job, 60, 'Running tests');

      await this.commandRunner.runTestsWithCoverage(projectDir, packageManager, true);

      this.coverageParser.setProjectRoot(clonePath);
      const coverageReport = await this.parseCoverageOutput(projectDir);

      // Update coverage for each file
      let totalImprovedCoverage = 0;
      for (const coverageFile of coverageFiles) {
        let fileCoverage = coverageReport.files.find(f => f.path === coverageFile.path.value);
        if (!fileCoverage) {
          fileCoverage = coverageReport.files.find(f =>
            basename(f.path) === basename(coverageFile.path.value)
          );
        }

        if (fileCoverage) {
          coverageFile.updateCoverage(
            CoveragePercentage.create(fileCoverage.percentage),
            fileCoverage.uncoveredLines,
          );
          totalImprovedCoverage += fileCoverage.percentage;
        }
        await this.coverageFileRepo.save(coverageFile);
      }
      const avgCoverage = totalImprovedCoverage / coverageFiles.length;

      await this.updateAndSaveProgress(job, 80, 'Committing changes');

      const commitMessage = fileCount === 1
        ? `test: improve coverage for ${coverageFiles[0].path.value}\n\nCoverage: ${avgCoverage.toFixed(1)}%`
        : `test: improve coverage for ${fileCount} files\n\nFiles: ${job.filePaths.join(', ')}\nAverage coverage: ${avgCoverage.toFixed(1)}%`;

      await this.githubService.commitAndPush({
        workDir: clonePath,
        branch: branchName,
        message: commitMessage,
        files: finalChangedFiles,
      });

      await this.updateAndSaveProgress(job, 90, 'Creating pull request');

      const prTitle = fileCount === 1
        ? `Improve test coverage for ${basename(coverageFiles[0].path.value)}`
        : `Improve test coverage for ${fileCount} files`;

      const prInfo = await this.githubApiClient.createPullRequest({
        owner: repository.owner,
        repo: repository.name,
        title: prTitle,
        body: this.generateMultiFilePrDescription(coverageFiles, avgCoverage),
        head: branchName,
        base: repository.defaultBranch,
      });

      job.completeImprovement(GitHubPrUrl.create(prInfo.url));
      await this.jobRepo.save(job);

      // Mark all files as improved
      for (const coverageFile of coverageFiles) {
        coverageFile.markAsImproved(coverageFile.coveragePercentage, coverageFile.uncoveredLines);
        await this.coverageFileRepo.save(coverageFile);
      }

      this.emitProgress(job.id, 100, `Completed (${avgCoverage.toFixed(1)}% avg coverage)`);

      return job;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      job.fail(errorMessage);
      await this.jobRepo.save(job);

      // Reset all files to pending
      for (const fileId of job.fileIds) {
        const coverageFile = await this.coverageFileRepo.findById(fileId);
        if (coverageFile) {
          coverageFile.resetToPending();
          await this.coverageFileRepo.save(coverageFile);
        }
      }

      this.emitProgress(job.id, 0, `Failed: ${errorMessage}`);
      return job;
    } finally {
      if (clonePath) {
        await this.githubService.cleanupWorkDir(clonePath);
      }
    }
  }

  // ============= SHARED UTILITIES =============

  private getAiProvider(provider: AiProvider) {
    return provider === 'claude' ? new ClaudeProvider() : new OpenAiProvider();
  }

  private async parseCoverageOutput(projectDir: string): Promise<{
    files: Array<{ path: string; linesCovered: number; linesTotal: number; percentage: number; uncoveredLines: number[] }>;
    totalCoverage: number;
  }> {
    const istanbulPath = join(projectDir, 'coverage', 'coverage-final.json');
    if (existsSync(istanbulPath)) {
      return this.coverageParser.parseIstanbulJson(istanbulPath);
    }

    const lcovPath = join(projectDir, 'coverage', 'lcov.info');
    if (existsSync(lcovPath)) {
      return this.coverageParser.parseLcov(lcovPath);
    }

    return { files: [], totalCoverage: 0 };
  }

  private isTestFile(filePath: string): boolean {
    return filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts') ||
           filePath.endsWith('.test.js') || filePath.endsWith('.spec.js');
  }

  private isValidTestContent(content: string): boolean {
    const hasDescribe = /\bdescribe\s*\(/.test(content);
    const hasIt = /\bit\s*\(/.test(content);
    const hasTest = /\btest\s*\(/.test(content);
    const hasExpect = /\bexpect\s*\(/.test(content);
    return (hasDescribe || hasIt || hasTest) && hasExpect;
  }

  private getChangedFiles(workDir: string): string[] {
    try {
      const output = execSync('git diff --name-only HEAD', { cwd: workDir, encoding: 'utf-8' });
      const stagedOutput = execSync('git diff --name-only --cached', { cwd: workDir, encoding: 'utf-8' });
      const untrackedOutput = execSync('git ls-files --others --exclude-standard', { cwd: workDir, encoding: 'utf-8' });

      const allFiles = [...output.split('\n'), ...stagedOutput.split('\n'), ...untrackedOutput.split('\n')]
        .filter(f => f.trim().length > 0);

      return [...new Set(allFiles)];
    } catch {
      return [];
    }
  }

  private resetNonTestFiles(workDir: string): void {
    try {
      const changedFiles = this.getChangedFiles(workDir);
      const nonTestFiles = changedFiles.filter(f => !this.isTestFile(f));

      for (const file of nonTestFiles) {
        try {
          execSync(`git checkout -- "${file}"`, { cwd: workDir, encoding: 'utf-8' });
        } catch {
          try {
            execSync(`rm -f "${file}"`, { cwd: workDir, encoding: 'utf-8' });
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  private generateMultiFilePrDescription(coverageFiles: CoverageFile[], avgCoverage: number): string {
    const fileCount = coverageFiles.length;
    const fileList = coverageFiles.map(f =>
      `- \`${f.path.value}\` (${f.coveragePercentage.value.toFixed(1)}%)`
    ).join('\n');

    return `## Summary
This PR improves test coverage for ${fileCount} file${fileCount > 1 ? 's' : ''}.

### Files
${fileList}

### Results
- **Average Coverage:** ${avgCoverage.toFixed(1)}%

### Test Plan
- [ ] Review generated tests
- [ ] Run test suite locally
- [ ] Verify coverage improvement

---
🤖 Generated by Coverage Improver`;
  }

  private emitProgress(jobId: string, progress: number, message: string): void {
    if (this.progressCallback) {
      this.progressCallback(jobId, progress, message);
    }
    console.log(`[Job ${jobId}] ${progress}% - ${message}`);
  }

  private async updateAndSaveProgress(job: Job, progress: number, message: string): Promise<void> {
    job.updateProgress(progress);
    await this.jobRepo.save(job);
    this.emitProgress(job.id, progress, message);
  }
}

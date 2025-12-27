import {
  Job,
  IJobRepository,
  IGitHubRepoRepository,
  ICoverageFileRepository,
  CoverageFile,
  CoveragePercentage,
  FilePath,
  GitHubRepo,
  GitHubPrUrl,
  AiProvider,
} from '../../domain';
import { IGitHubService, IGitHubApiClient } from '../../infrastructure/github';
import { ICoverageParser } from '../../infrastructure/coverage';
import { ICommandRunner } from '../../infrastructure/runner';
import { ClaudeProvider } from '../../infrastructure/ai/ClaudeProvider';
import { OpenAiProvider } from '../../infrastructure/ai/OpenAiProvider';
import { join, relative, dirname, basename } from 'path';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

export interface JobProgressCallback {
  (jobId: string, progress: number, message: string): void;
}

/**
 * Unified processor for both analysis and improvement jobs.
 * Analysis jobs: clone repo, run tests with coverage, store results
 * Improvement jobs: generate tests for a file, create PR
 */
export class JobProcessor {
  private isProcessing = false;
  private progressCallback?: JobProgressCallback;
  private readonly maxRetries: number;
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
    this.maxRetries = parseInt(process.env.AI_MAX_RETRIES || '3', 10);
    this.coverageThreshold = parseInt(process.env.COVERAGE_THRESHOLD || '80', 10);
  }

  setProgressCallback(callback: JobProgressCallback): void {
    this.progressCallback = callback;
  }

  stopProcessing(): void {
    this.isProcessing = false;
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
    let clonePath: string | null = null;

    try {
      job.start();
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 5, 'Starting analysis');

      // Get or create repository
      let repository = await this.repoRepository.findById(job.repositoryId);
      if (!repository && job.repositoryUrl) {
        const { owner, name } = GitHubRepo.fromGitHubUrl(job.repositoryUrl);
        repository = GitHubRepo.create({
          url: job.repositoryUrl,
          owner,
          name,
          branch: job.branch || 'main',
          defaultBranch: job.branch || 'main',
        });
        await this.repoRepository.save(repository);
      }

      if (!repository) {
        throw new Error('Repository not found');
      }

      this.emitProgress(job.id, 10, 'Cloning repository');

      // Clone repository
      clonePath = this.githubService.getTempDir(job.id);
      await this.githubService.clone({
        repoUrl: job.repositoryUrl!,
        targetDir: clonePath,
        branch: job.branch || undefined,
      });

      job.updateProgress(20);
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 20, 'Installing dependencies');

      // Find the project directory
      const projectInfo = this.findProjectDirectory(clonePath);
      const relativeProjectDir = projectInfo && projectInfo.path !== clonePath
        ? relative(clonePath, projectInfo.path)
        : null;

      let coverageReport = { files: [] as Array<{ path: string; linesCovered: number; linesTotal: number; percentage: number; uncoveredLines: number[] }>, totalCoverage: 0 };

      if (projectInfo) {
        const projectDir = projectInfo.path;
        const packageManager = this.commandRunner.detectPackageManager(projectDir);
        await this.commandRunner.installDependencies(projectDir, packageManager);

        job.updateProgress(40);
        await this.jobRepo.save(job);
        this.emitProgress(job.id, 40, 'Running tests with coverage');

        await this.commandRunner.runTestsWithCoverage(projectDir, packageManager, projectInfo.hasTestScript);

        job.updateProgress(60);
        await this.jobRepo.save(job);
        this.emitProgress(job.id, 60, 'Parsing coverage results');

        coverageReport = await this.parseCoverageOutput(projectDir);
      }

      // Find all .ts files and add missing ones with 0% coverage
      const allTsFiles = this.findAllTypeScriptFiles(clonePath);
      const coveredPaths = new Set(coverageReport.files.map(f => f.path));

      for (const tsFile of allTsFiles) {
        if (!coveredPaths.has(tsFile)) {
          coverageReport.files.push({
            path: tsFile,
            linesCovered: 0,
            linesTotal: 1,
            percentage: 0,
            uncoveredLines: [1],
          });
        }
      }

      // Recalculate total coverage
      const totalCovered = coverageReport.files.reduce((sum, f) => sum + f.linesCovered, 0);
      const totalLines = coverageReport.files.reduce((sum, f) => sum + f.linesTotal, 0);
      coverageReport.totalCoverage = totalLines > 0 ? Math.round((totalCovered / totalLines) * 100 * 100) / 100 : 0;
      coverageReport.files.sort((a, b) => a.percentage - b.percentage);

      job.updateProgress(80);
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 80, 'Storing coverage data');

      // Clear old coverage data and store new
      await this.coverageFileRepo.deleteByRepositoryId(repository.id);
      let filesBelowThreshold = 0;

      for (const fileReport of coverageReport.files) {
        const coverageFile = CoverageFile.create({
          repositoryId: repository.id,
          path: FilePath.create(fileReport.path),
          coveragePercentage: CoveragePercentage.create(fileReport.percentage),
          uncoveredLines: fileReport.uncoveredLines,
          projectDir: relativeProjectDir || undefined,
        });
        await this.coverageFileRepo.save(coverageFile);

        if (fileReport.percentage < this.coverageThreshold) {
          filesBelowThreshold++;
        }
      }

      // Update repository
      repository.markAsAnalyzed();
      await this.repoRepository.save(repository);

      // Complete job
      job.completeAnalysis(coverageReport.files.length, filesBelowThreshold);
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 100, `Analysis complete: ${coverageReport.files.length} files, ${filesBelowThreshold} below threshold`);

      return job;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      job.fail(errorMessage);
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 0, `Failed: ${errorMessage}`);
      return job;
    } finally {
      if (clonePath) {
        await this.githubService.cleanupWorkDir(clonePath);
      }
    }
  }

  // ============= IMPROVEMENT JOB EXECUTION =============

  private async executeImprovementJob(job: Job): Promise<Job> {
    let clonePath: string | null = null;

    try {
      job.start();
      await this.jobRepo.save(job);
      this.emitProgress(job.id, 5, 'Job started');

      const repository = await this.repoRepository.findById(job.repositoryId);
      if (!repository) {
        throw new Error(`Repository not found: ${job.repositoryId}`);
      }

      const coverageFile = await this.coverageFileRepo.findById(job.fileId!);
      if (!coverageFile) {
        throw new Error(`Coverage file not found: ${job.fileId}`);
      }

      await this.updateAndSaveProgress(job, 10, 'Cloning repository');

      clonePath = this.githubService.getTempDir(job.id);
      await this.githubService.clone({
        repoUrl: repository.url,
        targetDir: clonePath,
        branch: repository.defaultBranch,
      });

      await this.updateAndSaveProgress(job, 15, 'Installing dependencies');
      const projectDir = coverageFile.projectDir
        ? join(clonePath, coverageFile.projectDir)
        : clonePath;

      const packageManager = this.commandRunner.detectPackageManager(projectDir);
      await this.commandRunner.installDependencies(projectDir, packageManager);

      await this.updateAndSaveProgress(job, 20, 'Creating branch');

      const branchName = this.githubService.generateBranchName(coverageFile.path.value);
      await this.githubService.createBranch(clonePath, branchName);

      const sourceFilePath = join(clonePath, coverageFile.path.value);
      if (!existsSync(sourceFilePath)) {
        throw new Error(`Source file not found: ${coverageFile.path.value}`);
      }
      const sourceContent = readFileSync(sourceFilePath, 'utf-8');

      const testFilePath = this.findTestFile(clonePath, coverageFile.path.value);

      // Iterative test generation loop
      let attempt = 0;
      let currentCoverage = coverageFile.coveragePercentage.value;
      let generatedTestPath: string | null = null;
      let currentUncoveredLines = [...coverageFile.uncoveredLines];

      while (attempt < this.maxRetries && currentCoverage < this.coverageThreshold) {
        attempt++;
        const progressBase = 25 + (attempt - 1) * 20;

        await this.updateAndSaveProgress(job, progressBase, `Generating tests (attempt ${attempt}/${this.maxRetries})`);

        // Get AI provider (inline, no factory needed)
        const aiProvider = this.getAiProvider(job.aiProvider!);

        const currentTestPath = generatedTestPath || testFilePath;

        await aiProvider.generateTests({
          filePath: coverageFile.path.value,
          fileContent: sourceContent,
          uncoveredLines: currentUncoveredLines,
          existingTestPath: currentTestPath,
          projectDir: clonePath,
        });

        const newTestFiles = this.getChangedFiles(clonePath).filter(f => this.isTestFile(f));
        const expectedTestPath = testFilePath || coverageFile.path.value.replace('.ts', '.test.ts');
        const fullTestPath = join(clonePath, expectedTestPath);

        if (!existsSync(fullTestPath) && newTestFiles.length === 0) {
          if (attempt < this.maxRetries) continue;
          throw new Error('AI failed to create test file after all attempts');
        }

        generatedTestPath = newTestFiles.length > 0 ? newTestFiles[0] : expectedTestPath;
        const actualTestPath = join(clonePath, generatedTestPath);
        const testContent = readFileSync(actualTestPath, 'utf-8');

        if (!this.isValidTestContent(testContent)) {
          if (attempt < this.maxRetries) continue;
          throw new Error('AI failed to generate valid test content after all attempts');
        }

        await this.updateAndSaveProgress(job, progressBase + 10, `Running tests (attempt ${attempt}/${this.maxRetries})`);

        await this.commandRunner.runTestsWithCoverage(projectDir, packageManager, true);

        this.coverageParser.setProjectRoot(clonePath);
        const coverageReport = await this.parseCoverageOutput(projectDir);

        let fileCoverage = coverageReport.files.find(f => f.path === coverageFile.path.value);
        if (!fileCoverage) {
          fileCoverage = coverageReport.files.find(f =>
            f.path.endsWith(`/${basename(coverageFile.path.value)}`) &&
            f.path.includes(basename(dirname(coverageFile.path.value)))
          );
        }
        if (!fileCoverage) {
          fileCoverage = coverageReport.files.find(f =>
            basename(f.path) === basename(coverageFile.path.value)
          );
        }

        if (fileCoverage) {
          currentCoverage = fileCoverage.percentage;
          currentUncoveredLines = fileCoverage.uncoveredLines;

          // Update coverage in database
          coverageFile.updateCoverage(
            CoveragePercentage.create(currentCoverage),
            currentUncoveredLines,
          );
          await this.coverageFileRepo.save(coverageFile);
        } else {
          currentCoverage = coverageReport.totalCoverage;
        }

        if (currentCoverage >= this.coverageThreshold) {
          break;
        }
      }

      if (!generatedTestPath) {
        throw new Error('No test file was generated');
      }

      await this.updateAndSaveProgress(job, 70, 'Validating changes');
      this.resetNonTestFiles(clonePath);

      const changedFiles = this.getChangedFiles(clonePath);
      const invalidFiles = changedFiles.filter(f => !this.isTestFile(f));

      if (invalidFiles.length > 0) {
        throw new Error(`Invalid files modified: ${invalidFiles.join(', ')}`);
      }

      await this.updateAndSaveProgress(job, 80, 'Committing changes');

      await this.githubService.commitAndPush({
        workDir: clonePath,
        branch: branchName,
        message: `test: improve coverage for ${coverageFile.path.value}\n\nCoverage: ${currentCoverage.toFixed(1)}%`,
        files: changedFiles,
      });

      await this.updateAndSaveProgress(job, 90, 'Creating pull request');

      const prInfo = await this.githubApiClient.createPullRequest({
        owner: repository.owner,
        repo: repository.name,
        title: `Improve test coverage for ${basename(coverageFile.path.value)}`,
        body: this.generatePrDescription(coverageFile.path.value, coverageFile.uncoveredLines, currentCoverage, attempt),
        head: branchName,
        base: repository.defaultBranch,
      });

      job.completeImprovement(GitHubPrUrl.create(prInfo.url));
      await this.jobRepo.save(job);

      coverageFile.markAsImproved(CoveragePercentage.create(currentCoverage), []);
      await this.coverageFileRepo.save(coverageFile);

      this.emitProgress(job.id, 100, `Completed (${currentCoverage.toFixed(1)}% coverage)`);

      return job;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      job.fail(errorMessage);
      await this.jobRepo.save(job);

      if (job.fileId) {
        const coverageFile = await this.coverageFileRepo.findById(job.fileId);
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

  private findProjectDirectory(clonePath: string): { path: string; hasTestScript: boolean } | null {
    const rootPackageJson = join(clonePath, 'package.json');
    if (existsSync(rootPackageJson)) {
      try {
        const pkg = JSON.parse(readFileSync(rootPackageJson, 'utf-8'));
        if (pkg.scripts?.test) {
          return { path: clonePath, hasTestScript: true };
        }
      } catch { /* ignore */ }
    }

    const subdirs = ['ui', 'frontend', 'web', 'client', 'app', 'backend', 'server', 'api', 'src'];

    for (const subdir of subdirs) {
      const subdirPath = join(clonePath, subdir);
      const packageJsonPath = join(subdirPath, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          if (pkg.scripts?.test) {
            return { path: subdirPath, hasTestScript: true };
          }
        } catch { /* ignore */ }
      }
    }

    for (const subdir of subdirs) {
      const subdirPath = join(clonePath, subdir);
      if (existsSync(join(subdirPath, 'package.json'))) {
        return { path: subdirPath, hasTestScript: false };
      }
    }

    if (existsSync(rootPackageJson)) {
      return { path: clonePath, hasTestScript: false };
    }

    return null;
  }

  private findAllTypeScriptFiles(baseDir: string, relativePath: string = ''): string[] {
    const files: string[] = [];
    const fullPath = relativePath ? join(baseDir, relativePath) : baseDir;

    try {
      const entries = readdirSync(fullPath);
      for (const entry of entries) {
        const entryRelativePath = relativePath ? join(relativePath, entry) : entry;
        const entryFullPath = join(fullPath, entry);

        if (this.shouldSkipDirectory(entry)) continue;

        const stat = statSync(entryFullPath);
        if (stat.isDirectory()) {
          files.push(...this.findAllTypeScriptFiles(baseDir, entryRelativePath));
        } else if (this.isSourceTypeScriptFile(entry)) {
          files.push(entryRelativePath.replace(/\\/g, '/'));
        }
      }
    } catch { /* ignore */ }

    return files;
  }

  private shouldSkipDirectory(name: string): boolean {
    return ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '__mocks__'].includes(name);
  }

  private isSourceTypeScriptFile(filename: string): boolean {
    if (!filename.endsWith('.ts')) return false;
    if (filename.endsWith('.test.ts') || filename.endsWith('.spec.ts')) return false;
    if (filename.endsWith('.d.ts')) return false;
    return true;
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

  private findTestFile(clonePath: string, sourcePath: string): string | undefined {
    const baseName = sourcePath.replace('.ts', '');
    const patterns = [
      `${baseName}.spec.ts`,
      `${baseName}.test.ts`,
      sourcePath.replace('/src/', '/test/').replace('.ts', '.spec.ts'),
    ];

    for (const pattern of patterns) {
      if (existsSync(join(clonePath, pattern))) {
        return pattern;
      }
    }
    return undefined;
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

  private generatePrDescription(filePath: string, uncoveredLines: number[], finalCoverage: number, attempts: number): string {
    return `## Summary
This PR improves test coverage for \`${filePath}\`.

### Results
- **Final Coverage:** ${finalCoverage.toFixed(1)}%
- **AI Attempts:** ${attempts}
- **Lines Targeted:** ${uncoveredLines.slice(0, 10).join(', ')}${uncoveredLines.length > 10 ? '...' : ''}

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

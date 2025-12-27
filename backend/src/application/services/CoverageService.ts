import {
  CoverageFile,
  CoveragePercentage,
  FilePath,
  GitHubRepo,
  ICoverageFileRepository,
  IGitHubRepoRepository,
} from '../../domain';
import { IGitHubService, ICoverageParser, ICommandRunner } from '../../infrastructure';
import { join, relative } from 'path';
import { existsSync, readFileSync } from 'fs';
import fg from 'fast-glob';

export interface AnalyzeCoverageResult {
  repository: GitHubRepo;
  filesFound: number;
  filesBelowThreshold: number;
}

export interface AnalysisProgressCallback {
  (progress: number, message: string): void;
}

/**
 * Application service for coverage analysis.
 * Handles the business logic of analyzing test coverage for a repository.
 */
export class CoverageService {
  private readonly coverageThreshold: number;

  constructor(
    private readonly repoRepository: IGitHubRepoRepository,
    private readonly coverageFileRepo: ICoverageFileRepository,
    private readonly githubService: IGitHubService,
    private readonly coverageParser: ICoverageParser,
    private readonly commandRunner: ICommandRunner,
  ) {
    this.coverageThreshold = parseInt(process.env.COVERAGE_THRESHOLD || '80', 10);
  }

  /**
   * Analyze test coverage for a repository.
   * Clones the repo, runs tests with coverage, and stores results.
   */
  async analyze(
    repositoryId: string,
    repositoryUrl: string,
    branch: string,
    workDir: string,
    onProgress?: AnalysisProgressCallback,
  ): Promise<AnalyzeCoverageResult> {
    const emit = (progress: number, message: string) => {
      if (onProgress) onProgress(progress, message);
    };

    // Get or create repository
    let repository = await this.repoRepository.findById(repositoryId);
    if (!repository) {
      const { owner, name } = GitHubRepo.fromGitHubUrl(repositoryUrl);
      repository = GitHubRepo.create({
        url: repositoryUrl,
        owner,
        name,
        branch: branch || 'main',
        defaultBranch: branch || 'main',
      });
      await this.repoRepository.save(repository);
    }

    emit(10, 'Cloning repository');

    // Clone repository
    await this.githubService.clone({
      repoUrl: repositoryUrl,
      targetDir: workDir,
      branch: branch || undefined,
    });

    emit(20, 'Installing dependencies');

    // Find the project directory
    const projectInfo = this.findProjectDirectory(workDir);
    const relativeProjectDir = projectInfo && projectInfo.path !== workDir
      ? relative(workDir, projectInfo.path)
      : null;

    let coverageReport = {
      files: [] as Array<{
        path: string;
        linesCovered: number;
        linesTotal: number;
        percentage: number;
        uncoveredLines: number[];
      }>,
      totalCoverage: 0,
    };

    if (projectInfo) {
      const projectDir = projectInfo.path;
      const packageManager = this.commandRunner.detectPackageManager(projectDir);
      await this.commandRunner.installDependencies(projectDir, packageManager);

      emit(40, 'Running tests with coverage');

      await this.commandRunner.runTestsWithCoverage(projectDir, packageManager, projectInfo.hasTestScript);

      emit(60, 'Parsing coverage results');

      coverageReport = await this.parseCoverageOutput(projectDir);
    }

    // Find all .ts files and add missing ones with 0% coverage
    const allTsFiles = await this.findAllTypeScriptFiles(workDir);
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
    coverageReport.totalCoverage = totalLines > 0
      ? Math.round((totalCovered / totalLines) * 100 * 100) / 100
      : 0;
    coverageReport.files.sort((a, b) => a.percentage - b.percentage);

    emit(80, 'Storing coverage data');

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

    return {
      repository,
      filesFound: coverageReport.files.length,
      filesBelowThreshold,
    };
  }

  private async parseCoverageOutput(projectDir: string): Promise<{
    files: Array<{
      path: string;
      linesCovered: number;
      linesTotal: number;
      percentage: number;
      uncoveredLines: number[];
    }>;
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
        const { readFileSync } = require('fs');
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
          const { readFileSync } = require('fs');
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

  /**
   * Find all TypeScript source files using fast-glob.
   * Excludes test files, declaration files, and common non-source directories.
   */
  private async findAllTypeScriptFiles(baseDir: string): Promise<string[]> {
    return fg('**/*.ts', {
      cwd: baseDir,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/.next/**',
        '**/.nuxt/**',
        '**/__mocks__/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
      ],
    });
  }
}

import {
  CoverageFile,
  CoveragePercentage,
  FilePath,
  GitHubRepo,
  ICoverageFileRepository,
  IGitHubRepoRepository,
} from '../../domain';
import { IGitHubService } from '../../infrastructure/github';
import { ICoverageParser, CoverageReport } from '../../infrastructure/coverage';
import { ICommandRunner } from '../../infrastructure/runner';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { readdirSync, statSync } from 'fs';

export interface AnalyzeCoverageResult {
  repository: GitHubRepo;
  files: CoverageFile[];
  totalCoverage: number;
  filesBelowThreshold: number;
}

/**
 * Application service for coverage-related use cases.
 * Orchestrates domain objects for coverage analysis.
 */
export class CoverageService {
  constructor(
    private readonly repoRepository: IGitHubRepoRepository,
    private readonly coverageFileRepo: ICoverageFileRepository,
    private readonly githubService: IGitHubService,
    private readonly coverageParser: ICoverageParser,
    private readonly commandRunner: ICommandRunner,
  ) {}

  /**
   * Analyze test coverage for a repository.
   * Clones the repo, runs tests with coverage, and stores results.
   */
  async analyze(repositoryUrl: string, branch?: string): Promise<AnalyzeCoverageResult> {
    // 1. Find or create repository
    let repository = await this.repoRepository.findByUrl(repositoryUrl);

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

    // 2. Clone repository
    const tempDir = this.githubService.getTempDir(randomUUID());
    await this.githubService.clone({
      repoUrl: repository.url,
      targetDir: tempDir,
      branch: branch || repository.defaultBranch,
    });

    try {
      // 3. Detect package manager
      const packageManager = this.commandRunner.detectPackageManager(tempDir);
      console.log(`Detected package manager: ${packageManager}`);

      // 4. Install dependencies
      console.log('Installing dependencies...');
      const installResult = await this.commandRunner.installDependencies(tempDir, packageManager);
      if (installResult.exitCode !== 0) {
        console.warn('Dependency installation had issues:', installResult.stderr);
        // Continue anyway, some projects may have partial installs
      }

      // 5. Run tests with coverage
      console.log('Running tests with coverage...');
      const testResult = await this.commandRunner.runTestsWithCoverage(tempDir, packageManager);
      console.log(`Tests completed with exit code: ${testResult.exitCode}`);

      // 6. Parse coverage output
      let coverageReport = await this.parseCoverageOutput(tempDir);

      // 7. Find all .ts files and add any missing ones with 0% coverage
      const allTsFiles = this.findAllTypeScriptFiles(tempDir);
      const coveredPaths = new Set(coverageReport.files.map(f => f.path));

      for (const tsFile of allTsFiles) {
        if (!coveredPaths.has(tsFile)) {
          coverageReport.files.push({
            path: tsFile,
            linesCovered: 0,
            linesTotal: 1, // At least 1 line
            percentage: 0,
            uncoveredLines: [1], // Mark as fully uncovered
          });
        }
      }

      // Recalculate total coverage
      const totalCovered = coverageReport.files.reduce((sum, f) => sum + f.linesCovered, 0);
      const totalLines = coverageReport.files.reduce((sum, f) => sum + f.linesTotal, 0);
      coverageReport.totalCoverage = totalLines > 0 ? Math.round((totalCovered / totalLines) * 100 * 100) / 100 : 0;

      // Sort by coverage percentage (lowest first)
      coverageReport.files.sort((a, b) => a.percentage - b.percentage);

      // 8. Clear old coverage data for this repo
      await this.coverageFileRepo.deleteByRepositoryId(repository.id);

      // 9. Store new coverage data
      const coverageThreshold = parseInt(process.env.COVERAGE_THRESHOLD || '80', 10);
      const coverageFiles: CoverageFile[] = [];
      for (const fileReport of coverageReport.files) {
        const coverageFile = CoverageFile.create({
          repositoryId: repository.id,
          path: FilePath.create(fileReport.path),
          coveragePercentage: CoveragePercentage.create(fileReport.percentage),
          uncoveredLines: fileReport.uncoveredLines,
        });
        await this.coverageFileRepo.save(coverageFile);
        coverageFiles.push(coverageFile);
      }

      // 10. Update repository last analyzed timestamp
      repository.markAsAnalyzed();
      await this.repoRepository.save(repository);

      // 11. Calculate summary using configurable threshold
      const filesBelowThreshold = coverageFiles.filter(
        f => f.coveragePercentage.value < coverageThreshold
      ).length;

      return {
        repository,
        files: coverageFiles,
        totalCoverage: coverageReport.totalCoverage,
        filesBelowThreshold,
      };
    } finally {
      // Cleanup cloned repo
      await this.githubService.cleanupWorkDir(tempDir);
    }
  }

  private async parseCoverageOutput(clonePath: string): Promise<CoverageReport> {
    const { existsSync } = await import('fs');

    // Check for istanbul JSON coverage (most common with Jest)
    const istanbulPath = join(clonePath, 'coverage', 'coverage-final.json');
    if (existsSync(istanbulPath)) {
      return this.coverageParser.parseIstanbulJson(istanbulPath);
    }

    // Check for lcov coverage
    const lcovPath = join(clonePath, 'coverage', 'lcov.info');
    if (existsSync(lcovPath)) {
      return this.coverageParser.parseLcov(lcovPath);
    }

    // No coverage output found - return empty report
    console.warn('No coverage output found in', join(clonePath, 'coverage'));
    return { files: [], totalCoverage: 0 };
  }

  /**
   * Recursively find all TypeScript source files (excluding tests and node_modules)
   */
  private findAllTypeScriptFiles(baseDir: string, relativePath: string = ''): string[] {
    const files: string[] = [];
    const fullPath = relativePath ? join(baseDir, relativePath) : baseDir;

    try {
      const entries = readdirSync(fullPath);

      for (const entry of entries) {
        const entryRelativePath = relativePath ? join(relativePath, entry) : entry;
        const entryFullPath = join(fullPath, entry);

        // Skip common non-source directories
        if (this.shouldSkipDirectory(entry)) {
          continue;
        }

        const stat = statSync(entryFullPath);

        if (stat.isDirectory()) {
          files.push(...this.findAllTypeScriptFiles(baseDir, entryRelativePath));
        } else if (this.isSourceTypeScriptFile(entry)) {
          // Normalize path to use forward slashes
          files.push(entryRelativePath.replace(/\\/g, '/'));
        }
      }
    } catch (error) {
      // Directory may not exist or be readable
      console.warn(`Could not read directory: ${fullPath}`);
    }

    return files;
  }

  private shouldSkipDirectory(name: string): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      '__mocks__',
    ];
    return skipDirs.includes(name);
  }

  private isSourceTypeScriptFile(filename: string): boolean {
    // Include .ts files, exclude test files and declaration files
    if (!filename.endsWith('.ts')) {
      return false;
    }
    if (filename.endsWith('.test.ts') || filename.endsWith('.spec.ts')) {
      return false;
    }
    if (filename.endsWith('.d.ts')) {
      return false;
    }
    return true;
  }
}

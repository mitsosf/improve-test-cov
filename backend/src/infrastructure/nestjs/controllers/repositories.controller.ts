import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { CreateRepositoryDto, AnalyzeRepositoryDto, RepositoryResponseDto, BranchResponseDto, AnalysisJobResponseDto } from '../dto';
import { CoverageReportResponseDto } from '../dto';
import {
  Job,
  IGitHubRepoRepository,
  GITHUB_REPO_REPOSITORY,
  ICoverageFileRepository,
  COVERAGE_FILE_REPOSITORY,
  IJobRepository,
  JOB_REPOSITORY,
  GitHubRepo,
} from '../../../domain';
import { IGitHubApiClient, GITHUB_API_CLIENT } from '../../github';

@Controller('repositories')
export class RepositoriesController {
  constructor(
    @Inject(GITHUB_REPO_REPOSITORY)
    private readonly repoRepository: IGitHubRepoRepository,
    @Inject(COVERAGE_FILE_REPOSITORY)
    private readonly coverageFileRepo: ICoverageFileRepository,
    @Inject(JOB_REPOSITORY)
    private readonly jobRepo: IJobRepository,
    @Inject(GITHUB_API_CLIENT)
    private readonly githubApiClient: IGitHubApiClient,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateRepositoryDto): Promise<RepositoryResponseDto> {
    const branch = dto.branch || 'main';

    // Check if this repo+branch combination already exists
    let repository = await this.repoRepository.findByUrlAndBranch(dto.url, branch);

    if (!repository) {
      const { owner, name } = GitHubRepo.fromGitHubUrl(dto.url);
      repository = GitHubRepo.create({
        url: dto.url,
        owner,
        name,
        branch,
        defaultBranch: branch,
      });
      await this.repoRepository.save(repository);
    }

    return this.toResponse(repository);
  }

  @Get()
  async findAll(): Promise<RepositoryResponseDto[]> {
    const repositories = await this.repoRepository.findAll();
    return repositories.map(r => this.toResponse(r));
  }

  @Get('branches')
  async getBranches(@Query('url') url: string): Promise<BranchResponseDto> {
    if (!url) {
      throw new BadRequestException('URL query parameter is required');
    }

    try {
      const { owner, name } = GitHubRepo.fromGitHubUrl(url);
      const allBranches = await this.githubApiClient.listBranches(owner, name);

      // Get already tracked branches for this URL
      const trackedBranches = await this.repoRepository.findBranchesByUrl(url);

      // Filter out tracked branches
      const availableBranches = allBranches.filter(
        (b) => !trackedBranches.includes(b.name),
      );

      // Sort branches: default first, then alphabetically
      availableBranches.sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return a.name.localeCompare(b.name);
      });

      const defaultBranch = allBranches.find((b) => b.isDefault)?.name || 'main';

      return {
        branches: availableBranches.map((b) => b.name),
        defaultBranch,
        allTracked: availableBranches.length === 0,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid GitHub URL')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<RepositoryResponseDto> {
    const repository = await this.repoRepository.findById(id);
    if (!repository) {
      throw new NotFoundException(`Repository not found: ${id}`);
    }
    return this.toResponse(repository);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    const repository = await this.repoRepository.findById(id);
    if (!repository) {
      throw new NotFoundException(`Repository not found: ${id}`);
    }

    // Delete associated coverage files
    await this.coverageFileRepo.deleteByRepositoryId(id);

    await this.repoRepository.delete(id);
  }

  @Post(':id/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  async analyze(
    @Param('id') id: string,
    @Body() dto: AnalyzeRepositoryDto,
  ): Promise<AnalysisJobResponseDto> {
    const repository = await this.repoRepository.findById(id);
    if (!repository) {
      throw new NotFoundException(`Repository not found: ${id}`);
    }

    // Check if there's already a pending or running analysis for this repo
    const existingJobs = await this.jobRepo.findByRepositoryId(id, 'analysis');
    const activeJob = existingJobs.find(j => j.status.value === 'pending' || j.status.value === 'running');
    if (activeJob) {
      return this.toAnalysisJobResponse(activeJob);
    }

    // Create a new analysis job
    const job = Job.createAnalysis({
      repositoryId: repository.id,
      repositoryUrl: repository.url,
      branch: dto.branch || repository.defaultBranch,
    });

    await this.jobRepo.save(job);

    return this.toAnalysisJobResponse(job);
  }

  @Get(':id/analysis/:jobId')
  async getAnalysisJob(
    @Param('id') repoId: string,
    @Param('jobId') jobId: string,
  ): Promise<AnalysisJobResponseDto> {
    const job = await this.jobRepo.findById(jobId);
    if (!job || job.repositoryId !== repoId || job.type !== 'analysis') {
      throw new NotFoundException(`Analysis job not found: ${jobId}`);
    }
    return this.toAnalysisJobResponse(job);
  }

  @Get(':id/analysis')
  async getLatestAnalysisJob(
    @Param('id') repoId: string,
  ): Promise<AnalysisJobResponseDto | null> {
    const job = await this.jobRepo.findLatestByRepositoryId(repoId, 'analysis');
    if (!job) {
      return null;
    }
    return this.toAnalysisJobResponse(job);
  }

  @Get(':id/coverage')
  async getCoverage(
    @Param('id') id: string,
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ): Promise<CoverageReportResponseDto> {
    const repository = await this.repoRepository.findById(id);
    if (!repository) {
      throw new NotFoundException(`Repository not found: ${id}`);
    }

    const threshold = parseInt(process.env.COVERAGE_THRESHOLD || '80', 10);
    const page = pageParam ? parseInt(pageParam, 10) : undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    // Get all files for summary calculation
    const allFiles = await this.coverageFileRepo.findByRepositoryId(id);
    const totalCoverage =
      allFiles.length > 0
        ? allFiles.reduce((sum, f) => sum + f.coveragePercentage.value, 0) / allFiles.length
        : 0;

    // Get files for response (paginated or all)
    let files = allFiles;
    let pagination: { page: number; limit: number; total: number; totalPages: number } | undefined;

    if (page && limit) {
      const result = await this.coverageFileRepo.findByRepositoryIdPaginated(id, { page, limit });
      files = result.items;
      pagination = {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      };
    }

    return {
      repository: {
        id: repository.id,
        name: repository.fullName,
        url: repository.url,
        branch: repository.branch,
        defaultBranch: repository.defaultBranch,
        lastAnalyzedAt: repository.lastAnalyzedAt,
      },
      summary: {
        totalFiles: allFiles.length,
        averageCoverage: Math.round(totalCoverage * 100) / 100,
        filesBelowThreshold: allFiles.filter((f) => f.coveragePercentage.value < threshold).length,
        filesImproving: allFiles.filter((f) => f.status === 'improving').length,
        filesImproved: allFiles.filter((f) => f.status === 'improved').length,
      },
      files: files.map((f) => ({
        id: f.id,
        path: f.path.value,
        coveragePercentage: f.coveragePercentage.value,
        uncoveredLines: f.uncoveredLines,
        status: f.status,
        projectDir: f.projectDir,
        needsImprovement: f.coveragePercentage.value < threshold && f.status === 'pending',
      })),
      pagination,
    };
  }

  private toResponse(repository: GitHubRepo): RepositoryResponseDto {
    return {
      id: repository.id,
      url: repository.url,
      name: repository.fullName,
      branch: repository.branch,
      defaultBranch: repository.defaultBranch,
      lastAnalyzedAt: repository.lastAnalyzedAt,
      createdAt: repository.createdAt,
    };
  }

  private toAnalysisJobResponse(job: Job): AnalysisJobResponseDto {
    return {
      id: job.id,
      repositoryId: job.repositoryId,
      repositoryUrl: job.repositoryUrl || '',
      branch: job.branch || '',
      status: job.status.value as 'pending' | 'running' | 'completed' | 'failed',
      progress: job.progress,
      error: job.error,
      filesFound: job.filesFound,
      filesBelowThreshold: job.filesBelowThreshold,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}

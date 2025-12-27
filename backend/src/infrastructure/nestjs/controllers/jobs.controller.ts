import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Inject,
  Query,
} from '@nestjs/common';
import { CreateJobDto, JobResponseDto, JobListResponseDto } from '../dto';
import {
  Job,
  IJobRepository,
  JOB_REPOSITORY,
  IGitHubRepoRepository,
  GITHUB_REPO_REPOSITORY,
  ICoverageFileRepository,
  COVERAGE_FILE_REPOSITORY,
} from '../../../domain';
import { ImprovementService } from '../../../application';

@Controller('jobs')
export class JobsController {
  private readonly improvementService: ImprovementService;

  constructor(
    @Inject(JOB_REPOSITORY)
    private readonly jobRepo: IJobRepository,
    @Inject(GITHUB_REPO_REPOSITORY)
    private readonly repoRepository: IGitHubRepoRepository,
    @Inject(COVERAGE_FILE_REPOSITORY)
    private readonly coverageFileRepo: ICoverageFileRepository,
  ) {
    this.improvementService = new ImprovementService(jobRepo, coverageFileRepo);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateJobDto): Promise<JobResponseDto> {
    try {
      const result = await this.improvementService.startImprovement(
        dto.repositoryId,
        dto.fileIds,
        dto.aiProvider,
      );
      return this.toResponse(result.job);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get()
  async findAll(@Query('repositoryId') repositoryId?: string): Promise<JobListResponseDto> {
    // Only return improvement jobs (type='improvement')
    const jobs = repositoryId
      ? await this.jobRepo.findByRepositoryId(repositoryId, 'improvement')
      : await this.jobRepo.findAll('improvement');

    return {
      jobs: await Promise.all(jobs.map(j => this.toResponse(j))),
      total: jobs.length,
    };
  }

  @Get('pending')
  async findPending(@Query('limit') limit?: string): Promise<JobListResponseDto> {
    const jobs = await this.jobRepo.findPending(
      limit ? parseInt(limit, 10) : 10,
      'improvement'
    );

    return {
      jobs: await Promise.all(jobs.map(j => this.toResponse(j))),
      total: jobs.length,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<JobResponseDto> {
    const job = await this.jobRepo.findById(id);
    if (!job) {
      throw new NotFoundException(`Job not found: ${id}`);
    }
    return this.toResponse(job);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@Param('id') id: string): Promise<void> {
    try {
      await this.improvementService.cancel(id);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          throw new NotFoundException(error.message);
        }
        if (error.message.includes('Cannot cancel')) {
          throw new BadRequestException(error.message);
        }
      }
      throw error;
    }
  }

  private async toResponse(job: Job): Promise<JobResponseDto> {
    const repo = await this.repoRepository.findById(job.repositoryId);

    return {
      id: job.id,
      repositoryId: job.repositoryId,
      repositoryName: repo?.fullName || 'Unknown',
      fileIds: job.fileIds,
      filePaths: job.filePaths,
      fileCount: job.fileCount,
      status: job.status.value,
      aiProvider: job.aiProvider || 'claude',
      progress: job.progress,
      prUrl: job.prUrl?.value || null,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}

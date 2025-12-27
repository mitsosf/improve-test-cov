import { Module, Global, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  // Persistence
  createDatabase,
  SqliteGitHubRepoRepository,
  SqliteCoverageFileRepository,
  SqliteJobRepository,
  // GitHub
  GitHubService,
  GitHubApiClient,
  GITHUB_SERVICE,
  GITHUB_API_CLIENT,
  // Coverage
  CoverageParser,
  COVERAGE_PARSER,
  // Runner
  CommandRunner,
  COMMAND_RUNNER,
} from '../..';
import { JobProcessor } from '../../../application';
import {
  GITHUB_REPO_REPOSITORY,
  COVERAGE_FILE_REPOSITORY,
  JOB_REPOSITORY,
} from '../../../domain';
import { RepositoriesController, JobsController, HealthController } from '../controllers';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const DATABASE_TOKEN = Symbol('DATABASE');

@Global()
@Module({
  controllers: [RepositoriesController, JobsController, HealthController],
  providers: [
    // Database
    {
      provide: DATABASE_TOKEN,
      useFactory: () => {
        const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'coverage.db');
        const dataDir = join(process.cwd(), 'data');
        if (!existsSync(dataDir)) {
          mkdirSync(dataDir, { recursive: true });
        }
        return createDatabase(dbPath);
      },
    },

    // Repositories
    {
      provide: GITHUB_REPO_REPOSITORY,
      useFactory: (db: Database.Database) => new SqliteGitHubRepoRepository(db),
      inject: [DATABASE_TOKEN],
    },
    {
      provide: COVERAGE_FILE_REPOSITORY,
      useFactory: (db: Database.Database) => new SqliteCoverageFileRepository(db),
      inject: [DATABASE_TOKEN],
    },
    {
      provide: JOB_REPOSITORY,
      useFactory: (db: Database.Database) => new SqliteJobRepository(db),
      inject: [DATABASE_TOKEN],
    },

    // Infrastructure services
    {
      provide: GITHUB_SERVICE,
      useFactory: () => new GitHubService(),
    },
    {
      provide: GITHUB_API_CLIENT,
      useFactory: () => new GitHubApiClient(),
    },
    {
      provide: COVERAGE_PARSER,
      useFactory: () => new CoverageParser(),
    },
    {
      provide: COMMAND_RUNNER,
      useFactory: () => new CommandRunner(),
    },

    // Unified job processor
    {
      provide: JobProcessor,
      useFactory: (
        jobRepo: SqliteJobRepository,
        repoRepository: SqliteGitHubRepoRepository,
        coverageFileRepo: SqliteCoverageFileRepository,
        githubService: GitHubService,
        githubApiClient: GitHubApiClient,
        coverageParser: CoverageParser,
        commandRunner: CommandRunner,
      ) => new JobProcessor(
        jobRepo,
        repoRepository,
        coverageFileRepo,
        githubService,
        githubApiClient,
        coverageParser,
        commandRunner,
      ),
      inject: [
        JOB_REPOSITORY,
        GITHUB_REPO_REPOSITORY,
        COVERAGE_FILE_REPOSITORY,
        GITHUB_SERVICE,
        GITHUB_API_CLIENT,
        COVERAGE_PARSER,
        COMMAND_RUNNER,
      ],
    },
  ],
  exports: [
    DATABASE_TOKEN,
    GITHUB_REPO_REPOSITORY,
    COVERAGE_FILE_REPOSITORY,
    JOB_REPOSITORY,
    GITHUB_SERVICE,
    GITHUB_API_CLIENT,
    COVERAGE_PARSER,
    COMMAND_RUNNER,
    JobProcessor,
  ],
})
export class CoreModule implements OnModuleInit, OnModuleDestroy {
  private jobProcessorInterval?: ReturnType<typeof setInterval>;

  constructor(private readonly jobProcessor: JobProcessor) {}

  async onModuleInit() {
    if (process.env.ENABLE_JOB_PROCESSOR !== 'false') {
      console.log('Starting job processor...');
      this.startJobProcessor();
    }
  }

  onModuleDestroy() {
    if (this.jobProcessorInterval) {
      clearInterval(this.jobProcessorInterval);
    }
  }

  private startJobProcessor() {
    // Process all jobs (both analysis and improvement) every 5 seconds
    this.jobProcessorInterval = setInterval(async () => {
      try {
        await this.jobProcessor.processNextJob();
      } catch (error) {
        console.error('Job processor error:', error);
      }
    }, 5000);
  }
}

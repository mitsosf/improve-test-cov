import { IsString, IsUrl, IsOptional } from 'class-validator';

// Request DTOs with validation (stay in backend)
export class CreateRepositoryDto {
  @IsUrl()
  url!: string;

  @IsString()
  @IsOptional()
  branch?: string;
}

export class AnalyzeRepositoryDto {
  @IsString()
  @IsOptional()
  branch?: string;
}

// Re-export response types from shared
export type {
  RepositoryDto as RepositoryResponseDto,
  BranchesDto as BranchResponseDto,
  PaginatedRepositoriesDto as PaginatedRepositoriesResponseDto,
} from '@coverage-improver/shared';

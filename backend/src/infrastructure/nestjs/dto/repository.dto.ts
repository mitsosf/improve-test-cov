import { IsString, IsUrl, IsOptional, MinLength } from 'class-validator';

export class CreateRepositoryDto {
  @IsUrl()
  url!: string;

  @IsString()
  @IsOptional()
  branch?: string;
}

export class RepositoryResponseDto {
  id!: string;
  url!: string;
  name!: string;
  branch!: string;
  defaultBranch!: string;
  lastAnalyzedAt!: Date | null;
  createdAt!: Date;
}

export class AnalyzeRepositoryDto {
  @IsString()
  @IsOptional()
  branch?: string;
}

export class BranchResponseDto {
  branches!: string[];
  defaultBranch!: string;
  allTracked!: boolean;
}

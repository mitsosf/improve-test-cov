import { IsString, IsUUID, IsOptional, IsEnum, IsArray } from 'class-validator';
import { AiProvider } from '../../../domain/entities/Job';

export class CreateJobDto {
  @IsUUID()
  repositoryId!: string;

  @IsUUID()
  fileId!: string;

  @IsEnum(['claude', 'openai'])
  @IsOptional()
  aiProvider?: AiProvider;
}

export class CreateBulkJobDto {
  @IsUUID()
  repositoryId!: string;

  @IsArray()
  @IsUUID('4', { each: true })
  fileIds!: string[];

  @IsEnum(['claude', 'openai'])
  @IsOptional()
  aiProvider?: AiProvider;
}

export class JobResponseDto {
  id!: string;
  repositoryId!: string;
  repositoryName!: string;
  fileId!: string;
  filePath!: string;
  status!: string;
  aiProvider!: string;
  progress!: number;
  prUrl!: string | null;
  error!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class JobListResponseDto {
  jobs!: JobResponseDto[];
  total!: number;
}

export class BulkJobResponseDto {
  jobs!: JobResponseDto[];
  total!: number;
  created!: number;
  skipped!: number;
}

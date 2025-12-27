import { IsUUID, IsOptional, IsEnum, IsArray, ArrayMinSize } from 'class-validator';
import { AiProvider } from '../../../domain/entities/Job';

export class CreateJobDto {
  @IsUUID()
  repositoryId!: string;

  @IsArray()
  @ArrayMinSize(1)
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
  fileIds!: string[];
  filePaths!: string[];
  fileCount!: number;
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

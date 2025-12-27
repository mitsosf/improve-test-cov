export class AnalysisJobResponseDto {
  id!: string;
  repositoryId!: string;
  repositoryUrl!: string;
  branch!: string;
  status!: 'pending' | 'running' | 'completed' | 'failed';
  progress!: number;
  error!: string | null;
  filesFound!: number;
  filesBelowThreshold!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

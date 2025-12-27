export class CoverageFileDto {
  id!: string;
  path!: string;
  coveragePercentage!: number;
  uncoveredLines!: number[];
  status!: string;
  projectDir!: string | null;
  needsImprovement!: boolean;
}

export class CoverageSummaryDto {
  totalFiles!: number;
  averageCoverage!: number;
  filesBelowThreshold!: number;
  filesImproving!: number;
  filesImproved!: number;
}

export class PaginationDto {
  page!: number;
  limit!: number;
  total!: number;
  totalPages!: number;
}

export class CoverageReportResponseDto {
  repository!: {
    id: string;
    name: string;
    url: string;
    branch: string;
    defaultBranch: string;
    lastAnalyzedAt: Date | null;
  };
  summary!: CoverageSummaryDto;
  files!: CoverageFileDto[];
  pagination?: PaginationDto;
}

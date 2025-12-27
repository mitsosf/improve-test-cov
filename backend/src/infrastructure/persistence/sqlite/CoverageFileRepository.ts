import Database from 'better-sqlite3';
import { CoverageFile, CoverageFileStatus } from '../../../domain/entities/CoverageFile';
import {
  ICoverageFileRepository,
  PaginationOptions,
  PaginatedResult,
} from '../../../domain/repositories/ICoverageFileRepository';
import { CoveragePercentage } from '../../../domain/value-objects/CoveragePercentage';
import { FilePath } from '../../../domain/value-objects/FilePath';
import { getDatabase } from './database';

interface CoverageFileRow {
  id: string;
  repository_id: string;
  path: string;
  coverage_percentage: number;
  uncovered_lines: string;
  status: string;
  project_dir: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteCoverageFileRepository implements ICoverageFileRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  async save(file: CoverageFile): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO coverage_files (id, repository_id, path, coverage_percentage, uncovered_lines, status, project_dir, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        coverage_percentage = excluded.coverage_percentage,
        uncovered_lines = excluded.uncovered_lines,
        status = excluded.status,
        project_dir = excluded.project_dir,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      file.id,
      file.repositoryId,
      file.path.value,
      file.coveragePercentage.value,
      JSON.stringify(file.uncoveredLines),
      file.status,
      file.projectDir,
      file.createdAt.toISOString(),
      file.updatedAt.toISOString(),
    );
  }

  async saveMany(files: CoverageFile[]): Promise<void> {
    const insert = this.db.transaction((files: CoverageFile[]) => {
      for (const file of files) {
        this.db.prepare(`
          INSERT INTO coverage_files (id, repository_id, path, coverage_percentage, uncovered_lines, status, project_dir, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(repository_id, path) DO UPDATE SET
            id = excluded.id,
            coverage_percentage = excluded.coverage_percentage,
            uncovered_lines = excluded.uncovered_lines,
            status = excluded.status,
            project_dir = excluded.project_dir,
            updated_at = excluded.updated_at
        `).run(
          file.id,
          file.repositoryId,
          file.path.value,
          file.coveragePercentage.value,
          JSON.stringify(file.uncoveredLines),
          file.status,
          file.projectDir,
          file.createdAt.toISOString(),
          file.updatedAt.toISOString(),
        );
      }
    });

    insert(files);
  }

  async findById(id: string): Promise<CoverageFile | null> {
    const stmt = this.db.prepare('SELECT * FROM coverage_files WHERE id = ?');
    const row = stmt.get(id) as CoverageFileRow | undefined;
    return row ? this.mapToEntity(row) : null;
  }

  async findByRepositoryId(repositoryId: string): Promise<CoverageFile[]> {
    const stmt = this.db.prepare('SELECT * FROM coverage_files WHERE repository_id = ? ORDER BY path');
    const rows = stmt.all(repositoryId) as CoverageFileRow[];
    return rows.map((row) => this.mapToEntity(row));
  }

  async findByRepositoryIdPaginated(
    repositoryId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<CoverageFile>> {
    const { page, limit } = options;
    const offset = (page - 1) * limit;

    // Get total count
    const countStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM coverage_files WHERE repository_id = ?',
    );
    const { count } = countStmt.get(repositoryId) as { count: number };

    // Get paginated results
    const stmt = this.db.prepare(`
      SELECT * FROM coverage_files
      WHERE repository_id = ?
      ORDER BY path
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(repositoryId, limit, offset) as CoverageFileRow[];

    return {
      items: rows.map((row) => this.mapToEntity(row)),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    };
  }

  async findByPath(repositoryId: string, path: string): Promise<CoverageFile | null> {
    const stmt = this.db.prepare('SELECT * FROM coverage_files WHERE repository_id = ? AND path = ?');
    const row = stmt.get(repositoryId, path) as CoverageFileRow | undefined;
    return row ? this.mapToEntity(row) : null;
  }

  async findBelowThreshold(repositoryId: string, threshold: number): Promise<CoverageFile[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM coverage_files
      WHERE repository_id = ? AND coverage_percentage < ?
      ORDER BY coverage_percentage ASC
    `);
    const rows = stmt.all(repositoryId, threshold) as CoverageFileRow[];
    return rows.map((row) => this.mapToEntity(row));
  }

  async delete(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM coverage_files WHERE id = ?');
    stmt.run(id);
  }

  async deleteByRepositoryId(repositoryId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM coverage_files WHERE repository_id = ?');
    stmt.run(repositoryId);
  }

  private mapToEntity(row: CoverageFileRow): CoverageFile {
    return CoverageFile.reconstitute({
      id: row.id,
      repositoryId: row.repository_id,
      path: FilePath.create(row.path),
      coveragePercentage: CoveragePercentage.create(row.coverage_percentage),
      uncoveredLines: JSON.parse(row.uncovered_lines),
      status: row.status as CoverageFileStatus,
      projectDir: row.project_dir || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}

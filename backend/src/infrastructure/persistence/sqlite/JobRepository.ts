import Database from 'better-sqlite3';
import { Job, JobType, AiProvider } from '../../../domain/entities/Job';
import { IJobRepository } from '../../../domain/repositories/IJobRepository';
import { JobStatus } from '../../../domain/value-objects/JobStatus';
import { GitHubPrUrl } from '../../../domain/value-objects/GitHubPrUrl';
import { getDatabase } from './database';

interface JobRow {
  id: string;
  type: string;
  repository_id: string;
  status: string;
  progress: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  // Analysis-specific
  repository_url: string | null;
  branch: string | null;
  files_found: number;
  files_below_threshold: number;
  // Improvement-specific
  file_id: string | null;
  file_path: string | null;
  ai_provider: string | null;
  pr_url: string | null;
}

export class SqliteJobRepository implements IJobRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  async save(job: Job): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, type, repository_id, status, progress, error, created_at, updated_at,
        repository_url, branch, files_found, files_below_threshold,
        file_id, file_path, ai_provider, pr_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        progress = excluded.progress,
        error = excluded.error,
        updated_at = excluded.updated_at,
        files_found = excluded.files_found,
        files_below_threshold = excluded.files_below_threshold,
        pr_url = excluded.pr_url
    `);

    stmt.run(
      job.id,
      job.type,
      job.repositoryId,
      job.status.value,
      job.progress,
      job.error,
      job.createdAt.toISOString(),
      job.updatedAt.toISOString(),
      job.repositoryUrl,
      job.branch,
      job.filesFound,
      job.filesBelowThreshold,
      job.fileId,
      job.filePath,
      job.aiProvider,
      job.prUrl?.value || null,
    );
  }

  async findById(id: string): Promise<Job | null> {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    const row = stmt.get(id) as JobRow | undefined;
    return row ? this.mapToEntity(row) : null;
  }

  async findByRepositoryId(repositoryId: string, type?: JobType): Promise<Job[]> {
    const sql = type
      ? 'SELECT * FROM jobs WHERE repository_id = ? AND type = ? ORDER BY created_at DESC'
      : 'SELECT * FROM jobs WHERE repository_id = ? ORDER BY created_at DESC';
    const stmt = this.db.prepare(sql);
    const rows = (type ? stmt.all(repositoryId, type) : stmt.all(repositoryId)) as JobRow[];
    return rows.map((row) => this.mapToEntity(row));
  }

  async findByFileId(fileId: string): Promise<Job[]> {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE file_id = ? ORDER BY created_at DESC');
    const rows = stmt.all(fileId) as JobRow[];
    return rows.map((row) => this.mapToEntity(row));
  }

  async findPending(limit?: number, type?: JobType): Promise<Job[]> {
    let sql = "SELECT * FROM jobs WHERE status = 'pending'";
    if (type) sql += ' AND type = ?';
    sql += ' ORDER BY created_at ASC';
    if (limit) sql += ` LIMIT ${limit}`;

    const stmt = this.db.prepare(sql);
    const rows = (type ? stmt.all(type) : stmt.all()) as JobRow[];
    return rows.map((row) => this.mapToEntity(row));
  }

  async findPendingByRepositoryId(repositoryId: string, type?: JobType): Promise<Job | null> {
    let sql = `
      SELECT * FROM jobs
      WHERE repository_id = ? AND status IN ('pending', 'running')
    `;
    if (type) sql += ' AND type = ?';
    sql += ' ORDER BY created_at ASC LIMIT 1';

    const stmt = this.db.prepare(sql);
    const row = (type ? stmt.get(repositoryId, type) : stmt.get(repositoryId)) as JobRow | undefined;
    return row ? this.mapToEntity(row) : null;
  }

  async findLatestByRepositoryId(repositoryId: string, type?: JobType): Promise<Job | null> {
    let sql = 'SELECT * FROM jobs WHERE repository_id = ?';
    if (type) sql += ' AND type = ?';
    sql += ' ORDER BY created_at DESC LIMIT 1';

    const stmt = this.db.prepare(sql);
    const row = (type ? stmt.get(repositoryId, type) : stmt.get(repositoryId)) as JobRow | undefined;
    return row ? this.mapToEntity(row) : null;
  }

  async findRunning(type?: JobType): Promise<Job[]> {
    let sql = "SELECT * FROM jobs WHERE status = 'running'";
    if (type) sql += ' AND type = ?';
    sql += ' ORDER BY created_at ASC';

    const stmt = this.db.prepare(sql);
    const rows = (type ? stmt.all(type) : stmt.all()) as JobRow[];
    return rows.map((row) => this.mapToEntity(row));
  }

  async findAll(type?: JobType): Promise<Job[]> {
    let sql = 'SELECT * FROM jobs';
    if (type) sql += ' WHERE type = ?';
    sql += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = (type ? stmt.all(type) : stmt.all()) as JobRow[];
    return rows.map((row) => this.mapToEntity(row));
  }

  async delete(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM jobs WHERE id = ?');
    stmt.run(id);
  }

  private mapToEntity(row: JobRow): Job {
    return Job.reconstitute({
      id: row.id,
      type: row.type as JobType,
      repositoryId: row.repository_id,
      status: JobStatus.fromString(row.status),
      progress: row.progress,
      error: row.error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      // Analysis-specific
      repositoryUrl: row.repository_url || undefined,
      branch: row.branch || undefined,
      filesFound: row.files_found,
      filesBelowThreshold: row.files_below_threshold,
      // Improvement-specific
      fileId: row.file_id || undefined,
      filePath: row.file_path || undefined,
      aiProvider: row.ai_provider as AiProvider | undefined,
      prUrl: row.pr_url ? GitHubPrUrl.create(row.pr_url) : null,
    });
  }
}

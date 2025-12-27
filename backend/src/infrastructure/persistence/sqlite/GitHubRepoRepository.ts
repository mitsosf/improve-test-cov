import Database from 'better-sqlite3';
import {
  GitHubRepo,
  IGitHubRepoRepository,
  PaginationOptions,
  PaginatedResult,
} from '../../../domain';
import { getDatabase } from './database';

interface GitHubRepoRow {
  id: string;
  url: string;
  owner: string;
  name: string;
  branch: string;
  default_branch: string;
  last_analyzed_at: string | null;
  created_at: string;
}

export class SqliteGitHubRepoRepository implements IGitHubRepoRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  async save(repo: GitHubRepo): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO repositories (id, url, owner, name, branch, default_branch, last_analyzed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        url = excluded.url,
        owner = excluded.owner,
        name = excluded.name,
        branch = excluded.branch,
        default_branch = excluded.default_branch,
        last_analyzed_at = excluded.last_analyzed_at
    `);

    stmt.run(
      repo.id,
      repo.url,
      repo.owner,
      repo.name,
      repo.branch,
      repo.defaultBranch,
      repo.lastAnalyzedAt?.toISOString() || null,
      repo.createdAt.toISOString(),
    );
  }

  async findById(id: string): Promise<GitHubRepo | null> {
    const stmt = this.db.prepare('SELECT * FROM repositories WHERE id = ?');
    const row = stmt.get(id) as GitHubRepoRow | undefined;
    return row ? this.mapToEntity(row) : null;
  }

  async findByUrl(url: string): Promise<GitHubRepo | null> {
    const stmt = this.db.prepare('SELECT * FROM repositories WHERE url = ?');
    const row = stmt.get(url) as GitHubRepoRow | undefined;
    return row ? this.mapToEntity(row) : null;
  }

  async findByUrlAndBranch(url: string, branch: string): Promise<GitHubRepo | null> {
    const stmt = this.db.prepare('SELECT * FROM repositories WHERE url = ? AND branch = ?');
    const row = stmt.get(url, branch) as GitHubRepoRow | undefined;
    return row ? this.mapToEntity(row) : null;
  }

  async findBranchesByUrl(url: string): Promise<string[]> {
    const stmt = this.db.prepare('SELECT branch FROM repositories WHERE url = ?');
    const rows = stmt.all(url) as Array<{ branch: string }>;
    return rows.map((r) => r.branch);
  }

  async findAll(): Promise<GitHubRepo[]> {
    const stmt = this.db.prepare('SELECT * FROM repositories ORDER BY created_at DESC');
    const rows = stmt.all() as GitHubRepoRow[];
    return rows.map((row) => this.mapToEntity(row));
  }

  async findAllPaginated(options: PaginationOptions): Promise<PaginatedResult<GitHubRepo>> {
    const { page, limit } = options;
    const offset = (page - 1) * limit;

    // Get total count
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM repositories');
    const { count } = countStmt.get() as { count: number };

    // Get paginated results
    const stmt = this.db.prepare(`
      SELECT * FROM repositories
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(limit, offset) as GitHubRepoRow[];

    return {
      items: rows.map((row) => this.mapToEntity(row)),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    };
  }

  async delete(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM repositories WHERE id = ?');
    stmt.run(id);
  }

  private mapToEntity(row: GitHubRepoRow): GitHubRepo {
    return GitHubRepo.reconstitute({
      id: row.id,
      url: row.url,
      owner: row.owner,
      name: row.name,
      branch: row.branch || row.default_branch, // Fallback for migration
      defaultBranch: row.default_branch,
      lastAnalyzedAt: row.last_analyzed_at ? new Date(row.last_analyzed_at) : null,
      createdAt: new Date(row.created_at),
    });
  }
}

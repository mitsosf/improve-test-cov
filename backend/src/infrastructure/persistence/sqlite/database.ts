import Database from 'better-sqlite3';
import { join } from 'path';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'coverage.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initializeSchema(db);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initializeSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      last_analyzed_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(url, branch)
    );

    CREATE TABLE IF NOT EXISTS coverage_files (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      path TEXT NOT NULL,
      coverage_percentage REAL NOT NULL,
      uncovered_lines TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      project_dir TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      UNIQUE(repository_id, path)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      -- Analysis-specific fields
      repository_url TEXT,
      branch TEXT,
      files_found INTEGER DEFAULT 0,
      files_below_threshold INTEGER DEFAULT 0,
      -- Improvement-specific fields
      file_id TEXT,
      file_path TEXT,
      ai_provider TEXT,
      pr_url TEXT,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_coverage_files_repository ON coverage_files(repository_id);
    CREATE INDEX IF NOT EXISTS idx_coverage_files_status ON coverage_files(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_repository ON jobs(repository_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
  `);

  // Migration: Add project_dir column if it doesn't exist (for existing databases)
  const coverageColumns = database.prepare("PRAGMA table_info(coverage_files)").all() as Array<{ name: string }>;
  const hasProjectDir = coverageColumns.some(col => col.name === 'project_dir');
  if (!hasProjectDir) {
    database.exec('ALTER TABLE coverage_files ADD COLUMN project_dir TEXT');
  }

  // Migration: Add branch column to repositories if it doesn't exist
  const repoColumns = database.prepare("PRAGMA table_info(repositories)").all() as Array<{ name: string }>;
  const hasBranch = repoColumns.some(col => col.name === 'branch');
  if (!hasBranch) {
    // Add branch column, copy value from default_branch for existing rows
    database.exec(`
      ALTER TABLE repositories ADD COLUMN branch TEXT;
      UPDATE repositories SET branch = default_branch WHERE branch IS NULL;
    `);
    // Note: SQLite doesn't support changing UNIQUE constraints on existing tables,
    // but new inserts will enforce UNIQUE(url, branch) from the CREATE TABLE
  }
}

/**
 * Create a new database connection at the specified path
 */
export function createDatabase(dbPath: string): Database.Database {
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  initializeSchema(database);
  return database;
}

// For testing purposes
export function createTestDatabase(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  initializeSchema(testDb);
  return testDb;
}

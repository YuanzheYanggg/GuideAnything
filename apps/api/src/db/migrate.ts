import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

const migrations = [
  {
    version: 1,
    sql: readFileSync(new URL('./migrations/0001_init.sql', import.meta.url), 'utf8'),
  },
  {
    version: 2,
    sql: readFileSync(new URL('./migrations/0002_workspace_v1.sql', import.meta.url), 'utf8'),
  },
  {
    version: 3,
    sql: readFileSync(new URL('./migrations/0003_santexwell_agent_runtime.sql', import.meta.url), 'utf8'),
  },
  {
    version: 4,
    sql: readFileSync(new URL('./migrations/0004_agent_run_steers.sql', import.meta.url), 'utf8'),
  },
] as const;

export function migrateDatabase(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const record = database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    if (applied.get(migration.version)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

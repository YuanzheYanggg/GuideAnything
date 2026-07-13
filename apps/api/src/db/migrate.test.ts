import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { createDatabase } from './client';
import { migrateDatabase } from './migrate';

describe('database migrations', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  it('creates the complete schema and can run twice', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    migrateDatabase(database);

    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
    ).all().map((row) => (row as { name: string }).name);

    expect(tables).toEqual(expect.arrayContaining([
      'guide_collaborators',
      'guide_search',
      'guide_versions',
      'guides',
      'media_assets',
      'schema_migrations',
      'users',
    ]));
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('creates workspace v1 tables and constraints', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      'workspaces',
      'workspace_members',
      'workspace_items',
      'user_favorites',
      'recent_views',
      'workspace_activity',
    ]));
    const versions = database.prepare(
      'SELECT version FROM schema_migrations ORDER BY version',
    ).all() as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
  });
});

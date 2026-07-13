import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { CanvasDocumentSchema } from '@guideanything/contracts';

import { createDatabase } from './client';
import { migrateDatabase } from './migrate';
import { seedDatabase } from './seed';

describe('demo seed', () => {
  let database: DatabaseSync | undefined;
  afterEach(() => database?.close());

  it('is repeatable and includes the complete ERP teaching sample', async () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    await seedDatabase(database);
    const versionIds = database.prepare(
      'SELECT id FROM guide_versions ORDER BY guide_id, version',
    ).all();
    await seedDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 3 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM guide_versions').get()).toEqual({ count: 2 });
    expect(database.prepare('SELECT id FROM guide_versions ORDER BY guide_id, version').all()).toEqual(versionIds);
    expect(database.prepare('SELECT id FROM workspaces ORDER BY id').all()).toEqual([
      { id: 'workspace-finance' },
      { id: 'workspace-general' },
      { id: 'workspace-materials' },
      { id: 'workspace-people' },
      { id: 'workspace-production' },
      { id: 'workspace-sales' },
    ]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM workspace_members').get()).toEqual({ count: 18 });
    expect(database.prepare(
      `SELECT entity_id, workspace_id
       FROM workspace_items
       WHERE kind = 'GUIDE'
       ORDER BY entity_id`,
    ).all()).toEqual([
      { entity_id: 'demo-material-check', workspace_id: 'workspace-materials' },
      { entity_id: 'demo-sales-order', workspace_id: 'workspace-sales' },
    ]);

    const rows = database.prepare(
      'SELECT title, document_json FROM guide_versions ORDER BY title',
    ).all() as Array<{ title: string; document_json: string }>;
    const documents = rows.map((row) => ({ title: row.title, document: CanvasDocumentSchema.parse(JSON.parse(row.document_json)) }));
    const salesOrder = documents.find((item) => item.title === 'ERP 销售订单创建')!.document;

    expect(salesOrder.nodes.map((node) => node.type)).toEqual(expect.arrayContaining([
      'decision', 'image', 'markdown', 'subguide', 'video',
    ]));
    expect(salesOrder.nodes.find((node) => node.type === 'video')?.data.keypoints).toHaveLength(2);
    expect(salesOrder.nodes.find((node) => node.type === 'subguide')?.data.guideVersionId).toBeTruthy();
    expect(salesOrder.steps.length).toBeGreaterThanOrEqual(5);
    expect(database.prepare("SELECT COUNT(*) AS count FROM guide_search WHERE guide_search MATCH '\"销售订单\"*'").get())
      .toEqual({ count: 1 });
  });

  it('does not resurrect an archived guide while preserving guide and version IDs', async () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    await seedDatabase(database);
    database.exec(`
      INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, published_version_id, created_at, updated_at
      )
      SELECT 'archived-guide', owner_id, '归档指南', summary, tags_json, 'ARCHIVED',
             visibility, revision, draft_document, NULL, created_at, updated_at
      FROM guides WHERE id = 'demo-material-check';

      INSERT INTO guide_versions (
        id, guide_id, version, title, summary, tags_json, document_json,
        search_text, published_by, published_at
      )
      SELECT 'archived-version', 'archived-guide', 1, '归档指南', summary, tags_json,
             document_json, search_text, published_by, published_at
      FROM guide_versions WHERE guide_id = 'demo-material-check';

      UPDATE guides SET published_version_id = 'archived-version' WHERE id = 'archived-guide';
    `);
    const guideIds = database.prepare('SELECT id FROM guides ORDER BY id').all();
    const versionIds = database.prepare('SELECT id FROM guide_versions ORDER BY id').all();

    await seedDatabase(database);

    expect(database.prepare('SELECT id FROM guides ORDER BY id').all()).toEqual(guideIds);
    expect(database.prepare('SELECT id FROM guide_versions ORDER BY id').all()).toEqual(versionIds);
    expect(database.prepare(
      `SELECT entity_id, workspace_id, deleted_at, deleted_by
       FROM workspace_items
       WHERE kind = 'GUIDE' AND entity_id = 'archived-guide'`,
    ).all()).toEqual([]);
  });

  it('does not replace an existing default workspace owner with the demo author', async () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO users (id,email,password_hash,display_name,role,created_at)
      VALUES ('legacy-owner','legacy-owner@example.com','hash','原负责人','AUTHOR',?)`).run(now);
    database.prepare(`INSERT INTO workspaces
      (id,slug,name,description,icon_key,color_key,owner_id,created_at,updated_at)
      VALUES ('workspace-materials','materials','物料管理','','FileText','materials','legacy-owner',?,?)`).run(now, now);
    database.prepare(`INSERT INTO workspace_members (workspace_id,user_id,permission,created_at)
      VALUES ('workspace-materials','legacy-owner','OWNER',?)`).run(now);

    await seedDatabase(database);

    expect(database.prepare(`SELECT owner_id FROM workspaces WHERE id='workspace-materials'`).get())
      .toEqual({ owner_id: 'legacy-owner' });
    expect(database.prepare(`SELECT permission FROM workspace_members
      WHERE workspace_id='workspace-materials' AND user_id='demo-author'`).get())
      .toEqual({ permission: 'EDIT' });
  });
});

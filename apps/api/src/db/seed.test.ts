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
});

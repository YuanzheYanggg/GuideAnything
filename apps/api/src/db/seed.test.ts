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
    await seedDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 3 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM guide_versions').get()).toEqual({ count: 2 });

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

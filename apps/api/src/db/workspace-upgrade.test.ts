import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { createDatabase } from './client';
import { migrateDatabase } from './migrate';
import { upgradeWorkspaceV1 } from './workspace-upgrade';

describe('Workspace V1 existing-data upgrade', () => {
  let database: DatabaseSync | undefined;
  afterEach(() => database?.close());

  it('is transactional and idempotently classifies active guides without demo users', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    const now = '2026-07-13T00:00:00.000Z';
    database.prepare(`INSERT INTO users (id,email,password_hash,display_name,role,created_at)
      VALUES ('legacy-author','legacy@example.com','hash','旧作者','AUTHOR',?)`).run(now);
    const insert = database.prepare(`INSERT INTO guides
      (id,owner_id,title,summary,tags_json,status,visibility,revision,draft_document,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'INTERNAL',0,'{"schemaVersion":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1},"steps":[],"entryNodeId":null,"exitNodeIds":[]}',?,?)`);
    insert.run('guide-material','legacy-author','采购检查','',JSON.stringify(['供应商']),'DRAFT',now,now);
    insert.run('guide-finance','legacy-author','月末结账','',JSON.stringify([]),'PUBLISHED',now,now);
    insert.run('guide-archived','legacy-author','销售订单','',JSON.stringify([]),'ARCHIVED',now,now);

    upgradeWorkspaceV1(database);
    upgradeWorkspaceV1(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM workspaces').get()).toEqual({ count: 6 });
    expect(database.prepare(`SELECT entity_id, workspace_id FROM workspace_items ORDER BY entity_id`).all()).toEqual([
      { entity_id: 'guide-finance', workspace_id: 'workspace-finance' },
      { entity_id: 'guide-material', workspace_id: 'workspace-materials' },
    ]);
    expect(database.prepare(`SELECT COUNT(*) AS count FROM workspace_members
      WHERE user_id='legacy-author' AND permission='OWNER'`).get()).toEqual({ count: 6 });
  });

  it('does not resurrect a permanently removed published guide on restart', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    const now = '2026-07-13T00:00:00.000Z';
    database.prepare(`INSERT INTO users (id,email,password_hash,display_name,role,created_at)
      VALUES ('owner','owner@example.com','hash','作者','AUTHOR',?)`).run(now);
    database.prepare(`INSERT INTO guides
      (id,owner_id,title,summary,tags_json,status,visibility,revision,draft_document,created_at,updated_at)
      VALUES ('removed','owner','物料指南','','[]','ARCHIVED','INTERNAL',0,'{}',?,?)`).run(now, now);
    upgradeWorkspaceV1(database);
    expect(database.prepare(`SELECT COUNT(*) AS count FROM workspace_items WHERE entity_id='removed'`).get())
      .toEqual({ count: 0 });
  });
});

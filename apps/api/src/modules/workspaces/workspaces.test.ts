import { describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  seedTestWorkspace,
} from '../../test/test-app';

describe('workspace API', () => {
  it('lists only accessible workspaces with guide counts', async () => {
    const context = await createTestContext();
    const workspace = seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-materials',
      slug: 'materials',
      name: '物料管理',
    });
    seedTestWorkspace(context.database, context.userIds.otherAuthor, {
      id: 'workspace-private',
      slug: 'private',
      name: '私有空间',
    });
    addTestWorkspaceMember(context.database, workspace.id, context.userIds.learner, 'VIEW');
    const now = new Date().toISOString();
    context.database.prepare(
      `INSERT INTO guides (id,owner_id,title,summary,tags_json,status,visibility,revision,draft_document,created_at,updated_at)
       VALUES ('guide-one',?,'物料指南','','[]','PUBLISHED','INTERNAL',0,'{}',?,?)`,
    ).run(context.userIds.author, now, now);
    context.database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES ('item-guide', ?, 'GUIDE', 'guide-one', '物料指南', '', ?, ?, ?)`,
    ).run(workspace.id, context.userIds.author, now, now);
    context.database.prepare(`INSERT INTO guide_versions
      (id,guide_id,version,title,summary,tags_json,document_json,search_text,published_by,published_at)
      VALUES ('version-one','guide-one',1,'物料指南','','[]','{}','',?,?)`).run(context.userIds.author, now);
    context.database.prepare(`UPDATE guides SET published_version_id='version-one' WHERE id='guide-one'`).run();

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: authorization(context.tokens.learner),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        id: workspace.id,
        name: '物料管理',
        permission: 'VIEW',
        guideCount: 1,
      }),
    ]);
    await context.close();
  });

  it('returns 404 instead of leaking an inaccessible workspace', async () => {
    const context = await createTestContext();
    seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-private',
      slug: 'private',
      name: '私有空间',
    });

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/workspaces/workspace-private',
      headers: authorization(context.tokens.learner),
    });

    expect(response.statusCode).toBe(404);
    await context.close();
  });

  it('hides draft guide rows and counts from learner workspace members', async () => {
    const context = await createTestContext();
    const workspace = seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-learner-visibility', slug: 'learner-visibility', name: '学习者可见性',
    });
    addTestWorkspaceMember(context.database, workspace.id, context.userIds.learner, 'VIEW');
    for (const title of ['已发布指南', '内部草稿']) {
      const created = await context.app.inject({
        method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
        payload: { workspaceId: workspace.id, title },
      });
      if (title === '已发布指南') await context.app.inject({
        method: 'POST', url: `/api/guides/${created.json().guide.id}/publish`,
        headers: authorization(context.tokens.author),
      });
    }
    const detail = await context.app.inject({
      method: 'GET', url: `/api/workspaces/${workspace.id}`, headers: authorization(context.tokens.learner),
    });
    const items = await context.app.inject({
      method: 'GET', url: `/api/workspaces/${workspace.id}/items`, headers: authorization(context.tokens.learner),
    });
    expect(detail.json().counts.GUIDE).toBe(1);
    expect(detail.json().workspace.guideCount).toBe(1);
    expect(items.json().items.map((item: { title: string }) => item.title)).toEqual(['已发布指南']);
    await context.close();
  });

  it('allows only authors to create workspaces and makes the creator owner', async () => {
    const context = await createTestContext();
    const denied = await context.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: authorization(context.tokens.editor),
      payload: {
        name: '采购管理',
        slug: 'procurement',
        description: '',
        iconKey: 'FileText',
        colorKey: 'materials',
      },
    });
    expect(denied.statusCode).toBe(403);

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: authorization(context.tokens.author),
      payload: {
        name: '采购管理',
        slug: 'procurement',
        description: '采购与供应商知识',
        iconKey: 'FileText',
        colorKey: 'materials',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().workspace).toEqual(expect.objectContaining({
      name: '采购管理',
      permission: 'OWNER',
      ownerId: context.userIds.author,
    }));
    await context.close();
  });

  it('enforces owner-only settings and member writes while members can read', async () => {
    const context = await createTestContext();
    const workspace = seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-sales',
      slug: 'sales',
      name: '销售与分销',
    });
    addTestWorkspaceMember(context.database, workspace.id, context.userIds.editor, 'EDIT');

    const detail = await context.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}`,
      headers: authorization(context.tokens.editor),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().workspace.permission).toBe('EDIT');
    expect(detail.json().counts).toEqual({
      GUIDE: 0,
      SOURCE: 0,
      AGENT: 0,
      ONTOLOGY: 0,
      CONVERSATION: 0,
      ARTIFACT: 0,
    });

    const denied = await context.app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}`,
      headers: authorization(context.tokens.editor),
      payload: { name: '新销售空间' },
    });
    expect(denied.statusCode).toBe(403);

    const added = await context.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/members`,
      headers: authorization(context.tokens.author),
      payload: { userId: context.userIds.learner, permission: 'VIEW' },
    });
    expect(added.statusCode).toBe(201);

    const members = await context.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/members`,
      headers: authorization(context.tokens.learner),
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: context.userIds.learner, permission: 'VIEW' }),
    ]));

    const removed = await context.app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.id}/members/${context.userIds.learner}`,
      headers: authorization(context.tokens.author),
    });
    expect(removed.statusCode).toBe(204);
    await context.close();
  });

  it('rejects owner demotion and preserves OWNER permission', async () => {
    const context = await createTestContext();
    const workspace = seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-owner-guard',
      slug: 'owner-guard',
      name: '所有者保护',
    });

    for (const permission of ['EDIT', 'VIEW'] as const) {
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/workspaces/${workspace.id}/members`,
        headers: authorization(context.tokens.author),
        payload: { userId: context.userIds.author, permission },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('OWNER_CANNOT_BE_CHANGED');
    }

    expect(context.database.prepare(
      `SELECT permission FROM workspace_members WHERE workspace_id = ? AND user_id = ?`,
    ).get(workspace.id, context.userIds.author)).toEqual({ permission: 'OWNER' });
    await context.close();
  });

  it('does not expose an unrequested targeted-member PUT route', async () => {
    const context = await createTestContext();
    const workspace = seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-route-scope',
      slug: 'route-scope',
      name: '路由范围',
    });
    const response = await context.app.inject({
      method: 'PUT',
      url: `/api/workspaces/${workspace.id}/members/${context.userIds.editor}`,
      headers: authorization(context.tokens.author),
      payload: { permission: 'EDIT' },
    });
    expect(response.statusCode).toBe(404);
    await context.close();
  });
});

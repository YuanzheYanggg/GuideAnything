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

  it('organizes business-team content into folders and mounts shared resource centers', async () => {
    const context = await createTestContext();
    const create = async (name: string, slug: string, kind: string) => context.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: authorization(context.tokens.author),
      payload: { name, slug, description: '', iconKey: 'SquaresFour', colorKey: 'general', kind },
    });
    const teamResponse = await create('北美业务组', 'north-america-sales', 'BUSINESS_TEAM');
    const financeResponse = await create('财务资源中心', 'finance-center', 'FINANCE');
    const productionResponse = await create('生产资源中心', 'production-center', 'PRODUCTION');
    expect(teamResponse.statusCode).toBe(201);
    expect(financeResponse.statusCode).toBe(201);
    expect(teamResponse.json().workspace).toEqual(expect.objectContaining({ kind: 'BUSINESS_TEAM' }));
    expect(financeResponse.json().workspace).toEqual(expect.objectContaining({ kind: 'FINANCE' }));
    const teamId = teamResponse.json().workspace.id as string;
    const financeId = financeResponse.json().workspace.id as string;
    const productionId = productionResponse.json().workspace.id as string;

    const rootFolder = await context.app.inject({
      method: 'POST', url: `/api/workspaces/${teamId}/folders`, headers: authorization(context.tokens.author),
      payload: { name: '打样工序' },
    });
    expect(rootFolder.statusCode).toBe(201);
    const childFolder = await context.app.inject({
      method: 'POST', url: `/api/workspaces/${teamId}/folders`, headers: authorization(context.tokens.author),
      payload: { name: '新客户', parentId: rootFolder.json().folder.id },
    });
    expect(childFolder.statusCode).toBe(201);

    const guide = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId: teamId, title: '客户打样流程' },
    });
    const sourceItemId = 'source-item-folder-test';
    const now = new Date().toISOString();
    context.database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES (?, ?, 'SOURCE', 'source-folder-test', '客户资料', '', ?, ?, ?)`,
    ).run(sourceItemId, teamId, context.userIds.author, now, now);
    const moveGuide = await context.app.inject({
      method: 'PATCH', url: `/api/workspaces/${teamId}/items/${guide.json().guide.workspaceItemId}/folder`,
      headers: authorization(context.tokens.author), payload: { folderId: childFolder.json().folder.id },
    });
    const moveSource = await context.app.inject({
      method: 'PATCH', url: `/api/workspaces/${teamId}/items/${sourceItemId}/folder`,
      headers: authorization(context.tokens.author), payload: { folderId: rootFolder.json().folder.id },
    });
    expect(moveGuide.statusCode).toBe(200);
    expect(moveSource.statusCode).toBe(200);
    const items = await context.app.inject({
      method: 'GET', url: `/api/workspaces/${teamId}/items`, headers: authorization(context.tokens.author),
    });
    expect(items.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: guide.json().guide.id, folderId: childFolder.json().folder.id }),
      expect.objectContaining({ id: sourceItemId, folderId: rootFolder.json().folder.id }),
    ]));
    const cannotDeleteRoot = await context.app.inject({
      method: 'DELETE', url: `/api/workspaces/${teamId}/folders/${rootFolder.json().folder.id}`,
      headers: authorization(context.tokens.author),
    });
    expect(cannotDeleteRoot.statusCode).toBe(400);

    const mounted = await context.app.inject({
      method: 'POST', url: `/api/workspaces/${teamId}/resource-mounts`, headers: authorization(context.tokens.author),
      payload: { providerWorkspaceId: financeId },
    });
    expect(mounted.statusCode).toBe(201);
    expect(mounted.json().mount).toEqual(expect.objectContaining({
      consumerWorkspaceId: teamId, providerWorkspaceId: financeId, providerKind: 'FINANCE',
    }));
    const listedMounts = await context.app.inject({
      method: 'GET', url: `/api/workspaces/${teamId}/resource-mounts`, headers: authorization(context.tokens.author),
    });
    expect(listedMounts.json().items).toEqual([expect.objectContaining({ providerWorkspaceId: financeId })]);
    const duplicate = await context.app.inject({
      method: 'POST', url: `/api/workspaces/${teamId}/resource-mounts`, headers: authorization(context.tokens.author),
      payload: { providerWorkspaceId: financeId },
    });
    expect(duplicate.statusCode).toBe(400);
    const wrongConsumer = await context.app.inject({
      method: 'POST', url: `/api/workspaces/${productionId}/resource-mounts`, headers: authorization(context.tokens.author),
      payload: { providerWorkspaceId: financeId },
    });
    expect(wrongConsumer.statusCode).toBe(400);

    const deleted = await context.app.inject({
      method: 'DELETE', url: `/api/workspaces/${teamId}/resource-mounts/${mounted.json().mount.id}`,
      headers: authorization(context.tokens.author),
    });
    expect(deleted.statusCode).toBe(204);
    await context.close();
  });

  it('lets a business-team owner mount a resource center they can edit without owning it', async () => {
    const context = await createTestContext();
    const team = seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-team-shared-center', slug: 'team-shared-center', name: '欧洲业务组',
    });
    const finance = seedTestWorkspace(context.database, context.userIds.otherAuthor, {
      id: 'workspace-finance-shared-center', slug: 'finance-shared-center', name: '公司财务中心',
    });
    context.database.prepare(`UPDATE workspaces SET kind = 'FINANCE' WHERE id = ?`).run(finance.id);
    addTestWorkspaceMember(context.database, finance.id, context.userIds.author, 'EDIT');

    const mounted = await context.app.inject({
      method: 'POST',
      url: `/api/workspaces/${team.id}/resource-mounts`,
      headers: authorization(context.tokens.author),
      payload: { providerWorkspaceId: finance.id },
    });

    expect(mounted.statusCode).toBe(201);
    expect(mounted.json().mount).toEqual(expect.objectContaining({
      consumerWorkspaceId: team.id,
      providerWorkspaceId: finance.id,
    }));
    await context.close();
  });

  it('lets an editor organize folders but not manage resource mounts', async () => {
    const context = await createTestContext();
    const team = seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-team-owner-guard', slug: 'team-owner-guard', name: '业务团队',
    });
    const finance = seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-finance-owner-guard', slug: 'finance-owner-guard', name: '财务中心',
    });
    context.database.prepare(`UPDATE workspaces SET kind = 'FINANCE' WHERE id = ?`).run(finance.id);
    addTestWorkspaceMember(context.database, team.id, context.userIds.editor, 'EDIT');
    const folder = await context.app.inject({
      method: 'POST', url: `/api/workspaces/${team.id}/folders`, headers: authorization(context.tokens.editor),
      payload: { name: '不应创建' },
    });
    const mount = await context.app.inject({
      method: 'POST', url: `/api/workspaces/${team.id}/resource-mounts`, headers: authorization(context.tokens.editor),
      payload: { providerWorkspaceId: finance.id },
    });
    expect(folder.statusCode).toBe(201);
    expect(mount.statusCode).toBe(403);
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

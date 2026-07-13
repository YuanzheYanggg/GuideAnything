import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  createWorkspaceGuideFixture,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';

it('removes trashed guides from search and restores them to the index', async () => {
  const context = await createWorkspaceGuideFixture();
  try {
    const search = () => context.app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('可检索测试指南')}`,
      headers: authorization(context.tokens.author),
    });
    expect((await search()).json().items).toEqual([
      expect.objectContaining({
        guideId: context.guideId,
        workspaceItemId: context.workspaceItemId,
      }),
    ]);
    const trashed = await context.app.inject({
      method: 'POST',
      url: `/api/workspace-items/${context.workspaceItemId}/trash`,
      headers: authorization(context.tokens.author),
    });
    expect(trashed.statusCode).toBe(200);
    expect((await search()).json().items).toEqual([]);
    const restored = await context.app.inject({
      method: 'POST',
      url: `/api/workspace-items/${context.workspaceItemId}/restore`,
      headers: authorization(context.tokens.author),
    });
    expect(restored.statusCode).toBe(200);
    expect((await search()).json().items).toEqual([
      expect.objectContaining({
        guideId: context.guideId,
        workspaceItemId: context.workspaceItemId,
      }),
    ]);
  } finally {
    await context.close();
  }
});

describe('published guide search', () => {
  let context: TestContext;
  const workspaceId = 'workspace-search';

  beforeEach(async () => {
    context = await createTestContext();
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId,
      slug: 'search',
      name: '检索工作区',
    });
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.learner, 'VIEW');
  });
  afterEach(async () => context.close());

  it('indexes only the latest published version and matches title, tags, and node content', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: 'ERP 销售订单创建', summary: 'VA01 操作教学', tags: ['订单', 'SAP'] },
    });
    const guideId = created.json().guide.id as string;
    await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.author),
      payload: { revision: 0, document: sampleDocument('# 客户主数据检查\n输入售达方。') },
    });

    const beforePublish = await search(context, '销售订单');
    expect(beforePublish.items).toEqual([]);

    await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/publish`, headers: authorization(context.tokens.author),
    });

    for (const query of ['销售订单', 'SAP', '客户主数据']) {
      const result = await search(context, query);
      expect(result.items[0]).toMatchObject({
        guideId,
        title: 'ERP 销售订单创建',
        version: 1,
        workspaceId,
        workspaceItemId: created.json().guide.workspaceItemId,
        workspaceName: '检索工作区',
        favorite: false,
      });
    }
    const outsideWorkspace = await context.app.inject({
      method: 'GET', url: '/api/search?q=%E9%94%80%E5%94%AE%E8%AE%A2%E5%8D%95&workspaceId=workspace-other',
      headers: authorization(context.tokens.learner),
    });
    expect(outsideWorkspace.statusCode).toBe(200);
    expect(outsideWorkspace.json().items).toEqual([]);

    context.database.prepare(
      `INSERT INTO user_favorites (user_id, item_id, created_at) VALUES (?, ?, ?)`,
    ).run(context.userIds.learner, created.json().guide.workspaceItemId, new Date().toISOString());
    expect((await search(context, '销售订单')).items[0]).toMatchObject({ favorite: true });
    const authorSearch = await context.app.inject({
      method: 'GET',
      url: '/api/search?q=%E9%94%80%E5%94%AE%E8%AE%A2%E5%8D%95',
      headers: authorization(context.tokens.author),
    });
    expect(authorSearch.statusCode).toBe(200);
    expect(authorSearch.json().items[0]).toMatchObject({ favorite: false });

    const unrelated = await searchAs(context, '销售订单', context.tokens.otherAuthor);
    expect(unrelated.items).toEqual([]);

    const invited = await context.app.inject({
      method: 'POST',
      url: `/api/guides/${guideId}/collaborators`,
      headers: authorization(context.tokens.author),
      payload: { userId: context.userIds.editor },
    });
    expect(invited.statusCode).toBe(201);
    expect((await searchAs(context, '销售订单', context.tokens.editor)).items[0]).toMatchObject({ guideId });

    context.database.prepare(
      `UPDATE workspace_items SET deleted_at = ?, deleted_by = ? WHERE entity_id = ?`,
    ).run(new Date().toISOString(), context.userIds.author, guideId);
    expect((await search(context, '销售订单')).items).toEqual([]);
  });

  it('lists published guides when the search query is empty', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '可复用的物料检查', summary: '用于子指南列表', tags: ['物料'] },
    });
    const guideId = created.json().guide.id as string;
    await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/publish`, headers: authorization(context.tokens.author),
    });
    const second = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '可复用的订单检查', summary: '用于分页验证', tags: ['订单'] },
    });
    const secondGuideId = second.json().guide.id as string;
    await context.app.inject({
      method: 'POST', url: `/api/guides/${secondGuideId}/publish`, headers: authorization(context.tokens.author),
    });

    const response = await context.app.inject({
      method: 'GET', url: '/api/search?q=&limit=1', headers: authorization(context.tokens.learner),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().nextOffset).toBe(1);

    const next = await context.app.inject({
      method: 'GET', url: '/api/search?q=&limit=1&offset=1', headers: authorization(context.tokens.learner),
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().nextOffset).toBeNull();
    expect([response.json().items[0].guideId, next.json().items[0].guideId]).toEqual(expect.arrayContaining([guideId, secondGuideId]));

    const unrelated = await searchAs(context, '', context.tokens.otherAuthor);
    expect(unrelated.items).toEqual([]);

    context.database.prepare(`UPDATE workspaces SET status = 'ARCHIVED' WHERE id = ?`).run(workspaceId);
    const archived = await context.app.inject({
      method: 'GET', url: '/api/search?q=', headers: authorization(context.tokens.learner),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().items).toEqual([]);
  });
});

async function search(context: TestContext, query: string) {
  return searchAs(context, query, context.tokens.learner);
}

async function searchAs(context: TestContext, query: string, token: string) {
  const response = await context.app.inject({
    method: 'GET',
    url: `/api/search?q=${encodeURIComponent(query)}`,
    headers: authorization(token),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    items: Array<{
      guideId: string;
      title: string;
      version: number;
      workspaceId: string;
      workspaceItemId: string;
      workspaceName: string;
      favorite: boolean;
    }>;
  };
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  authorization,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';

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

    context.database.prepare(`UPDATE workspaces SET status = 'ARCHIVED' WHERE id = ?`).run(workspaceId);
    const archived = await context.app.inject({
      method: 'GET', url: '/api/search?q=', headers: authorization(context.tokens.learner),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().items).toEqual([]);
  });
});

async function search(context: TestContext, query: string) {
  const response = await context.app.inject({
    method: 'GET',
    url: `/api/search?q=${encodeURIComponent(query)}`,
    headers: authorization(context.tokens.learner),
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

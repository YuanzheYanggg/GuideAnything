import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authorization, createTestContext, sampleDocument, type TestContext } from '../../test/test-app';

describe('published guide search', () => {
  let context: TestContext;

  beforeEach(async () => { context = await createTestContext(); });
  afterEach(async () => context.close());

  it('indexes only the latest published version and matches title, tags, and node content', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { title: 'ERP 销售订单创建', summary: 'VA01 操作教学', tags: ['订单', 'SAP'] },
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
      expect(result.items[0]).toMatchObject({ guideId, title: 'ERP 销售订单创建', version: 1 });
    }
  });

  it('lists published guides when the search query is empty', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { title: '可复用的物料检查', summary: '用于子指南列表', tags: ['物料'] },
    });
    const guideId = created.json().guide.id as string;
    await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/publish`, headers: authorization(context.tokens.author),
    });
    const second = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { title: '可复用的订单检查', summary: '用于分页验证', tags: ['订单'] },
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
  });
});

async function search(context: TestContext, query: string) {
  const response = await context.app.inject({
    method: 'GET',
    url: `/api/search?q=${encodeURIComponent(query)}`,
    headers: authorization(context.tokens.learner),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { items: Array<{ guideId: string; title: string; version: number }> };
}

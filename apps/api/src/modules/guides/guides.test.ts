import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  authorization,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';

describe('guide lifecycle', () => {
  let context: TestContext;
  const workspaceId = 'workspace-sales';

  beforeEach(async () => {
    context = await createTestContext();
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId,
      slug: 'sales',
      name: '销售与分销',
    });
  });
  afterEach(async () => context.close());

  it('creates a guide and resource item in the selected editable workspace', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '创建销售订单', summary: '', tags: ['销售'] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().guide).toEqual(expect.objectContaining({
      workspaceId,
      workspaceItemId: expect.any(String),
    }));
    const registry = context.database.prepare(
      'SELECT kind, workspace_id FROM workspace_items WHERE entity_id = ?',
    ).get(response.json().guide.id);
    expect(registry).toEqual({ kind: 'GUIDE', workspace_id: workspaceId });
  });

  it('creates, saves, publishes, and preserves immutable versions', async () => {
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: authorization(context.tokens.author),
      payload: { workspaceId, title: 'ERP 销售订单创建', summary: '从客户到保存', tags: ['ERP', '销售'] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().guide).toMatchObject({ revision: 0, status: 'DRAFT', title: 'ERP 销售订单创建' });
    const guideId = created.json().guide.id as string;

    const saved = await context.app.inject({
      method: 'PATCH',
      url: `/api/guides/${guideId}`,
      headers: authorization(context.tokens.author),
      payload: { revision: 0, document: sampleDocument(), summary: '完整销售订单创建流程' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().guide.revision).toBe(1);
    expect(context.database.prepare(
      'SELECT title, summary FROM workspace_items WHERE entity_id = ?',
    ).get(guideId)).toEqual({ title: 'ERP 销售订单创建', summary: '完整销售订单创建流程' });

    const publishedV1 = await context.app.inject({
      method: 'POST',
      url: `/api/guides/${guideId}/publish`,
      headers: authorization(context.tokens.author),
    });
    expect(publishedV1.statusCode).toBe(201);
    expect(publishedV1.json().version).toMatchObject({ version: 1, guideId });
    const versionOneId = publishedV1.json().version.id as string;

    const savedAgain = await context.app.inject({
      method: 'PATCH',
      url: `/api/guides/${guideId}`,
      headers: authorization(context.tokens.author),
      payload: { revision: 1, document: sampleDocument('# 第二版内容\n新增信用检查。') },
    });
    expect(savedAgain.statusCode).toBe(200);

    const publishedV2 = await context.app.inject({
      method: 'POST',
      url: `/api/guides/${guideId}/publish`,
      headers: authorization(context.tokens.author),
    });
    expect(publishedV2.json().version.version).toBe(2);

    const pinnedV1 = await context.app.inject({
      method: 'GET',
      url: `/api/versions/${versionOneId}`,
      headers: authorization(context.tokens.learner),
    });
    expect(pinnedV1.statusCode).toBe(200);
    expect(pinnedV1.json().version.document.nodes[1].data.markdown).toContain('填写客户');
    expect(pinnedV1.json().version.document.nodes[1].data.markdown).not.toContain('第二版');
    const activities = context.database.prepare(
      'SELECT action FROM workspace_activity WHERE workspace_id = ? ORDER BY created_at, rowid',
    ).all(workspaceId) as Array<{ action: string }>;
    expect(activities.map(({ action }) => action)).toEqual([
      'GUIDE_CREATED',
      'GUIDE_UPDATED',
      'GUIDE_PUBLISHED',
      'GUIDE_UPDATED',
      'GUIDE_PUBLISHED',
    ]);
  });

  it('rejects stale revisions and invalid canvas documents', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '冲突测试' },
    });
    const guideId = created.json().guide.id as string;

    const first = await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.author),
      payload: { revision: 0, document: sampleDocument() },
    });
    expect(first.statusCode).toBe(200);

    const stale = await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.author),
      payload: { revision: 0, document: sampleDocument('# 会覆盖的内容') },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('REVISION_CONFLICT');

    const invalid = await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.author),
      payload: { revision: 1, document: { ...sampleDocument(), edges: [{ id: 'bad', source: 'missing', target: 'start' }] } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('VALIDATION_ERROR');
  });
});

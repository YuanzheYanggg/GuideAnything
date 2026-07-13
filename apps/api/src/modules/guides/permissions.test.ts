import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';

describe('guide permissions', () => {
  let context: TestContext;
  const workspaceId = 'workspace-collaboration';

  beforeEach(async () => {
    context = await createTestContext();
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId,
      slug: 'collaboration',
      name: '协作空间',
    });
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.editor, 'EDIT');
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.learner, 'VIEW');
  });
  afterEach(async () => context.close());

  it('allows an invited editor to save while reserving publication for the owner', async () => {
    const learnerCreate = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.learner),
      payload: { workspaceId, title: '越权创建' },
    });
    expect(learnerCreate.statusCode).toBe(403);

    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '协作指南' },
    });
    const guideId = created.json().guide.id as string;

    expect((await context.app.inject({
      method: 'GET', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.editor),
    })).statusCode).toBe(403);
    expect((await context.app.inject({
      method: 'GET', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.learner),
    })).statusCode).toBe(403);
    expect((await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.otherAuthor),
      payload: { revision: 0, document: sampleDocument() },
    })).statusCode).toBe(403);

    const invited = await context.app.inject({
      method: 'POST',
      url: `/api/guides/${guideId}/collaborators`,
      headers: authorization(context.tokens.author),
      payload: { userId: context.userIds.editor },
    });
    expect(invited.statusCode).toBe(201);

    const edited = await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.editor),
      payload: { revision: 0, document: sampleDocument('# 编辑者完成的内容') },
    });
    expect(edited.statusCode).toBe(200);

    const publish = await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/publish`, headers: authorization(context.tokens.editor),
    });
    expect(publish.statusCode).toBe(403);

    const shared = await context.app.inject({
      method: 'GET',
      url: `/api/guides?workspaceId=${workspaceId}&scope=shared`,
      headers: authorization(context.tokens.editor),
    });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().items.map((guide: { id: string }) => guide.id)).toEqual([guideId]);

    const ownerShared = await context.app.inject({
      method: 'GET',
      url: `/api/guides?workspaceId=${workspaceId}&scope=shared`,
      headers: authorization(context.tokens.author),
    });
    expect(ownerShared.statusCode).toBe(200);
    expect(ownerShared.json().items).toEqual([]);

    expect(context.database.prepare(
      `SELECT action FROM workspace_activity
       WHERE workspace_id = ? AND action = 'COLLABORATOR_ADDED'`,
    ).get(workspaceId)).toEqual({ action: 'COLLABORATOR_ADDED' });
  });

  it('requires an author with owner or edit workspace permission to create', async () => {
    const missingMembership = await context.app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: authorization(context.tokens.otherAuthor),
      payload: { workspaceId, title: '无成员资格' },
    });
    expect(missingMembership.statusCode).toBe(404);

    addTestWorkspaceMember(context.database, workspaceId, context.userIds.otherAuthor, 'VIEW');
    const viewOnly = await context.app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: authorization(context.tokens.otherAuthor),
      payload: { workspaceId, title: '只读成员' },
    });
    expect(viewOnly.statusCode).toBe(403);

    addTestWorkspaceMember(context.database, workspaceId, context.userIds.otherAuthor, 'EDIT');
    const editable = await context.app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: authorization(context.tokens.otherAuthor),
      payload: { workspaceId, title: '可编辑成员' },
    });
    expect(editable.statusCode).toBe(201);

    const owned = await context.app.inject({
      method: 'GET',
      url: `/api/guides?workspaceId=${workspaceId}&scope=owned`,
      headers: authorization(context.tokens.otherAuthor),
    });
    expect(owned.statusCode).toBe(200);
    expect(owned.json().items.map((guide: { id: string }) => guide.id)).toEqual([editable.json().guide.id]);
  });
});

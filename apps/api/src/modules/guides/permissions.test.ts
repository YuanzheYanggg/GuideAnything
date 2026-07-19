import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';
import { createGuideDigestProposal } from './digest-repository';

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
    })).statusCode).toBe(404);
    expect((await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.otherAuthor),
      payload: { revision: 0, document: sampleDocument() },
    })).statusCode).toBe(404);

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

  it('uses 404 for invisible guides and 403 for visible members without action permission', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '权限边界草稿' },
    });
    const guideId = created.json().guide.id as string;
    for (const [method, suffix] of [['GET', ''], ['PATCH', ''], ['POST', '/publish'], ['POST', '/collaborators']] as const) {
      const response = await context.app.inject({
        method, url: `/api/guides/${guideId}${suffix}`, headers: authorization(context.tokens.otherAuthor),
        ...(method === 'PATCH' ? { payload: { revision: 0, title: '越权' } } : {}),
        ...(suffix === '/collaborators' ? { payload: { userId: context.userIds.editor } } : {}),
      });
      expect(response.statusCode).toBe(404);
    }
    expect((await context.app.inject({
      method: 'GET', url: '/api/guides/missing-guide', headers: authorization(context.tokens.author),
    })).statusCode).toBe(404);
    expect((await context.app.inject({
      method: 'GET', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.editor),
    })).statusCode).toBe(403);
    expect((await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/publish`, headers: authorization(context.tokens.editor),
    })).statusCode).toBe(403);
  });

  it('allows author or editor roles with owner or edit workspace permission to create', async () => {
    const editorCreate = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.editor),
      payload: { workspaceId, title: '编辑者创建' },
    });
    expect(editorCreate.statusCode).toBe(201);

    addTestWorkspaceMember(context.database, workspaceId, context.userIds.editor, 'VIEW');
    const editorView = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.editor),
      payload: { workspaceId, title: '编辑者只读越权' },
    });
    expect(editorView.statusCode).toBe(403);
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.editor, 'EDIT');

    const learnerCreate = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.learner),
      payload: { workspaceId, title: '学习者越权' },
    });
    expect(learnerCreate.statusCode).toBe(403);

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

  it('returns requester-specific favorite and lifecycle capabilities for drafts', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.editor),
      payload: { workspaceId, title: '编辑者草稿' },
    });
    expect(created.statusCode).toBe(201);
    const itemId = created.json().guide.workspaceItemId as string;

    const before = await context.app.inject({
      method: 'GET', url: `/api/guides?workspaceId=${workspaceId}`, headers: authorization(context.tokens.editor),
    });
    expect(before.json().items[0]).toMatchObject({ favorite: false, canManageLifecycle: true });

    await context.app.inject({ method: 'PUT', url: `/api/me/favorites/${itemId}`, headers: authorization(context.tokens.editor) });
    const after = await context.app.inject({
      method: 'GET', url: `/api/guides?workspaceId=${workspaceId}`, headers: authorization(context.tokens.editor),
    });
    expect(after.json().items[0]).toMatchObject({ favorite: true, canManageLifecycle: true });

    const published = await context.app.inject({
      method: 'POST', url: `/api/guides/${created.json().guide.id}/publish`, headers: authorization(context.tokens.editor),
    });
    expect(published.statusCode).toBe(201);
    const searchUrl = `/api/search?q=${encodeURIComponent('编辑者草稿')}`;
    const guideOwnerResult = await context.app.inject({
      method: 'GET', url: searchUrl, headers: authorization(context.tokens.editor),
    });
    expect(guideOwnerResult.json().items[0]).toMatchObject({ canManageLifecycle: true });
    const workspaceOwnerResult = await context.app.inject({
      method: 'GET', url: searchUrl, headers: authorization(context.tokens.author),
    });
    expect(workspaceOwnerResult.json().items[0]).toMatchObject({ canManageLifecycle: true });
  });

  it('does not expand workspace membership into digest proposal access', async () => {
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.otherAuthor, 'EDIT');
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '摘要权限指南' },
    });
    const guideId = created.json().guide.id as string;
    await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.author),
      payload: { revision: 0, document: sampleDocument('# 摘要权限') },
    });
    await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/collaborators`, headers: authorization(context.tokens.author),
      payload: { userId: context.userIds.editor },
    });
    const snapshot = context.database.prepare(
      `SELECT id, revision FROM flow_knowledge_snapshots
       WHERE guide_id = ? AND origin_type = 'DRAFT' ORDER BY revision DESC LIMIT 1`,
    ).get(guideId) as { id: string; revision: number };
    const proposal = createGuideDigestProposal(context.database, {
      guideId,
      workspaceId,
      baseSnapshotId: snapshot.id,
      baseRevision: snapshot.revision,
      bundleRevision: 1,
      rendererVersion: 'guide-digest-markdown-v1',
      generationMetadata: { attemptCount: 1, repairAttempted: false },
      draft: {
        schemaVersion: 1,
        shortSummary: '权限测试摘要',
        scope: { audiences: [], businessObjects: [], systems: [] },
        stageSections: [], keyRules: [], tagSuggestions: [], gaps: [],
      },
      markdown: '# 权限测试摘要',
      createdBy: context.userIds.author,
    });

    for (const [method, suffix, payload] of [
      ['GET', '/flow-snapshot-status', undefined],
      ['POST', '/flow-snapshot/reconcile', undefined],
      ['POST', '/digest-proposals', {}],
      ['GET', '/digest-proposals', undefined],
      ['GET', `/digest-proposals/${proposal.id}`, undefined],
      ['PATCH', `/digest-proposals/${proposal.id}/status`, { status: 'REJECTED' }],
      ['POST', `/digest-proposals/${proposal.id}/apply`, {
        applySummary: false, acceptedTagLabels: [], acceptMarkdown: true,
      }],
    ] as const) {
      const visibleDenied = await context.app.inject({
        method,
        url: `/api/guides/${guideId}${suffix}`,
        headers: authorization(context.tokens.otherAuthor),
        ...(payload === undefined ? {} : { payload }),
      });
      expect(visibleDenied.statusCode, `${method} ${suffix} visible member`).toBe(403);

      const hiddenDenied = await context.app.inject({
        method,
        url: `/api/guides/${guideId}${suffix}`,
        headers: authorization(context.tokens.learner),
        ...(payload === undefined ? {} : { payload }),
      });
      expect(hiddenDenied.statusCode, `${method} ${suffix} hidden member`).toBe(404);
    }

    expect((await context.app.inject({
      method: 'GET', url: `/api/guides/${guideId}/digest-proposals/${proposal.id}`,
      headers: authorization(context.tokens.editor),
    })).statusCode).toBe(200);
    const applied = await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/digest-proposals/${proposal.id}/apply`,
      headers: authorization(context.tokens.editor),
      payload: { applySummary: false, acceptedTagLabels: [], acceptMarkdown: true },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().proposal.status).toBe('APPLIED');
  });
});

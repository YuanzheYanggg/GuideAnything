import { describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  createWorkspaceGuideFixture,
  seedTestWorkspace,
} from '../../test/test-app';

describe('personal workspace state', () => {
  it('persists favorites idempotently and keeps them private', async () => {
    const context = await createWorkspaceGuideFixture();
    try {
      const itemId = context.workspaceItemId;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await context.app.inject({
          method: 'PUT',
          url: `/api/me/favorites/${itemId}`,
          headers: authorization(context.tokens.author),
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().item).toMatchObject({ id: itemId, favorite: true });
      }
      const author = await context.app.inject({
        method: 'GET',
        url: '/api/me/favorites',
        headers: authorization(context.tokens.author),
      });
      const learner = await context.app.inject({
        method: 'GET',
        url: '/api/me/favorites',
        headers: authorization(context.tokens.learner),
      });
      expect(author.json().items).toHaveLength(1);
      expect(learner.json().items).toHaveLength(0);
      const removed = await context.app.inject({
        method: 'DELETE',
        url: `/api/me/favorites/${itemId}`,
        headers: authorization(context.tokens.author),
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().item).toMatchObject({ id: itemId, favorite: false });
    } finally {
      await context.close();
    }
  });

  it('upserts recent views and sorts by last viewed time', async () => {
    const context = await createWorkspaceGuideFixture();
    try {
      const secondCreated = await context.app.inject({
        method: 'POST',
        url: '/api/guides',
        headers: authorization(context.tokens.author),
        payload: { workspaceId: context.workspaceId, title: '第二份最近查看指南' },
      });
      const secondGuide = secondCreated.json().guide as { id: string; workspaceItemId: string };
      await context.app.inject({
        method: 'POST',
        url: `/api/guides/${secondGuide.id}/publish`,
        headers: authorization(context.tokens.author),
      });
      const firstView = await context.app.inject({
        method: 'PUT',
        url: `/api/me/recent/${context.workspaceItemId}`,
        headers: authorization(context.tokens.author),
        payload: { context: { mode: 'lesson', versionId: context.versionId } },
      });
      expect(firstView.json().item).toMatchObject({ id: context.workspaceItemId, viewCount: 1 });
      const secondView = await context.app.inject({
        method: 'PUT',
        url: `/api/me/recent/${context.workspaceItemId}`,
        headers: authorization(context.tokens.author),
        payload: { context: { mode: 'lesson', versionId: context.versionId } },
      });
      expect(secondView.json().item).toMatchObject({ id: context.workspaceItemId, viewCount: 2 });
      await context.app.inject({
        method: 'PUT',
        url: `/api/me/recent/${secondGuide.workspaceItemId}`,
        headers: authorization(context.tokens.author),
        payload: { context: { mode: 'lesson' } },
      });
      context.database.prepare(
        'UPDATE recent_views SET last_viewed_at = ? WHERE user_id = ? AND item_id = ?',
      ).run('2026-01-01T00:00:00.000Z', context.userIds.author, context.workspaceItemId);
      context.database.prepare(
        'UPDATE recent_views SET last_viewed_at = ? WHERE user_id = ? AND item_id = ?',
      ).run('2026-01-02T00:00:00.000Z', context.userIds.author, secondGuide.workspaceItemId);
      const row = context.database.prepare(
        'SELECT view_count FROM recent_views WHERE user_id = ? AND item_id = ?',
      ).get(context.userIds.author, context.workspaceItemId);
      expect(row).toEqual({ view_count: 2 });
      const recent = await context.app.inject({
        method: 'GET',
        url: '/api/me/recent',
        headers: authorization(context.tokens.author),
      });
      expect(recent.json().items.map((item: { id: string }) => item.id)).toEqual([
        secondGuide.workspaceItemId,
        context.workspaceItemId,
      ]);
      expect(recent.json().items.map((item: { lastViewedAt: string }) => item.lastViewedAt)).toEqual([
        '2026-01-02T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ]);
    } finally {
      await context.close();
    }
  });

  it('trashes and restores an owned guide without deleting published versions', async () => {
    const context = await createWorkspaceGuideFixture();
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const trashed = await context.app.inject({
          method: 'POST',
          url: `/api/workspace-items/${context.workspaceItemId}/trash`,
          headers: authorization(context.tokens.author),
        });
        expect(trashed.statusCode).toBe(200);
        expect(trashed.json().item).toMatchObject({
          id: context.workspaceItemId,
          deletedAt: expect.any(String),
        });
      }
      expect(context.database.prepare(
        "SELECT COUNT(*) AS count FROM workspace_activity WHERE item_id = ? AND action = 'ITEM_TRASHED'",
      ).get(context.workspaceItemId)).toEqual({ count: 1 });
      expect(context.database.prepare(
        'SELECT COUNT(*) AS count FROM guide_versions WHERE guide_id = ?',
      ).get(context.guideId)).toEqual({ count: 1 });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const restored = await context.app.inject({
          method: 'POST',
          url: `/api/workspace-items/${context.workspaceItemId}/restore`,
          headers: authorization(context.tokens.author),
        });
        expect(restored.statusCode).toBe(200);
        expect(restored.json().item).toMatchObject({
          id: context.workspaceItemId,
          deletedAt: null,
        });
      }
      expect(context.database.prepare(
        "SELECT COUNT(*) AS count FROM workspace_activity WHERE item_id = ? AND action = 'ITEM_RESTORED'",
      ).get(context.workspaceItemId)).toEqual({ count: 1 });
    } finally {
      await context.close();
    }
  });

  it('lists only explicitly shared guides rather than workspace membership', async () => {
    const context = await createWorkspaceGuideFixture();
    try {
      addTestWorkspaceMember(
        context.database,
        context.workspaceId,
        context.userIds.learner,
        'VIEW',
      );
      const membershipOnly = await context.app.inject({
        method: 'GET',
        url: '/api/me/shared',
        headers: authorization(context.tokens.learner),
      });
      expect(membershipOnly.json().items).toEqual([]);

      const invited = await context.app.inject({
        method: 'POST',
        url: `/api/guides/${context.guideId}/collaborators`,
        headers: authorization(context.tokens.author),
        payload: { userId: context.userIds.editor },
      });
      expect(invited.statusCode).toBe(201);
      addTestWorkspaceMember(
        context.database,
        context.workspaceId,
        context.userIds.editor,
        'VIEW',
      );
      const explicitlyShared = await context.app.inject({
        method: 'GET',
        url: '/api/me/shared',
        headers: authorization(context.tokens.editor),
      });
      expect(explicitlyShared.json().items).toEqual([
        expect.objectContaining({
          id: context.workspaceItemId,
          entityId: context.guideId,
          permission: 'EDIT',
        }),
      ]);
    } finally {
      await context.close();
    }
  });

  it('archives a permanently removed published guide while retaining its readable version', async () => {
    const context = await createWorkspaceGuideFixture();
    try {
      await context.app.inject({
        method: 'PUT',
        url: `/api/me/favorites/${context.workspaceItemId}`,
        headers: authorization(context.tokens.author),
      });
      await context.app.inject({
        method: 'PUT',
        url: `/api/me/recent/${context.workspaceItemId}`,
        headers: authorization(context.tokens.author),
        payload: { context: { mode: 'lesson' } },
      });
      await context.app.inject({
        method: 'POST',
        url: `/api/workspace-items/${context.workspaceItemId}/trash`,
        headers: authorization(context.tokens.author),
      });
      const removed = await context.app.inject({
        method: 'DELETE',
        url: `/api/workspace-items/${context.workspaceItemId}`,
        headers: authorization(context.tokens.author),
      });
      expect(removed.statusCode).toBe(204);
      expect(context.database.prepare('SELECT status FROM guides WHERE id = ?').get(context.guideId))
        .toEqual({ status: 'ARCHIVED' });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM guide_versions WHERE guide_id = ?')
        .get(context.guideId)).toEqual({ count: 1 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM workspace_items WHERE id = ?')
        .get(context.workspaceItemId)).toEqual({ count: 0 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM user_favorites WHERE item_id = ?')
        .get(context.workspaceItemId)).toEqual({ count: 0 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM recent_views WHERE item_id = ?')
        .get(context.workspaceItemId)).toEqual({ count: 0 });
      const version = await context.app.inject({
        method: 'GET',
        url: `/api/versions/${context.versionId}`,
        headers: authorization(context.tokens.learner),
      });
      expect(version.statusCode).toBe(200);
      expect(version.json().version.id).toBe(context.versionId);
    } finally {
      await context.close();
    }
  });

  it('deletes both registry identity and guide row for an unpublished guide', async () => {
    const context = await createTestContext();
    try {
      const workspace = seedTestWorkspace(context.database, context.userIds.author, {
        id: 'workspace-draft-removal',
        slug: 'draft-removal',
        name: '草稿删除工作区',
      });
      const created = await context.app.inject({
        method: 'POST',
        url: '/api/guides',
        headers: authorization(context.tokens.author),
        payload: { workspaceId: workspace.id, title: '待删除草稿' },
      });
      const guide = created.json().guide as { id: string; workspaceItemId: string };
      await context.app.inject({
        method: 'POST',
        url: `/api/workspace-items/${guide.workspaceItemId}/trash`,
        headers: authorization(context.tokens.author),
      });
      const removed = await context.app.inject({
        method: 'DELETE',
        url: `/api/workspace-items/${guide.workspaceItemId}`,
        headers: authorization(context.tokens.author),
      });
      expect(removed.statusCode).toBe(204);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM workspace_items WHERE id = ?')
        .get(guide.workspaceItemId)).toEqual({ count: 0 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM guides WHERE id = ?')
        .get(guide.id)).toEqual({ count: 0 });
    } finally {
      await context.close();
    }
  });

  it('denies learners personal state for unpublished guides without leaking draft metadata', async () => {
    const context = await createTestContext();
    try {
      const workspace = seedTestWorkspace(context.database, context.userIds.author, {
        id: 'workspace-private-draft',
        slug: 'private-draft',
        name: '私有草稿工作区',
      });
      addTestWorkspaceMember(context.database, workspace.id, context.userIds.learner, 'VIEW');
      const created = await context.app.inject({
        method: 'POST',
        url: '/api/guides',
        headers: authorization(context.tokens.author),
        payload: { workspaceId: workspace.id, title: '不可泄露的草稿标题' },
      });
      const itemId = created.json().guide.workspaceItemId as string;
      for (const request of [
        { method: 'PUT' as const, url: `/api/me/favorites/${itemId}` },
        {
          method: 'PUT' as const,
          url: `/api/me/recent/${itemId}`,
          payload: { context: { mode: 'draft' } },
        },
      ]) {
        const response = await context.app.inject({
          ...request,
          headers: authorization(context.tokens.learner),
        });
        expect(response.statusCode).toBe(404);
      }
      const now = new Date().toISOString();
      context.database.prepare(
        'INSERT INTO user_favorites (user_id, item_id, created_at) VALUES (?, ?, ?)',
      ).run(context.userIds.learner, itemId, now);
      context.database.prepare(
        `INSERT INTO recent_views (user_id, item_id, last_viewed_at, view_count, context_json)
         VALUES (?, ?, ?, 1, '{}')`,
      ).run(context.userIds.learner, itemId, now);
      const favorites = await context.app.inject({
        method: 'GET', url: '/api/me/favorites', headers: authorization(context.tokens.learner),
      });
      const recent = await context.app.inject({
        method: 'GET', url: '/api/me/recent', headers: authorization(context.tokens.learner),
      });
      expect(favorites.json().items).toEqual([]);
      expect(recent.json().items).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('hides lifecycle item existence until baseline access is established', async () => {
    const context = await createWorkspaceGuideFixture();
    try {
      const inaccessibleTrash = await context.app.inject({
        method: 'POST',
        url: `/api/workspace-items/${context.workspaceItemId}/trash`,
        headers: authorization(context.tokens.otherAuthor),
      });
      expect(inaccessibleTrash.statusCode).toBe(404);

      addTestWorkspaceMember(context.database, context.workspaceId, context.userIds.learner, 'VIEW');
      const readableButUnauthorized = await context.app.inject({
        method: 'POST',
        url: `/api/workspace-items/${context.workspaceItemId}/trash`,
        headers: authorization(context.tokens.learner),
      });
      expect(readableButUnauthorized.statusCode).toBe(403);

      await context.app.inject({
        method: 'POST',
        url: `/api/workspace-items/${context.workspaceItemId}/trash`,
        headers: authorization(context.tokens.author),
      });
      for (const request of [
        { method: 'POST' as const, url: `/api/workspace-items/${context.workspaceItemId}/restore` },
        { method: 'DELETE' as const, url: `/api/workspace-items/${context.workspaceItemId}` },
      ]) {
        const response = await context.app.inject({
          ...request,
          headers: authorization(context.tokens.otherAuthor),
        });
        expect(response.statusCode).toBe(404);
      }
    } finally {
      await context.close();
    }
  });
});

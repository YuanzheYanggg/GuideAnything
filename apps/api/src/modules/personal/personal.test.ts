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
    } finally {
      await context.close();
    }
  });

  it('upserts recent views and sorts by last viewed time', async () => {
    const context = await createWorkspaceGuideFixture();
    try {
      await context.app.inject({
        method: 'PUT',
        url: `/api/me/recent/${context.workspaceItemId}`,
        headers: authorization(context.tokens.author),
        payload: { context: { mode: 'lesson', versionId: context.versionId } },
      });
      await context.app.inject({
        method: 'PUT',
        url: `/api/me/recent/${context.workspaceItemId}`,
        headers: authorization(context.tokens.author),
        payload: { context: { mode: 'lesson', versionId: context.versionId } },
      });
      const row = context.database.prepare(
        'SELECT view_count FROM recent_views WHERE user_id = ? AND item_id = ?',
      ).get(context.userIds.author, context.workspaceItemId);
      expect(row).toEqual({ view_count: 2 });
    } finally {
      await context.close();
    }
  });

  it('trashes and restores an owned guide without deleting published versions', async () => {
    const context = await createWorkspaceGuideFixture();
    try {
      const trashed = await context.app.inject({
        method: 'POST',
        url: `/api/workspace-items/${context.workspaceItemId}/trash`,
        headers: authorization(context.tokens.author),
      });
      expect(trashed.statusCode).toBe(200);
      expect(context.database.prepare(
        'SELECT COUNT(*) AS count FROM guide_versions WHERE guide_id = ?',
      ).get(context.guideId)).toEqual({ count: 1 });
      const restored = await context.app.inject({
        method: 'POST',
        url: `/api/workspace-items/${context.workspaceItemId}/restore`,
        headers: authorization(context.tokens.author),
      });
      expect(restored.statusCode).toBe(200);
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
      const explicitlyShared = await context.app.inject({
        method: 'GET',
        url: '/api/me/shared',
        headers: authorization(context.tokens.editor),
      });
      expect(explicitlyShared.json().items).toEqual([
        expect.objectContaining({ id: context.workspaceItemId, entityId: context.guideId }),
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
});

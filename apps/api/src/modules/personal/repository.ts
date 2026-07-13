import type {
  UserRole,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspacePermission,
} from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import { recordActivity } from '../workspaces/repository';

interface ItemSummaryRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  kind: WorkspaceItemKind;
  entity_id: string;
  title: string;
  summary: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by_name: string | null;
  author_name: string | null;
  published_version_id: string | null;
  last_viewed_at: string | null;
  view_count: number | null;
  favorite: number;
  permission: WorkspacePermission;
}

export interface WorkspaceItemRecord {
  id: string;
  workspaceId: string;
  kind: WorkspaceItemKind;
  entityId: string;
  createdBy: string;
  deletedAt: string | null;
  workspacePermission: WorkspacePermission | null;
  guideOwnerId: string | null;
  publishedVersionId: string | null;
}

const ITEM_SUMMARY_SELECT = `
  SELECT item.id, item.workspace_id, workspace.name AS workspace_name, item.kind, item.entity_id,
         item.title, item.summary, item.updated_at, item.deleted_at,
         deleted_by.display_name AS deleted_by_name, guide_owner.display_name AS author_name,
         guide.published_version_id, recent.last_viewed_at, recent.view_count,
         CASE WHEN favorite.item_id IS NULL THEN 0 ELSE 1 END AS favorite,
         CASE
           WHEN member.permission = 'OWNER' THEN 'OWNER'
           WHEN guide.owner_id = ? OR collaborator.user_id IS NOT NULL OR member.permission = 'EDIT' THEN 'EDIT'
           ELSE 'VIEW'
         END AS permission
  FROM workspace_items item
  JOIN workspaces workspace ON workspace.id = item.workspace_id AND workspace.status = 'ACTIVE'
  LEFT JOIN workspace_members member
    ON member.workspace_id = workspace.id AND member.user_id = ?
  LEFT JOIN user_favorites favorite
    ON favorite.item_id = item.id AND favorite.user_id = ?
  LEFT JOIN recent_views recent
    ON recent.item_id = item.id AND recent.user_id = ?
  LEFT JOIN guides guide ON item.kind = 'GUIDE' AND guide.id = item.entity_id
  LEFT JOIN users guide_owner ON guide_owner.id = guide.owner_id
  LEFT JOIN guide_versions published_version ON published_version.id = guide.published_version_id
  LEFT JOIN guide_collaborators collaborator
    ON collaborator.guide_id = guide.id AND collaborator.user_id = ?
  LEFT JOIN users deleted_by ON deleted_by.id = item.deleted_by
`;

const requesterArgs = (userId: string) => [userId, userId, userId, userId, userId];

const REQUESTER_CAN_ACCESS = `(
  member.user_id IS NOT NULL
  OR guide.owner_id = ?
  OR collaborator.user_id IS NOT NULL
)`;

export function listFavorites(
  database: DatabaseSync,
  userId: string,
  userRole: UserRole,
): WorkspaceItemSummary[] {
  const rows = database.prepare(
    `${ITEM_SUMMARY_SELECT}
     WHERE item.deleted_at IS NULL AND favorite.item_id IS NOT NULL
       AND ${REQUESTER_CAN_ACCESS}
       AND (
         item.kind != 'GUIDE'
         OR (guide.status = 'PUBLISHED' AND guide.published_version_id IS NOT NULL)
         OR ? != 'LEARNER'
       )
     ORDER BY favorite.created_at DESC`,
  ).all(...requesterArgs(userId), userId, userRole) as unknown as ItemSummaryRow[];
  return rows.map(mapItemSummary);
}

export function setFavorite(database: DatabaseSync, userId: string, itemId: string): void {
  database.prepare(
    `INSERT INTO user_favorites (user_id, item_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id, item_id) DO NOTHING`,
  ).run(userId, itemId, new Date().toISOString());
}

export function removeFavorite(database: DatabaseSync, userId: string, itemId: string): void {
  database.prepare('DELETE FROM user_favorites WHERE user_id = ? AND item_id = ?').run(userId, itemId);
}

export function recordRecentView(
  database: DatabaseSync,
  userId: string,
  itemId: string,
  context: Record<string, unknown>,
): void {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO recent_views (user_id, item_id, last_viewed_at, view_count, context_json)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (user_id, item_id) DO UPDATE SET
       last_viewed_at = excluded.last_viewed_at,
       view_count = recent_views.view_count + 1,
       context_json = excluded.context_json`,
  ).run(userId, itemId, now, JSON.stringify(context));
}

export function listRecentViews(
  database: DatabaseSync,
  userId: string,
  userRole: UserRole,
): WorkspaceItemSummary[] {
  const rows = database.prepare(
    `${ITEM_SUMMARY_SELECT}
     WHERE item.deleted_at IS NULL AND recent.item_id IS NOT NULL
       AND ${REQUESTER_CAN_ACCESS}
       AND (
         item.kind != 'GUIDE'
         OR (guide.status = 'PUBLISHED' AND guide.published_version_id IS NOT NULL)
         OR ? != 'LEARNER'
       )
     ORDER BY recent.last_viewed_at DESC`,
  ).all(...requesterArgs(userId), userId, userRole) as unknown as ItemSummaryRow[];
  return rows.map(mapItemSummary);
}

export function listSharedItems(database: DatabaseSync, userId: string): WorkspaceItemSummary[] {
  const rows = database.prepare(
    `${ITEM_SUMMARY_SELECT}
     WHERE item.deleted_at IS NULL
       AND collaborator.user_id IS NOT NULL
       AND guide.owner_id != ?
     ORDER BY item.updated_at DESC`,
  ).all(...requesterArgs(userId), userId) as unknown as ItemSummaryRow[];
  return rows.map(mapItemSummary);
}

export function listTrash(database: DatabaseSync, userId: string): WorkspaceItemSummary[] {
  const rows = database.prepare(
    `${ITEM_SUMMARY_SELECT}
     WHERE item.deleted_at IS NOT NULL
       AND (member.permission = 'OWNER' OR guide.owner_id = ? OR item.created_by = ?)
     ORDER BY item.deleted_at DESC`,
  ).all(...requesterArgs(userId), userId, userId) as unknown as ItemSummaryRow[];
  return rows.map(mapItemSummary);
}

export function getWorkspaceItemForUser(
  database: DatabaseSync,
  itemId: string,
  userId: string,
): WorkspaceItemRecord | null {
  const row = database.prepare(
    `SELECT item.id, item.workspace_id, item.kind, item.entity_id, item.created_by, item.deleted_at,
            member.permission, guide.owner_id AS guide_owner_id, guide.published_version_id
     FROM workspace_items item
     JOIN workspaces workspace ON workspace.id = item.workspace_id AND workspace.status = 'ACTIVE'
     LEFT JOIN workspace_members member ON member.workspace_id = workspace.id AND member.user_id = ?
     LEFT JOIN guides guide ON item.kind = 'GUIDE' AND guide.id = item.entity_id
     LEFT JOIN guide_collaborators collaborator
       ON collaborator.guide_id = guide.id AND collaborator.user_id = ?
     WHERE item.id = ?
       AND (member.user_id IS NOT NULL OR guide.owner_id = ? OR collaborator.user_id IS NOT NULL)`,
  ).get(userId, userId, itemId, userId) as unknown as {
    id: string;
    workspace_id: string;
    kind: WorkspaceItemKind;
    entity_id: string;
    created_by: string;
    deleted_at: string | null;
    permission: WorkspacePermission | null;
    guide_owner_id: string | null;
    published_version_id: string | null;
  } | undefined;
  return row ? mapWorkspaceItem(row) : null;
}

export function requesterCanAccessItem(
  database: DatabaseSync,
  userId: string,
  userRole: UserRole,
  itemId: string,
): boolean {
  const row = database.prepare(
    `SELECT 1
     FROM workspace_items item
     JOIN workspaces workspace ON workspace.id = item.workspace_id AND workspace.status = 'ACTIVE'
     LEFT JOIN workspace_members member
       ON member.workspace_id = workspace.id AND member.user_id = ?
     LEFT JOIN guides guide ON item.kind = 'GUIDE' AND guide.id = item.entity_id
     LEFT JOIN guide_collaborators collaborator
       ON collaborator.guide_id = guide.id AND collaborator.user_id = ?
     WHERE item.id = ? AND item.deleted_at IS NULL
       AND (member.user_id IS NOT NULL OR guide.owner_id = ? OR collaborator.user_id IS NOT NULL)
       AND (
         item.kind != 'GUIDE'
         OR (guide.status = 'PUBLISHED' AND guide.published_version_id IS NOT NULL)
         OR ? != 'LEARNER'
       )`,
  ).get(userId, userId, itemId, userId, userRole);
  return Boolean(row);
}

export function getItemSummary(
  database: DatabaseSync,
  userId: string,
  itemId: string,
): WorkspaceItemSummary | null {
  const row = database.prepare(
    `${ITEM_SUMMARY_SELECT}
     WHERE item.id = ?`,
  ).get(...requesterArgs(userId), itemId) as unknown as ItemSummaryRow | undefined;
  return row ? mapItemSummary(row) : null;
}

export function trashItem(database: DatabaseSync, item: WorkspaceItemRecord, actorId: string): void {
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      'UPDATE workspace_items SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?',
    ).run(now, actorId, now, item.id);
    if (item.kind === 'GUIDE') {
      database.prepare('DELETE FROM guide_search WHERE guide_id = ?').run(item.entityId);
    }
    recordActivity(database, {
      workspaceId: item.workspaceId,
      actorId,
      action: 'ITEM_TRASHED',
      itemId: item.id,
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function restoreItem(database: DatabaseSync, item: WorkspaceItemRecord, actorId: string): void {
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      'UPDATE workspace_items SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?',
    ).run(now, item.id);
    if (item.kind === 'GUIDE' && item.publishedVersionId) {
      database.prepare('DELETE FROM guide_search WHERE guide_id = ?').run(item.entityId);
      const version = database.prepare(
        `SELECT id, guide_id, title, summary, tags_json, search_text
         FROM guide_versions WHERE id = ? AND guide_id = ?`,
      ).get(item.publishedVersionId, item.entityId) as {
        id: string;
        guide_id: string;
        title: string;
        summary: string;
        tags_json: string;
        search_text: string;
      } | undefined;
      if (!version) throw new Error('Published guide version is missing');
      database.prepare(
        `INSERT INTO guide_search (version_id, guide_id, title, summary, tags, content)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        version.id,
        version.guide_id,
        version.title,
        version.summary,
        (JSON.parse(version.tags_json) as string[]).join(' '),
        version.search_text,
      );
    }
    recordActivity(database, {
      workspaceId: item.workspaceId,
      actorId,
      action: 'ITEM_RESTORED',
      itemId: item.id,
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function permanentlyRemoveItem(database: DatabaseSync, item: WorkspaceItemRecord): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    if (item.kind === 'GUIDE') {
      database.prepare('DELETE FROM guide_search WHERE guide_id = ?').run(item.entityId);
      if (item.publishedVersionId) {
        database.prepare("UPDATE guides SET status = 'ARCHIVED', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), item.entityId);
        database.prepare('DELETE FROM user_favorites WHERE item_id = ?').run(item.id);
        database.prepare('DELETE FROM recent_views WHERE item_id = ?').run(item.id);
        database.prepare('DELETE FROM workspace_items WHERE id = ?').run(item.id);
      } else {
        database.prepare('DELETE FROM workspace_items WHERE id = ?').run(item.id);
        database.prepare('DELETE FROM guides WHERE id = ?').run(item.entityId);
      }
    } else {
      database.prepare('DELETE FROM workspace_items WHERE id = ?').run(item.id);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function mapWorkspaceItem(row: {
  id: string;
  workspace_id: string;
  kind: WorkspaceItemKind;
  entity_id: string;
  created_by: string;
  deleted_at: string | null;
  permission: WorkspacePermission | null;
  guide_owner_id: string | null;
  published_version_id: string | null;
}): WorkspaceItemRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    entityId: row.entity_id,
    createdBy: row.created_by,
    deletedAt: row.deleted_at,
    workspacePermission: row.permission,
    guideOwnerId: row.guide_owner_id,
    publishedVersionId: row.published_version_id,
  };
}

function mapItemSummary(row: ItemSummaryRow): WorkspaceItemSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    kind: row.kind,
    entityId: row.entity_id,
    title: row.title,
    summary: row.summary,
    updatedAt: row.updated_at,
    favorite: row.favorite === 1,
    permission: row.permission,
    deletedAt: row.deleted_at,
    deletedByName: row.deleted_by_name,
    authorName: row.author_name,
    publishedVersionId: row.published_version_id,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count ?? 0,
  };
}

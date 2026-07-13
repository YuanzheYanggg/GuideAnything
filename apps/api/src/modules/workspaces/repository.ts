import type {
  WorkspaceActivity,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspacePermission,
  WorkspaceSummary,
} from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description: string;
  iconKey: string;
  colorKey: string;
}

export interface WorkspaceMember {
  userId: string;
  displayName: string;
  role: string;
  permission: WorkspacePermission;
  createdAt: string;
}

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_key: string;
  color_key: string;
  owner_id: string;
  owner_name: string;
  permission: WorkspacePermission;
  guide_count: number;
  updated_at: string;
}

const WORKSPACE_SUMMARY_SELECT = `
  SELECT w.id, w.slug, w.name, w.description, w.icon_key, w.color_key,
         w.owner_id, owner.display_name AS owner_name, member.permission,
         COUNT(CASE WHEN item.kind = 'GUIDE' AND item.deleted_at IS NULL THEN 1 END) AS guide_count,
         w.updated_at
  FROM workspaces w
  JOIN workspace_members member ON member.workspace_id = w.id AND member.user_id = ?
  JOIN users owner ON owner.id = w.owner_id
  LEFT JOIN workspace_items item ON item.workspace_id = w.id
`;

export function createWorkspace(
  database: DatabaseSync,
  ownerId: string,
  input: CreateWorkspaceInput,
): WorkspaceSummary {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      `INSERT INTO workspaces (
        id, slug, name, description, icon_key, color_key, owner_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.slug, input.name, input.description, input.iconKey, input.colorKey, ownerId, now, now);
    database.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
       VALUES (?, ?, 'OWNER', ?)`,
    ).run(id, ownerId, now);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return getWorkspaceForUser(database, id, ownerId)!;
}

export function ensureDefaultWorkspaces(
  database: DatabaseSync,
  ownerId: string,
  defaults: ReadonlyArray<CreateWorkspaceInput & { id: string }>,
): void {
  const now = new Date().toISOString();
  const upsertWorkspace = database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      slug = excluded.slug,
      name = excluded.name,
      description = excluded.description,
      icon_key = excluded.icon_key,
      color_key = excluded.color_key,
      owner_id = excluded.owner_id`,
  );
  const upsertOwner = database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES (?, ?, 'OWNER', ?)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET permission = 'OWNER'`,
  );
  for (const workspace of defaults) {
    upsertWorkspace.run(
      workspace.id,
      workspace.slug,
      workspace.name,
      workspace.description,
      workspace.iconKey,
      workspace.colorKey,
      ownerId,
      now,
      now,
    );
    upsertOwner.run(workspace.id, ownerId, now);
  }
}

export function listWorkspacesForUser(database: DatabaseSync, userId: string): WorkspaceSummary[] {
  const rows = database.prepare(
    `${WORKSPACE_SUMMARY_SELECT}
     WHERE w.status = 'ACTIVE'
     GROUP BY w.id, member.permission
     ORDER BY w.updated_at DESC, w.name ASC`,
  ).all(userId) as unknown as WorkspaceRow[];
  return rows.map(mapWorkspace);
}

export function getWorkspaceForUser(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
): WorkspaceSummary | null {
  const row = database.prepare(
    `${WORKSPACE_SUMMARY_SELECT}
     WHERE w.id = ? AND w.status = 'ACTIVE'
     GROUP BY w.id, member.permission`,
  ).get(userId, workspaceId) as unknown as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : null;
}

export function getWorkspacePermission(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
): WorkspacePermission | null {
  const row = database.prepare(
    `SELECT member.permission
     FROM workspaces w
     JOIN workspace_members member ON member.workspace_id = w.id AND member.user_id = ?
     WHERE w.id = ? AND w.status = 'ACTIVE'`,
  ).get(userId, workspaceId) as { permission: WorkspacePermission } | undefined;
  return row?.permission ?? null;
}

export function updateWorkspace(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
  input: Partial<CreateWorkspaceInput>,
): WorkspaceSummary {
  const current = getWorkspaceForUser(database, workspaceId, userId)!;
  database.prepare(
    `UPDATE workspaces
     SET name = ?, slug = ?, description = ?, icon_key = ?, color_key = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name ?? current.name,
    input.slug ?? current.slug,
    input.description ?? current.description,
    input.iconKey ?? current.iconKey,
    input.colorKey ?? current.colorKey,
    new Date().toISOString(),
    workspaceId,
  );
  return getWorkspaceForUser(database, workspaceId, userId)!;
}

export function listWorkspaceItems(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
  kind?: WorkspaceItemKind,
): WorkspaceItemSummary[] {
  const rows = database.prepare(
    `SELECT item.id, item.workspace_id, w.name AS workspace_name, item.kind, item.entity_id,
            item.title, item.summary, item.updated_at, item.deleted_at,
            deleted_by.display_name AS deleted_by_name, creator.display_name AS author_name,
            g.published_version_id, recent.last_viewed_at, recent.view_count,
            CASE WHEN favorite.item_id IS NULL THEN 0 ELSE 1 END AS favorite,
            member.permission
     FROM workspace_items item
     JOIN workspaces w ON w.id = item.workspace_id AND w.status = 'ACTIVE'
     JOIN workspace_members member ON member.workspace_id = w.id AND member.user_id = ?
     JOIN users creator ON creator.id = item.created_by
     LEFT JOIN users deleted_by ON deleted_by.id = item.deleted_by
     LEFT JOIN guides g ON item.kind = 'GUIDE' AND g.id = item.entity_id
     LEFT JOIN user_favorites favorite ON favorite.item_id = item.id AND favorite.user_id = ?
     LEFT JOIN recent_views recent ON recent.item_id = item.id AND recent.user_id = ?
     WHERE item.workspace_id = ? AND item.deleted_at IS NULL
       AND (? IS NULL OR item.kind = ?)
     ORDER BY item.updated_at DESC`,
  ).all(userId, userId, userId, workspaceId, kind ?? null, kind ?? null) as unknown as Array<{
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
  }>;
  return rows.map((row) => ({
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
  }));
}

export function countWorkspaceItems(
  database: DatabaseSync,
  workspaceId: string,
): Record<WorkspaceItemKind, number> {
  const counts: Record<WorkspaceItemKind, number> = {
    GUIDE: 0,
    SOURCE: 0,
    AGENT: 0,
    ONTOLOGY: 0,
    CONVERSATION: 0,
    ARTIFACT: 0,
  };
  const rows = database.prepare(
    `SELECT kind, COUNT(*) AS count
     FROM workspace_items
     WHERE workspace_id = ? AND deleted_at IS NULL
     GROUP BY kind`,
  ).all(workspaceId) as unknown as Array<{ kind: WorkspaceItemKind; count: number }>;
  for (const row of rows) counts[row.kind] = row.count;
  return counts;
}

export function listWorkspaceActivity(
  database: DatabaseSync,
  workspaceId: string,
): WorkspaceActivity[] {
  const rows = database.prepare(
    `SELECT activity.id, activity.workspace_id, activity.actor_id,
            actor.display_name AS actor_name, activity.action, activity.item_id, activity.created_at
     FROM workspace_activity activity
     JOIN users actor ON actor.id = activity.actor_id
     WHERE activity.workspace_id = ?
     ORDER BY activity.created_at DESC
     LIMIT 100`,
  ).all(workspaceId) as unknown as Array<{
    id: string;
    workspace_id: string;
    actor_id: string;
    actor_name: string;
    action: WorkspaceActivity['action'];
    item_id: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    itemId: row.item_id,
    createdAt: row.created_at,
  }));
}

export function listWorkspaceMembers(database: DatabaseSync, workspaceId: string): WorkspaceMember[] {
  const rows = database.prepare(
    `SELECT member.user_id, user.display_name, user.role, member.permission, member.created_at
     FROM workspace_members member
     JOIN users user ON user.id = member.user_id
     WHERE member.workspace_id = ?
     ORDER BY CASE member.permission WHEN 'OWNER' THEN 0 WHEN 'EDIT' THEN 1 ELSE 2 END,
              user.display_name ASC`,
  ).all(workspaceId) as unknown as Array<{
    user_id: string;
    display_name: string;
    role: string;
    permission: WorkspacePermission;
    created_at: string;
  }>;
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    permission: row.permission,
    createdAt: row.created_at,
  }));
}

export function addWorkspaceMember(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
  permission: Exclude<WorkspacePermission, 'OWNER'>,
): WorkspaceMember {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET permission = excluded.permission`,
  ).run(workspaceId, userId, permission, now);
  return listWorkspaceMembers(database, workspaceId).find((member) => member.userId === userId)!;
}

export function removeWorkspaceMember(database: DatabaseSync, workspaceId: string, userId: string): void {
  database.prepare(
    `DELETE FROM workspace_members
     WHERE workspace_id = ? AND user_id = ? AND permission != 'OWNER'`,
  ).run(workspaceId, userId);
}

export function recordActivity(
  database: DatabaseSync,
  input: {
    workspaceId: string;
    actorId: string;
    action: WorkspaceActivity['action'];
    itemId?: string;
    metadata?: Record<string, unknown>;
  },
): void {
  database.prepare(
    `INSERT INTO workspace_activity (
      id, workspace_id, actor_id, action, item_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.workspaceId,
    input.actorId,
    input.action,
    input.itemId ?? null,
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
}

function mapWorkspace(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    iconKey: row.icon_key,
    colorKey: row.color_key,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    permission: row.permission,
    guideCount: row.guide_count,
    updatedAt: row.updated_at,
  };
}

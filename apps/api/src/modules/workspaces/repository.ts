import type {
  WorkspaceActivity,
  WorkspaceFolder,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspaceKind,
  WorkspacePermission,
  WorkspaceResourceMount,
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
  kind?: WorkspaceKind;
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
  kind: WorkspaceKind;
  guide_count: number;
  updated_at: string;
}

const WORKSPACE_SUMMARY_SELECT = `
  SELECT w.id, w.slug, w.name, w.description, w.icon_key, w.color_key, w.kind,
         w.owner_id, owner.display_name AS owner_name, member.permission,
         COUNT(CASE WHEN item.kind = 'GUIDE' AND item.deleted_at IS NULL
                     AND (requester.role != 'LEARNER' OR (guide.status = 'PUBLISHED' AND guide.published_version_id IS NOT NULL))
                    THEN 1 END) AS guide_count,
         w.updated_at
  FROM workspaces w
  JOIN workspace_members member ON member.workspace_id = w.id AND member.user_id = ?
  JOIN users owner ON owner.id = w.owner_id
  JOIN users requester ON requester.id = member.user_id
  LEFT JOIN workspace_items item ON item.workspace_id = w.id
  LEFT JOIN guides guide ON item.kind = 'GUIDE' AND guide.id = item.entity_id
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
        id, slug, name, description, icon_key, color_key, kind, owner_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.slug, input.name, input.description, input.iconKey, input.colorKey, input.kind ?? 'BUSINESS_TEAM', ownerId, now, now);
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
      id, slug, name, description, icon_key, color_key, kind, owner_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`,
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
      workspace.kind ?? 'BUSINESS_TEAM',
      ownerId,
      now,
      now,
    );
    const owner = database.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(workspace.id) as { owner_id: string };
    upsertOwner.run(workspace.id, owner.owner_id, now);
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
    `SELECT item.id, item.workspace_id, w.name AS workspace_name, item.folder_id, item.kind, item.entity_id,
            item.title, item.summary, item.updated_at, item.deleted_at,
            deleted_by.display_name AS deleted_by_name, creator.display_name AS author_name,
            g.published_version_id, recent.last_viewed_at, recent.view_count,
            CASE WHEN favorite.item_id IS NULL THEN 0 ELSE 1 END AS favorite,
            CASE WHEN g.owner_id = ? OR member.permission = 'OWNER' THEN 1 ELSE 0 END AS can_manage_lifecycle,
            CASE WHEN g.owner_id = ? OR collaborator.user_id IS NOT NULL THEN 1 ELSE 0 END AS can_edit,
            member.permission
     FROM workspace_items item
     JOIN workspaces w ON w.id = item.workspace_id AND w.status = 'ACTIVE'
     JOIN workspace_members member ON member.workspace_id = w.id AND member.user_id = ?
     JOIN users creator ON creator.id = item.created_by
     JOIN users requester ON requester.id = member.user_id
     LEFT JOIN users deleted_by ON deleted_by.id = item.deleted_by
     LEFT JOIN guides g ON item.kind = 'GUIDE' AND g.id = item.entity_id
     LEFT JOIN guide_collaborators collaborator ON collaborator.guide_id = g.id AND collaborator.user_id = ?
     LEFT JOIN user_favorites favorite ON favorite.item_id = item.id AND favorite.user_id = ?
     LEFT JOIN recent_views recent ON recent.item_id = item.id AND recent.user_id = ?
     WHERE item.workspace_id = ? AND item.deleted_at IS NULL
       AND (? IS NULL OR item.kind = ?)
       AND (item.kind != 'GUIDE' OR requester.role != 'LEARNER'
            OR (g.status = 'PUBLISHED' AND g.published_version_id IS NOT NULL))
     ORDER BY item.updated_at DESC`,
  ).all(userId, userId, userId, userId, userId, userId, workspaceId, kind ?? null, kind ?? null) as unknown as Array<{
    id: string;
    workspace_id: string;
    workspace_name: string;
    folder_id: string | null;
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
    can_manage_lifecycle: number;
    can_edit: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    folderId: row.folder_id,
    kind: row.kind,
    entityId: row.entity_id,
    title: row.title,
    summary: row.summary,
    updatedAt: row.updated_at,
    favorite: row.favorite === 1,
    permission: row.permission,
    canEdit: row.can_edit === 1,
    canManageLifecycle: row.can_manage_lifecycle === 1,
    deletedAt: row.deleted_at,
    deletedByName: row.deleted_by_name,
    authorName: row.author_name,
    publishedVersionId: row.published_version_id,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count ?? 0,
  }));
}

export function listWorkspaceFolders(database: DatabaseSync, workspaceId: string): WorkspaceFolder[] {
  const rows = database.prepare(
    `SELECT id, workspace_id, parent_id, name, created_at, updated_at
     FROM workspace_folders
     WHERE workspace_id = ?
     ORDER BY parent_id IS NOT NULL, parent_id, name COLLATE NOCASE`,
  ).all(workspaceId) as unknown as Array<{
    id: string;
    workspace_id: string;
    parent_id: string | null;
    name: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getWorkspaceFolder(database: DatabaseSync, workspaceId: string, folderId: string): WorkspaceFolder | null {
  return listWorkspaceFolders(database, workspaceId).find((folder) => folder.id === folderId) ?? null;
}

export function createWorkspaceFolder(
  database: DatabaseSync,
  input: { workspaceId: string; parentId: string | null; name: string; createdBy: string },
): WorkspaceFolder {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO workspace_folders (id, workspace_id, parent_id, name, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.workspaceId, input.parentId, input.name, input.createdBy, now, now);
  return getWorkspaceFolder(database, input.workspaceId, id)!;
}

export function renameWorkspaceFolder(
  database: DatabaseSync,
  input: { workspaceId: string; folderId: string; name: string },
): WorkspaceFolder | null {
  const result = database.prepare(
    `UPDATE workspace_folders SET name = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`,
  ).run(input.name, new Date().toISOString(), input.folderId, input.workspaceId);
  if (result.changes === 0) return null;
  return getWorkspaceFolder(database, input.workspaceId, input.folderId);
}

export function workspaceFolderHasContents(database: DatabaseSync, workspaceId: string, folderId: string): boolean {
  return database.prepare(
    `SELECT 1
     WHERE EXISTS (SELECT 1 FROM workspace_folders WHERE workspace_id = ? AND parent_id = ?)
        OR EXISTS (SELECT 1 FROM workspace_items WHERE workspace_id = ? AND folder_id = ? AND deleted_at IS NULL)`,
  ).get(workspaceId, folderId, workspaceId, folderId) !== undefined;
}

export function deleteWorkspaceFolder(database: DatabaseSync, workspaceId: string, folderId: string): boolean {
  const result = database.prepare(
    `DELETE FROM workspace_folders WHERE id = ? AND workspace_id = ?`,
  ).run(folderId, workspaceId);
  return result.changes > 0;
}

export function moveWorkspaceItemToFolder(
  database: DatabaseSync,
  input: { workspaceId: string; itemId: string; folderId: string | null },
): WorkspaceItemSummary | null {
  const result = database.prepare(
    `UPDATE workspace_items SET folder_id = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
  ).run(input.folderId, new Date().toISOString(), input.itemId, input.workspaceId);
  if (result.changes === 0) return null;
  return null;
}

interface ResourceMountRow {
  id: string;
  consumer_workspace_id: string;
  provider_workspace_id: string;
  provider_name: string;
  provider_kind: Exclude<WorkspaceKind, 'BUSINESS_TEAM'>;
  created_at: string;
}

function mapResourceMount(row: ResourceMountRow): WorkspaceResourceMount {
  return {
    id: row.id,
    consumerWorkspaceId: row.consumer_workspace_id,
    providerWorkspaceId: row.provider_workspace_id,
    providerName: row.provider_name,
    providerKind: row.provider_kind,
    createdAt: row.created_at,
  };
}

const RESOURCE_MOUNT_SELECT = `
  SELECT mount.id, mount.consumer_workspace_id, mount.provider_workspace_id,
         provider.name AS provider_name, provider.kind AS provider_kind, mount.created_at
  FROM workspace_resource_mounts AS mount
  JOIN workspaces AS provider ON provider.id = mount.provider_workspace_id
`;

export function listWorkspaceResourceMounts(database: DatabaseSync, consumerWorkspaceId: string): WorkspaceResourceMount[] {
  const rows = database.prepare(
    `${RESOURCE_MOUNT_SELECT}
     WHERE mount.consumer_workspace_id = ? AND provider.status = 'ACTIVE'
     ORDER BY provider.name COLLATE NOCASE`,
  ).all(consumerWorkspaceId) as unknown as ResourceMountRow[];
  return rows.map(mapResourceMount);
}

export function getWorkspaceResourceMount(
  database: DatabaseSync,
  consumerWorkspaceId: string,
  mountId: string,
): WorkspaceResourceMount | null {
  const row = database.prepare(
    `${RESOURCE_MOUNT_SELECT}
     WHERE mount.consumer_workspace_id = ? AND mount.id = ?`,
  ).get(consumerWorkspaceId, mountId) as unknown as ResourceMountRow | undefined;
  return row ? mapResourceMount(row) : null;
}

export function createWorkspaceResourceMount(
  database: DatabaseSync,
  input: { consumerWorkspaceId: string; providerWorkspaceId: string; createdBy: string },
): WorkspaceResourceMount {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO workspace_resource_mounts (
      id, consumer_workspace_id, provider_workspace_id, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.consumerWorkspaceId, input.providerWorkspaceId, input.createdBy, now, now);
  return getWorkspaceResourceMount(database, input.consumerWorkspaceId, id)!;
}

export function deleteWorkspaceResourceMount(database: DatabaseSync, mountId: string): boolean {
  const result = database.prepare('DELETE FROM workspace_resource_mounts WHERE id = ?').run(mountId);
  return result.changes > 0;
}

export function listMountedResourceWorkspaceIds(database: DatabaseSync, consumerWorkspaceId: string): string[] {
  const rows = database.prepare(
    `SELECT mount.provider_workspace_id
     FROM workspace_resource_mounts AS mount
     JOIN workspaces AS consumer ON consumer.id = mount.consumer_workspace_id
     JOIN workspaces AS provider ON provider.id = mount.provider_workspace_id
     WHERE mount.consumer_workspace_id = ?
       AND consumer.status = 'ACTIVE' AND consumer.kind = 'BUSINESS_TEAM'
       AND provider.status = 'ACTIVE'
       AND provider.kind IN ('FINANCE', 'TECHNICAL', 'FOLLOW_UP', 'PRODUCTION')
     ORDER BY mount.provider_workspace_id`,
  ).all(consumerWorkspaceId) as unknown as Array<{ provider_workspace_id: string }>;
  return rows.map((row) => row.provider_workspace_id);
}

export function countWorkspaceItems(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
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
    `SELECT item.kind, COUNT(*) AS count
     FROM workspace_items item
     JOIN workspace_members member ON member.workspace_id = item.workspace_id AND member.user_id = ?
     JOIN users requester ON requester.id = member.user_id
     LEFT JOIN guides guide ON item.kind = 'GUIDE' AND guide.id = item.entity_id
     WHERE item.workspace_id = ? AND item.deleted_at IS NULL
       AND (item.kind != 'GUIDE' OR requester.role != 'LEARNER'
            OR (guide.status = 'PUBLISHED' AND guide.published_version_id IS NOT NULL))
     GROUP BY kind`,
  ).all(userId, workspaceId) as unknown as Array<{ kind: WorkspaceItemKind; count: number }>;
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
    kind: row.kind,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    permission: row.permission,
    guideCount: row.guide_count,
    updatedAt: row.updated_at,
  };
}

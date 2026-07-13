import type { CanvasDocument, GuideStatus, GuideVersionSnapshot } from '@guideanything/contracts';
import { CanvasDocumentSchema } from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import { recordActivity } from '../workspaces/repository';

export interface GuideDraft {
  id: string;
  ownerId: string;
  workspaceId: string;
  workspaceItemId: string;
  authorName: string;
  title: string;
  summary: string;
  tags: string[];
  status: GuideStatus;
  revision: number;
  document: CanvasDocument;
  publishedVersionId: string | null;
  publishedVersion: number | null;
  updatedAt: string;
}

interface GuideRow {
  id: string;
  owner_id: string;
  workspace_id: string;
  workspace_item_id: string;
  author_name: string;
  title: string;
  summary: string;
  tags_json: string;
  status: GuideStatus;
  revision: number;
  draft_document: string;
  published_version_id: string | null;
  published_version: number | null;
  updated_at: string;
}

interface VersionRow {
  id: string;
  guide_id: string;
  workspace_item_id: string | null;
  version: number;
  title: string;
  summary: string;
  tags_json: string;
  document_json: string;
  published_at: string;
}

export type GuideAccess = 'OWNER' | 'EDIT' | null;

export function createGuide(
  database: DatabaseSync,
  ownerId: string,
  workspaceId: string,
  input: { title: string; summary: string; tags: string[] },
): GuideDraft {
  const id = randomUUID();
  const workspaceItemId = randomUUID();
  const now = new Date().toISOString();
  const document = emptyDocument();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'DRAFT', 'INTERNAL', 0, ?, ?, ?)`,
    ).run(id, ownerId, input.title, input.summary, JSON.stringify(input.tags), JSON.stringify(document), now, now);
    database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES (?, ?, 'GUIDE', ?, ?, ?, ?, ?, ?)`,
    ).run(workspaceItemId, workspaceId, id, input.title, input.summary, ownerId, now, now);
    recordActivity(database, {
      workspaceId,
      actorId: ownerId,
      action: 'GUIDE_CREATED',
      itemId: workspaceItemId,
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return getGuide(database, id)!;
}

export function getGuide(database: DatabaseSync, guideId: string): GuideDraft | null {
  const row = database.prepare(
    `SELECT g.id, g.owner_id, item.workspace_id, item.id AS workspace_item_id,
            u.display_name AS author_name, g.title, g.summary,
            g.tags_json, g.status, g.revision, g.draft_document, g.published_version_id,
            v.version AS published_version, g.updated_at
     FROM guides g
     JOIN users u ON u.id = g.owner_id
     JOIN workspace_items item ON item.kind = 'GUIDE' AND item.entity_id = g.id
     JOIN workspaces workspace ON workspace.id = item.workspace_id
     LEFT JOIN guide_versions v ON v.id = g.published_version_id
     WHERE g.id = ? AND g.status != 'ARCHIVED'
       AND item.deleted_at IS NULL AND workspace.status = 'ACTIVE'`,
  ).get(guideId) as unknown as GuideRow | undefined;
  return row ? mapGuide(row) : null;
}

export type GuideListScope = 'owned' | 'editable' | 'shared';

export function listGuides(
  database: DatabaseSync,
  userId: string,
  options: { workspaceId?: string; scope?: GuideListScope },
): GuideDraft[] {
  const scope = options.scope ?? 'editable';
  const rows = database.prepare(
    `SELECT DISTINCT g.id, g.owner_id, item.workspace_id, item.id AS workspace_item_id,
            u.display_name AS author_name, g.title, g.summary,
            g.tags_json, g.status, g.revision, g.draft_document, g.published_version_id,
            v.version AS published_version, g.updated_at
     FROM guides g
     JOIN users u ON u.id = g.owner_id
     JOIN workspace_items item ON item.kind = 'GUIDE' AND item.entity_id = g.id
     JOIN workspaces workspace ON workspace.id = item.workspace_id AND workspace.status = 'ACTIVE'
     LEFT JOIN guide_collaborators c ON c.guide_id = g.id AND c.user_id = ?
     LEFT JOIN guide_versions v ON v.id = g.published_version_id
     WHERE g.status != 'ARCHIVED' AND item.deleted_at IS NULL
       AND (? IS NULL OR item.workspace_id = ?)
       AND (
         (? = 'owned' AND g.owner_id = ?)
         OR (? = 'shared' AND c.user_id IS NOT NULL AND g.owner_id != ?)
         OR (? = 'editable' AND (g.owner_id = ? OR c.user_id IS NOT NULL))
       )
     ORDER BY g.updated_at DESC`,
  ).all(
    userId,
    options.workspaceId ?? null,
    options.workspaceId ?? null,
    scope,
    userId,
    scope,
    userId,
    scope,
    userId,
  ) as unknown as GuideRow[];
  return rows.map(mapGuide);
}

export function getGuideAccess(database: DatabaseSync, guideId: string, userId: string): GuideAccess {
  const row = database.prepare(
    `SELECT CASE
       WHEN g.owner_id = ? THEN 'OWNER'
       WHEN c.user_id IS NOT NULL THEN 'EDIT'
       ELSE NULL
     END AS access
     FROM guides g
     JOIN workspace_items item ON item.kind = 'GUIDE' AND item.entity_id = g.id AND item.deleted_at IS NULL
     JOIN workspaces workspace ON workspace.id = item.workspace_id AND workspace.status = 'ACTIVE'
     LEFT JOIN guide_collaborators c ON c.guide_id = g.id AND c.user_id = ?
     WHERE g.id = ? AND g.status != 'ARCHIVED'`,
  ).get(userId, userId, guideId) as unknown as { access: GuideAccess } | undefined;
  return row?.access ?? null;
}

export function updateGuide(
  database: DatabaseSync,
  guideId: string,
  actorId: string,
  revision: number,
  input: { title?: string; summary?: string; tags?: string[]; document?: CanvasDocument },
): GuideDraft {
  const current = getGuide(database, guideId);
  if (!current) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
  const next = {
    title: input.title ?? current.title,
    summary: input.summary ?? current.summary,
    tags: input.tags ?? current.tags,
    document: input.document ?? current.document,
  };
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = database.prepare(
      `UPDATE guides
       SET title = ?, summary = ?, tags_json = ?, draft_document = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ?`,
    ).run(
      next.title,
      next.summary,
      JSON.stringify(next.tags),
      JSON.stringify(next.document),
      now,
      guideId,
      revision,
    );
    if (result.changes === 0) {
      throw httpError(409, 'REVISION_CONFLICT', '指南已被其他操作更新，请重新载入');
    }
    database.prepare(
      `UPDATE workspace_items SET title = ?, summary = ?, updated_at = ? WHERE id = ?`,
    ).run(next.title, next.summary, now, current.workspaceItemId);
    recordActivity(database, {
      workspaceId: current.workspaceId,
      actorId,
      action: 'GUIDE_UPDATED',
      itemId: current.workspaceItemId,
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return getGuide(database, guideId)!;
}

export function addCollaborator(
  database: DatabaseSync,
  guideId: string,
  actorId: string,
  userId: string,
): void {
  const user = database.prepare(`SELECT role FROM users WHERE id = ?`).get(userId) as
    | { role: string }
    | undefined;
  if (!user || !['EDITOR', 'AUTHOR'].includes(user.role)) {
    throw httpError(400, 'INVALID_COLLABORATOR', '协作者必须是编辑者或作者');
  }
  const guide = getGuide(database, guideId);
  if (!guide) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      `INSERT INTO guide_collaborators (guide_id, user_id, permission, created_at)
       VALUES (?, ?, 'EDIT', ?)
       ON CONFLICT (guide_id, user_id) DO UPDATE SET permission = 'EDIT'`,
    ).run(guideId, userId, new Date().toISOString());
    recordActivity(database, {
      workspaceId: guide.workspaceId,
      actorId,
      action: 'COLLABORATOR_ADDED',
      itemId: guide.workspaceItemId,
      metadata: { userId, permission: 'EDIT' },
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function publishGuide(
  database: DatabaseSync,
  guideId: string,
  publisherId: string,
): GuideVersionSnapshot & { publishedAt: string } {
  const guide = getGuide(database, guideId);
  if (!guide) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
  const validated = CanvasDocumentSchema.safeParse(guide.document);
  if (!validated.success) {
    throw httpError(400, 'VALIDATION_ERROR', '画布数据不完整，无法发布', validated.error.issues);
  }

  const latest = database.prepare(
    `SELECT COALESCE(MAX(version), 0) AS version FROM guide_versions WHERE guide_id = ?`,
  ).get(guideId) as { version: number };
  const version = latest.version + 1;
  const id = randomUUID();
  const publishedAt = new Date().toISOString();
  const searchText = extractSearchText(validated.data);

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      `INSERT INTO guide_versions (
        id, guide_id, version, title, summary, tags_json, document_json,
        search_text, published_by, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      guideId,
      version,
      guide.title,
      guide.summary,
      JSON.stringify(guide.tags),
      JSON.stringify(validated.data),
      searchText,
      publisherId,
      publishedAt,
    );
    database.prepare(
      `UPDATE guides SET status = 'PUBLISHED', published_version_id = ?, updated_at = ? WHERE id = ?`,
    ).run(id, publishedAt, guideId);
    database.prepare('DELETE FROM guide_search WHERE guide_id = ?').run(guideId);
    database.prepare(
      `INSERT INTO guide_search (version_id, guide_id, title, summary, tags, content)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, guideId, guide.title, guide.summary, guide.tags.join(' '), searchText);
    recordActivity(database, {
      workspaceId: guide.workspaceId,
      actorId: publisherId,
      action: 'GUIDE_PUBLISHED',
      itemId: guide.workspaceItemId,
      metadata: { versionId: id, version },
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return {
    id,
    guideId,
    workspaceItemId: guide.workspaceItemId,
    version,
    title: guide.title,
    summary: guide.summary,
    tags: guide.tags,
    document: validated.data,
    publishedAt,
  };
}

export function getVersion(database: DatabaseSync, versionId: string): (GuideVersionSnapshot & { publishedAt: string }) | null {
  const row = database.prepare(
    `SELECT version.id, version.guide_id, item.id AS workspace_item_id, version.version,
            version.title, version.summary, version.tags_json, version.document_json, version.published_at
     FROM guide_versions version
     LEFT JOIN workspace_items item ON item.kind = 'GUIDE' AND item.entity_id = version.guide_id
     WHERE version.id = ?`,
  ).get(versionId) as unknown as VersionRow | undefined;
  return row ? mapVersion(row) : null;
}

function mapGuide(row: GuideRow): GuideDraft {
  return {
    id: row.id,
    ownerId: row.owner_id,
    workspaceId: row.workspace_id,
    workspaceItemId: row.workspace_item_id,
    authorName: row.author_name,
    title: row.title,
    summary: row.summary,
    tags: JSON.parse(row.tags_json) as string[],
    status: row.status,
    revision: row.revision,
    document: CanvasDocumentSchema.parse(JSON.parse(row.draft_document)),
    publishedVersionId: row.published_version_id,
    publishedVersion: row.published_version,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: VersionRow): GuideVersionSnapshot & { publishedAt: string } {
  return {
    id: row.id,
    guideId: row.guide_id,
    ...(row.workspace_item_id ? { workspaceItemId: row.workspace_item_id } : {}),
    version: row.version,
    title: row.title,
    summary: row.summary,
    tags: JSON.parse(row.tags_json) as string[],
    document: CanvasDocumentSchema.parse(JSON.parse(row.document_json)),
    publishedAt: row.published_at,
  };
}

function emptyDocument(): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [],
    exitNodeIds: [],
  };
}

function extractSearchText(document: CanvasDocument): string {
  const values: string[] = [];
  for (const node of document.nodes) {
    switch (node.type) {
      case 'start':
      case 'end':
      case 'process':
      case 'decision':
      case 'data':
        values.push(node.data.label, node.data.description ?? '', ...(node.data.branchLabels ?? []));
        break;
      case 'markdown':
        values.push(node.data.markdown);
        break;
      case 'image':
        values.push(node.data.alt, node.data.caption ?? '');
        break;
      case 'video':
        values.push(node.data.caption ?? '', ...node.data.keypoints.map((point) => point.title));
        break;
      case 'subguide':
        values.push(node.data.title);
        break;
    }
  }
  for (const step of document.steps) values.push(step.title, step.body ?? '');
  return values.filter(Boolean).join('\n');
}

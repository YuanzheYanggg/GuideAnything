import type {
  FlowKnowledgeResourceV2,
  FlowKnowledgeSnapshotV2,
  FlowSnapshotSummaryV1,
} from '@guideanything/contracts';
import { FlowKnowledgeSnapshotSchema, FlowSnapshotSummaryV1Schema } from '@guideanything/contracts';
import {
  compileFlowKnowledgeSnapshotV2,
  normalizeFlowKnowledgeSnapshot,
} from '@guideanything/canvas-core';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { buildSearchText } from './search-text';

export interface GuideFlowContext {
  workspaceId: string;
  workspaceItemId: string;
  guideId: string;
  ownerId: string;
  title: string;
  summary: string;
  tags: string[];
  origin: { kind: 'DRAFT'; revision: number } | { kind: 'PUBLISHED'; versionId: string; version: number };
  document: Parameters<typeof compileFlowKnowledgeSnapshotV2>[0]['document'];
}

export class FlowIndexError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FlowIndexError';
  }
}

export function syncGuideFlowSnapshot(database: DatabaseSync, context: GuideFlowContext): FlowKnowledgeSnapshotV2 {
  const checksum = sha256(JSON.stringify(context.document));
  const existing = findOrigin(database, context);
  if (existing) {
    if (existing.document_checksum !== checksum) {
      throw new FlowIndexError('FLOW_ORIGIN_INTEGRITY_MISMATCH', '同一流程版本的内容校验不一致');
    }
    const snapshot = normalizeFlowKnowledgeSnapshot(
      FlowKnowledgeSnapshotSchema.parse(JSON.parse(existing.snapshot_json)),
    );
    const materialized = database.prepare(
      `SELECT 1 FROM knowledge_documents WHERE flow_snapshot_id = ?`,
    ).get(existing.id);
    if (!materialized) materializeExistingSnapshot(database, context, snapshot, checksum);
    return snapshot;
  }

  const snapshotId = randomUUID();
  const snapshot = compileFlowKnowledgeSnapshotV2({
    snapshotId,
    workspaceId: context.workspaceId,
    workspaceItemId: context.workspaceItemId,
    guideId: context.guideId,
    title: context.title,
    summary: context.summary,
    tags: context.tags,
    origin: context.origin,
    document: context.document,
  });
  const sourceId = flowSourceId(context.guideId);
  const documentId = randomUUID();
  const now = new Date().toISOString();
  const revision = flowRevision(context.origin);
  const metadata = {
    sourceKind: 'WORKSPACE_FLOW',
    aliases: [],
    tags: context.tags,
    rawEvidenceAvailable: false,
    guideId: context.guideId,
    guideTitle: context.title,
    origin: context.origin,
  };
  const fragments = flowFragments(snapshot, documentId, checksum, now);

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      `INSERT INTO flow_knowledge_snapshots (
        id, guide_id, workspace_id, origin_type, revision, version_id, version,
        document_checksum, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshotId,
      context.guideId,
      context.workspaceId,
      context.origin.kind,
      context.origin.kind === 'DRAFT' ? context.origin.revision : null,
      context.origin.kind === 'PUBLISHED' ? context.origin.versionId : null,
      context.origin.kind === 'PUBLISHED' ? context.origin.version : null,
      checksum,
      JSON.stringify(snapshot),
      now,
    );
    database.prepare(
      `INSERT INTO knowledge_sources (
        id, scope, kind, workspace_id, conversation_id, created_by,
        status, revision, config_json, created_at, updated_at
      ) VALUES (?, 'WORKSPACE', 'WORKSPACE_FLOW', ?, NULL, ?, 'READY', ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        status = 'READY', revision = excluded.revision,
        config_json = excluded.config_json, updated_at = excluded.updated_at`,
    ).run(sourceId, context.workspaceId, context.ownerId, revision, JSON.stringify({ guideId: context.guideId }), now, now);
    database.prepare(
      `INSERT INTO knowledge_documents (
        id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
        parse_status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?)`,
    ).run(
      documentId, sourceId, snapshotId, flowRelativeLocator(context.origin), context.title,
      checksum, revision, JSON.stringify(metadata), now, now,
    );
    const insertFragment = database.prepare(
      `INSERT INTO knowledge_fragments (
        id, document_id, ordinal, title, heading, content, search_text,
        internal_locator_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    fragments.forEach((fragment, ordinal) => insertFragment.run(
      fragment.id, documentId, ordinal, context.title, fragment.heading, fragment.content,
      fragment.searchText, fragment.locatorJson, now, now,
    ));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return snapshot;
}

export function recordFlowIndexFailure(database: DatabaseSync, context: GuideFlowContext, code: string): void {
  const now = new Date().toISOString();
  const sourceId = flowSourceId(context.guideId);
  database.prepare(
    `INSERT INTO knowledge_sources (
      id, scope, kind, workspace_id, conversation_id, created_by,
      status, revision, config_json, created_at, updated_at
    ) VALUES (?, 'WORKSPACE', 'WORKSPACE_FLOW', ?, NULL, ?, 'FAILED', ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      status = 'FAILED', revision = excluded.revision,
      config_json = excluded.config_json, updated_at = excluded.updated_at`,
  ).run(
    sourceId, context.workspaceId, context.ownerId, flowRevision(context.origin),
    JSON.stringify({ guideId: context.guideId, lastFailureCode: safeCode(code) }), now, now,
  );
}

export function listReadableFlowSnapshots(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
): FlowSnapshotSummaryV1[] {
  const rows = database.prepare(
    `SELECT snapshot.id, snapshot.guide_id, snapshot.origin_type, snapshot.revision,
            snapshot.version_id, snapshot.version, snapshot.snapshot_json, snapshot.created_at,
            source.id AS source_id, source.status AS source_status, source.config_json AS source_config_json,
            document.id AS document_id, guide.title AS guide_title,
            guide.owner_id, collaborator.user_id AS collaborator_id
     FROM flow_knowledge_snapshots snapshot
     JOIN guides guide ON guide.id = snapshot.guide_id
     JOIN knowledge_documents document ON document.flow_snapshot_id = snapshot.id
     JOIN knowledge_sources source ON source.id = document.source_id
     LEFT JOIN guide_collaborators collaborator
       ON collaborator.guide_id = guide.id AND collaborator.user_id = ?
     WHERE snapshot.workspace_id = ?
     ORDER BY snapshot.guide_id, snapshot.created_at DESC, snapshot.id DESC`,
  ).all(userId, workspaceId) as unknown as FlowSummaryRow[];
  const byGuide = new Map<string, FlowSummaryRow>();
  for (const row of rows) {
    const canReadDraft = row.owner_id === userId || row.collaborator_id === userId;
    if (row.origin_type === 'DRAFT' && !canReadDraft) continue;
    if (!byGuide.has(row.guide_id)) byGuide.set(row.guide_id, row);
  }
  return [...byGuide.values()].map((row) => {
    const snapshot = normalizeFlowKnowledgeSnapshot(
      FlowKnowledgeSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
    );
    const origin = row.origin_type === 'DRAFT'
      ? { kind: 'DRAFT' as const, revision: row.revision! }
      : { kind: 'PUBLISHED' as const, versionId: row.version_id!, version: row.version! };
    const failed = row.source_status === 'FAILED';
    const invalidReason = safeFlowFailureReason(row.source_config_json);
    return FlowSnapshotSummaryV1Schema.parse({
      snapshotId: row.id,
      sourceId: row.source_id,
      documentId: row.document_id,
      guideId: row.guide_id,
      guideTitle: row.guide_title,
      origin,
      nodeCount: snapshot.nodes.length,
      status: row.source_status === 'FAILED' ? 'FAILED' : row.source_status === 'STALE' ? 'STALE' : 'READY',
      href: failed
        ? null
        : row.origin_type === 'DRAFT'
          ? `/guides/${encodeURIComponent(row.guide_id)}/edit`
          : `/versions/${encodeURIComponent(row.version_id!)}/learn`,
      ...(failed ? { invalidReason: invalidReason ?? 'FLOW_INDEX_FAILED' } : {}),
      createdAt: row.created_at,
    });
  });
}

export function reconcileGuideFlowSnapshots(database: DatabaseSync): { indexed: number; failed: number } {
  const draftRows = database.prepare(
    `SELECT guide.id, guide.owner_id, guide.title, guide.summary, guide.tags_json,
            guide.revision, guide.draft_document, item.workspace_id, item.id AS workspace_item_id
     FROM guides guide
     JOIN workspace_items item ON item.kind = 'GUIDE' AND item.entity_id = guide.id
     LEFT JOIN flow_knowledge_snapshots snapshot
       ON snapshot.guide_id = guide.id AND snapshot.origin_type = 'DRAFT' AND snapshot.revision = guide.revision
     LEFT JOIN knowledge_documents document ON document.flow_snapshot_id = snapshot.id
     WHERE guide.status != 'ARCHIVED' AND item.deleted_at IS NULL
       AND (snapshot.id IS NULL OR document.id IS NULL)`,
  ).all() as unknown as DraftReconcileRow[];
  const publishedRows = database.prepare(
    `SELECT version.id AS version_id, version.guide_id, version.version, version.title,
            version.summary, version.tags_json, version.document_json,
            guide.owner_id, item.workspace_id, item.id AS workspace_item_id
     FROM guide_versions version
     JOIN guides guide ON guide.id = version.guide_id
     JOIN workspace_items item ON item.kind = 'GUIDE' AND item.entity_id = guide.id
     LEFT JOIN flow_knowledge_snapshots snapshot
       ON snapshot.guide_id = version.guide_id AND snapshot.origin_type = 'PUBLISHED'
      AND snapshot.version_id = version.id AND snapshot.version = version.version
     LEFT JOIN knowledge_documents document ON document.flow_snapshot_id = snapshot.id
     WHERE item.deleted_at IS NULL AND (snapshot.id IS NULL OR document.id IS NULL)`,
  ).all() as unknown as PublishedReconcileRow[];
  let indexed = 0;
  let failed = 0;
  const contexts: GuideFlowContext[] = [
    ...draftRows.map((row) => ({
      workspaceId: row.workspace_id,
      workspaceItemId: row.workspace_item_id,
      guideId: row.id,
      ownerId: row.owner_id,
      title: row.title,
      summary: row.summary,
      tags: JSON.parse(row.tags_json) as string[],
      origin: { kind: 'DRAFT' as const, revision: row.revision },
      document: JSON.parse(row.draft_document) as GuideFlowContext['document'],
    })),
    ...publishedRows.map((row) => ({
      workspaceId: row.workspace_id,
      workspaceItemId: row.workspace_item_id,
      guideId: row.guide_id,
      ownerId: row.owner_id,
      title: row.title,
      summary: row.summary,
      tags: JSON.parse(row.tags_json) as string[],
      origin: { kind: 'PUBLISHED' as const, versionId: row.version_id, version: row.version },
      document: JSON.parse(row.document_json) as GuideFlowContext['document'],
    })),
  ];
  for (const context of contexts) {
    try {
      syncGuideFlowSnapshot(database, context);
      indexed += 1;
    } catch (error) {
      recordFlowIndexFailure(database, context, error instanceof FlowIndexError ? error.code : 'FLOW_RECONCILE_FAILED');
      failed += 1;
    }
  }
  return { indexed, failed };
}

function flowFragments(
  snapshot: FlowKnowledgeSnapshotV2,
  documentId: string,
  revision: string,
  now: string,
): Array<{ id: string; heading: string; content: string; searchText: string; locatorJson: string; now: string }> {
  const titleByNodeId = new Map(snapshot.nodes.map((node) => [node.id, node.title]));
  const flowRelations = snapshot.relations.filter((relation) => relation.kind === 'FLOW');
  const resourceById = new Map(snapshot.resources.map((resource) => [resource.id, resource]));
  const result: Array<{ id: string; heading: string; content: string; searchText: string; locatorJson: string; now: string }> = [];
  const overviewTarget = snapshot.nodes.find((node) => node.isEntry)?.locator
    ?? snapshot.nodes[0]?.locator
    ?? snapshot.resources[0]?.locator;
  if (overviewTarget) {
    const parts = [snapshot.title, snapshot.summary, ...snapshot.tags].filter(Boolean);
    const id = flowOverviewFragmentId(snapshot.snapshotId);
    result.push({
      id,
      heading: snapshot.title,
      content: parts.join('\n'),
      searchText: buildSearchText(parts),
      locatorJson: JSON.stringify({
        kind: 'WORKSPACE_FLOW', ...overviewTarget, documentId, revision, fragmentId: id, projection: 'OVERVIEW',
      }),
      now,
    });
  }
  for (const node of snapshot.nodes) {
    const relatedFlow = flowRelations.filter((relation) => (
      relation.sourceNodeId === node.id || relation.targetNodeId === node.id
    ));
    const branchLabels = relatedFlow
      .flatMap((relation) => [relation.label, relation.branchLabel])
      .filter((value): value is string => Boolean(value));
    const neighborIds = oneAndTwoHopNodeIds(node.id, flowRelations).slice(0, 24);
    const neighbors = neighborIds
      .map((id) => titleByNodeId.get(id))
      .filter((value): value is string => Boolean(value));
    const resourceLabels = snapshot.relations.flatMap((relation) => (
      relation.kind === 'USES_RESOURCE' && relation.sourceNodeId === node.id
        ? [relation.label, resourceTitle(resourceById.get(relation.resourceId))]
        : []
    )).filter((value): value is string => Boolean(value));
    const parts = [
      node.title,
      node.description ?? '',
      node.stage?.title ?? '',
      node.responsibility?.title ?? '',
      ...branchLabels,
      ...neighbors,
      ...resourceLabels,
    ].filter(Boolean);
    const content = parts.join('\n');
    const id = flowFragmentId(snapshot.snapshotId, node.id);
    result.push({
      id,
      heading: node.title,
      content,
      searchText: buildSearchText(parts),
      locatorJson: JSON.stringify({ kind: 'WORKSPACE_FLOW', ...node.locator, documentId, revision, fragmentId: id }),
      now,
    });
  }
  snapshot.resources.forEach((resource) => result.push(flowResourceFragment(snapshot, resource, documentId, revision, now)));
  return result;
}

function flowResourceFragment(
  snapshot: FlowKnowledgeSnapshotV2,
  resource: FlowKnowledgeResourceV2,
  documentId: string,
  revision: string,
  now: string,
) {
  const parts = resource.kind === 'MARKDOWN'
    ? [resource.markdown]
    : resource.kind === 'IMAGE'
      ? [resource.alt, resource.caption ?? '', ...resource.annotations.flatMap((annotation) => [annotation.title, annotation.body ?? ''])]
      : [resource.caption ?? '', ...resource.keypoints.map((keypoint) => keypoint.title)];
  const content = parts.filter(Boolean).join('\n').slice(0, 100_000);
  const id = flowFragmentId(snapshot.snapshotId, resource.id);
  return {
    id,
    heading: resourceTitle(resource),
    content,
    searchText: buildSearchText(parts),
    locatorJson: JSON.stringify({ kind: 'WORKSPACE_FLOW', ...resource.locator, documentId, revision, fragmentId: id }),
    now,
  };
}

function resourceTitle(resource: FlowKnowledgeResourceV2 | undefined): string {
  if (!resource) return '';
  if (resource.kind === 'MARKDOWN') {
    return resource.markdown.match(/^\s{0,3}#{1,6}\s+(.+)$/mu)?.[1]?.trim() || '说明';
  }
  if (resource.kind === 'IMAGE') return resource.alt;
  return resource.caption?.trim() || resource.keypoints[0]?.title || '视频要点';
}

function oneAndTwoHopNodeIds(
  nodeId: string,
  relations: Array<Extract<FlowKnowledgeSnapshotV2['relations'][number], { kind: 'FLOW' }>>,
): string[] {
  const adjacent = (targetId: string) => relations.flatMap((relation) => {
    if (relation.sourceNodeId === targetId) return [relation.targetNodeId];
    if (relation.targetNodeId === targetId) return [relation.sourceNodeId];
    return [];
  });
  const oneHop = [...new Set(adjacent(nodeId))].filter((id) => id !== nodeId).sort();
  const oneHopSet = new Set(oneHop);
  const twoHop = [...new Set(oneHop.flatMap(adjacent))]
    .filter((id) => id !== nodeId && !oneHopSet.has(id))
    .sort();
  return [...oneHop, ...twoHop];
}

function findOrigin(database: DatabaseSync, context: GuideFlowContext) {
  if (context.origin.kind === 'DRAFT') {
    return database.prepare(
      `SELECT id, document_checksum, snapshot_json FROM flow_knowledge_snapshots
       WHERE guide_id = ? AND origin_type = 'DRAFT' AND revision = ?`,
    ).get(context.guideId, context.origin.revision) as { id: string; document_checksum: string; snapshot_json: string } | undefined;
  }
  return database.prepare(
    `SELECT id, document_checksum, snapshot_json FROM flow_knowledge_snapshots
     WHERE guide_id = ? AND origin_type = 'PUBLISHED' AND version_id = ? AND version = ?`,
  ).get(context.guideId, context.origin.versionId, context.origin.version) as { id: string; document_checksum: string; snapshot_json: string } | undefined;
}

function materializeExistingSnapshot(
  database: DatabaseSync,
  context: GuideFlowContext,
  snapshot: FlowKnowledgeSnapshotV2,
  checksum: string,
): void {
  const sourceId = flowSourceId(context.guideId);
  const documentId = randomUUID();
  const revision = flowRevision(context.origin);
  const now = new Date().toISOString();
  const fragments = flowFragments(snapshot, documentId, checksum, now);
  const metadata = {
    sourceKind: 'WORKSPACE_FLOW', aliases: [], tags: context.tags, rawEvidenceAvailable: false,
    guideId: context.guideId, guideTitle: context.title, origin: context.origin,
  };
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      `INSERT INTO knowledge_sources (
        id, scope, kind, workspace_id, conversation_id, created_by,
        status, revision, config_json, created_at, updated_at
      ) VALUES (?, 'WORKSPACE', 'WORKSPACE_FLOW', ?, NULL, ?, 'READY', ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET status = 'READY', revision = excluded.revision,
        config_json = excluded.config_json, updated_at = excluded.updated_at`,
    ).run(sourceId, context.workspaceId, context.ownerId, revision, JSON.stringify({ guideId: context.guideId }), now, now);
    database.prepare(
      `INSERT INTO knowledge_documents (
        id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
        parse_status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?)`,
    ).run(
      documentId, sourceId, snapshot.snapshotId, flowRelativeLocator(context.origin),
      context.title, checksum, revision, JSON.stringify(metadata), now, now,
    );
    const insert = database.prepare(
      `INSERT INTO knowledge_fragments (
        id, document_id, ordinal, title, heading, content, search_text,
        internal_locator_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    fragments.forEach((fragment, ordinal) => insert.run(
      fragment.id, documentId, ordinal, context.title, fragment.heading, fragment.content,
      fragment.searchText, fragment.locatorJson, now, now,
    ));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function flowSourceId(guideId: string): string {
  return `flow-source-${createHash('sha256').update(guideId).digest('hex').slice(0, 32)}`;
}

function flowFragmentId(snapshotId: string, nodeId: string): string {
  return `flow-fragment-${createHash('sha256').update(`${snapshotId}\u0000${nodeId}`).digest('hex').slice(0, 32)}`;
}

function flowOverviewFragmentId(snapshotId: string): string {
  return `flow-overview-${createHash('sha256').update(snapshotId).digest('hex').slice(0, 32)}`;
}

function flowRevision(origin: GuideFlowContext['origin']): string {
  return origin.kind === 'DRAFT' ? `draft-${origin.revision}` : `published-${origin.versionId}-${origin.version}`;
}

function flowRelativeLocator(origin: GuideFlowContext['origin']): string {
  return flowRevision(origin);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_]/gu, '_').slice(0, 80) || 'FLOW_INDEX_FAILED';
}

function safeFlowFailureReason(configJson: string): string | null {
  try {
    const parsed = JSON.parse(configJson) as { lastFailureCode?: unknown };
    return typeof parsed.lastFailureCode === 'string' && /^[A-Z0-9_]{1,80}$/u.test(parsed.lastFailureCode)
      ? parsed.lastFailureCode
      : null;
  } catch {
    return null;
  }
}

interface FlowSummaryRow {
  id: string;
  guide_id: string;
  origin_type: 'DRAFT' | 'PUBLISHED';
  revision: number | null;
  version_id: string | null;
  version: number | null;
  snapshot_json: string;
  created_at: string;
  source_id: string;
  source_status: string;
  source_config_json: string;
  document_id: string;
  guide_title: string;
  owner_id: string;
  collaborator_id: string | null;
}

interface DraftReconcileRow {
  id: string;
  owner_id: string;
  title: string;
  summary: string;
  tags_json: string;
  revision: number;
  draft_document: string;
  workspace_id: string;
  workspace_item_id: string;
}

interface PublishedReconcileRow {
  version_id: string;
  guide_id: string;
  version: number;
  title: string;
  summary: string;
  tags_json: string;
  document_json: string;
  owner_id: string;
  workspace_id: string;
  workspace_item_id: string;
}

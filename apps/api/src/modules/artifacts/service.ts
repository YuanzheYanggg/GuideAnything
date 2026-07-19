import {
  ArtifactV1Schema,
  FlowKnowledgeSnapshotSchema,
  InternalEvidenceLocatorV1Schema,
  ReferenceResolutionV1Schema,
  type ArtifactV1,
  type FlowKnowledgeSnapshotV2,
  type InternalEvidenceLocatorV1,
  type ReferenceResolutionV1,
} from '@guideanything/contracts';
import { normalizeFlowKnowledgeSnapshot } from '@guideanything/canvas-core';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import { getWorkspacePermission } from '../workspaces/repository';

interface CitationRow {
  reference_id: string;
  source_kind: string;
  internal_locator_json: string;
  title: string;
  excerpt: string;
  revision: string;
  conversation_id: string;
  conversation_scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspace_id: string | null;
  initiating_message_id: string;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  kind: string;
  title: string;
  payload_json: string;
  created_at: string;
}

type InvalidReasonCode = Extract<ReferenceResolutionV1, { status: 'INVALID' }>['reasonCode'];

export class ArtifactReferenceService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listWorkspace(ownerId: string, workspaceId: string): ArtifactV1[] {
    this.requireWorkspaceRead(ownerId, workspaceId);
    const rows = this.database.prepare(
      `SELECT artifact.id, artifact.run_id, artifact.kind, artifact.title,
              artifact.payload_json, artifact.created_at
       FROM artifacts AS artifact
       JOIN conversations AS conversation ON conversation.id = artifact.conversation_id
       WHERE artifact.owner_id = ?
         AND conversation.owner_id = artifact.owner_id
         AND conversation.scope = 'WORKSPACE'
         AND conversation.workspace_id = ?
       ORDER BY artifact.created_at DESC, artifact.id DESC`,
    ).all(ownerId, workspaceId) as unknown as ArtifactRow[];
    return rows.map((row) => {
      const artifact = ArtifactV1Schema.parse(JSON.parse(row.payload_json));
      if (
        artifact.id !== row.id
        || artifact.runId !== row.run_id
        || artifact.kind !== row.kind
        || artifact.title !== row.title
        || artifact.createdAt !== row.created_at
      ) {
        throw new Error('产物记录与已验证载荷不一致');
      }
      return artifact;
    });
  }

  resolveReference(ownerId: string, referenceId: string): ReferenceResolutionV1 {
    const row = this.database.prepare(
      `SELECT citation.reference_id, citation.source_kind, citation.internal_locator_json,
              citation.title, citation.excerpt, citation.revision,
              conversation.id AS conversation_id, conversation.scope AS conversation_scope,
              conversation.workspace_id, run.initiating_message_id
       FROM answer_citations AS citation
       JOIN agent_runs AS run ON run.id = citation.run_id
       JOIN conversations AS conversation ON conversation.id = run.conversation_id
       WHERE citation.reference_id = ? AND conversation.owner_id = ?`,
    ).get(referenceId, ownerId) as unknown as CitationRow | undefined;
    if (!row) throw httpError(404, 'REFERENCE_NOT_FOUND', '引用不存在');

    const parsed = parseLocator(row.internal_locator_json);
    if (!parsed || !sourceMatchesLocator(row.source_kind, parsed)) {
      return this.invalid(row, 'NOT_NAVIGABLE', '引用定位信息未通过结构校验。');
    }
    if (storedRevision(parsed) !== row.revision) {
      return this.invalid(row, 'STALE', '引用记录的版本信息已经不一致。');
    }

    if (parsed.kind === 'SANTEXWELL') return this.resolveSantexwell(row, parsed);
    if (parsed.kind === 'WORKSPACE_DOCUMENT') return this.resolveWorkspaceDocument(ownerId, row, parsed);
    if (parsed.kind === 'WORKSPACE_FLOW') return this.resolveWorkspaceFlow(ownerId, row, parsed);
    if (parsed.kind === 'SESSION_ATTACHMENT') return this.resolveSessionAttachment(ownerId, row, parsed);
    return this.resolvePriorConversation(ownerId, row, parsed);
  }

  private resolveSantexwell(
    citation: CitationRow,
    locator: Extract<InternalEvidenceLocatorV1, { kind: 'SANTEXWELL' }>,
  ): ReferenceResolutionV1 {
    const row = this.database.prepare(
      `SELECT document.revision, document.relative_locator, document.parse_status,
              source.status AS source_status
       FROM knowledge_documents AS document
       JOIN knowledge_sources AS source ON source.id = document.source_id
       WHERE document.id = ? AND source.scope = 'GLOBAL'
         AND source.kind = 'SANTEXWELL_VAULT'`,
    ).get(locator.documentId) as {
      revision: string;
      relative_locator: string;
      parse_status: string;
      source_status: string;
    } | undefined;
    if (!row || row.parse_status !== 'READY' || !isReadableSourceStatus(row.source_status)) {
      return this.invalid(citation, 'SOURCE_UNAVAILABLE', '对应的知识页面当前不可用。');
    }
    if (row.revision !== locator.revision || row.relative_locator !== locator.relativePath) {
      return this.invalid(citation, 'STALE', '知识页面已经更新，请重新生成答案。');
    }
    if (!this.fragmentExists(locator.documentId, locator.fragmentId)) {
      return this.invalid(citation, 'STALE', '原知识片段已经不存在。');
    }
    const query = locator.fragmentId ? `?fragment=${encodeURIComponent(locator.fragmentId)}` : '';
    return this.valid(citation, 'SANTEXWELL', 'SANTEXWELL_FRAGMENT',
      `/knowledge/santexwell/documents/${encodeURIComponent(locator.documentId)}${query}`);
  }

  private resolveWorkspaceDocument(
    ownerId: string,
    citation: CitationRow,
    locator: Extract<InternalEvidenceLocatorV1, { kind: 'WORKSPACE_DOCUMENT' }>,
  ): ReferenceResolutionV1 {
    if (
      citation.conversation_scope !== 'WORKSPACE'
      || citation.workspace_id !== locator.workspaceId
      || !getWorkspacePermission(this.database, locator.workspaceId, ownerId)
    ) {
      return this.invalid(citation, 'FORBIDDEN', '你已经没有该工作区资料的访问权限。');
    }
    const row = this.database.prepare(
      `SELECT source.id AS source_id, source.status AS source_status,
              document.revision, document.parse_status
       FROM knowledge_documents AS document
       JOIN knowledge_sources AS source ON source.id = document.source_id
       JOIN workspace_items AS item
         ON item.id = ? AND item.kind = 'SOURCE' AND item.entity_id = source.id
        AND item.workspace_id = source.workspace_id AND item.deleted_at IS NULL
       WHERE document.id = ? AND source.scope = 'WORKSPACE'
         AND source.kind = 'WORKSPACE_DOCUMENT' AND source.workspace_id = ?`,
    ).get(locator.sourceItemId, locator.documentId, locator.workspaceId) as {
      source_id: string;
      source_status: string;
      revision: string;
      parse_status: string;
    } | undefined;
    if (!row || row.parse_status !== 'READY' || !isReadableSourceStatus(row.source_status)) {
      return this.invalid(citation, 'SOURCE_UNAVAILABLE', '对应的工作区资料当前不可用。');
    }
    if (row.revision !== locator.revision || !this.fragmentExists(locator.documentId, locator.fragmentId)) {
      return this.invalid(citation, 'STALE', '工作区资料已经更新，请重新生成答案。');
    }
    const query = new URLSearchParams({ source: row.source_id, document: locator.documentId });
    if (locator.fragmentId) query.set('fragment', locator.fragmentId);
    return this.valid(citation, 'WORKSPACE_DOCUMENT', 'WORKSPACE_DOCUMENT',
      `/workspaces/${encodeURIComponent(locator.workspaceId)}/sources?${query.toString()}`);
  }

  private resolveWorkspaceFlow(
    ownerId: string,
    citation: CitationRow,
    locator: Extract<InternalEvidenceLocatorV1, { kind: 'WORKSPACE_FLOW' }>,
  ): ReferenceResolutionV1 {
    if (!citation.workspace_id || !getWorkspacePermission(this.database, citation.workspace_id, ownerId)) {
      return this.invalid(citation, 'FORBIDDEN', '你已经没有该流程所在工作区的访问权限。');
    }
    const row = this.database.prepare(
      `SELECT snapshot.origin_type, snapshot.revision, snapshot.version_id, snapshot.version,
              snapshot.snapshot_json, guide.revision AS current_revision,
              guide.status AS guide_status, guide.owner_id,
              collaborator.user_id AS collaborator_id,
              source.status AS source_status, document.parse_status
       FROM flow_knowledge_snapshots AS snapshot
       JOIN guides AS guide ON guide.id = snapshot.guide_id
       JOIN knowledge_documents AS document ON document.flow_snapshot_id = snapshot.id
       JOIN knowledge_sources AS source ON source.id = document.source_id
       LEFT JOIN guide_collaborators AS collaborator
         ON collaborator.guide_id = guide.id AND collaborator.user_id = ?
       WHERE snapshot.id = ? AND snapshot.guide_id = ? AND snapshot.workspace_id = ?`,
    ).get(ownerId, locator.snapshotId, locator.guideId, citation.workspace_id) as {
      origin_type: 'DRAFT' | 'PUBLISHED';
      revision: number | null;
      version_id: string | null;
      version: number | null;
      snapshot_json: string;
      current_revision: number;
      guide_status: string;
      owner_id: string;
      collaborator_id: string | null;
      source_status: string;
      parse_status: string;
    } | undefined;
    if (!row || row.parse_status !== 'READY' || !isReadableSourceStatus(row.source_status)) {
      return this.invalid(citation, 'SOURCE_UNAVAILABLE', '对应的流程快照当前不可用。');
    }
    let snapshot: FlowKnowledgeSnapshotV2 | null = null;
    try {
      snapshot = normalizeFlowKnowledgeSnapshot(
        FlowKnowledgeSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
      );
    } catch {
      snapshot = null;
    }
    if (!snapshot || !snapshotContainsFlowLocator(snapshot, locator)) {
      return this.invalid(citation, 'STALE', '原流程节点已经不存在。');
    }
    if (row.origin_type === 'DRAFT') {
      if (row.owner_id !== ownerId && !row.collaborator_id) {
        return this.invalid(citation, 'FORBIDDEN', '你已经没有该流程草稿的访问权限。');
      }
      if (row.guide_status === 'ARCHIVED' || row.revision !== row.current_revision) {
        return this.invalid(citation, 'STALE', '流程草稿已经更新，请重新生成答案。');
      }
      return this.valid(citation, 'WORKSPACE_FLOW', 'CURRENT_DRAFT_FLOW_NODE',
        `/guides/${encodeURIComponent(locator.guideId)}/edit?nodeId=${encodeURIComponent(locator.nodeId)}`);
    }
    if (!row.version_id || !row.version) {
      return this.invalid(citation, 'SOURCE_UNAVAILABLE', '已发布流程版本缺少定位信息。');
    }
    return this.valid(citation, 'WORKSPACE_FLOW', 'PUBLISHED_FLOW_NODE',
      `/versions/${encodeURIComponent(row.version_id)}/learn?nodeId=${encodeURIComponent(locator.nodeId)}`);
  }

  private resolveSessionAttachment(
    ownerId: string,
    citation: CitationRow,
    locator: Extract<InternalEvidenceLocatorV1, { kind: 'SESSION_ATTACHMENT' }>,
  ): ReferenceResolutionV1 {
    if (
      citation.conversation_scope !== 'WORKSPACE'
      || citation.conversation_id !== locator.conversationId
      || !citation.workspace_id
      || !getWorkspacePermission(this.database, citation.workspace_id, ownerId)
    ) {
      return this.invalid(citation, 'FORBIDDEN', '你已经没有该会话附件的访问权限。');
    }
    const row = this.database.prepare(
      `SELECT attachment.status AS attachment_status, attachment.expires_at,
              source.status AS source_status, document.revision, document.parse_status
       FROM conversation_attachments AS attachment
       JOIN knowledge_sources AS source ON source.id = attachment.source_id
       JOIN knowledge_documents AS document ON document.source_id = source.id
       WHERE attachment.id = ? AND attachment.conversation_id = ?
         AND attachment.owner_id = ? AND document.id = ?
         AND source.scope = 'SESSION' AND source.kind = 'SESSION_ATTACHMENT'`,
    ).get(locator.attachmentId, locator.conversationId, ownerId, locator.documentId) as {
      attachment_status: string;
      expires_at: string;
      source_status: string;
      revision: string;
      parse_status: string;
    } | undefined;
    if (
      !row
      || row.attachment_status !== 'READY'
      || row.expires_at <= this.now().toISOString()
      || row.source_status !== 'READY'
      || row.parse_status !== 'READY'
    ) {
      return this.invalid(citation, 'SOURCE_UNAVAILABLE', '会话附件已经过期或当前不可用。');
    }
    if (row.revision !== locator.revision || !this.fragmentExists(locator.documentId, locator.fragmentId)) {
      return this.invalid(citation, 'STALE', '会话附件内容已经变化。');
    }
    const query = new URLSearchParams({
      conversation: citation.conversation_id,
      message: citation.initiating_message_id,
    });
    return this.valid(citation, 'SESSION_ATTACHMENT', 'CONVERSATION_MESSAGE',
      `/workspaces/${encodeURIComponent(citation.workspace_id)}/agents?${query.toString()}`);
  }

  private resolvePriorConversation(
    ownerId: string,
    citation: CitationRow,
    locator: Extract<InternalEvidenceLocatorV1, { kind: 'PRIOR_CONVERSATION' }>,
  ): ReferenceResolutionV1 {
    const row = this.database.prepare(
      `SELECT conversation.scope, conversation.workspace_id
       FROM conversation_messages AS message
       JOIN conversations AS conversation ON conversation.id = message.conversation_id
       WHERE message.id = ? AND message.conversation_id = ? AND message.committed = 1
         AND conversation.owner_id = ?`,
    ).get(locator.messageId, locator.conversationId, ownerId) as {
      scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
      workspace_id: string | null;
    } | undefined;
    if (!row) return this.invalid(citation, 'SOURCE_UNAVAILABLE', '原会话消息已经不可用。');
    if (row.workspace_id && !getWorkspacePermission(this.database, row.workspace_id, ownerId)) {
      return this.invalid(citation, 'FORBIDDEN', '你已经没有原会话所在工作区的访问权限。');
    }
    const query = new URLSearchParams({ conversation: locator.conversationId, message: locator.messageId });
    const href = row.scope === 'GLOBAL_SANTEXWELL'
      ? `/knowledge/santexwell?${query.toString()}`
      : `/workspaces/${encodeURIComponent(row.workspace_id!)}/agents?${query.toString()}`;
    return this.valid(citation, 'PRIOR_CONVERSATION', 'CONVERSATION_MESSAGE', href);
  }

  private fragmentExists(documentId: string, fragmentId?: string): boolean {
    if (!fragmentId) return true;
    return Boolean(this.database.prepare(
      'SELECT 1 FROM knowledge_fragments WHERE id = ? AND document_id = ?',
    ).get(fragmentId, documentId));
  }

  private valid(
    citation: CitationRow,
    source: 'WORKSPACE_FLOW' | 'WORKSPACE_DOCUMENT' | 'SESSION_ATTACHMENT' | 'SANTEXWELL' | 'PRIOR_CONVERSATION',
    kind: 'PUBLISHED_FLOW_NODE' | 'CURRENT_DRAFT_FLOW_NODE' | 'SANTEXWELL_FRAGMENT' | 'WORKSPACE_DOCUMENT' | 'CONVERSATION_MESSAGE',
    href: string,
  ): ReferenceResolutionV1 {
    return ReferenceResolutionV1Schema.parse({
      status: 'VALID', referenceId: citation.reference_id, source,
      title: citation.title, excerpt: citation.excerpt, target: { kind, href },
    });
  }

  private invalid(
    citation: CitationRow,
    reasonCode: InvalidReasonCode,
    invalidReason: string,
  ): ReferenceResolutionV1 {
    const forbidden = reasonCode === 'FORBIDDEN';
    return ReferenceResolutionV1Schema.parse({
      status: 'INVALID', referenceId: citation.reference_id,
      title: forbidden ? '引用不可用' : citation.title,
      excerpt: forbidden ? '当前用户无权查看该引用内容。' : citation.excerpt,
      reasonCode,
      invalidReason,
    });
  }

  private requireWorkspaceRead(userId: string, workspaceId: string): void {
    if (!getWorkspacePermission(this.database, workspaceId, userId)) {
      throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    }
  }
}

function parseLocator(value: string): InternalEvidenceLocatorV1 | null {
  try {
    const parsed = InternalEvidenceLocatorV1Schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sourceMatchesLocator(source: string, locator: InternalEvidenceLocatorV1): boolean {
  return source === locator.kind;
}

function storedRevision(locator: InternalEvidenceLocatorV1): string {
  if (locator.kind === 'WORKSPACE_FLOW') return locator.snapshotId;
  if (locator.kind === 'PRIOR_CONVERSATION') return locator.messageId;
  return locator.revision;
}

function isReadableSourceStatus(value: string): boolean {
  return value === 'READY' || value === 'STALE';
}

function snapshotContainsFlowLocator(
  snapshot: FlowKnowledgeSnapshotV2,
  locator: Extract<InternalEvidenceLocatorV1, { kind: 'WORKSPACE_FLOW' }>,
): boolean {
  const candidates = [
    ...snapshot.nodes.map((node) => node.locator),
    ...snapshot.resources.map((resource) => resource.locator),
  ];
  return candidates.some((candidate) => (
    candidate.guideId === locator.guideId
    && candidate.snapshotId === locator.snapshotId
    && candidate.nodeId === locator.nodeId
  ));
}

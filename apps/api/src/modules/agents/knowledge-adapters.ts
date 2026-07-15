import {
  FlowKnowledgeSnapshotV1Schema,
  InternalEvidenceLocatorV1Schema,
  InternalFlowFeedbackV1Schema,
  PublicReferenceV1Schema,
  RouteDecisionV1Schema,
  SelectedAgentContextV1Schema,
  SourceOptionsV1Schema,
  ValidatedEvidenceV1Schema,
  type EvidenceSourceV1,
  type FlowKnowledgeSnapshotV1,
  type InternalEvidenceLocatorV1,
  type RouteDecisionV1,
  type SourceOptionsV1,
  type ValidatedEvidenceV1,
} from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  SANTEXWELL_SOURCE_ID,
  searchKnowledgeInternal,
  type KnowledgeSearchScope,
} from '../knowledge/repository';
import { sanitizeVaultControlledText } from '../knowledge/vault-text';
import type { AgentKnowledgeAdapters } from './assembly';
import type {
  AgentRetrievalRequest,
  AgentRetrievalTask,
  AgentRunExecutionContext,
  ResolvedAgentReference,
} from './orchestrator';

const PUBLIC_EXCERPT_LENGTH = 600;
const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'ROUTING', 'RUNNING', 'VALIDATING']);
const READABLE_SOURCE_STATUSES = new Set(['READY', 'STALE']);

export interface DatabaseAgentKnowledgeAdapterOptions {
  database: DatabaseSync;
  now?: () => Date;
  createReferenceId?: () => string;
}

/**
 * Adapts the canonical knowledge index to the Agent runtime. The adapter never
 * exposes storage keys or filesystem locations: every locator is reconstructed
 * from current relational ownership plus the strict contracts schema.
 */
export function createDatabaseAgentKnowledgeAdapters(
  options: DatabaseAgentKnowledgeAdapterOptions,
): AgentKnowledgeAdapters {
  const now = options.now ?? (() => new Date());
  const createReferenceId = options.createReferenceId ?? randomUUID;

  const retriever: AgentKnowledgeAdapters['retriever'] = {
    async retrieve(request) {
      abortIfNeeded(request.signal);
      assertRetrievalRequest(options.database, request, now());
      if (request.maxCandidates === 0) return [];

      const evidence: ValidatedEvidenceV1[] = [];
      const seen = new Set<string>();
      const appendRecord = (record: EvidenceRecord, locator: Record<string, unknown>): boolean => {
        if (evidence.length >= request.maxCandidates || seen.has(record.fragment_id)) return false;
        if (recordSourceKind(record) !== request.task.kind) return false;
        if (
          request.task.kind === 'SESSION_ATTACHMENT'
          && (!record.attachment_id || !request.context.attachmentIds.includes(record.attachment_id))
        ) return false;
        const canonical = canonicalEvidence(options.database, request.context, record, locator, now());
        seen.add(canonical.id);
        evidence.push(canonical);
        return true;
      };

      for (const record of selectedRecords(options.database, request, request.maxCandidates)) {
        appendRecord(record, record.locator);
        if (request.task.kind === 'WORKSPACE_FLOW') {
          expandFlowEvidence(options.database, request, evidence, seen, appendRecord);
        }
        if (evidence.length >= request.maxCandidates) break;
      }

      abortIfNeeded(request.signal);
      if (evidence.length < request.maxCandidates) {
        const hits = searchKnowledgeInternal(
          options.database,
          retrievalQuery(request),
          searchScope(request, request.maxCandidates - evidence.length),
        );
        for (const internalHit of hits) {
          abortIfNeeded(request.signal);
          const record = loadEvidenceRecord(options.database, internalHit.hit.fragmentId);
          if (!record || record.document_id !== internalHit.hit.documentId) {
            throw new Error('知识搜索结果与当前索引记录不一致');
          }
          appendRecord(record, internalHit.locator);
          if (request.task.kind === 'WORKSPACE_FLOW') {
            expandFlowEvidence(options.database, request, evidence, seen, appendRecord);
          }
          if (evidence.length >= request.maxCandidates) break;
        }
      }
      abortIfNeeded(request.signal);
      return evidence;
    },

    async isWorkspaceEvidenceSufficient(request) {
      abortIfNeeded(request.signal);
      const decision = RouteDecisionV1Schema.parse(request.decision);
      requireFreshContext(options.database, request.context, now());
      assertDecisionSources(decision.sources, request.context.sources);
      const canonicalSources = new Set<EvidenceSourceV1>();
      for (const untrusted of request.evidence) {
        abortIfNeeded(request.signal);
        const evidence = ValidatedEvidenceV1Schema.parse(untrusted);
        if (evidence.source === 'SANTEXWELL' || evidence.source === 'PRIOR_CONVERSATION') continue;
        try {
          const record = loadEvidenceRecord(options.database, evidence.id);
          if (!record) continue;
          const canonical = canonicalEvidence(
            options.database,
            request.context,
            record,
            record.locator,
            now(),
          );
          if (sameEvidence(canonical, evidence)) canonicalSources.add(canonical.source);
        } catch {
          // Stale evidence must never suppress Vault retrieval.
        }
      }
      if (decision.route === 'DIRECT' || decision.route === 'FOCUSED') {
        return canonicalSources.size > 0;
      }

      const required = requiredWorkspaceSources(decision);
      return required.size > 0 && [...required].every((source) => canonicalSources.has(source));
    },
  };

  const evidenceResolver: AgentKnowledgeAdapters['evidenceResolver'] = {
    async resolveEvidence(context, untrustedEvidence, signal) {
      if (signal) abortIfNeeded(signal);
      requireFreshContext(options.database, context, now());
      const evidence = ValidatedEvidenceV1Schema.parse(untrustedEvidence);
      const record = loadEvidenceRecord(options.database, evidence.id);
      if (!record) throw new Error('引用证据已经失效');
      const canonical = canonicalEvidence(options.database, context, record, record.locator, now());
      if (!sameEvidence(canonical, evidence)) throw new Error('引用证据的版本或 locator 已经变化');
      if (signal) abortIfNeeded(signal);
      return resolvedReference(canonical, createReferenceId());
    },

    async resolveFlowFeedback(context, untrustedFeedback, untrustedEvidence, signal) {
      const feedback = InternalFlowFeedbackV1Schema.parse(untrustedFeedback);
      const evidence = ValidatedEvidenceV1Schema.parse(untrustedEvidence);
      if (evidence.locator.kind !== 'WORKSPACE_FLOW') {
        throw new Error('流程反馈必须绑定工作区流程证据');
      }
      const { kind: _kind, ...evidenceLocator } = evidence.locator;
      if (JSON.stringify(feedback.locator) !== JSON.stringify(evidenceLocator)) {
        throw new Error('流程反馈 locator 与已验证节点不匹配');
      }
      return evidenceResolver.resolveEvidence(context, evidence, signal);
    },
  };

  return { retriever, evidenceResolver };
}

function assertRetrievalRequest(
  database: DatabaseSync,
  request: AgentRetrievalRequest,
  now: Date,
): void {
  const decision = RouteDecisionV1Schema.parse(request.decision);
  requireFreshContext(database, request.context, now);
  assertDecisionSources(decision.sources, request.context.sources);
  abortIfNeeded(request.signal);
  if (!Number.isInteger(request.maxCandidates) || request.maxCandidates < 0) {
    throw new Error('检索候选预算无效');
  }
  const budget = request.task.kind === 'SANTEXWELL'
    ? decision.budget.maxVaultDigests
    : decision.budget.maxWorkspaceCandidates;
  if (request.maxCandidates > budget) throw new Error('检索候选数量超过路线预算');
  if (
    !Number.isInteger(request.maxFlowHops)
    || request.maxFlowHops < 0
    || request.maxFlowHops > decision.budget.maxFlowHops
    || (request.task.kind !== 'WORKSPACE_FLOW' && request.maxFlowHops !== 0)
  ) {
    throw new Error('流程跳数超过路线预算');
  }
  if (request.allowRaw && (request.task.kind !== 'SANTEXWELL' || !decision.budget.allowRaw)) {
    throw new Error('本路线未授权原始资料读取');
  }
  const scheduled = decision.tasks.find((task) => task.id === request.task.id);
  if (!scheduled || scheduled.kind === 'REDUCE' || JSON.stringify(scheduled) !== JSON.stringify(request.task)) {
    throw new Error('检索任务不属于当前路线');
  }
  const option = sourceOptionFor(request.task.kind);
  if (!request.context.sources[option] || !decision.sources[option]) {
    throw new Error('检索任务使用了本轮未启用或未授权的来源');
  }
  if (
    request.context.scope === 'GLOBAL_SANTEXWELL'
    && request.task.kind !== 'SANTEXWELL'
  ) throw new Error('全局会话只能检索 Santexwell');
  if (
    (request.task.kind === 'WORKSPACE_FLOW' || request.task.kind === 'WORKSPACE_DOCUMENT')
    && !request.context.workspaceId
  ) throw new Error('工作区检索缺少 workspaceId');
}

function selectedRecords(
  database: DatabaseSync,
  request: AgentRetrievalRequest,
  limit: number,
): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  const selected = request.context.selectedContext
    ? SelectedAgentContextV1Schema.parse(request.context.selectedContext)
    : undefined;
  if (selected?.kind === 'FLOW_NODE' && request.task.kind === 'WORKSPACE_FLOW') {
    const record = loadSelectedFlowRecord(database, selected.snapshotId, selected.nodeId);
    if (!record) throw new Error('选中的流程节点已经失效');
    records.push(record);
  } else if (selected?.kind === 'FLOW_SNAPSHOT' && request.task.kind === 'WORKSPACE_FLOW') {
    const record = loadFirstSnapshotRecord(database, selected.snapshotId);
    if (!record) throw new Error('选中的流程快照已经失效');
    records.push(record);
  } else if (selected?.kind === 'WORKSPACE_SOURCE' && request.task.kind === 'WORKSPACE_DOCUMENT') {
    const record = loadFirstSourceRecord(database, selected.sourceId);
    if (!record) throw new Error('选中的工作区资料已经失效');
    records.push(record);
  } else if (selected?.kind === 'KNOWLEDGE_FRAGMENT') {
    const record = selected.fragmentId
      ? loadEvidenceRecord(database, selected.fragmentId)
      : loadFirstDocumentRecord(database, selected.documentId);
    if (!record || record.document_id !== selected.documentId) {
      throw new Error('选中的知识片段已经失效');
    }
    if (recordSourceKind(record) === request.task.kind) records.push(record);
  }

  if (request.task.kind === 'SESSION_ATTACHMENT') {
    for (const attachmentId of request.context.attachmentIds) {
      if (records.length >= limit) break;
      const record = loadFirstAttachmentRecord(database, attachmentId, request.context.conversationId);
      if (!record) throw new Error('本轮选中的会话附件已经失效');
      records.push(record);
    }
  }
  return uniqueRecords(records);
}

function searchScope(request: AgentRetrievalRequest, limit: number): KnowledgeSearchScope {
  const sourceKinds: KnowledgeSearchScope['sourceKinds'] = [request.task.kind];
  if (request.task.kind === 'WORKSPACE_FLOW' || request.task.kind === 'WORKSPACE_DOCUMENT') {
    return {
      sourceKinds,
      workspaceId: request.context.workspaceId!,
      userId: request.context.ownerId,
      limit,
    };
  }
  if (request.task.kind === 'SESSION_ATTACHMENT') {
    return {
      sourceKinds,
      conversationId: request.context.conversationId,
      userId: request.context.ownerId,
      limit,
    };
  }
  return { sourceKinds, limit };
}

function retrievalQuery(request: AgentRetrievalRequest): string {
  // Preserve the user's discriminating terms before the bounded search-token
  // compiler sees generic task wording such as "检索工作区流程".
  return [request.context.text, request.context.steeringInstruction, request.task.objective]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n')
    .slice(0, 20_000);
}

function expandFlowEvidence(
  database: DatabaseSync,
  request: AgentRetrievalRequest,
  evidence: ValidatedEvidenceV1[],
  seen: Set<string>,
  appendRecord: (record: EvidenceRecord, locator: Record<string, unknown>) => boolean,
): void {
  if (request.maxFlowHops === 0 || evidence.length >= request.maxCandidates) return;
  const seeds = evidence.filter((item) => item.locator.kind === 'WORKSPACE_FLOW');
  for (const seed of seeds) {
    if (seed.locator.kind !== 'WORKSPACE_FLOW') continue;
    const locator = seed.locator;
    const row = database.prepare(
      `SELECT snapshot_json FROM flow_knowledge_snapshots WHERE id = ? AND guide_id = ?`,
    ).get(locator.snapshotId, locator.guideId) as { snapshot_json: string } | undefined;
    if (!row) throw new Error('流程快照已经失效');
    const snapshot = FlowKnowledgeSnapshotV1Schema.parse(JSON.parse(row.snapshot_json));
    const node = snapshot.nodes.find((item) => item.id === locator.nodeId);
    if (!node) continue;
    const neighborIds = request.maxFlowHops === 1
      ? node.neighborhood.oneHopNodeIds
      : [...node.neighborhood.oneHopNodeIds, ...node.neighborhood.twoHopNodeIds];
    for (const nodeId of neighborIds) {
      if (evidence.length >= request.maxCandidates) return;
      const record = loadSelectedFlowRecord(database, snapshot.snapshotId, nodeId);
      if (!record || seen.has(record.fragment_id)) continue;
      appendRecord(record, record.locator);
    }
  }
}

function canonicalEvidence(
  database: DatabaseSync,
  context: AgentRunExecutionContext,
  record: EvidenceRecord,
  untrustedLocator: Record<string, unknown>,
  now: Date,
): ValidatedEvidenceV1 {
  requireFreshContext(database, context, now);
  if (record.parse_status !== 'READY') throw new Error('知识文档当前不可用');
  const source = recordSourceKind(record);
  if (!sourceEnabled(context.sources, source)) throw new Error('证据来源未在本轮启用');
  const title = safePublicText(record.document_title, 500);
  const excerpt = safePublicText(record.content, PUBLIC_EXCERPT_LENGTH).replace(/\s+/gu, ' ').trim();
  if (!title || !excerpt) throw new Error('知识证据没有可安全公开的文本');

  let locator: InternalEvidenceLocatorV1;
  if (source === 'SANTEXWELL') {
    requireSourceStatus(record, READABLE_SOURCE_STATUSES);
    if (record.source_scope !== 'GLOBAL' || record.source_kind !== 'SANTEXWELL_VAULT') {
      throw new Error('Santexwell 证据作用域无效');
    }
    if (record.source_id !== SANTEXWELL_SOURCE_ID) throw new Error('Santexwell 证据来源无效');
    const authoritative = {
      kind: 'SANTEXWELL' as const,
      documentId: record.document_id,
      fragmentId: record.fragment_id,
      relativePath: record.relative_locator,
      revision: record.document_revision,
      ...(safePublicText(record.heading ?? '', 500) ? {
        heading: safePublicText(record.heading ?? '', 500),
      } : {}),
    };
    assertLocatorFields(untrustedLocator, authoritative, [
      'kind', 'documentId', 'fragmentId', 'relativePath', 'revision',
    ]);
    locator = InternalEvidenceLocatorV1Schema.parse(authoritative);
  } else if (source === 'WORKSPACE_DOCUMENT') {
    requireSourceStatus(record, READABLE_SOURCE_STATUSES);
    if (
      record.source_scope !== 'WORKSPACE'
      || record.source_kind !== 'WORKSPACE_DOCUMENT'
      || record.source_workspace_id !== context.workspaceId
      || !record.source_item_id
      || record.source_revision !== record.document_revision
    ) throw new Error('工作区资料的当前归属或版本无效');
    const authoritative = {
      kind: 'WORKSPACE_DOCUMENT' as const,
      workspaceId: record.source_workspace_id,
      sourceItemId: record.source_item_id,
      documentId: record.document_id,
      revision: record.document_revision,
      fragmentId: record.fragment_id,
    };
    assertLocatorFields(untrustedLocator, authoritative, Object.keys(authoritative));
    locator = InternalEvidenceLocatorV1Schema.parse(authoritative);
  } else if (source === 'SESSION_ATTACHMENT') {
    requireSourceStatus(record, new Set(['READY']));
    if (
      record.source_scope !== 'SESSION'
      || record.source_kind !== 'SESSION_ATTACHMENT'
      || record.source_conversation_id !== context.conversationId
      || record.source_created_by !== context.ownerId
      || record.source_revision !== record.document_revision
      || !record.attachment_id
      || record.attachment_conversation_id !== context.conversationId
      || record.attachment_owner_id !== context.ownerId
      || record.attachment_status !== 'READY'
      || !record.attachment_expires_at
      || !isFutureTimestamp(record.attachment_expires_at, now)
      || !context.attachmentIds.includes(record.attachment_id)
    ) throw new Error('会话附件已经失效、过期或不属于当前会话');
    const authoritative = {
      kind: 'SESSION_ATTACHMENT' as const,
      conversationId: context.conversationId,
      attachmentId: record.attachment_id,
      documentId: record.document_id,
      revision: record.document_revision,
      fragmentId: record.fragment_id,
    };
    assertLocatorFields(untrustedLocator, authoritative, Object.keys(authoritative));
    locator = InternalEvidenceLocatorV1Schema.parse(authoritative);
  } else {
    requireSourceStatus(record, READABLE_SOURCE_STATUSES);
    locator = authoritativeFlowLocator(database, context, record, untrustedLocator);
  }

  return ValidatedEvidenceV1Schema.parse({
    id: record.fragment_id,
    source,
    title,
    excerpt,
    locator,
  });
}

function authoritativeFlowLocator(
  database: DatabaseSync,
  context: AgentRunExecutionContext,
  record: EvidenceRecord,
  untrustedLocator: Record<string, unknown>,
): InternalEvidenceLocatorV1 {
  if (
    record.source_scope !== 'WORKSPACE'
    || record.source_kind !== 'WORKSPACE_FLOW'
    || record.source_workspace_id !== context.workspaceId
    || !record.flow_snapshot_id
  ) throw new Error('流程证据不属于当前工作区');
  if (untrustedLocator.kind !== 'WORKSPACE_FLOW') throw new Error('流程 locator 类型冲突');
  const guideId = stringField(untrustedLocator, 'guideId');
  const snapshotId = stringField(untrustedLocator, 'snapshotId');
  const nodeId = stringField(untrustedLocator, 'nodeId');
  if (snapshotId !== record.flow_snapshot_id) throw new Error('流程 locator 与快照冲突');

  const row = database.prepare(
    `SELECT snapshot.guide_id, snapshot.workspace_id, snapshot.origin_type,
            snapshot.revision, snapshot.version_id, snapshot.version,
            snapshot.document_checksum, snapshot.snapshot_json,
            guide.owner_id, guide.status AS guide_status, guide.revision AS guide_revision,
            item.deleted_at AS item_deleted_at,
            collaborator.user_id AS collaborator_id
     FROM flow_knowledge_snapshots AS snapshot
     JOIN guides AS guide ON guide.id = snapshot.guide_id
     JOIN workspace_items AS item
       ON item.kind = 'GUIDE' AND item.entity_id = guide.id AND item.workspace_id = snapshot.workspace_id
     LEFT JOIN guide_collaborators AS collaborator
       ON collaborator.guide_id = guide.id AND collaborator.user_id = ?
     WHERE snapshot.id = ?`,
  ).get(context.ownerId, snapshotId) as unknown as FlowAuthorizationRow | undefined;
  if (
    !row
    || row.guide_id !== guideId
    || row.workspace_id !== context.workspaceId
    || row.item_deleted_at !== null
    || row.guide_status === 'ARCHIVED'
  ) throw new Error('流程指南已经失效或不再属于当前工作区');
  const expectedRevision = row.origin_type === 'DRAFT'
    ? `draft-${row.revision}`
    : `published-${row.version_id}-${row.version}`;
  if (
    record.document_revision !== expectedRevision
    || record.relative_locator !== expectedRevision
    || record.document_checksum !== row.document_checksum
  ) throw new Error('流程索引 revision 与当前快照版本不匹配');
  if (row.origin_type === 'DRAFT') {
    if (
      row.revision === null
      || row.guide_revision !== row.revision
      || (row.owner_id !== context.ownerId && row.collaborator_id !== context.ownerId)
    ) throw new Error('流程草稿 revision 已经变化或用户无权读取');
  } else {
    const published = database.prepare(
      `SELECT 1 FROM guide_versions WHERE id = ? AND guide_id = ? AND version = ?`,
    ).get(row.version_id, row.guide_id, row.version);
    if (!published) throw new Error('已发布流程版本已经失效');
  }
  const snapshot = FlowKnowledgeSnapshotV1Schema.parse(JSON.parse(row.snapshot_json));
  const locator = findFlowLocator(snapshot, nodeId);
  if (!locator || locator.guideId !== guideId || locator.snapshotId !== snapshotId) {
    throw new Error('流程节点 locator 不存在或已经变化');
  }
  const authoritative = { kind: 'WORKSPACE_FLOW' as const, ...locator };
  assertLocatorFields(untrustedLocator, authoritative, ['kind', 'guideId', 'snapshotId', 'nodeId']);
  return InternalEvidenceLocatorV1Schema.parse(authoritative);
}

function findFlowLocator(
  snapshot: FlowKnowledgeSnapshotV1,
  nodeId: string,
): { guideId: string; snapshotId: string; nodeId: string } | null {
  const node = snapshot.nodes.find((item) => item.id === nodeId);
  if (node) return node.locator;
  for (const attachment of [
    ...snapshot.nodes.flatMap((item) => item.attachments),
    ...snapshot.unattachedResources,
  ]) {
    if (attachment.nodeId === nodeId) return attachment.locator;
  }
  return null;
}

function requireFreshContext(
  database: DatabaseSync,
  context: AgentRunExecutionContext,
  now: Date,
): void {
  SourceOptionsV1Schema.parse(context.sources);
  if (context.selectedContext) SelectedAgentContextV1Schema.parse(context.selectedContext);
  const row = database.prepare(
    `SELECT run.conversation_id, run.plan_version, run.status AS run_status,
            run.source_options_json AS run_sources_json,
            message.source_options_json AS message_sources_json,
            message.selected_context_json, message.attachment_ids_json,
            conversation.owner_id, conversation.scope, conversation.workspace_id,
            conversation.status AS conversation_status
     FROM agent_runs AS run
     JOIN conversations AS conversation ON conversation.id = run.conversation_id
     JOIN conversation_messages AS message
       ON message.id = run.initiating_message_id
      AND message.conversation_id = run.conversation_id
      AND message.role = 'USER' AND message.committed = 1
     WHERE run.id = ?`,
  ).get(context.runId) as unknown as FreshContextRow | undefined;
  if (
    !row
    || row.conversation_id !== context.conversationId
    || row.plan_version !== context.planVersion
    || row.owner_id !== context.ownerId
    || row.scope !== context.scope
    || row.workspace_id !== context.workspaceId
    || row.conversation_status !== 'ACTIVE'
    || !ACTIVE_RUN_STATUSES.has(row.run_status)
  ) throw new Error('Agent 运行或会话上下文已经失效');
  const runSources = SourceOptionsV1Schema.parse(JSON.parse(row.run_sources_json));
  const messageSources = SourceOptionsV1Schema.parse(JSON.parse(row.message_sources_json));
  if (
    JSON.stringify(runSources) !== JSON.stringify(context.sources)
    || JSON.stringify(messageSources) !== JSON.stringify(context.sources)
  ) {
    throw new Error('Agent 运行来源上下文已经变化');
  }
  const persistedAttachmentIds = parseAttachmentIds(row.attachment_ids_json);
  if (JSON.stringify(persistedAttachmentIds) !== JSON.stringify(context.attachmentIds)) {
    throw new Error('发起消息的附件上下文已经变化');
  }
  const persistedSelected = row.selected_context_json
    ? SelectedAgentContextV1Schema.parse(JSON.parse(row.selected_context_json))
    : null;
  if (JSON.stringify(persistedSelected) !== JSON.stringify(context.selectedContext ?? null)) {
    throw new Error('发起消息的选中上下文已经变化');
  }
  if (context.scope === 'GLOBAL_SANTEXWELL') {
    if (
      context.workspaceId !== null
      || context.sources.workspaceFlows
      || context.sources.workspaceDocuments
      || context.sources.sessionAttachments
      || !context.sources.santexwell
      || context.attachmentIds.length > 0
    ) throw new Error('全局 Santexwell 上下文越权');
  } else {
    if (!context.workspaceId) throw new Error('工作区上下文缺少 workspaceId');
    const membership = database.prepare(
      `SELECT 1 FROM workspaces AS workspace
       JOIN workspace_members AS member ON member.workspace_id = workspace.id
       WHERE workspace.id = ? AND workspace.status = 'ACTIVE' AND member.user_id = ?`,
    ).get(context.workspaceId, context.ownerId);
    if (!membership) throw new Error('用户已经失去工作区访问权限');
  }
  if (new Set(context.attachmentIds).size !== context.attachmentIds.length) {
    throw new Error('运行附件 ID 不能重复');
  }
  if (context.attachmentIds.length > 0) {
    if (!context.sources.sessionAttachments) throw new Error('本轮未启用会话附件');
    for (const attachmentId of context.attachmentIds) {
      const attachment = database.prepare(
        `SELECT status, expires_at FROM conversation_attachments
         WHERE id = ? AND conversation_id = ? AND owner_id = ?`,
      ).get(attachmentId, context.conversationId, context.ownerId) as {
        status: string;
        expires_at: string;
      } | undefined;
      if (!attachment || attachment.status !== 'READY' || !isFutureTimestamp(attachment.expires_at, now)) {
        throw new Error('一个或多个会话附件已经失效或过期');
      }
    }
  }
}

function loadEvidenceRecord(database: DatabaseSync, fragmentId: string): EvidenceRecord | null {
  const row = database.prepare(
    `SELECT fragment.id AS fragment_id, fragment.heading, fragment.content,
            fragment.internal_locator_json,
            document.id AS document_id, document.source_id, document.flow_snapshot_id,
            document.relative_locator, document.title AS document_title,
            document.checksum AS document_checksum,
            document.revision AS document_revision, document.parse_status,
            source.scope AS source_scope, source.kind AS source_kind,
            source.workspace_id AS source_workspace_id,
            source.conversation_id AS source_conversation_id,
            source.created_by AS source_created_by, source.status AS source_status,
            source.revision AS source_revision,
            item.id AS source_item_id,
            attachment.id AS attachment_id,
            attachment.conversation_id AS attachment_conversation_id,
            attachment.owner_id AS attachment_owner_id,
            attachment.status AS attachment_status,
            attachment.expires_at AS attachment_expires_at
     FROM knowledge_fragments AS fragment
     JOIN knowledge_documents AS document ON document.id = fragment.document_id
     JOIN knowledge_sources AS source ON source.id = document.source_id
     LEFT JOIN workspace_items AS item
       ON item.kind = 'SOURCE' AND item.entity_id = source.id AND item.deleted_at IS NULL
     LEFT JOIN conversation_attachments AS attachment ON attachment.source_id = source.id
     WHERE fragment.id = ?`,
  ).get(fragmentId) as unknown as EvidenceDatabaseRow | undefined;
  if (!row) return null;
  return { ...row, locator: parseLocator(row.internal_locator_json) };
}

function loadSelectedFlowRecord(
  database: DatabaseSync,
  snapshotId: string,
  nodeId: string,
): EvidenceRecord | null {
  const row = database.prepare(
    `SELECT fragment.id
     FROM knowledge_fragments AS fragment
     JOIN knowledge_documents AS document ON document.id = fragment.document_id
     WHERE document.flow_snapshot_id = ?
       AND json_extract(fragment.internal_locator_json, '$.nodeId') = ?
     ORDER BY fragment.ordinal LIMIT 1`,
  ).get(snapshotId, nodeId) as { id: string } | undefined;
  return row ? loadEvidenceRecord(database, row.id) : null;
}

function loadFirstSnapshotRecord(database: DatabaseSync, snapshotId: string): EvidenceRecord | null {
  return loadFirstMatchingRecord(
    database,
    `SELECT fragment.id FROM knowledge_fragments AS fragment
     JOIN knowledge_documents AS document ON document.id = fragment.document_id
     WHERE document.flow_snapshot_id = ? ORDER BY fragment.ordinal LIMIT 1`,
    snapshotId,
  );
}

function loadFirstSourceRecord(database: DatabaseSync, sourceId: string): EvidenceRecord | null {
  return loadFirstMatchingRecord(
    database,
    `SELECT fragment.id FROM knowledge_fragments AS fragment
     JOIN knowledge_documents AS document ON document.id = fragment.document_id
     WHERE document.source_id = ? ORDER BY document.updated_at DESC, fragment.ordinal LIMIT 1`,
    sourceId,
  );
}

function loadFirstDocumentRecord(database: DatabaseSync, documentId: string): EvidenceRecord | null {
  return loadFirstMatchingRecord(
    database,
    'SELECT id FROM knowledge_fragments WHERE document_id = ? ORDER BY ordinal LIMIT 1',
    documentId,
  );
}

function loadFirstAttachmentRecord(
  database: DatabaseSync,
  attachmentId: string,
  conversationId: string,
): EvidenceRecord | null {
  return loadFirstMatchingRecord(
    database,
    `SELECT fragment.id FROM conversation_attachments AS attachment
     JOIN knowledge_documents AS document ON document.source_id = attachment.source_id
     JOIN knowledge_fragments AS fragment ON fragment.document_id = document.id
     WHERE attachment.id = ? AND attachment.conversation_id = ?
     ORDER BY fragment.ordinal LIMIT 1`,
    attachmentId,
    conversationId,
  );
}

function loadFirstMatchingRecord(
  database: DatabaseSync,
  sql: string,
  ...parameters: Array<string | number | null>
): EvidenceRecord | null {
  const row = database.prepare(sql).get(...parameters) as { id: string } | undefined;
  return row ? loadEvidenceRecord(database, row.id) : null;
}

function recordSourceKind(record: EvidenceRecord): AgentRetrievalTask['kind'] {
  return ({
    SANTEXWELL_VAULT: 'SANTEXWELL',
    WORKSPACE_DOCUMENT: 'WORKSPACE_DOCUMENT',
    WORKSPACE_FLOW: 'WORKSPACE_FLOW',
    SESSION_ATTACHMENT: 'SESSION_ATTACHMENT',
  } as const)[record.source_kind];
}

function requiredWorkspaceSources(decision: RouteDecisionV1): Set<EvidenceSourceV1> {
  const required = new Set<EvidenceSourceV1>();
  const enabled: Array<[keyof SourceOptionsV1, EvidenceSourceV1]> = [
    ['workspaceFlows', 'WORKSPACE_FLOW'],
    ['workspaceDocuments', 'WORKSPACE_DOCUMENT'],
    ['sessionAttachments', 'SESSION_ATTACHMENT'],
  ];
  for (const [option, source] of enabled) if (decision.sources[option]) required.add(source);
  for (const task of decision.tasks) {
    if (task.kind !== 'SANTEXWELL' && task.kind !== 'REDUCE') required.add(task.kind);
  }
  return required;
}

function assertDecisionSources(decision: SourceOptionsV1, immutable: SourceOptionsV1): void {
  const keys = Object.keys(immutable) as Array<keyof SourceOptionsV1>;
  const broadened = keys.find((key) => decision[key] && !immutable[key]);
  if (broadened) throw new Error(`路线扩大了未授权来源：${broadened}`);
  const requiredWorkspace = (['workspaceFlows', 'workspaceDocuments', 'sessionAttachments'] as const)
    .find((key) => immutable[key] && !decision[key]);
  if (requiredWorkspace) throw new Error(`路线关闭了本轮工作区来源：${requiredWorkspace}`);
}

function sourceOptionFor(kind: AgentRetrievalTask['kind']): keyof SourceOptionsV1 {
  return ({
    WORKSPACE_FLOW: 'workspaceFlows',
    WORKSPACE_DOCUMENT: 'workspaceDocuments',
    SESSION_ATTACHMENT: 'sessionAttachments',
    SANTEXWELL: 'santexwell',
  } as const)[kind];
}

function sourceEnabled(sources: SourceOptionsV1, source: EvidenceSourceV1): boolean {
  if (source === 'PRIOR_CONVERSATION') return false;
  return sources[sourceOptionFor(source)];
}

function requireSourceStatus(record: EvidenceRecord, allowed: ReadonlySet<string>): void {
  if (!allowed.has(record.source_status)) throw new Error('知识来源当前不可用');
}

function assertLocatorFields(
  untrusted: Record<string, unknown>,
  authoritative: Record<string, unknown>,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(untrusted, field) && untrusted[field] !== authoritative[field]) {
      throw new Error(`内部 locator 字段冲突：${field}`);
    }
  }
}

function stringField(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string' || !result) throw new Error(`流程 locator 缺少 ${field}`);
  return result;
}

function safePublicText(value: string, length: number): string {
  return sanitizeVaultControlledText(value).slice(0, length).trim();
}

function parseLocator(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('知识片段内部 locator 无效');
  }
}

function resolvedReference(evidence: ValidatedEvidenceV1, untrustedId: string): ResolvedAgentReference {
  const referenceId = untrustedId.trim();
  const reference = PublicReferenceV1Schema.parse({
    referenceId,
    href: `/references/${encodeURIComponent(referenceId)}`,
  });
  return { reference, evidence };
}

function sameEvidence(left: ValidatedEvidenceV1, right: ValidatedEvidenceV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Agent 检索已取消');
}

function parseAttachmentIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed)
    || parsed.length > 20
    || parsed.some((item) => typeof item !== 'string' || !item)
    || new Set(parsed).size !== parsed.length
  ) throw new Error('发起消息的附件上下文无效');
  return parsed;
}

function isFutureTimestamp(value: string, now: Date): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function uniqueRecords(records: readonly EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.fragment_id)) return false;
    seen.add(record.fragment_id);
    return true;
  });
}

interface EvidenceDatabaseRow {
  fragment_id: string;
  heading: string | null;
  content: string;
  internal_locator_json: string;
  document_id: string;
  source_id: string;
  flow_snapshot_id: string | null;
  relative_locator: string;
  document_title: string;
  document_checksum: string;
  document_revision: string;
  parse_status: string;
  source_scope: 'GLOBAL' | 'WORKSPACE' | 'SESSION';
  source_kind: 'SANTEXWELL_VAULT' | 'WORKSPACE_DOCUMENT' | 'WORKSPACE_FLOW' | 'SESSION_ATTACHMENT';
  source_workspace_id: string | null;
  source_conversation_id: string | null;
  source_created_by: string | null;
  source_status: string;
  source_revision: string;
  source_item_id: string | null;
  attachment_id: string | null;
  attachment_conversation_id: string | null;
  attachment_owner_id: string | null;
  attachment_status: string | null;
  attachment_expires_at: string | null;
}

type EvidenceRecord = EvidenceDatabaseRow & { locator: Record<string, unknown> };

interface FreshContextRow {
  conversation_id: string;
  plan_version: number;
  run_status: string;
  run_sources_json: string;
  message_sources_json: string;
  selected_context_json: string | null;
  attachment_ids_json: string;
  owner_id: string;
  scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspace_id: string | null;
  conversation_status: string;
}

interface FlowAuthorizationRow {
  guide_id: string;
  workspace_id: string;
  origin_type: 'DRAFT' | 'PUBLISHED';
  revision: number | null;
  version_id: string | null;
  version: number | null;
  document_checksum: string;
  snapshot_json: string;
  owner_id: string;
  guide_status: string;
  guide_revision: number;
  item_deleted_at: string | null;
  collaborator_id: string | null;
}

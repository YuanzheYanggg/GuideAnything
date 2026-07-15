import {
  AgentRunStatusV1Schema,
  FlowKnowledgeSnapshotV1Schema,
  SelectedAgentContextV1Schema,
  SourceOptionsV1Schema,
  type SelectedAgentContextV1,
  type SourceOptionsV1,
} from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import type { AgentRunExecutionContext } from './orchestrator';

interface ExecutionRow {
  run_id: string;
  conversation_id: string;
  plan_version: number;
  run_status: string;
  run_sources_json: string;
  owner_id: string;
  scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspace_id: string | null;
  conversation_status: 'ACTIVE' | 'ARCHIVED';
  message_text: string;
  message_sources_json: string;
  selected_context_json: string | null;
  attachment_ids_json: string;
  steering_instruction: string | null;
}

export function loadAgentRunExecutionContext(
  database: DatabaseSync,
  runId: string,
  now = new Date(),
): AgentRunExecutionContext {
  const row = database.prepare(
    `SELECT run.id AS run_id, run.conversation_id, run.plan_version,
            run.status AS run_status, run.source_options_json AS run_sources_json,
            conversation.owner_id, conversation.scope, conversation.workspace_id,
            conversation.status AS conversation_status,
            message.content AS message_text,
            message.source_options_json AS message_sources_json,
            message.selected_context_json, message.attachment_ids_json,
            (
              SELECT steer.instruction FROM agent_run_steers AS steer
              WHERE steer.run_id = run.id AND steer.plan_version = run.plan_version
              LIMIT 1
            ) AS steering_instruction
     FROM agent_runs AS run
     JOIN conversations AS conversation ON conversation.id = run.conversation_id
     JOIN conversation_messages AS message
       ON message.id = run.initiating_message_id
      AND message.conversation_id = run.conversation_id
      AND message.role = 'USER'
      AND message.committed = 1
     WHERE run.id = ?`,
  ).get(runId) as unknown as ExecutionRow | undefined;
  if (!row) throw new Error('Agent 运行不存在或缺少发起消息');
  if (row.run_status !== 'QUEUED') throw new Error('只有排队中的 Agent 运行可以执行');
  if (row.conversation_status !== 'ACTIVE') throw new Error('归档会话不能继续执行 Agent 运行');

  const runSources = SourceOptionsV1Schema.parse(JSON.parse(row.run_sources_json));
  const messageSources = SourceOptionsV1Schema.parse(JSON.parse(row.message_sources_json));
  if (!sameSources(runSources, messageSources)) throw new Error('运行来源与发起消息不一致');
  const attachmentIds = parseAttachmentIds(row.attachment_ids_json);
  const selectedContext = row.selected_context_json
    ? SelectedAgentContextV1Schema.parse(JSON.parse(row.selected_context_json))
    : undefined;

  if (row.scope === 'GLOBAL_SANTEXWELL') {
    if (
      row.workspace_id !== null
      || runSources.workspaceFlows
      || runSources.workspaceDocuments
      || runSources.sessionAttachments
      || !runSources.santexwell
      || attachmentIds.length > 0
      || (selectedContext && selectedContext.kind !== 'KNOWLEDGE_FRAGMENT')
    ) {
      throw new Error('全局 Santexwell 运行上下文越权');
    }
  } else {
    if (!row.workspace_id) throw new Error('工作区运行缺少 workspaceId');
    const access = database.prepare(
      `SELECT 1
       FROM workspaces AS workspace
       JOIN workspace_members AS member ON member.workspace_id = workspace.id
       WHERE workspace.id = ? AND workspace.status = 'ACTIVE' AND member.user_id = ?`,
    ).get(row.workspace_id, row.owner_id);
    if (!access) throw new Error('用户已经失去工作区访问权限，或工作区已归档');
  }

  requireAttachments(database, row.conversation_id, row.owner_id, attachmentIds, runSources, now);
  if (selectedContext) {
    requireSelectedContext(
      database,
      row.conversation_id,
      row.workspace_id,
      runSources,
      selectedContext,
      now,
    );
  }

  return {
    runId: row.run_id,
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    scope: row.scope,
    workspaceId: row.workspace_id,
    planVersion: row.plan_version,
    status: AgentRunStatusV1Schema.parse(row.run_status),
    text: row.message_text,
    ...(row.steering_instruction ? { steeringInstruction: row.steering_instruction } : {}),
    sources: runSources,
    ...(selectedContext ? { selectedContext } : {}),
    attachmentIds,
  };
}

function requireAttachments(
  database: DatabaseSync,
  conversationId: string,
  ownerId: string,
  attachmentIds: readonly string[],
  sources: SourceOptionsV1,
  now: Date,
): void {
  if (attachmentIds.length === 0) return;
  if (!sources.sessionAttachments) throw new Error('本轮未启用会话附件');
  const placeholders = attachmentIds.map(() => '?').join(', ');
  const row = database.prepare(
    `SELECT COUNT(*) AS count
     FROM conversation_attachments
     WHERE id IN (${placeholders})
       AND conversation_id = ?
       AND owner_id = ?
       AND status = 'READY'
       AND expires_at > ?`,
  ).get(...attachmentIds, conversationId, ownerId, now.toISOString()) as { count: number };
  if (row.count !== attachmentIds.length) {
    throw new Error('一个或多个会话附件已经失效、过期或不再属于当前会话');
  }
}

function requireSelectedContext(
  database: DatabaseSync,
  conversationId: string,
  workspaceId: string | null,
  sources: SourceOptionsV1,
  context: SelectedAgentContextV1,
  now: Date,
): void {
  if (context.kind === 'FLOW_NODE' || context.kind === 'FLOW_SNAPSHOT') {
    if (!workspaceId || !sources.workspaceFlows) throw new Error('选中的流程上下文不再可用');
    const row = database.prepare(
      `SELECT snapshot_json FROM flow_knowledge_snapshots
       WHERE id = ? AND workspace_id = ?`,
    ).get(context.snapshotId, workspaceId) as { snapshot_json: string } | undefined;
    if (!row) throw new Error('选中的流程快照不再可用');
    if (context.kind === 'FLOW_NODE') {
      const snapshot = FlowKnowledgeSnapshotV1Schema.parse(JSON.parse(row.snapshot_json));
      if (!snapshot.nodes.some((node) => node.id === context.nodeId)) {
        throw new Error('选中的流程节点不再可用');
      }
    }
    return;
  }
  if (context.kind === 'WORKSPACE_SOURCE') {
    if (!workspaceId || !sources.workspaceDocuments) throw new Error('选中的工作区资料不再可用');
    const source = database.prepare(
      `SELECT 1 FROM knowledge_sources
       WHERE id = ? AND scope = 'WORKSPACE' AND kind = 'WORKSPACE_DOCUMENT'
         AND workspace_id = ? AND status IN ('READY', 'STALE')`,
    ).get(context.sourceId, workspaceId);
    if (!source) throw new Error('选中的工作区资料不再可用');
    return;
  }

  const source = database.prepare(
    `SELECT source.id, source.scope, source.kind, source.workspace_id, source.conversation_id,
            source.created_by, source.status
     FROM knowledge_documents AS document
     JOIN knowledge_sources AS source ON source.id = document.source_id
     WHERE document.id = ? AND document.parse_status = 'READY'
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM knowledge_fragments AS fragment
         WHERE fragment.id = ? AND fragment.document_id = document.id
       ))`,
  ).get(
    context.documentId,
    context.fragmentId ?? null,
    context.fragmentId ?? null,
  ) as {
    id: string;
    scope: 'GLOBAL' | 'WORKSPACE' | 'SESSION';
    kind: 'SANTEXWELL_VAULT' | 'WORKSPACE_DOCUMENT' | 'WORKSPACE_FLOW' | 'SESSION_ATTACHMENT';
    workspace_id: string | null;
    conversation_id: string | null;
    created_by: string | null;
    status: string;
  } | undefined;
  if (!source) throw new Error('选中的知识片段不再可用');
  const allowed = source.scope === 'GLOBAL'
    ? source.kind === 'SANTEXWELL_VAULT'
      && sources.santexwell
      && (source.status === 'READY' || source.status === 'STALE')
    : source.scope === 'WORKSPACE'
      ? source.workspace_id === workspaceId
        && (source.status === 'READY' || source.status === 'STALE')
        && (
          (source.kind === 'WORKSPACE_DOCUMENT' && sources.workspaceDocuments)
          || (source.kind === 'WORKSPACE_FLOW' && sources.workspaceFlows)
        )
      : source.conversation_id === conversationId
        && sources.sessionAttachments
        && source.status === 'READY'
        && database.prepare(
          `SELECT 1 FROM conversation_attachments
           WHERE source_id = ? AND conversation_id = ? AND status = 'READY' AND expires_at > ?`,
        ).get(source.id, conversationId, now.toISOString()) !== undefined;
  if (!allowed) throw new Error('选中的知识片段不再属于本轮已授权来源');
}

function parseAttachmentIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 20 || parsed.some((item) => typeof item !== 'string' || !item)) {
    throw new Error('运行附件列表无效');
  }
  if (new Set(parsed).size !== parsed.length) throw new Error('运行附件列表包含重复项');
  return parsed;
}

function sameSources(left: SourceOptionsV1, right: SourceOptionsV1): boolean {
  return left.workspaceFlows === right.workspaceFlows
    && left.workspaceDocuments === right.workspaceDocuments
    && left.sessionAttachments === right.sessionAttachments
    && left.santexwell === right.santexwell;
}

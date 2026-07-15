import {
  AgentMessageAcceptedV1Schema,
  AgentRunSnapshotV1Schema,
  ConversationSummaryV1Schema,
  SendConversationMessageRequestV1Schema,
  SourceOptionsV1Schema,
  type AgentMessageAcceptedV1,
  type AgentRunSnapshotV1,
  type ConversationSummaryV1,
  type SendConversationMessageRequestV1,
} from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface CreateConversationInput {
  scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspaceId: string | null;
  ownerId: string;
  title: string;
}

export interface ListConversationInput {
  ownerId: string;
  scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspaceId: string | null;
}

export interface EnqueueConversationRunInput {
  conversationId: string;
  ownerId: string;
  request: SendConversationMessageRequestV1;
}

export interface EnqueueConversationRunResult {
  created: boolean;
  accepted: AgentMessageAcceptedV1;
}

export class IdempotencyConflictError extends Error {
  readonly code = 'CLIENT_MESSAGE_ID_CONFLICT';

  constructor() {
    super('同一 clientMessageId 已用于不同的消息内容');
    this.name = 'IdempotencyConflictError';
  }
}

export class ConversationNotFoundError extends Error {
  readonly code = 'CONVERSATION_NOT_FOUND';

  constructor() {
    super('会话不存在');
    this.name = 'ConversationNotFoundError';
  }
}

interface ConversationRow {
  id: string;
  scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspace_id: string | null;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

interface UserMessageRow {
  id: string;
  conversation_id: string;
  client_message_id: string;
  content: string;
  source_options_json: string;
  selected_context_json: string | null;
  attachment_ids_json: string;
  created_at: string;
}

interface RunRow {
  id: string;
  conversation_id: string;
  initiating_message_id: string;
  run_sequence: number;
  plan_version: number;
  route: AgentRunSnapshotV1['route'];
  status: AgentRunSnapshotV1['status'];
  source_options_json: string;
  error_code: string | null;
  error_message: string | null;
  error_retryable: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  last_event_sequence: number;
}

const CONVERSATION_SELECT = `
  SELECT conversation.id, conversation.scope, conversation.workspace_id,
         conversation.title, conversation.status, conversation.created_at,
         conversation.updated_at,
         (
           SELECT substr(message.content, 1, 500)
           FROM conversation_messages AS message
           WHERE message.conversation_id = conversation.id
           ORDER BY message.created_at DESC, message.id DESC
           LIMIT 1
         ) AS last_message_preview
  FROM conversations AS conversation
`;

export function createConversation(
  database: DatabaseSync,
  input: CreateConversationInput,
): ConversationSummaryV1 {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO conversations (
      id, scope, workspace_id, owner_id, title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
  ).run(id, input.scope, input.workspaceId, input.ownerId, input.title, now, now);
  return getConversationForOwner(database, id, input.ownerId)!;
}

export function getConversationForOwner(
  database: DatabaseSync,
  conversationId: string,
  ownerId: string,
): ConversationSummaryV1 | null {
  const row = database.prepare(
    `${CONVERSATION_SELECT}
     WHERE conversation.id = ? AND conversation.owner_id = ?`,
  ).get(conversationId, ownerId) as unknown as ConversationRow | undefined;
  return row ? mapConversation(row) : null;
}

export function listConversationsForOwner(
  database: DatabaseSync,
  input: ListConversationInput,
): ConversationSummaryV1[] {
  const rows = database.prepare(
    `${CONVERSATION_SELECT}
     WHERE conversation.owner_id = ?
       AND conversation.scope = ?
       AND conversation.workspace_id IS ?
     ORDER BY conversation.updated_at DESC, conversation.id DESC`,
  ).all(input.ownerId, input.scope, input.workspaceId) as unknown as ConversationRow[];
  return rows.map(mapConversation);
}

export function enqueueConversationRun(
  database: DatabaseSync,
  input: EnqueueConversationRunInput,
): EnqueueConversationRunResult {
  const request = SendConversationMessageRequestV1Schema.parse(input.request);
  const conversation = getConversationForOwner(database, input.conversationId, input.ownerId);
  if (!conversation) {
    throw new ConversationNotFoundError();
  }
  if (conversation.status !== 'ACTIVE') {
    throw new Error('归档会话不能创建新运行');
  }
  if (conversation.scope === 'GLOBAL_SANTEXWELL' && !isGlobalSantexwellRequest(request)) {
    throw new Error('全局会话只能使用 Santexwell 来源与知识片段上下文');
  }

  const existing = getUserMessageByClientId(database, input.conversationId, request.clientMessageId);
  if (existing) {
    if (!sameMessageRequest(existing, request)) throw new IdempotencyConflictError();
    const run = getRunByMessage(database, input.conversationId, existing.id);
    if (!run) throw new Error('幂等消息缺少关联运行');
    return { created: false, accepted: mapAccepted(existing, run) };
  }

  const messageId = randomUUID();
  const runId = randomUUID();
  const now = new Date().toISOString();
  const sourceOptionsJson = JSON.stringify(request.sources);
  const selectedContextJson = request.selectedContext ? JSON.stringify(request.selectedContext) : null;
  const attachmentIdsJson = JSON.stringify(request.attachmentIds);

  database.exec('BEGIN IMMEDIATE');
  try {
    const sequenceRow = database.prepare(
      `SELECT COALESCE(MAX(run_sequence), 0) + 1 AS next_sequence
       FROM agent_runs WHERE conversation_id = ?`,
    ).get(input.conversationId) as { next_sequence: number };
    database.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json,
        selected_context_json, attachment_ids_json, committed, created_at
      ) VALUES (?, ?, 'USER', ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      messageId,
      input.conversationId,
      request.clientMessageId,
      request.text,
      sourceOptionsJson,
      selectedContextJson,
      attachmentIdsJson,
      now,
    );
    database.prepare(
      `INSERT INTO agent_runs (
        id, conversation_id, initiating_message_id, run_sequence, plan_version,
        status, source_options_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 'QUEUED', ?, ?, ?)`,
    ).run(runId, input.conversationId, messageId, sequenceRow.next_sequence, sourceOptionsJson, now, now);
    database.prepare(
      `UPDATE conversations SET updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    ).run(now, input.conversationId, input.ownerId);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    const raced = getUserMessageByClientId(database, input.conversationId, request.clientMessageId);
    if (raced) {
      if (!sameMessageRequest(raced, request)) throw new IdempotencyConflictError();
      const run = getRunByMessage(database, input.conversationId, raced.id);
      if (run) return { created: false, accepted: mapAccepted(raced, run) };
    }
    throw error;
  }

  const message = getUserMessageById(database, messageId)!;
  const run = getRunById(database, runId)!;
  return { created: true, accepted: mapAccepted(message, run) };
}

export function getRunById(database: DatabaseSync, runId: string): RunRow | null {
  const row = database.prepare(
    `SELECT run.*,
            COALESCE((SELECT MAX(sequence) FROM agent_run_events WHERE run_id = run.id), 0)
              AS last_event_sequence
     FROM agent_runs AS run
     WHERE run.id = ?`,
  ).get(runId) as unknown as RunRow | undefined;
  return row ?? null;
}

export function getRunSnapshotForOwner(
  database: DatabaseSync,
  runId: string,
  ownerId: string,
): AgentRunSnapshotV1 | null {
  const owned = database.prepare(
    `SELECT 1
     FROM agent_runs AS run
     JOIN conversations AS conversation ON conversation.id = run.conversation_id
     WHERE run.id = ? AND conversation.owner_id = ?`,
  ).get(runId, ownerId);
  if (!owned) return null;
  const row = getRunById(database, runId);
  return row ? mapRunSnapshot(row) : null;
}

export function mapRunSnapshot(row: RunRow): AgentRunSnapshotV1 {
  const sources = SourceOptionsV1Schema.parse(JSON.parse(row.source_options_json));
  const error = row.error_code === null
    ? null
    : {
        code: row.error_code,
        message: row.error_message ?? '运行失败',
        retryable: row.error_retryable === 1,
      };
  return AgentRunSnapshotV1Schema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    initiatingMessageId: row.initiating_message_id,
    runSequence: row.run_sequence,
    planVersion: row.plan_version,
    route: row.route,
    status: row.status,
    sources,
    lastEventSequence: row.last_event_sequence,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    error,
  });
}

function getUserMessageByClientId(
  database: DatabaseSync,
  conversationId: string,
  clientMessageId: string,
): UserMessageRow | null {
  const row = database.prepare(
    `SELECT id, conversation_id, client_message_id, content, source_options_json,
            selected_context_json, attachment_ids_json, created_at
     FROM conversation_messages
     WHERE conversation_id = ? AND client_message_id = ? AND role = 'USER'`,
  ).get(conversationId, clientMessageId) as unknown as UserMessageRow | undefined;
  return row ?? null;
}

function getUserMessageById(database: DatabaseSync, messageId: string): UserMessageRow | null {
  const row = database.prepare(
    `SELECT id, conversation_id, client_message_id, content, source_options_json,
            selected_context_json, attachment_ids_json, created_at
     FROM conversation_messages
     WHERE id = ? AND role = 'USER'`,
  ).get(messageId) as unknown as UserMessageRow | undefined;
  return row ?? null;
}

function getRunByMessage(
  database: DatabaseSync,
  conversationId: string,
  messageId: string,
): RunRow | null {
  const row = database.prepare(
    `SELECT run.*,
            COALESCE((SELECT MAX(sequence) FROM agent_run_events WHERE run_id = run.id), 0)
              AS last_event_sequence
     FROM agent_runs AS run
     WHERE run.conversation_id = ? AND run.initiating_message_id = ?
     ORDER BY run.run_sequence ASC, run.id ASC
     LIMIT 1`,
  ).get(conversationId, messageId) as unknown as RunRow | undefined;
  return row ?? null;
}

function sameMessageRequest(row: UserMessageRow, request: SendConversationMessageRequestV1): boolean {
  const selectedContextJson = request.selectedContext ? JSON.stringify(request.selectedContext) : null;
  return row.content === request.text
    && row.source_options_json === JSON.stringify(request.sources)
    && row.selected_context_json === selectedContextJson
    && row.attachment_ids_json === JSON.stringify(request.attachmentIds);
}

function mapAccepted(message: UserMessageRow, run: RunRow): AgentMessageAcceptedV1 {
  const userMessage = {
    id: message.id,
    role: 'USER' as const,
    clientMessageId: message.client_message_id,
    content: message.content,
    sources: SourceOptionsV1Schema.parse(JSON.parse(message.source_options_json)),
    createdAt: message.created_at,
  };
  const snapshot = mapRunSnapshot(run);
  return AgentMessageAcceptedV1Schema.parse({
    message: userMessage,
    run: snapshot,
    eventsPath: `/agent-runs/${encodeURIComponent(snapshot.id)}/events`,
  });
}

function mapConversation(row: ConversationRow): ConversationSummaryV1 {
  return ConversationSummaryV1Schema.parse({
    id: row.id,
    scope: row.scope,
    workspaceId: row.workspace_id,
    title: row.title,
    status: row.status,
    ...(row.last_message_preview ? { lastMessagePreview: row.last_message_preview } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function isGlobalSantexwellRequest(request: SendConversationMessageRequestV1): boolean {
  return !request.sources.workspaceFlows
    && !request.sources.workspaceDocuments
    && !request.sources.sessionAttachments
    && request.sources.santexwell
    && request.attachmentIds.length === 0
    && (!request.selectedContext || request.selectedContext.kind === 'KNOWLEDGE_FRAGMENT');
}

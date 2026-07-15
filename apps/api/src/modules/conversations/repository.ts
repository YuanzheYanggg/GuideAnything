import {
  AgentCommittedAnswerV1Schema,
  AgentMessageAcceptedV1Schema,
  AgentRunSnapshotV1Schema,
  ConversationAssistantMessageV1Schema,
  ConversationDetailV1Schema,
  ConversationSummaryV1Schema,
  ConversationUserMessageV1Schema,
  PublicRoutePlanV1Schema,
  SendConversationMessageRequestV1Schema,
  SteerAgentRunRequestV1Schema,
  SourceOptionsV1Schema,
  type AgentCommittedAnswerV1,
  type AgentMessageAcceptedV1,
  type AgentRunStatusV1,
  type AgentRunSnapshotV1,
  type ConversationAssistantMessageV1,
  type ConversationDetailV1,
  type ConversationSummaryV1,
  type SendConversationMessageRequestV1,
} from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { listConversationAttachments } from '../conversation-attachments/repository';

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

export class AgentRunNotFoundError extends Error {
  readonly code = 'RUN_NOT_FOUND';
  readonly statusCode = 404;

  constructor() {
    super('运行不存在');
    this.name = 'AgentRunNotFoundError';
  }
}

export class AgentRunNotControllableError extends Error {
  readonly code = 'RUN_NOT_CONTROLLABLE';
  readonly statusCode = 409;

  constructor() {
    super('当前运行状态不能执行该控制操作');
    this.name = 'AgentRunNotControllableError';
  }
}

export class SteerIdempotencyConflictError extends Error {
  readonly code = 'CLIENT_STEER_ID_CONFLICT';
  readonly statusCode = 409;

  constructor() {
    super('同一 clientSteerId 已用于不同的调整指令');
    this.name = 'SteerIdempotencyConflictError';
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
  route_decision_json: string | null;
  error_code: string | null;
  error_message: string | null;
  error_retryable: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  last_event_sequence: number;
}

interface StoredMessageRow {
  id: string;
  role: 'USER' | 'ASSISTANT';
  client_message_id: string | null;
  content: string;
  source_options_json: string | null;
  created_at: string;
}

const AssistantMessageEnvelopeSchema = z.object({
  runId: z.string().min(1).max(200),
  answer: AgentCommittedAnswerV1Schema,
}).strict();

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

const OWNED_RUN_ACCESS_PREDICATE = `
  conversation.owner_id = ?
  AND (
    conversation.scope = 'GLOBAL_SANTEXWELL'
    OR (
      conversation.scope = 'WORKSPACE'
      AND EXISTS (
        SELECT 1
        FROM workspaces AS workspace
        JOIN workspace_members AS member
          ON member.workspace_id = workspace.id AND member.user_id = ?
        WHERE workspace.id = conversation.workspace_id
          AND workspace.status = 'ACTIVE'
      )
    )
  )
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

export function getConversationDetailForOwner(
  database: DatabaseSync,
  conversationId: string,
  ownerId: string,
): ConversationDetailV1 | null {
  const conversation = getConversationForOwner(database, conversationId, ownerId);
  if (!conversation) return null;
  const rows = database.prepare(
    `SELECT id, role, client_message_id, content, source_options_json, created_at
     FROM conversation_messages
     WHERE conversation_id = ? AND committed = 1
     ORDER BY created_at ASC, id ASC`,
  ).all(conversationId) as unknown as StoredMessageRow[];
  const messages = rows.map((row) => row.role === 'USER'
    ? ConversationUserMessageV1Schema.parse({
        id: row.id,
        role: 'USER',
        clientMessageId: row.client_message_id,
        content: row.content,
        sources: SourceOptionsV1Schema.parse(JSON.parse(row.source_options_json ?? 'null')),
        createdAt: row.created_at,
      })
    : mapAssistantMessage(row));
  const latestRunRow = database.prepare(
    `SELECT run.*,
            COALESCE((SELECT MAX(sequence) FROM agent_run_events WHERE run_id = run.id), 0)
              AS last_event_sequence
     FROM agent_runs AS run
     WHERE run.conversation_id = ?
     ORDER BY run.run_sequence DESC, run.id DESC
     LIMIT 1`,
  ).get(conversationId) as unknown as RunRow | undefined;
  return ConversationDetailV1Schema.parse({
    conversation,
    messages,
    latestRun: latestRunRow ? mapRunSnapshot(latestRunRow) : null,
    attachments: listConversationAttachments(database, conversationId, ownerId),
  });
}

export function commitAssistantMessage(
  database: DatabaseSync,
  input: { runId: string; answer: AgentCommittedAnswerV1 },
): ConversationAssistantMessageV1 {
  const answer = AgentCommittedAnswerV1Schema.parse(input.answer);
  const run = getRunById(database, input.runId);
  if (!run) throw new Error('运行不存在');
  if (run.status !== 'VALIDATING') throw new Error('只有 VALIDATING 运行可以提交助手消息');
  const existing = getAssistantMessageByRun(database, run.id);
  if (existing) return mapAssistantMessage(existing);
  const id = randomUUID();
  const now = new Date().toISOString();
  const content = JSON.stringify(AssistantMessageEnvelopeSchema.parse({ runId: run.id, answer }));
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json,
        selected_context_json, attachment_ids_json, committed, created_at
      ) VALUES (?, ?, 'ASSISTANT', NULL, ?, NULL, NULL, '[]', 1, ?)`,
    ).run(id, run.conversation_id, content, now);
    database.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(now, run.conversation_id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    const raced = getAssistantMessageByRun(database, run.id);
    if (raced) return mapAssistantMessage(raced);
    throw error;
  }
  return mapAssistantMessage(getAssistantMessageByRun(database, run.id)!);
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
     WHERE run.id = ? AND ${OWNED_RUN_ACCESS_PREDICATE}`,
  ).get(runId, ownerId, ownerId);
  if (!owned) return null;
  const row = getRunById(database, runId);
  return row ? mapRunSnapshot(row) : null;
}

export function requireControllableRunForOwner(
  database: DatabaseSync,
  runId: string,
  ownerId: string,
): AgentRunSnapshotV1 {
  const run = getRunSnapshotForOwner(database, runId, ownerId);
  if (!run) throw new AgentRunNotFoundError();
  if (run.status === 'VALIDATING' || isTerminalRunStatus(run.status)) {
    throw new AgentRunNotControllableError();
  }
  return run;
}

export function steerAgentRunForOwner(
  database: DatabaseSync,
  input: {
    runId: string;
    ownerId: string;
    clientSteerId: string;
    instruction: string;
  },
): { created: boolean; planVersion: number } {
  const request = SteerAgentRunRequestV1Schema.parse({
    clientSteerId: input.clientSteerId,
    instruction: input.instruction,
  });
  const existing = getSteerForOwner(database, input.runId, input.ownerId, request.clientSteerId);
  if (existing) {
    if (existing.instruction !== request.instruction) throw new SteerIdempotencyConflictError();
    return { created: false, planVersion: existing.plan_version };
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const run = database.prepare(
      `SELECT run.plan_version, run.status
       FROM agent_runs AS run
       JOIN conversations AS conversation ON conversation.id = run.conversation_id
       WHERE run.id = ? AND ${OWNED_RUN_ACCESS_PREDICATE}
         AND conversation.status = 'ACTIVE'`,
    ).get(input.runId, input.ownerId, input.ownerId) as {
      plan_version: number;
      status: AgentRunStatusV1;
    } | undefined;
    if (!run) throw new AgentRunNotFoundError();
    if (run.status === 'VALIDATING' || isTerminalRunStatus(run.status)) {
      throw new AgentRunNotControllableError();
    }
    const planVersion = run.plan_version + 1;
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO agent_run_steers (
        id, run_id, client_steer_id, plan_version, instruction, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), input.runId, request.clientSteerId, planVersion, request.instruction, now);
    database.prepare(
      `UPDATE agent_run_events
       SET stale = 1
       WHERE run_id = ? AND phase = 'PROVISIONAL' AND plan_version < ?`,
    ).run(input.runId, planVersion);
    database.prepare(
      `UPDATE agent_runs
       SET plan_version = ?, route = NULL, status = 'QUEUED', route_decision_json = NULL,
           error_code = NULL, error_message = NULL, error_retryable = NULL,
           cancelled_at = NULL, completed_at = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(planVersion, now, input.runId);
    database.exec('COMMIT');
    return { created: true, planVersion };
  } catch (error) {
    database.exec('ROLLBACK');
    const raced = getSteerForOwner(database, input.runId, input.ownerId, request.clientSteerId);
    if (raced) {
      if (raced.instruction !== request.instruction) throw new SteerIdempotencyConflictError();
      return { created: false, planVersion: raced.plan_version };
    }
    throw error;
  }
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
    ...(row.route_decision_json
      ? { publicPlan: PublicRoutePlanV1Schema.parse(JSON.parse(row.route_decision_json)) }
      : {}),
    lastEventSequence: row.last_event_sequence,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    error,
  });
}

function getAssistantMessageByRun(database: DatabaseSync, runId: string): StoredMessageRow | null {
  const row = database.prepare(
    `SELECT id, role, client_message_id, content, source_options_json, created_at
     FROM conversation_messages
     WHERE role = 'ASSISTANT' AND json_extract(content, '$.runId') = ?
     LIMIT 1`,
  ).get(runId) as unknown as StoredMessageRow | undefined;
  return row ?? null;
}

function getSteerForOwner(
  database: DatabaseSync,
  runId: string,
  ownerId: string,
  clientSteerId: string,
): { plan_version: number; instruction: string } | null {
  const row = database.prepare(
    `SELECT steer.plan_version, steer.instruction
     FROM agent_run_steers AS steer
     JOIN agent_runs AS run ON run.id = steer.run_id
     JOIN conversations AS conversation ON conversation.id = run.conversation_id
     WHERE steer.run_id = ? AND steer.client_steer_id = ?
       AND ${OWNED_RUN_ACCESS_PREDICATE}`,
  ).get(runId, clientSteerId, ownerId, ownerId) as {
    plan_version: number;
    instruction: string;
  } | undefined;
  return row ?? null;
}

function isTerminalRunStatus(status: AgentRunStatusV1): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

function mapAssistantMessage(row: StoredMessageRow): ConversationAssistantMessageV1 {
  const envelope = AssistantMessageEnvelopeSchema.parse(JSON.parse(row.content));
  return ConversationAssistantMessageV1Schema.parse({
    id: row.id,
    role: 'ASSISTANT',
    runId: envelope.runId,
    answer: envelope.answer,
    createdAt: row.created_at,
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

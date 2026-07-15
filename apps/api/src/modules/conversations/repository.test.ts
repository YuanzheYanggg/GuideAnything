import type { AgentRunEventV1, SendConversationMessageRequestV1 } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import {
  createConversation,
  enqueueConversationRun,
  getConversationForOwner,
  IdempotencyConflictError,
  listConversationsForOwner,
} from './repository';
import {
  AgentRunEventStore,
  RunEventBroker,
  streamPersistedRunEvents,
} from './events';

describe('conversation persistence', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedUser(database, 'owner-1');
    seedUser(database, 'owner-2');
    seedWorkspace(database, 'workspace-1', 'owner-1');
  });

  afterEach(() => database.close());

  it('keeps global and workspace conversations owner scoped', () => {
    const global = createConversation(database, {
      scope: 'GLOBAL_SANTEXWELL',
      workspaceId: null,
      ownerId: 'owner-1',
      title: '花式纱分类',
    });
    const workspace = createConversation(database, {
      scope: 'WORKSPACE',
      workspaceId: 'workspace-1',
      ownerId: 'owner-1',
      title: '审批流程',
    });

    expect(global.workspaceId).toBeNull();
    expect(workspace.workspaceId).toBe('workspace-1');
    expect(listConversationsForOwner(database, {
      ownerId: 'owner-1', scope: 'GLOBAL_SANTEXWELL', workspaceId: null,
    })).toEqual([global]);
    expect(getConversationForOwner(database, global.id, 'owner-2')).toBeNull();
  });

  it('atomically persists an idempotent message and queued run', () => {
    const conversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '流程问答',
    });
    const request = messageRequest();
    const first = enqueueConversationRun(database, {
      conversationId: conversation.id,
      ownerId: 'owner-1',
      request,
    });
    const replay = enqueueConversationRun(database, {
      conversationId: conversation.id,
      ownerId: 'owner-1',
      request,
    });

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.accepted).toEqual(first.accepted);
    expect(first.accepted.run.status).toBe('QUEUED');
    expect(first.accepted.run.runSequence).toBe(1);
    expect(first.accepted.eventsPath).toBe(`/agent-runs/${encodeURIComponent(first.accepted.run.id)}/events`);
    expect(database.prepare('SELECT COUNT(*) AS count FROM conversation_messages').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM agent_runs').get()).toEqual({ count: 1 });
    expect(database.prepare(
      `SELECT selected_context_json, attachment_ids_json FROM conversation_messages
       WHERE id = ?`,
    ).get(first.accepted.message.id)).toEqual({
      selected_context_json: JSON.stringify(request.selectedContext),
      attachment_ids_json: JSON.stringify(request.attachmentIds),
    });
  });

  it('rejects a reused client message id with a different payload', () => {
    const conversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '流程问答',
    });
    const request = messageRequest();
    enqueueConversationRun(database, { conversationId: conversation.id, ownerId: 'owner-1', request });
    expect(() => enqueueConversationRun(database, {
      conversationId: conversation.id,
      ownerId: 'owner-1',
      request: { ...request, text: '不同问题' },
    })).toThrow(IdempotencyConflictError);
  });

  it('refuses to persist workspace sources through a global conversation repository call', () => {
    const conversation = createConversation(database, {
      scope: 'GLOBAL_SANTEXWELL', workspaceId: null, ownerId: 'owner-1', title: '全局问答',
    });
    expect(() => enqueueConversationRun(database, {
      conversationId: conversation.id,
      ownerId: 'owner-1',
      request: messageRequest(),
    })).toThrow(/全局会话只能使用 Santexwell/u);
  });

  it('persists a schema-validated event before notifying subscribers', () => {
    const { runId } = seedRun();
    const broker = new RunEventBroker();
    const store = new AgentRunEventStore(database, broker);
    const listener = vi.fn((event: AgentRunEventV1) => {
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM agent_run_events WHERE id = ?',
      ).get(event.id)).toEqual({ count: 1 });
    });
    broker.subscribe(runId, listener);

    const event = store.append({
      runId,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'route.started',
      payload: {},
    });
    expect(event.sequence).toBe(1);
    expect(listener).toHaveBeenCalledOnce();
    expect(() => store.append({
      runId,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'plan.committed',
      payload: { decision: { contextAssessment: 'internal reasoning' } },
    } as never)).toThrow();
    expect(database.prepare('SELECT COUNT(*) AS count FROM agent_run_events').get()).toEqual({ count: 1 });
  });

  it('does not turn a committed append into a caller-visible failure when a listener throws', () => {
    const { runId } = seedRun();
    const broker = new RunEventBroker();
    broker.subscribe(runId, () => { throw new Error('broken listener'); });
    const store = new AgentRunEventStore(database, broker);
    expect(() => store.append({
      runId, planVersion: 1, phase: 'PROVISIONAL', type: 'route.started', payload: {},
    })).not.toThrow();
    expect(database.prepare('SELECT COUNT(*) AS count FROM agent_run_events').get()).toEqual({ count: 1 });
  });

  it('rejects invalid run state transitions and replaces the route after steer', () => {
    const { runId } = seedRun();
    const store = new AgentRunEventStore(database, new RunEventBroker());
    expect(() => store.append({
      runId,
      planVersion: 1,
      phase: 'COMMITTED',
      type: 'run.completed',
      payload: { messageId: 'missing-assistant-message' },
    })).toThrow(/VALIDATING|消息/u);
    store.append({ runId, planVersion: 1, phase: 'PROVISIONAL', type: 'route.started', payload: {} });
    store.append({
      runId,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'plan.committed',
      payload: {
        plan: {
          route: 'FOCUSED',
          userFacingPlan: '检查当前流程。',
          executionMode: 'SEQUENTIAL',
          tasks: [{ id: 'flow', label: '检查流程', sourceKind: 'WORKSPACE_FLOW' }],
        },
      },
    });
    expect(() => store.append({
      runId, planVersion: 1, phase: 'PROVISIONAL', type: 'route.started', payload: {},
    })).toThrow(/状态/u);

    database.prepare(
      `UPDATE agent_runs SET plan_version = 2, status = 'ROUTING' WHERE id = ?`,
    ).run(runId);
    store.append({
      runId,
      planVersion: 2,
      phase: 'PROVISIONAL',
      type: 'plan.committed',
      payload: {
        plan: {
          route: 'DIRECT',
          userFacingPlan: '直接使用已验证上下文。',
          executionMode: 'SEQUENTIAL',
          tasks: [],
        },
      },
    });
    expect(database.prepare('SELECT route FROM agent_runs WHERE id = ?').get(runId)).toEqual({ route: 'DIRECT' });
  });

  it('replays ordered events after a sequence and ends on terminal state', async () => {
    const { runId } = seedRun();
    const broker = new RunEventBroker();
    const store = new AgentRunEventStore(database, broker);
    store.append({
      runId, planVersion: 1, phase: 'PROVISIONAL', type: 'route.started', payload: {},
    });
    store.append({
      runId,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'route.completed',
      payload: { route: 'FOCUSED', userFacingPlan: '检查当前流程节点。' },
    });
    store.append({
      runId,
      planVersion: 1,
      phase: 'COMMITTED',
      type: 'run.failed',
      payload: { code: 'TEST_FAILURE', message: '测试终止。', retryable: true },
    });

    const received: AgentRunEventV1[] = [];
    for await (const event of streamPersistedRunEvents(database, broker, runId, 1)) received.push(event);
    expect(received.map((event) => event.sequence)).toEqual([2, 3]);
    expect(received.at(-1)?.type).toBe('run.failed');

    const terminalCursor = streamPersistedRunEvents(database, broker, runId, 3);
    const next = await Promise.race([
      terminalCursor.next(),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ]);
    expect(next).not.toBe('timeout');
    expect(next).toMatchObject({ done: true });
  });

  function seedRun(): { conversationId: string; runId: string } {
    const conversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '事件测试',
    });
    const queued = enqueueConversationRun(database, {
      conversationId: conversation.id, ownerId: 'owner-1', request: messageRequest(),
    });
    return { conversationId: conversation.id, runId: queued.accepted.run.id };
  }
});

function messageRequest(): SendConversationMessageRequestV1 {
  return {
    clientMessageId: 'client-message-1',
    text: '这个审批节点由谁负责？',
    sources: {
      workspaceFlows: true,
      workspaceDocuments: false,
      sessionAttachments: false,
      santexwell: true,
    },
    selectedContext: { kind: 'FLOW_NODE', snapshotId: 'snapshot-1', nodeId: 'approve' },
    attachmentIds: ['attachment-1'],
  };
}

function seedUser(database: DatabaseSync, id: string): void {
  database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, 'not-used', ?, 'AUTHOR', ?)`,
  ).run(id, `${id}@guide.local`, id, '2026-07-15T00:00:00.000Z');
}

function seedWorkspace(database: DatabaseSync, id: string, ownerId: string): void {
  const now = '2026-07-15T00:00:00.000Z';
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, created_at, updated_at
    ) VALUES (?, ?, '测试工作区', '', 'SquaresFour', 'general', ?, ?, ?)`,
  ).run(id, id, ownerId, now, now);
  database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES (?, ?, 'OWNER', ?)`,
  ).run(id, ownerId, now);
}

import type { SendConversationMessageRequestV1 } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import {
  AgentRunEventStore,
  listRunEventsAfter,
  RunEventBroker,
  streamPersistedRunEvents,
} from './events';
import { recoverInterruptedAgentRuns } from './recovery';
import { createConversation, enqueueConversationRun, getRunById } from './repository';

describe('interrupted agent run recovery', () => {
  let database: DatabaseSync;
  let broker: RunEventBroker;
  let store: AgentRunEventStore;
  let conversationId: string;

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedOwner(database);
    broker = new RunEventBroker();
    store = new AgentRunEventStore(database, broker);
    conversationId = createConversation(database, {
      scope: 'GLOBAL_SANTEXWELL',
      workspaceId: null,
      ownerId: 'owner-recovery',
      title: '恢复测试',
    }).id;
  });

  afterEach(() => database.close());

  it('atomically fails interrupted nonterminal runs and exposes a terminal replay event', async () => {
    const routing = enqueue('routing');
    store.append({
      runId: routing,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'route.started',
      payload: {},
    });
    const running = enqueue('running');
    advanceToRunning(running);
    const validating = enqueue('validating');
    advanceToRunning(validating);
    store.append({
      runId: validating,
      planVersion: 1,
      phase: 'COMMITTED',
      type: 'answer.validating',
      payload: {},
    });
    const queued = enqueue('queued');

    expect(recoverInterruptedAgentRuns(database, broker)).toBe(3);

    for (const runId of [routing, running, validating]) {
      expect(getRunById(database, runId)).toMatchObject({
        status: 'FAILED',
        error_code: 'RUNTIME_RESTARTED',
        error_retryable: 1,
      });
      expect(listRunEventsAfter(database, runId, 0).at(-1)).toMatchObject({
        type: 'run.failed',
        phase: 'COMMITTED',
        payload: { code: 'RUNTIME_RESTARTED', retryable: true },
      });
    }
    expect(getRunById(database, queued)).toMatchObject({ status: 'QUEUED' });
    expect(listRunEventsAfter(database, queued, 0)).toEqual([]);

    const replay = [];
    for await (const event of streamPersistedRunEvents(database, broker, validating, 0)) {
      replay.push(event);
    }
    expect(replay.at(-1)?.type).toBe('run.failed');
  });

  function enqueue(clientMessageId: string): string {
    return enqueueConversationRun(database, {
      conversationId,
      ownerId: 'owner-recovery',
      request: messageRequest(clientMessageId),
    }).accepted.run.id;
  }

  function advanceToRunning(runId: string): void {
    store.append({
      runId,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'route.started',
      payload: {},
    });
    store.append({
      runId,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'plan.committed',
      payload: {
        plan: {
          route: 'FOCUSED',
          userFacingPlan: '检查知识库。',
          executionMode: 'SEQUENTIAL',
          tasks: [{ id: 'vault', label: '检查知识库', sourceKind: 'SANTEXWELL' }],
        },
      },
    });
  }
});

function messageRequest(clientMessageId: string): SendConversationMessageRequestV1 {
  return {
    clientMessageId,
    text: '恢复后还能重试吗？',
    sources: {
      workspaceFlows: false,
      workspaceDocuments: false,
      sessionAttachments: false,
      santexwell: true,
    },
    attachmentIds: [],
  };
}

function seedOwner(database: DatabaseSync): void {
  database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES ('owner-recovery', 'recovery@guide.local', 'not-used', '恢复用户', 'AUTHOR', ?)`,
  ).run('2026-07-15T00:00:00.000Z');
}

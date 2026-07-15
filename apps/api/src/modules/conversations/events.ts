import { AgentRunEventV1Schema, type AgentRunEventV1 } from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { getRunById } from './repository';

type AppendRunEventInput = AgentRunEventV1 extends infer Event
  ? Event extends AgentRunEventV1
    ? Omit<Event, 'id' | 'sequence' | 'createdAt' | 'stale'> & { stale?: boolean }
    : never
  : never;

type RunEventListener = (event: AgentRunEventV1) => void;

const TERMINAL_EVENT_TYPES = new Set<AgentRunEventV1['type']>([
  'run.completed', 'run.failed', 'run.cancelled',
]);
const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export class RunEventBroker {
  readonly #listeners = new Map<string, Set<RunEventListener>>();

  subscribe(runId: string, listener: RunEventListener): () => void {
    const listeners = this.#listeners.get(runId) ?? new Set<RunEventListener>();
    listeners.add(listener);
    this.#listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(runId);
    };
  }

  publish(event: AgentRunEventV1): void {
    for (const listener of this.#listeners.get(event.runId) ?? []) listener(event);
  }
}

export class AgentRunEventStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly broker: RunEventBroker,
  ) {}

  append(input: AppendRunEventInput): AgentRunEventV1 {
    const event = appendRunEvent(this.database, input);
    this.broker.publish(event);
    return event;
  }
}

export function appendRunEvent(
  database: DatabaseSync,
  input: AppendRunEventInput,
): AgentRunEventV1 {
  database.exec('BEGIN IMMEDIATE');
  try {
    const run = getRunById(database, input.runId);
    if (!run) throw new Error('运行不存在');
    if (TERMINAL_RUN_STATUSES.has(run.status)) throw new Error('终态运行不能追加事件');
    if (input.planVersion > run.plan_version) throw new Error('事件 planVersion 超前于运行');
    if (input.phase === 'COMMITTED' && input.planVersion !== run.plan_version) {
      throw new Error('正式事件必须属于当前计划版本');
    }
    const sequenceRow = database.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM agent_run_events WHERE run_id = ?',
    ).get(input.runId) as { next_sequence: number };
    const stale = input.phase === 'PROVISIONAL'
      && (input.stale === true || input.planVersion < run.plan_version);
    const event = AgentRunEventV1Schema.parse({
      ...input,
      id: randomUUID(),
      sequence: sequenceRow.next_sequence,
      createdAt: new Date().toISOString(),
      ...(input.phase === 'PROVISIONAL' && stale ? { stale: true } : {}),
    });
    database.prepare(
      `INSERT INTO agent_run_events (
        id, run_id, sequence, plan_version, phase, type, payload_json, stale, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.runId,
      event.sequence,
      event.planVersion,
      event.phase,
      event.type,
      JSON.stringify(event.payload),
      event.phase === 'PROVISIONAL' && event.stale ? 1 : 0,
      event.createdAt,
    );
    updateRunStateForEvent(database, event);
    database.exec('COMMIT');
    return event;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function listRunEventsAfter(
  database: DatabaseSync,
  runId: string,
  afterSequence: number,
): AgentRunEventV1[] {
  const rows = database.prepare(
    `SELECT id, run_id, sequence, plan_version, phase, type, payload_json, stale, created_at
     FROM agent_run_events
     WHERE run_id = ? AND sequence > ?
     ORDER BY sequence ASC`,
  ).all(runId, afterSequence) as unknown as Array<{
    id: string;
    run_id: string;
    sequence: number;
    plan_version: number;
    phase: 'PROVISIONAL' | 'COMMITTED';
    type: AgentRunEventV1['type'];
    payload_json: string;
    stale: number;
    created_at: string;
  }>;
  return rows.map((row) => AgentRunEventV1Schema.parse({
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    planVersion: row.plan_version,
    phase: row.phase,
    type: row.type,
    payload: JSON.parse(row.payload_json),
    ...(row.phase === 'PROVISIONAL' && row.stale === 1 ? { stale: true } : {}),
    createdAt: row.created_at,
  }));
}

export async function* streamPersistedRunEvents(
  database: DatabaseSync,
  broker: RunEventBroker,
  runId: string,
  afterSequence: number,
  signal?: AbortSignal,
): AsyncGenerator<AgentRunEventV1> {
  if (!Number.isInteger(afterSequence) || afterSequence < 0) throw new Error('事件 sequence 必须是非负整数');
  const queue = new AsyncEventQueue(signal);
  const unsubscribe = broker.subscribe(runId, (event) => queue.push(event));
  let lastSequence = afterSequence;
  try {
    const replay = listRunEventsAfter(database, runId, afterSequence);
    for (const event of replay) {
      if (event.sequence <= lastSequence) continue;
      lastSequence = event.sequence;
      yield event;
      if (TERMINAL_EVENT_TYPES.has(event.type)) return;
    }
    while (!signal?.aborted) {
      const event = await queue.shift();
      if (!event) return;
      if (event.sequence <= lastSequence) continue;
      lastSequence = event.sequence;
      yield event;
      if (TERMINAL_EVENT_TYPES.has(event.type)) return;
    }
  } finally {
    unsubscribe();
    queue.close();
  }
}

class AsyncEventQueue {
  readonly #items: AgentRunEventV1[] = [];
  readonly #waiters: Array<(event: AgentRunEventV1 | null) => void> = [];
  #closed = false;
  readonly #abortListener: (() => void) | null;

  constructor(private readonly signal?: AbortSignal) {
    this.#abortListener = signal ? () => this.close() : null;
    if (this.#abortListener) signal!.addEventListener('abort', this.#abortListener, { once: true });
    if (signal?.aborted) this.close();
  }

  push(event: AgentRunEventV1): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter(event);
    else this.#items.push(event);
  }

  async shift(): Promise<AgentRunEventV1 | null> {
    const item = this.#items.shift();
    if (item) return item;
    if (this.#closed) return null;
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#abortListener) this.signal?.removeEventListener('abort', this.#abortListener);
    for (const waiter of this.#waiters.splice(0)) waiter(null);
    this.#items.length = 0;
  }
}

function updateRunStateForEvent(database: DatabaseSync, event: AgentRunEventV1): void {
  const now = event.createdAt;
  if (event.type === 'route.started') {
    database.prepare(
      `UPDATE agent_runs SET status = 'ROUTING', started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE id = ?`,
    ).run(now, now, event.runId);
  } else if (event.type === 'plan.committed' || event.type === 'task.started') {
    database.prepare(
      `UPDATE agent_runs SET status = 'RUNNING', route = COALESCE(route, ?), updated_at = ?
       WHERE id = ?`,
    ).run(event.type === 'plan.committed' ? event.payload.plan.route : null, now, event.runId);
  } else if (event.type === 'answer.validating') {
    database.prepare(
      `UPDATE agent_runs SET status = 'VALIDATING', updated_at = ? WHERE id = ?`,
    ).run(now, event.runId);
  } else if (event.type === 'run.completed') {
    database.prepare(
      `UPDATE agent_runs SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, event.runId);
  } else if (event.type === 'run.cancelled') {
    database.prepare(
      `UPDATE agent_runs SET status = 'CANCELLED', cancelled_at = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(now, now, now, event.runId);
  } else if (event.type === 'run.failed') {
    database.prepare(
      `UPDATE agent_runs
       SET status = 'FAILED', error_code = ?, error_message = ?, error_retryable = ?,
           completed_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      event.payload.code,
      event.payload.message,
      event.payload.retryable ? 1 : 0,
      now,
      now,
      event.runId,
    );
  }
}

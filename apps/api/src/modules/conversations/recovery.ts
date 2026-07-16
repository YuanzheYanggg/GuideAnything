import type { DatabaseSync } from 'node:sqlite';

import { AgentRunEventStore, RunEventBroker } from './events';

const INTERRUPTED_RUN_STATUSES = ['ROUTING', 'RUNNING', 'VALIDATING'] as const;

export function recoverInterruptedAgentRuns(
  database: DatabaseSync,
  broker: RunEventBroker,
): number {
  const placeholders = INTERRUPTED_RUN_STATUSES.map(() => '?').join(', ');
  const runs = database.prepare(
    `SELECT id
     FROM agent_runs
     WHERE status IN (${placeholders})
     ORDER BY created_at, id`,
  ).all(...INTERRUPTED_RUN_STATUSES) as unknown as Array<{ id: string }>;
  const eventStore = new AgentRunEventStore(database, broker);
  for (const run of runs) {
    eventStore.appendFailure(run.id, {
      code: 'RUNTIME_RESTARTED',
      message: '服务重启中断了本次运行，请重新发送问题后重试。',
      retryable: true,
    });
  }
  return runs.length;
}

import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { migrateDatabase } from './db/migrate';
import { seedDatabase } from './db/seed';
import { upgradeWorkspaceV1 } from './db/workspace-upgrade';
import {
  createAgentRuntimeAssembly,
} from './modules/agents/assembly';
import { createDatabaseAgentKnowledgeAdapters } from './modules/agents/knowledge-adapters';
import { getTrustedSantexwellHarness } from './modules/agents/trusted-harness';
import { recoverInterruptedAgentRuns } from './modules/conversations/recovery';
import { reconcileGuideFlowSnapshots } from './modules/knowledge/flow-indexer';
import { createSantexwellVaultRefreshController } from './modules/knowledge/vault-indexer';

const config = loadConfig();
const database = createDatabase(config.databasePath);
migrateDatabase(database);
upgradeWorkspaceV1(database);
if (config.seedDemo) await seedDatabase(database);
try {
  reconcileGuideFlowSnapshots(database);
} catch {
  // Flow indexing is derived state; an indexing failure must not prevent API startup.
}
const agentRuntime = createAgentRuntimeAssembly({
  database,
  config,
  knowledgeAdapters: createDatabaseAgentKnowledgeAdapters({ database }),
  trustedSantexwellHarness: config.santexwellVaultPath
    ? () => getTrustedSantexwellHarness(config.santexwellVaultPath!)
    : () => null,
});
recoverInterruptedAgentRuns(database, agentRuntime.broker);

const app = await buildApp({
  database,
  jwtSecret: config.jwtSecret,
  webOrigin: config.webOrigin,
  logger: true,
  uploadDir: config.uploadDir,
  agentRuntime,
});
const vaultRefresh = config.santexwellVaultPath
  ? createSantexwellVaultRefreshController({
      database,
      root: config.santexwellVaultPath,
      timeoutMs: Math.min(config.runTimeoutMs, 300_000),
    })
  : null;

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let closePromise: Promise<void> | null = null;
const close = (): Promise<void> => {
  if (closePromise) return closePromise;
  closePromise = (async () => {
    if (reconcileTimer) {
      clearInterval(reconcileTimer);
      reconcileTimer = null;
    }
    const vaultClosing = vaultRefresh?.close() ?? Promise.resolve();
    const agentClosing = agentRuntime.close?.() ?? Promise.resolve();
    const appClosing = app.close();
    await Promise.allSettled([vaultClosing, agentClosing, appClosing]);
    database.close();
  })();
  return closePromise;
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

const refreshDerivedKnowledge = () => {
  if (closePromise) return;
  try {
    reconcileGuideFlowSnapshots(database);
  } catch {
    // The next interval retries derived flow indexing without affecting authoritative guide state.
  }
  void vaultRefresh?.refresh().catch(() => undefined);
};

await app.listen({ host: '127.0.0.1', port: config.port });

// A slow iCloud hydration or full Vault scan must not delay the health endpoint.
// The last good generation remains readable until this background refresh commits atomically.
refreshDerivedKnowledge();
void resumeQueuedRuns();
reconcileTimer = setInterval(refreshDerivedKnowledge, 5 * 60_000);
reconcileTimer.unref();

async function resumeQueuedRuns(): Promise<void> {
  const rows = database.prepare(
    `SELECT id FROM agent_runs WHERE status = 'QUEUED' ORDER BY created_at, id`,
  ).all() as unknown as Array<{ id: string }>;
  for (const row of rows) {
    try {
      await agentRuntime.scheduleRun(row.id);
    } catch {
      // The orchestrator persists a terminal failure whenever execution can start.
      // A still-queued run remains available for the explicit steer/retry recovery path.
    }
  }
}

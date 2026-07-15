import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { migrateDatabase } from './db/migrate';
import { seedDatabase } from './db/seed';
import { upgradeWorkspaceV1 } from './db/workspace-upgrade';
import {
  createAgentRuntimeAssembly,
  createUnavailableKnowledgeAdapters,
} from './modules/agents/assembly';
import { reconcileGuideFlowSnapshots } from './modules/knowledge/flow-indexer';
import { indexSantexwellVault } from './modules/knowledge/vault-indexer';

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
if (config.santexwellVaultPath) {
  try {
    await indexSantexwellVault(
      database,
      config.santexwellVaultPath,
      AbortSignal.timeout(Math.min(config.runTimeoutMs, 300_000)),
    );
  } catch {
    // The vault indexer reports bounded reason codes when possible; keep serving the last good index.
  }
}
const agentRuntime = createAgentRuntimeAssembly({
  database,
  config,
  knowledgeAdapters: createUnavailableKnowledgeAdapters(),
});

const app = await buildApp({
  database,
  jwtSecret: config.jwtSecret,
  webOrigin: config.webOrigin,
  logger: true,
  uploadDir: config.uploadDir,
  agentRuntime,
});

const close = async () => {
  clearInterval(reconcileTimer);
  await app.close();
  database.close();
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

const reconcileTimer = setInterval(() => {
  try {
    reconcileGuideFlowSnapshots(database);
  } catch {
    // The next interval retries derived flow indexing without affecting authoritative guide state.
  }
  if (config.santexwellVaultPath) {
    void indexSantexwellVault(
      database,
      config.santexwellVaultPath,
      AbortSignal.timeout(Math.min(config.runTimeoutMs, 300_000)),
    ).catch(() => undefined);
  }
}, 5 * 60_000);
reconcileTimer.unref();

await app.listen({ host: '127.0.0.1', port: config.port });

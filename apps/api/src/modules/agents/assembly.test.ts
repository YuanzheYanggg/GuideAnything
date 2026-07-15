import type { BridgeEventV1, BridgeRunRequestV1 } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import type { AppConfig } from '../../config';
import {
  createAgentRuntimeAssembly,
  createUnavailableKnowledgeAdapters,
} from './assembly';
import type { AgentRuntimeClient } from './runtime-client';

describe('agent production assembly', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  it('fails closed when production knowledge adapters were not explicitly provided', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    expect(() => createAgentRuntimeAssembly({
      database: database!,
      config: config(),
      runtime: new EmptyRuntime(),
    })).toThrow(/knowledge adapters/u);
  });

  it('assembles scheduling and control hooks with explicit fail-closed adapters', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    const assembly = createAgentRuntimeAssembly({
      database,
      config: config(),
      runtime: new EmptyRuntime(),
      knowledgeAdapters: createUnavailableKnowledgeAdapters(),
    });

    expect(assembly.broker).toBeDefined();
    expect(assembly.scheduleRun).toEqual(expect.any(Function));
    expect(assembly.cancelRun).toEqual(expect.any(Function));
    expect(assembly.steerRun).toEqual(expect.any(Function));
    expect(assembly.close).toEqual(expect.any(Function));
  });

  it('assembles the deterministic runtime only for explicit non-production fake mode', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    const fakeConfig = config();
    fakeConfig.runtimeMode = 'fake';
    fakeConfig.bridgeToken = null;

    expect(() => createAgentRuntimeAssembly({
      database: database!,
      config: fakeConfig,
      knowledgeAdapters: createUnavailableKnowledgeAdapters(),
    })).not.toThrow();
  });
});

class EmptyRuntime implements AgentRuntimeClient {
  async *run(_request: BridgeRunRequestV1): AsyncGenerator<BridgeEventV1> {}
  async cancel(): Promise<void> {}
  async steer(): Promise<void> {}
}

function config(): AppConfig {
  return {
    port: 3001,
    webOrigin: 'http://localhost:5173',
    databasePath: ':memory:',
    uploadDir: 'data/uploads',
    jwtSecret: 'test-secret-that-is-long-enough-1234',
    seedDemo: false,
    runtimeMode: 'bridge',
    santexwellVaultPath: null,
    bridgeUrl: 'http://127.0.0.1:3010/',
    bridgeToken: 'runtime-token-that-is-long-enough-1234',
    agentConcurrency: 3,
    routerTimeoutMs: 30_000,
    workerTimeoutMs: 90_000,
    reducerTimeoutMs: 90_000,
    runTimeoutMs: 240_000,
    modelRoles: {
      router: null,
      deepRouter: null,
      focusedWorker: null,
      deepWorker: null,
      reducer: null,
    },
  };
}

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRuntimeBridgeEnv } from './config';

const TOKEN = 'runtime-bridge-test-token-000000000000';

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    AGENT_BRIDGE_TOKEN: TOKEN,
    CODEX_RUNTIME_HOME: '/srv/guideanything/codex-home',
    CODEX_RUNTIME_WORK_DIR: '/srv/guideanything/empty-runtime-work',
    AGENT_MODEL_ROUTER: 'router-model',
    AGENT_MODEL_DEEP_ROUTER: 'deep-router-model',
    AGENT_MODEL_FOCUSED_WORKER: 'focused-model',
    AGENT_MODEL_DEEP_WORKER: 'deep-worker-model',
    AGENT_MODEL_REDUCER: 'reducer-model',
    ...overrides,
  };
}

describe('parseRuntimeBridgeEnv', () => {
  it('parses a localhost-only bounded configuration and semantic model roles', () => {
    const config = parseRuntimeBridgeEnv(validEnv({
      RUNTIME_BRIDGE_PORT: '4010',
      CODEX_BASELINE_INPUT_TOKEN_LIMIT: '12000',
      CODEX_TURN_TIMEOUT_MS: '45000',
    }), '/workspace');

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4010);
    expect(config.baselineInputTokenLimit).toBe(12_000);
    expect(config.turnTimeoutMs).toBe(45_000);
    expect(config.modelRoles.ROUTER).toBe('router-model');
    expect(config.runtimeHome).toBe('/srv/guideanything/codex-home');
  });

  it('resolves dedicated runtime paths without requiring them to exist', () => {
    const config = parseRuntimeBridgeEnv(validEnv({
      CODEX_RUNTIME_HOME: './runtime/home',
      CODEX_RUNTIME_WORK_DIR: './runtime/work',
      CODEX_RUNTIME_AUTH_FILE: './secrets/codex-auth.json',
    }), '/workspace');

    expect(config.runtimeHome).toBe(path.join('/workspace', 'runtime/home'));
    expect(config.runtimeWorkDir).toBe(path.join('/workspace', 'runtime/work'));
    expect(config.runtimeAuthFile).toBe(path.join('/workspace', 'secrets/codex-auth.json'));
  });

  it('keeps the bridge token out of generic serialization', () => {
    const config = parseRuntimeBridgeEnv(validEnv(), '/workspace');

    expect(config.bridgeToken).toBe(TOKEN);
    expect(JSON.stringify(config)).not.toContain(TOKEN);
  });

  it.each([
    [{ AGENT_BRIDGE_TOKEN: 'short' }, 'AGENT_BRIDGE_TOKEN'],
    [{ RUNTIME_BRIDGE_PORT: '0' }, 'RUNTIME_BRIDGE_PORT'],
    [{ RUNTIME_BRIDGE_PORT: '65536' }, 'RUNTIME_BRIDGE_PORT'],
    [{ RUNTIME_BRIDGE_HOST: '0.0.0.0' }, 'RUNTIME_BRIDGE_HOST'],
    [{ CODEX_BINARY: 'codex && env' }, 'CODEX_BINARY'],
    [{ CODEX_TURN_TIMEOUT_MS: '999' }, 'CODEX_TURN_TIMEOUT_MS'],
    [{ CODEX_BASELINE_INPUT_TOKEN_LIMIT: '100' }, 'CODEX_BASELINE_INPUT_TOKEN_LIMIT'],
  ])('rejects unsafe or out-of-bounds environment values: %s', (override, expected) => {
    expect(() => parseRuntimeBridgeEnv(validEnv(override), '/workspace')).toThrow(expected);
  });

  it('keeps unspecified model roles null instead of silently selecting a model', () => {
    const config = parseRuntimeBridgeEnv(validEnv({
      AGENT_MODEL_ROUTER: '',
      AGENT_MODEL_DEEP_ROUTER: undefined,
    }), '/workspace');

    expect(config.modelRoles.ROUTER).toBeNull();
    expect(config.modelRoles.DEEP_ROUTER).toBeNull();
  });
});

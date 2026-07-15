import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOCAL_AGENT_BRIDGE_TOKEN, parseConfig } from './config';

const root = '/tmp/guideanything-config-test';

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    AGENT_BRIDGE_TOKEN: 'test-agent-bridge-token-that-is-at-least-32-characters',
    ...overrides,
  };
}

describe('parseConfig', () => {
  it('parses defaults without requiring a local vault to exist', () => {
    const config = parseConfig(env({
      AGENT_BRIDGE_TOKEN: undefined,
      SANTEXWELL_VAULT_PATH: undefined,
    }), root);

    expect(config).toMatchObject({
      port: 3001,
      databasePath: resolve(root, 'data/guideanything.sqlite'),
      uploadDir: resolve(root, 'data/uploads'),
      runtimeMode: 'bridge',
      santexwellVaultPath: null,
      bridgeUrl: 'http://127.0.0.1:3010/',
      bridgeToken: LOCAL_AGENT_BRIDGE_TOKEN,
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
    });
  });

  it('resolves the configured vault path and preserves nullable semantic model roles', () => {
    const config = parseConfig(env({
      SANTEXWELL_VAULT_PATH: './fixtures/not-mounted-yet',
      AGENT_BRIDGE_URL: 'http://localhost:4010/',
      AGENT_MODEL_ROUTER: 'router-model',
      AGENT_MODEL_DEEP_ROUTER: '  ',
      AGENT_MODEL_FOCUSED_WORKER: 'focused-model',
      AGENT_MODEL_DEEP_WORKER: 'deep-model',
      AGENT_MODEL_REDUCER: 'reducer-model',
    }), root);

    expect(config.santexwellVaultPath).toBe(resolve(root, 'fixtures/not-mounted-yet'));
    expect(config.bridgeUrl).toBe('http://localhost:4010/');
    expect(config.modelRoles).toEqual({
      router: 'router-model',
      deepRouter: null,
      focusedWorker: 'focused-model',
      deepWorker: 'deep-model',
      reducer: 'reducer-model',
    });
  });

  it.each([
    'https://127.0.0.1:3010/',
    'http://192.168.1.8:3010/',
    'http://[::1]:3010/',
    'http://2130706433/',
    'http://127.1/',
    'http://127.0.1/',
    'http://localhost:0/',
    'http://localhost:65536/',
    'http://localhost/%2e%2e',
    'http://localhost/%2E%2E/',
    'http://localhost/a/../',
    'http://localhost//',
    'http://user:password@localhost:3010/',
    'http://localhost:3010/api',
    'http://localhost:3010/?token=secret',
    'http://localhost:3010/#health',
  ])('rejects unsafe bridge URL %s', (bridgeUrl) => {
    expect(() => parseConfig(env({ AGENT_BRIDGE_URL: bridgeUrl }), root))
      .toThrow(/AGENT_BRIDGE_URL/);
  });

  it.each([
    ['http://localhost', 'http://localhost/'],
    ['http://127.0.0.1/', 'http://127.0.0.1/'],
    ['http://localhost:1', 'http://localhost:1/'],
    ['http://127.0.0.1:65535/', 'http://127.0.0.1:65535/'],
  ])('accepts canonical local bridge URL %s', (bridgeUrl, expected) => {
    expect(parseConfig(env({ AGENT_BRIDGE_URL: bridgeUrl }), root).bridgeUrl).toBe(expected);
  });

  it.each([
    ['AGENT_MAX_CONCURRENCY', '0'],
    ['AGENT_MAX_CONCURRENCY', '4'],
    ['AGENT_MAX_CONCURRENCY', '1.5'],
    ['AGENT_ROUTER_TIMEOUT_MS', '99'],
    ['AGENT_WORKER_TIMEOUT_MS', '300001'],
    ['AGENT_REDUCER_TIMEOUT_MS', 'not-a-number'],
    ['AGENT_RUN_TIMEOUT_MS', '900001'],
  ])('rejects an out-of-range integer for %s', (name, value) => {
    expect(() => parseConfig(env({ [name]: value }), root)).toThrow(name);
  });

  it('requires the run timeout to cover every individual phase timeout', () => {
    expect(() => parseConfig(env({
      AGENT_WORKER_TIMEOUT_MS: '120000',
      AGENT_RUN_TIMEOUT_MS: '60000',
    }), root)).toThrow(/AGENT_RUN_TIMEOUT_MS/);
  });

  it('rejects a blank or short token in bridge mode', () => {
    expect(() => parseConfig(env({ AGENT_BRIDGE_TOKEN: '' }), root)).toThrow(/AGENT_BRIDGE_TOKEN/);
    expect(() => parseConfig(env({ AGENT_BRIDGE_TOKEN: 'short' }), root)).toThrow(/AGENT_BRIDGE_TOKEN/);
  });

  it('allows explicit fake mode without a token only outside production', () => {
    const config = parseConfig(env({
      AGENT_RUNTIME_MODE: 'fake',
      AGENT_BRIDGE_TOKEN: '',
    }), root);

    expect(config.runtimeMode).toBe('fake');
    expect(config.bridgeToken).toBeNull();
  });

  it('rejects fake mode and unsafe bridge tokens in production', () => {
    expect(() => parseConfig(env({
      NODE_ENV: 'production',
      AGENT_RUNTIME_MODE: 'fake',
      AGENT_BRIDGE_TOKEN: '',
    }), root)).toThrow(/fake/);
    expect(() => parseConfig(env({
      NODE_ENV: 'production',
      AGENT_BRIDGE_TOKEN: undefined,
    }), root)).toThrow(/AGENT_BRIDGE_TOKEN/);
    expect(() => parseConfig(env({
      NODE_ENV: 'production',
      AGENT_BRIDGE_TOKEN: LOCAL_AGENT_BRIDGE_TOKEN,
    }), root)).toThrow(/AGENT_BRIDGE_TOKEN/);

    expect(parseConfig(env({
      NODE_ENV: 'production',
      AGENT_BRIDGE_TOKEN: 'production-runtime-token-that-is-at-least-32-chars',
    }), root).runtimeMode).toBe('bridge');
  });
});

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  REQUIRED_DISABLED_FEATURES,
  buildCodexAppServerArgs,
  type PreparedCodexRuntime,
} from './codex-home';
import { parseRuntimeBridgeEnv } from './config';
import type { RpcChildTransport } from './json-rpc';
import {
  buildMinimalProcessEnvironment,
  launchCodexRuntime,
  probeCodexInstallation,
  type ExecFileFunction,
  type SpawnFunction,
} from './server';

class FakeCodexChild extends EventEmitter implements RpcChildTransport {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();

  constructor(home: string) {
    super();
    let buffer = '';
    this.stdin.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const request = JSON.parse(buffer.slice(0, newline)) as { id?: number; method: string };
        buffer = buffer.slice(newline + 1);
        if (request.method === 'initialize') {
          this.stdout.write(`${JSON.stringify({
            id: request.id,
            result: {
              userAgent: 'codex-cli/0.144.1', codexHome: home,
              platformFamily: 'unix', platformOs: 'macos',
            },
          })}\n`);
        } else if (request.method === 'model/list') {
          this.stdout.write(`${JSON.stringify({
            id: request.id,
            result: {
              data: [{
                id: 'catalog-gpt-test', model: 'gpt-test',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'medium', description: '' },
                  { reasoningEffort: 'high', description: '' },
                ],
              }],
              nextCursor: null,
            },
          })}\n`);
        }
        newline = buffer.indexOf('\n');
      }
    });
  }

  kill(): boolean {
    queueMicrotask(() => this.emit('exit', 0, 'SIGTERM'));
    return true;
  }
}

function config() {
  return parseRuntimeBridgeEnv({
    AGENT_BRIDGE_TOKEN: 'runtime-bridge-test-token-000000000000',
    CODEX_BINARY: '/opt/codex/bin/codex',
    CODEX_RUNTIME_HOME: '/runtime/home',
    CODEX_RUNTIME_WORK_DIR: '/runtime/work',
    AGENT_MODEL_ROUTER: 'gpt-test',
    AGENT_MODEL_DEEP_ROUTER: 'gpt-test',
    AGENT_MODEL_FOCUSED_WORKER: 'gpt-test',
    AGENT_MODEL_DEEP_WORKER: 'gpt-test',
    AGENT_MODEL_REDUCER: 'gpt-test',
  });
}

function prepared(): PreparedCodexRuntime {
  return {
    home: '/runtime/home',
    workDir: '/runtime/work',
    authPath: '/runtime/home/auth.json',
    configPath: '/runtime/home/config.toml',
    appServerArgs: buildCodexAppServerArgs(),
  };
}

function featureOutput(features: readonly string[] = REQUIRED_DISABLED_FEATURES): string {
  return features.map((feature) => `${feature.padEnd(32)} stable false`).join('\n');
}

describe('Codex process isolation', () => {
  it('passes only a bounded environment and always replaces inherited CODEX_HOME', () => {
    const environment = buildMinimalProcessEnvironment('/runtime/home', {
      PATH: '/usr/bin',
      LANG: 'zh_CN.UTF-8',
      HTTPS_PROXY: 'http://proxy.local',
      CODEX_HOME: '/personal/.codex',
      OPENAI_API_KEY: 'must-not-inherit',
      AGENT_BRIDGE_TOKEN: 'must-not-inherit',
      SECRET: 'must-not-inherit',
      HOME: '/personal',
    });

    expect(environment).toEqual({
      PATH: '/usr/bin',
      LANG: 'zh_CN.UTF-8',
      HTTPS_PROXY: 'http://proxy.local',
      CODEX_HOME: '/runtime/home',
    });
    expect(JSON.stringify(environment)).not.toContain('must-not-inherit');
    expect(JSON.stringify(environment)).not.toContain('/personal');
  });

  it('probes the installed version and exact feature names without a shell', async () => {
    const calls: { file: string; args: readonly string[]; options: unknown }[] = [];
    const execFile: ExecFileFunction = async (file, args, options) => {
      calls.push({ file, args, options });
      return args[0] === '--version'
        ? { stdout: 'codex-cli 0.144.1\n', stderr: '' }
        : { stdout: featureOutput(), stderr: '' };
    };

    const result = await probeCodexInstallation(config(), prepared(), execFile, { PATH: '/usr/bin' });

    expect(result).toEqual({ version: '0.144.1' });
    expect(calls.map(({ args }) => args)).toEqual([['features', 'list'], ['--version']]);
    expect(calls[0]?.options).toMatchObject({
      cwd: '/runtime/work',
      timeoutMs: 15_000,
      maxBufferBytes: 1_000_000,
      environment: { PATH: '/usr/bin', CODEX_HOME: '/runtime/home' },
    });
  });

  it('fails before spawn when any mandatory disable is unknown', async () => {
    const missing = REQUIRED_DISABLED_FEATURES.filter((feature) => feature !== 'plugins');
    const execFile: ExecFileFunction = async () => ({ stdout: featureOutput(missing), stderr: '' });

    await expect(probeCodexInstallation(config(), prepared(), execFile, {})).rejects.toMatchObject({
      code: 'CODEX_FEATURE_MISMATCH',
    });
  });

  it('spawns argv without shell composition and initializes one long-lived app-server client', async () => {
    const runtimeConfig = config();
    const runtimePrepared = prepared();
    const execFile: ExecFileFunction = async (_file, args) => (
      args[0] === '--version'
        ? { stdout: 'codex-cli 0.144.1\n', stderr: '' }
        : { stdout: featureOutput(), stderr: '' }
    );
    const child = new FakeCodexChild(runtimePrepared.home);
    const spawn = vi.fn<SpawnFunction>(() => child);

    const runtime = await launchCodexRuntime(
      runtimeConfig,
      runtimePrepared,
      { execFile, spawn, sourceEnvironment: { PATH: '/usr/bin', OPENAI_API_KEY: 'secret' } },
    );

    expect(runtime.getHealth().status).toBe('READY');
    expect(spawn).toHaveBeenCalledWith(
      '/opt/codex/bin/codex',
      runtimePrepared.appServerArgs,
      {
        cwd: '/runtime/work',
        environment: { PATH: '/usr/bin', CODEX_HOME: '/runtime/home' },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    expect(JSON.stringify(spawn.mock.calls)).not.toContain('secret');
    await runtime.close();
  });

  it('uses the prepared canonical paths when the configured directory passed through an OS alias', async () => {
    const runtimeConfig = config();
    const canonicalPrepared: PreparedCodexRuntime = {
      ...prepared(),
      home: '/canonical/runtime/home',
      workDir: '/canonical/runtime/work',
      authPath: '/canonical/runtime/home/auth.json',
      configPath: '/canonical/runtime/home/config.toml',
    };
    const execFile: ExecFileFunction = async (_file, args) => (
      args[0] === '--version'
        ? { stdout: 'codex-cli 0.144.1\n', stderr: '' }
        : { stdout: featureOutput(), stderr: '' }
    );
    const child = new FakeCodexChild(canonicalPrepared.home);

    const runtime = await launchCodexRuntime(runtimeConfig, canonicalPrepared, {
      execFile,
      spawn: () => child,
      sourceEnvironment: { PATH: '/usr/bin' },
    });

    expect(runtime.getHealth().status).toBe('READY');
    await runtime.close();
  });
});

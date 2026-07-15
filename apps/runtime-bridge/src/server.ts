import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createRuntimeBridgeApp } from './app';
import { CodexRuntime, CodexRuntimeError } from './codex-client';
import {
  assertRequiredFeaturesAvailable,
  parseCodexFeatureList,
  prepareCodexRuntime,
  type PreparedCodexRuntime,
} from './codex-home';
import {
  loadRuntimeBridgeConfig,
  type RuntimeBridgeConfig,
  type RuntimeBridgeEnvironment,
} from './config';
import { JsonRpcLineClient, type RpcChildTransport } from './json-rpc';

const PROCESS_ENV_ALLOWLIST = [
  'PATH',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
] as const;

export interface ExecFileOptions {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxBufferBytes: number;
}

export type ExecFileFunction = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export interface SpawnOptions {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly stdio: readonly ['pipe', 'pipe', 'pipe'];
}

export type SpawnFunction = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => RpcChildTransport;

export interface RuntimeProcessDependencies {
  readonly execFile?: ExecFileFunction;
  readonly spawn?: SpawnFunction;
  readonly sourceEnvironment?: RuntimeBridgeEnvironment;
}

export function buildMinimalProcessEnvironment(
  runtimeHome: string,
  source: RuntimeBridgeEnvironment,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const key of PROCESS_ENV_ALLOWLIST) {
    const value = source[key];
    if (value) environment[key] = value;
  }
  environment.CODEX_HOME = runtimeHome;
  return Object.freeze(environment);
}

export async function probeCodexInstallation(
  config: RuntimeBridgeConfig,
  prepared: PreparedCodexRuntime,
  execFile: ExecFileFunction = defaultExecFile,
  sourceEnvironment: RuntimeBridgeEnvironment = process.env,
): Promise<{ readonly version: string }> {
  const environment = buildMinimalProcessEnvironment(prepared.home, sourceEnvironment);
  const options: ExecFileOptions = {
    cwd: prepared.workDir,
    environment,
    timeoutMs: config.rpcTimeoutMs,
    maxBufferBytes: 1_000_000,
  };
  try {
    const featureResult = await execFile(config.codexBinary, ['features', 'list'], options);
    assertRequiredFeaturesAvailable(parseCodexFeatureList(featureResult.stdout));
    const versionResult = await execFile(config.codexBinary, ['--version'], options);
    const version = /\b(\d+\.\d+\.\d+)\b/u.exec(versionResult.stdout)?.[1];
    if (!version) throw new Error('invalid version');
    return Object.freeze({ version });
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    const code = error instanceof Error && error.message.startsWith('Codex does not expose')
      ? 'CODEX_FEATURE_MISMATCH'
      : 'CODEX_PROBE_FAILED';
    throw new CodexRuntimeError(code, false);
  }
}

export async function launchCodexRuntime(
  config: RuntimeBridgeConfig,
  prepared: PreparedCodexRuntime,
  dependencies: RuntimeProcessDependencies = {},
): Promise<CodexRuntime> {
  const execFile = dependencies.execFile ?? defaultExecFile;
  const spawn = dependencies.spawn ?? defaultSpawn;
  const sourceEnvironment = dependencies.sourceEnvironment ?? process.env;
  const probe = await probeCodexInstallation(config, prepared, execFile, sourceEnvironment);
  const environment = buildMinimalProcessEnvironment(prepared.home, sourceEnvironment);
  const child = spawn(config.codexBinary, prepared.appServerArgs, {
    cwd: prepared.workDir,
    environment,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rpc = new JsonRpcLineClient(child, {
    defaultTimeoutMs: config.rpcTimeoutMs,
    closeTimeoutMs: config.closeTimeoutMs,
    maxLineBytes: 2_000_000,
    maxStderrBytes: 32_768,
  });
  const runtime = new CodexRuntime(rpc, config, probe.version, {
    home: prepared.home,
    workDir: prepared.workDir,
  });
  try {
    await runtime.initialize();
    return runtime;
  } catch (error) {
    await rpc.close().catch(() => undefined);
    if (error instanceof CodexRuntimeError) throw error;
    throw new CodexRuntimeError('CODEX_INITIALIZE_FAILED', true);
  }
}

export async function startRuntimeBridgeService(config = loadRuntimeBridgeConfig()) {
  const prepared = await prepareCodexRuntime(config);
  const runtime = await launchCodexRuntime(config, prepared);
  const app = createRuntimeBridgeApp({ config, runtime });
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
  return { app, runtime };
}

const defaultExecFile: ExecFileFunction = async (file, args, options) => {
  return await new Promise((resolve, reject) => {
    nodeExecFile(file, [...args], {
      cwd: options.cwd,
      env: { ...options.environment },
      timeout: options.timeoutMs,
      maxBuffer: options.maxBufferBytes,
      encoding: 'utf8',
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
};

const defaultSpawn: SpawnFunction = (file, args, options) => {
  return nodeSpawn(file, [...args], {
    cwd: options.cwd,
    env: { ...options.environment },
    shell: options.shell,
    stdio: [...options.stdio],
    windowsHide: true,
  });
};

async function main(): Promise<void> {
  try {
    const { app, runtime } = await startRuntimeBridgeService();
    process.stdout.write('GuideAnything runtime bridge ready on 127.0.0.1\n');
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await app.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
    };
    process.once('SIGTERM', () => { void close(); });
    process.once('SIGINT', () => { void close(); });
  } catch (error) {
    const code = error instanceof CodexRuntimeError ? error.code : 'RUNTIME_START_FAILED';
    process.stderr.write(`GuideAnything runtime bridge failed: ${code}\n`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && pathToFileURL(path.resolve(entry)).href === import.meta.url) {
  void main();
}

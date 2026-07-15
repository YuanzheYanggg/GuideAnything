import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import type { BridgeModelRoleV1 } from '@guideanything/contracts';

const MODEL_ROLE_ENV: Readonly<Record<BridgeModelRoleV1, string>> = {
  ROUTER: 'AGENT_MODEL_ROUTER',
  DEEP_ROUTER: 'AGENT_MODEL_DEEP_ROUTER',
  FOCUSED_WORKER: 'AGENT_MODEL_FOCUSED_WORKER',
  DEEP_WORKER: 'AGENT_MODEL_DEEP_WORKER',
  REDUCER: 'AGENT_MODEL_REDUCER',
};

export const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));

export type RuntimeBridgeEnvironment = Readonly<Record<string, string | undefined>>;

export interface RuntimeBridgeConfig {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly bridgeToken: string;
  readonly codexBinary: string;
  readonly runtimeHome: string;
  readonly runtimeAuthFile: string | null;
  readonly runtimeWorkDir: string;
  readonly modelRoles: Readonly<Record<BridgeModelRoleV1, string | null>>;
  readonly baselineInputTokenLimit: number;
  readonly turnTimeoutMs: number;
  readonly rpcTimeoutMs: number;
  readonly closeTimeoutMs: number;
  readonly bodyLimitBytes: number;
  readonly maxConcurrency: number;
}

export function parseRuntimeBridgeEnv(
  environment: RuntimeBridgeEnvironment,
  cwd = process.cwd(),
): RuntimeBridgeConfig {
  const requestedHost = environment.RUNTIME_BRIDGE_HOST?.trim();
  if (requestedHost && requestedHost !== '127.0.0.1') {
    throw new Error('RUNTIME_BRIDGE_HOST must be 127.0.0.1');
  }

  const bridgeToken = requiredBoundedString(environment.AGENT_BRIDGE_TOKEN, 'AGENT_BRIDGE_TOKEN', 32, 512);
  const runtimeHome = resolveConfiguredPath(
    environment.CODEX_RUNTIME_HOME ?? './data/runtime-bridge/codex-home',
    'CODEX_RUNTIME_HOME',
    cwd,
  );
  const runtimeWorkDir = resolveConfiguredPath(
    environment.CODEX_RUNTIME_WORK_DIR ?? './data/runtime-bridge/empty-work',
    'CODEX_RUNTIME_WORK_DIR',
    cwd,
  );
  if (runtimeHome === runtimeWorkDir) {
    throw new Error('CODEX_RUNTIME_HOME and CODEX_RUNTIME_WORK_DIR must be different directories');
  }

  const authValue = environment.CODEX_RUNTIME_AUTH_FILE?.trim();
  const runtimeAuthFile = authValue
    ? resolveConfiguredPath(authValue, 'CODEX_RUNTIME_AUTH_FILE', cwd)
    : null;
  const modelRoles = Object.fromEntries(
    Object.entries(MODEL_ROLE_ENV).map(([role, variable]) => [
      role,
      optionalBoundedString(environment[variable], variable, 200),
    ]),
  ) as Record<BridgeModelRoleV1, string | null>;

  const publicConfig = {
    host: '127.0.0.1' as const,
    port: boundedInteger(environment.RUNTIME_BRIDGE_PORT, 'RUNTIME_BRIDGE_PORT', 1, 65_535, 3_010),
    codexBinary: parseCodexBinary(environment.CODEX_BINARY),
    runtimeHome,
    runtimeAuthFile,
    runtimeWorkDir,
    modelRoles: Object.freeze(modelRoles),
    baselineInputTokenLimit: boundedInteger(
      environment.CODEX_BASELINE_INPUT_TOKEN_LIMIT,
      'CODEX_BASELINE_INPUT_TOKEN_LIMIT',
      1_000,
      1_000_000,
      100_000,
    ),
    turnTimeoutMs: boundedInteger(
      environment.CODEX_TURN_TIMEOUT_MS,
      'CODEX_TURN_TIMEOUT_MS',
      1_000,
      600_000,
      120_000,
    ),
    rpcTimeoutMs: boundedInteger(
      environment.CODEX_RPC_TIMEOUT_MS,
      'CODEX_RPC_TIMEOUT_MS',
      500,
      60_000,
      15_000,
    ),
    closeTimeoutMs: boundedInteger(
      environment.CODEX_CLOSE_TIMEOUT_MS,
      'CODEX_CLOSE_TIMEOUT_MS',
      100,
      10_000,
      2_000,
    ),
    bodyLimitBytes: boundedInteger(
      environment.RUNTIME_BRIDGE_BODY_LIMIT_BYTES,
      'RUNTIME_BRIDGE_BODY_LIMIT_BYTES',
      1_024,
      1_048_576,
      600_000,
    ),
    maxConcurrency: boundedInteger(
      environment.RUNTIME_BRIDGE_MAX_CONCURRENCY,
      'RUNTIME_BRIDGE_MAX_CONCURRENCY',
      1,
      3,
      3,
    ),
  };

  const config = publicConfig as RuntimeBridgeConfig;
  Object.defineProperty(config, 'bridgeToken', {
    value: bridgeToken,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(config);
}

export function loadRuntimeBridgeConfig(): RuntimeBridgeConfig {
  const envPath = path.resolve(projectRoot, '.env');
  if (existsSync(envPath)) loadEnvFile(envPath);
  return parseRuntimeBridgeEnv(process.env, projectRoot);
}

function parseCodexBinary(value: string | undefined): string {
  const binary = value?.trim() || 'codex';
  if (binary.length > 4_096 || binary.includes('\0')) {
    throw new Error('CODEX_BINARY is invalid');
  }
  if (path.isAbsolute(binary)) return path.normalize(binary);
  if (!/^[A-Za-z0-9._-]{1,256}$/.test(binary)) {
    throw new Error('CODEX_BINARY must be an absolute path or a safe executable basename');
  }
  return binary;
}

function resolveConfiguredPath(value: string, name: string, cwd: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4_096 || trimmed.includes('\0')) {
    throw new Error(`${name} must be a bounded filesystem path`);
  }
  return path.resolve(cwd, trimmed);
}

function requiredBoundedString(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
): string {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length < min || trimmed.length > max) {
    throw new Error(`${name} must contain between ${min} and ${max} characters`);
  }
  return trimmed;
}

function optionalBoundedString(value: string | undefined, name: string, max: number): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.length > max) throw new Error(`${name} must contain at most ${max} characters`);
  return trimmed;
}

function boundedInteger(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = value === undefined || value.trim() === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

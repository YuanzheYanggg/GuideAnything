import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
export const LOCAL_AGENT_BRIDGE_TOKEN = 'guideanything-local-runtime-token-change-me';

export interface AgentModelRoles {
  router: string | null;
  deepRouter: string | null;
  focusedWorker: string | null;
  deepWorker: string | null;
  reducer: string | null;
}

export interface AppConfig {
  port: number;
  webOrigin: string;
  databasePath: string;
  uploadDir: string;
  jwtSecret: string;
  seedDemo: boolean;
  runtimeMode: 'bridge' | 'fake';
  santexwellVaultPath: string | null;
  bridgeUrl: string;
  bridgeToken: string | null;
  agentConcurrency: number;
  routerTimeoutMs: number;
  workerTimeoutMs: number;
  reducerTimeoutMs: number;
  runTimeoutMs: number;
  modelRoles: AgentModelRoles;
}

export function parseConfig(env: NodeJS.ProcessEnv, root: string): AppConfig {
  const port = parseBoundedInteger(env.API_PORT, 3001, 'API_PORT', 1, 65_535);
  const runtimeMode = parseRuntimeMode(env.AGENT_RUNTIME_MODE);
  const bridgeUrl = parseBridgeUrl(env.AGENT_BRIDGE_URL ?? 'http://127.0.0.1:3010');
  const agentConcurrency = parseBoundedInteger(
    env.AGENT_MAX_CONCURRENCY,
    3,
    'AGENT_MAX_CONCURRENCY',
    1,
    3,
  );
  const routerTimeoutMs = parseBoundedInteger(
    env.AGENT_ROUTER_TIMEOUT_MS,
    30_000,
    'AGENT_ROUTER_TIMEOUT_MS',
    100,
    300_000,
  );
  const workerTimeoutMs = parseBoundedInteger(
    env.AGENT_WORKER_TIMEOUT_MS,
    90_000,
    'AGENT_WORKER_TIMEOUT_MS',
    100,
    300_000,
  );
  const reducerTimeoutMs = parseBoundedInteger(
    env.AGENT_REDUCER_TIMEOUT_MS,
    90_000,
    'AGENT_REDUCER_TIMEOUT_MS',
    100,
    300_000,
  );
  const runTimeoutMs = parseBoundedInteger(
    env.AGENT_RUN_TIMEOUT_MS,
    240_000,
    'AGENT_RUN_TIMEOUT_MS',
    1_000,
    900_000,
  );
  if (runTimeoutMs < Math.max(routerTimeoutMs, workerTimeoutMs, reducerTimeoutMs)) {
    throw new Error('AGENT_RUN_TIMEOUT_MS must be at least every individual phase timeout');
  }

  const isProduction = env.NODE_ENV === 'production';
  if (isProduction && runtimeMode === 'fake') {
    throw new Error('AGENT_RUNTIME_MODE=fake is not allowed in production');
  }
  const bridgeToken = parseBridgeToken(env.AGENT_BRIDGE_TOKEN, runtimeMode, isProduction);

  return {
    port,
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    databasePath: resolve(root, env.DATABASE_PATH ?? 'data/guideanything.sqlite'),
    uploadDir: resolve(root, env.UPLOAD_DIR ?? 'data/uploads'),
    jwtSecret: env.JWT_SECRET ?? 'guideanything-local-development-secret-change-me',
    seedDemo: env.SEED_DEMO !== 'false',
    runtimeMode,
    santexwellVaultPath: resolveOptionalPath(env.SANTEXWELL_VAULT_PATH, root),
    bridgeUrl,
    bridgeToken,
    agentConcurrency,
    routerTimeoutMs,
    workerTimeoutMs,
    reducerTimeoutMs,
    runTimeoutMs,
    modelRoles: {
      router: parseOptionalModel(env.AGENT_MODEL_ROUTER, 'AGENT_MODEL_ROUTER'),
      deepRouter: parseOptionalModel(env.AGENT_MODEL_DEEP_ROUTER, 'AGENT_MODEL_DEEP_ROUTER'),
      focusedWorker: parseOptionalModel(env.AGENT_MODEL_FOCUSED_WORKER, 'AGENT_MODEL_FOCUSED_WORKER'),
      deepWorker: parseOptionalModel(env.AGENT_MODEL_DEEP_WORKER, 'AGENT_MODEL_DEEP_WORKER'),
      reducer: parseOptionalModel(env.AGENT_MODEL_REDUCER, 'AGENT_MODEL_REDUCER'),
    },
  };
}

export function loadConfig(): AppConfig {
  const envPath = resolve(projectRoot, '.env');
  if (existsSync(envPath)) loadEnvFile(envPath);
  return parseConfig(process.env, projectRoot);
}

function parseRuntimeMode(value: string | undefined): AppConfig['runtimeMode'] {
  const mode = value ?? 'bridge';
  if (mode !== 'bridge' && mode !== 'fake') {
    throw new Error('AGENT_RUNTIME_MODE must be bridge or fake');
  }
  return mode;
}

function parseBridgeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AGENT_BRIDGE_URL must be a valid localhost HTTP URL');
  }
  if (
    url.protocol !== 'http:'
    || (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')
    || url.username !== ''
    || url.password !== ''
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new Error('AGENT_BRIDGE_URL must be a root-path http://localhost or http://127.0.0.1 URL without credentials, query, or fragment');
  }
  return url.toString();
}

function parseBridgeToken(
  rawValue: string | undefined,
  runtimeMode: AppConfig['runtimeMode'],
  isProduction: boolean,
): string | null {
  if (runtimeMode === 'fake' && !isProduction && (rawValue === undefined || rawValue.trim() === '')) {
    return null;
  }
  const token = rawValue === undefined ? LOCAL_AGENT_BRIDGE_TOKEN : rawValue.trim();
  if (token.length < 32 || (isProduction && token === LOCAL_AGENT_BRIDGE_TOKEN)) {
    throw new Error('AGENT_BRIDGE_TOKEN must be a non-sentinel token with at least 32 characters');
  }
  return token;
}

function parseBoundedInteger(
  rawValue: string | undefined,
  defaultValue: number,
  name: string,
  min: number,
  max: number,
): number {
  const value = rawValue === undefined ? defaultValue : Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function resolveOptionalPath(value: string | undefined, root: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? resolve(root, trimmed) : null;
}

function parseOptionalModel(value: string | undefined, name: string): string | null {
  const model = value?.trim();
  if (!model) return null;
  if (model.length > 200) throw new Error(`${name} must not exceed 200 characters`);
  return model;
}

import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';

import type { RuntimeBridgeConfig } from './config';

export const MINIMAL_CODEX_CONFIG = [
  'web_search = "disabled"',
  'personality = "none"',
  'approval_policy = "never"',
  'sandbox_mode = "read-only"',
  'model_reasoning_summary = "none"',
  '',
  '[analytics]',
  'enabled = false',
  '',
].join('\n');

export const REQUIRED_DISABLED_FEATURES = Object.freeze([
  'plugins',
  'remote_plugin',
  'plugin_sharing',
  'apps',
  'enable_mcp_apps',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'in_app_browser',
  'computer_use',
  'image_generation',
  'hooks',
  'goals',
  'shell_tool',
  'shell_snapshot',
  'shell_zsh_fork',
  'unified_exec',
  'unified_exec_zsh_fork',
  'workspace_dependencies',
  'multi_agent',
  'multi_agent_v2',
  'enable_fanout',
  'deferred_executor',
  'tool_suggest',
  'skill_mcp_dependency_install',
  'memories',
  'standalone_web_search',
  'network_proxy',
  'respect_system_proxy',
  'auth_elicitation',
  'tool_call_mcp_elicitation',
  'request_permissions_tool',
  'guardian_approval',
  'code_mode',
  'code_mode_host',
  'code_mode_only',
  'artifact',
  'current_time_reminder',
  'default_mode_request_user_input',
  'realtime_conversation',
  'terminal_visualization_instructions',
  'use_agent_identity',
] as const);

const FORBIDDEN_HOME_ENTRIES = new Set([
  'agents.md',
  'skills',
  'plugins',
  'hooks',
  'mcp',
  'mcp_servers',
  'memories',
  'rules',
  '.agents',
  '.codex-plugin',
]);

export interface PreparedCodexRuntime {
  readonly home: string;
  readonly workDir: string;
  readonly authPath: string;
  readonly configPath: string;
  readonly appServerArgs: readonly string[];
}

export async function prepareCodexRuntime(config: RuntimeBridgeConfig): Promise<PreparedCodexRuntime> {
  await ensurePrivateDirectory(config.runtimeHome, 'CODEX_RUNTIME_HOME');
  await ensureEmptyPrivateDirectory(config.runtimeWorkDir);
  const home = await realpath(config.runtimeHome);
  const workDir = await realpath(config.runtimeWorkDir);
  await purgeGeneratedSystemSkills(home);
  await rejectForbiddenHomeEntries(home);

  const configPath = path.join(home, 'config.toml');
  await installExactConfig(configPath);
  const authPath = path.join(home, 'auth.json');
  await ensureRuntimeAuth(authPath, config.runtimeAuthFile);

  return Object.freeze({
    home,
    workDir,
    authPath,
    configPath,
    appServerArgs: buildCodexAppServerArgs(),
  });
}

export function buildCodexAppServerArgs(): readonly string[] {
  return Object.freeze([
    'app-server',
    '--strict-config',
    ...REQUIRED_DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    '--stdio',
  ]);
}

export function parseCodexFeatureList(output: string): Set<string> {
  const features = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([a-z][a-z0-9_]*)\s+/u.exec(line.trim());
    if (match) features.add(match[1]!);
  }
  return features;
}

export function assertRequiredFeaturesAvailable(features: ReadonlySet<string>): void {
  const missing = REQUIRED_DISABLED_FEATURES.filter((feature) => !features.has(feature));
  if (missing.length > 0) {
    throw new Error(`Codex does not expose required disable flags: ${missing.join(', ')}`);
  }
}

async function ensurePrivateDirectory(directory: string, label: string): Promise<void> {
  const existing = await lstatIfExists(directory);
  if (existing?.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
  if (existing && !existing.isDirectory()) throw new Error(`${label} must be a directory`);
  if (!existing) await mkdir(directory, { recursive: true, mode: 0o700 });
  const created = await lstat(directory);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new Error(`${label} must be a private directory, not a symbolic link`);
  }
  await chmod(directory, 0o700);
}

async function ensureEmptyPrivateDirectory(directory: string): Promise<void> {
  await ensurePrivateDirectory(directory, 'CODEX_RUNTIME_WORK_DIR');
  const entries = await readdir(directory);
  if (entries.length > 0) throw new Error('CODEX_RUNTIME_WORK_DIR must be empty');
}

async function rejectForbiddenHomeEntries(home: string): Promise<void> {
  const entries = await readdir(home);
  const forbidden = entries.find((entry) =>
    FORBIDDEN_HOME_ENTRIES.has(entry.toLowerCase())
    || entry.startsWith('.runtime-skills-purge-'));
  if (forbidden) throw new Error(`CODEX_RUNTIME_HOME contains forbidden personal entry: ${forbidden}`);
}

async function purgeGeneratedSystemSkills(home: string): Promise<void> {
  const skillsRoot = path.join(home, 'skills');
  const skills = await lstatIfExists(skillsRoot);
  if (!skills || skills.isSymbolicLink() || !skills.isDirectory()) return;
  const entries = await readdir(skillsRoot);
  if (entries.length !== 1 || entries[0] !== '.system') return;

  const systemRoot = path.join(skillsRoot, '.system');
  const system = await lstatIfExists(systemRoot);
  const marker = await lstatIfExists(path.join(systemRoot, '.codex-system-skills.marker'));
  if (
    !system
    || system.isSymbolicLink()
    || !system.isDirectory()
    || !marker
    || marker.isSymbolicLink()
    || !marker.isFile()
  ) return;

  const quarantine = path.join(home, `.runtime-skills-purge-${randomUUID()}`);
  await rename(skillsRoot, quarantine);
  await rm(quarantine, { recursive: true, force: true });
}

async function installExactConfig(target: string): Promise<void> {
  const existing = await lstatIfExists(target);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error('config.toml must be the bridge-managed regular file');
    }
    const contents = await readFile(target, 'utf8');
    if (contents !== MINIMAL_CODEX_CONFIG) {
      throw new Error('config.toml is not the bridge-managed minimal configuration');
    }
    await chmod(target, 0o600);
    return;
  }
  await atomicWritePrivateFile(target, MINIMAL_CODEX_CONFIG);
}

async function ensureRuntimeAuth(target: string, explicitSource: string | null): Promise<void> {
  if (explicitSource) {
    const source = await lstatIfExists(explicitSource);
    if (!source || source.isSymbolicLink() || !source.isFile()) {
      throw new Error('CODEX_RUNTIME_AUTH_FILE must be an existing regular auth file');
    }
  }

  const existing = await lstatIfExists(target);
  if (existing) {
    if (explicitSource) {
      if (!existing.isSymbolicLink() || path.resolve(await readlink(target)) !== explicitSource) {
        throw new Error('runtime auth.json does not link to CODEX_RUNTIME_AUTH_FILE');
      }
    } else if (!existing.isFile() && !existing.isSymbolicLink()) {
      throw new Error('pre-provisioned runtime auth.json must be a file');
    }
    return;
  }

  if (!explicitSource) {
    throw new Error('runtime auth is missing; provide CODEX_RUNTIME_AUTH_FILE or pre-provision auth.json');
  }

  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await symlink(explicitSource, temporary);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function atomicWritePrivateFile(target: string, contents: string): Promise<void> {
  const temporary = `${target}.tmp-${randomUUID()}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function lstatIfExists(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

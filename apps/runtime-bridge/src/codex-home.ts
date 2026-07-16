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

import type { RuntimeBridgeConfig, RuntimeBridgeEnvironment } from './config';

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
const RUNTIME_HOME_MARKER = '.guideanything-runtime-home';
const RUNTIME_HOME_MARKER_CONTENT = 'guideanything-runtime-home:v1\n';

export interface PreparedCodexRuntime {
  readonly home: string;
  readonly workDir: string;
  readonly authPath: string;
  readonly configPath: string;
  readonly appServerArgs: readonly string[];
}

export async function prepareCodexRuntime(
  config: RuntimeBridgeConfig,
  sourceEnvironment: RuntimeBridgeEnvironment = process.env,
): Promise<PreparedCodexRuntime> {
  const home = await ensureManagedRuntimeHome(
    config.runtimeHome,
    config.runtimeAuthFile,
    sourceEnvironment,
  );
  await ensureEmptyPrivateDirectory(config.runtimeWorkDir);
  const workDir = await realpath(config.runtimeWorkDir);
  await validateManagedRuntimeBeforePurge(home, config.runtimeAuthFile);
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

async function ensureManagedRuntimeHome(
  directory: string,
  explicitAuthSource: string | null,
  sourceEnvironment: RuntimeBridgeEnvironment,
): Promise<string> {
  await rejectPersonalRuntimeHome(directory, sourceEnvironment);
  const existing = await lstatIfExists(directory);
  if (existing?.isSymbolicLink()) throw new Error('CODEX_RUNTIME_HOME must not be a symbolic link');
  if (existing && !existing.isDirectory()) throw new Error('CODEX_RUNTIME_HOME must be a directory');
  if (!existing) await mkdir(directory, { recursive: true, mode: 0o700 });

  const created = await lstat(directory);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new Error('CODEX_RUNTIME_HOME must be a private directory, not a symbolic link');
  }
  const home = await realpath(directory);
  const markerPath = path.join(home, RUNTIME_HOME_MARKER);
  const marker = await lstatIfExists(markerPath);
  if (!marker) {
    const entries = await readdir(home);
    const claimable = entries.length === 0
      || await isClaimableAuthOnlyHome(home, entries, explicitAuthSource)
      || await isLegacyManagedRuntimeHome(home, entries, explicitAuthSource);
    if (!claimable) {
      throw new Error(`CODEX_RUNTIME_HOME is not managed by the runtime bridge: ${entries.sort()[0] ?? 'unknown entry'}`);
    }
    await atomicWritePrivateFile(markerPath, RUNTIME_HOME_MARKER_CONTENT);
  } else {
    if (marker.isSymbolicLink() || !marker.isFile()) {
      throw new Error('CODEX_RUNTIME_HOME ownership marker is invalid');
    }
    if (await readFile(markerPath, 'utf8') !== RUNTIME_HOME_MARKER_CONTENT) {
      throw new Error('CODEX_RUNTIME_HOME ownership marker is invalid');
    }
  }
  await chmod(home, 0o700);
  return home;
}

async function rejectPersonalRuntimeHome(
  directory: string,
  sourceEnvironment: RuntimeBridgeEnvironment,
): Promise<void> {
  const candidate = await canonicalPathIdentity(directory);
  const personalHome = sourceEnvironment.HOME?.trim();
  if (
    personalHome
    && candidate === await canonicalPathIdentity(path.join(personalHome, '.codex'))
  ) {
    throw new Error('CODEX_RUNTIME_HOME must not use the personal CODEX_HOME at ~/.codex');
  }

  const inheritedCodexHome = sourceEnvironment.CODEX_HOME?.trim();
  if (
    inheritedCodexHome
    && candidate === await canonicalPathIdentity(inheritedCodexHome)
  ) {
    throw new Error('CODEX_RUNTIME_HOME must not reuse the inherited CODEX_HOME');
  }
}

async function canonicalPathIdentity(target: string): Promise<string> {
  let existingAncestor = path.resolve(target);
  const missingSegments: string[] = [];
  while (true) {
    try {
      return path.join(await realpath(existingAncestor), ...missingSegments);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) return path.resolve(target);
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
}

async function isClaimableAuthOnlyHome(
  home: string,
  entries: readonly string[],
  explicitAuthSource: string | null,
): Promise<boolean> {
  if (entries.length !== 1 || entries[0] !== 'auth.json') return false;
  try {
    await validateExistingRuntimeAuth(path.join(home, 'auth.json'), explicitAuthSource);
    return true;
  } catch {
    return false;
  }
}

async function isLegacyManagedRuntimeHome(
  home: string,
  entries: readonly string[],
  explicitAuthSource: string | null,
): Promise<boolean> {
  if (!entries.includes('config.toml') || !entries.includes('auth.json')) return false;
  if (entries.some((entry) => entry !== 'skills' && FORBIDDEN_HOME_ENTRIES.has(entry.toLowerCase()))) {
    return false;
  }
  try {
    await validateExactConfig(path.join(home, 'config.toml'));
    await validateExistingRuntimeAuth(path.join(home, 'auth.json'), explicitAuthSource);
  } catch {
    return false;
  }
  return !entries.includes('skills') || await isGeneratedSystemSkillsTree(path.join(home, 'skills'));
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

async function validateManagedRuntimeBeforePurge(home: string, explicitAuthSource: string | null): Promise<void> {
  if (!await lstatIfExists(path.join(home, 'skills'))) return;
  await validateExactConfig(path.join(home, 'config.toml'));
  await validateExistingRuntimeAuth(path.join(home, 'auth.json'), explicitAuthSource);
}

async function purgeGeneratedSystemSkills(home: string): Promise<void> {
  const skillsRoot = path.join(home, 'skills');
  if (!await isGeneratedSystemSkillsTree(skillsRoot)) return;

  const quarantine = path.join(home, `.runtime-skills-purge-${randomUUID()}`);
  await rename(skillsRoot, quarantine);
  if (!await isGeneratedSystemSkillsTree(quarantine)) {
    await rename(quarantine, skillsRoot).catch(() => undefined);
    throw new Error('generated system skills changed during restart validation');
  }
  await rm(quarantine, { recursive: true, force: true });
}

async function isGeneratedSystemSkillsTree(skillsRoot: string): Promise<boolean> {
  const skills = await lstatIfExists(skillsRoot);
  if (!skills || skills.isSymbolicLink() || !skills.isDirectory()) return false;
  const entries = await readdir(skillsRoot);
  if (entries.length !== 1 || entries[0] !== '.system') return false;

  const systemRoot = path.join(skillsRoot, '.system');
  const system = await lstatIfExists(systemRoot);
  const marker = await lstatIfExists(path.join(systemRoot, '.codex-system-skills.marker'));
  return Boolean(
    system
    && !system.isSymbolicLink()
    && system.isDirectory()
    && marker
    && !marker.isSymbolicLink()
    && marker.isFile(),
  );
}

async function installExactConfig(target: string): Promise<void> {
  const existing = await lstatIfExists(target);
  if (existing) {
    await validateExactConfig(target);
    await chmod(target, 0o600);
    return;
  }
  await atomicWritePrivateFile(target, MINIMAL_CODEX_CONFIG);
}

async function validateExactConfig(target: string): Promise<void> {
  const existing = await lstatIfExists(target);
  if (!existing || existing.isSymbolicLink() || !existing.isFile()) {
    throw new Error('config.toml must be the bridge-managed regular file');
  }
  const contents = await readFile(target, 'utf8');
  if (contents !== MINIMAL_CODEX_CONFIG) {
    throw new Error('config.toml is not the bridge-managed minimal configuration');
  }
}

async function ensureRuntimeAuth(target: string, explicitSource: string | null): Promise<void> {
  await validateExplicitAuthSource(explicitSource);

  const existing = await lstatIfExists(target);
  if (existing) {
    await validateExistingRuntimeAuth(target, explicitSource);
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

async function validateExplicitAuthSource(explicitSource: string | null): Promise<void> {
  if (!explicitSource) return;
  const source = await lstatIfExists(explicitSource);
  if (!source || source.isSymbolicLink() || !source.isFile()) {
    throw new Error('CODEX_RUNTIME_AUTH_FILE must be an existing regular auth file');
  }
}

async function validateExistingRuntimeAuth(target: string, explicitSource: string | null): Promise<void> {
  await validateExplicitAuthSource(explicitSource);
  const existing = await lstatIfExists(target);
  if (!existing) throw new Error('runtime auth.json is missing');
  if (explicitSource) {
    const link = existing.isSymbolicLink() ? await readlink(target) : null;
    const resolvedLink = link === null ? null : path.resolve(path.dirname(target), link);
    if (resolvedLink !== explicitSource) {
      throw new Error('runtime auth.json does not link to CODEX_RUNTIME_AUTH_FILE');
    }
    return;
  }
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new Error('pre-provisioned runtime auth.json must be a regular file');
  }
}

async function isRegularFile(target: string): Promise<boolean> {
  const entry = await lstatIfExists(target);
  return Boolean(entry && !entry.isSymbolicLink() && entry.isFile());
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

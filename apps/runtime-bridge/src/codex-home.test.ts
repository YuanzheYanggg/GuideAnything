import { lstat, mkdtemp, mkdir, readFile, readlink, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseRuntimeBridgeEnv } from './config';
import {
  MINIMAL_CODEX_CONFIG,
  REQUIRED_DISABLED_FEATURES,
  assertRequiredFeaturesAvailable,
  buildCodexAppServerArgs,
  parseCodexFeatureList,
  prepareCodexRuntime,
} from './codex-home';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }));
  }));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guideanything-runtime-home-'));
  roots.push(root);
  const auth = path.join(root, 'operator-auth.json');
  await writeFile(auth, 'opaque-auth-do-not-copy', { mode: 0o600 });
  const config = parseRuntimeBridgeEnv({
    AGENT_BRIDGE_TOKEN: 'runtime-bridge-test-token-000000000000',
    CODEX_RUNTIME_HOME: path.join(root, 'home'),
    CODEX_RUNTIME_WORK_DIR: path.join(root, 'work'),
    CODEX_RUNTIME_AUTH_FILE: auth,
  });
  return { root, auth, config };
}

describe('dedicated Codex runtime home', () => {
  it('refuses to claim the canonical personal ~/.codex through a parent path alias', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'guideanything-personal-home-'));
    roots.push(root);
    const personalHome = path.join(root, 'personal');
    const personalCodexHome = path.join(personalHome, '.codex');
    const alias = path.join(root, 'personal-alias');
    await mkdir(personalCodexHome, { recursive: true });
    await writeFile(path.join(personalCodexHome, 'auth.json'), 'personal-auth', { mode: 0o600 });
    await symlink(personalHome, alias, 'dir');
    const config = parseRuntimeBridgeEnv({
      AGENT_BRIDGE_TOKEN: 'runtime-bridge-test-token-000000000000',
      CODEX_RUNTIME_HOME: path.join(alias, '.codex'),
      CODEX_RUNTIME_WORK_DIR: path.join(root, 'work'),
    });

    await expect(prepareCodexRuntime(config, { HOME: personalHome }))
      .rejects.toThrow(/personal.*CODEX_HOME|CODEX_HOME.*personal/u);
    await expect(lstat(path.join(personalCodexHome, '.guideanything-runtime-home')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to claim an inherited CODEX_HOME even when it contains only auth', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'guideanything-inherited-home-'));
    roots.push(root);
    const inheritedHome = path.join(root, 'inherited-codex-home');
    await mkdir(inheritedHome);
    await writeFile(path.join(inheritedHome, 'auth.json'), 'personal-auth', { mode: 0o600 });
    const config = parseRuntimeBridgeEnv({
      AGENT_BRIDGE_TOKEN: 'runtime-bridge-test-token-000000000000',
      CODEX_RUNTIME_HOME: inheritedHome,
      CODEX_RUNTIME_WORK_DIR: path.join(root, 'work'),
    });

    await expect(prepareCodexRuntime(config, {
      HOME: path.join(root, 'personal'),
      CODEX_HOME: inheritedHome,
    })).rejects.toThrow(/inherited.*CODEX_HOME|CODEX_HOME.*inherited/u);
    await expect(lstat(path.join(inheritedHome, '.guideanything-runtime-home')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('atomically prepares a restrictive minimal home and links explicit auth without copying it', async () => {
    const { auth, config } = await fixture();

    const prepared = await prepareCodexRuntime(config);

    expect(prepared.home).toBe(await realpath(config.runtimeHome));
    expect(prepared.workDir).toBe(await realpath(config.runtimeWorkDir));
    expect(await readFile(path.join(config.runtimeHome, 'config.toml'), 'utf8')).toBe(MINIMAL_CODEX_CONFIG);
    expect(await readlink(path.join(config.runtimeHome, 'auth.json'))).toBe(auth);
    expect((await lstat(path.join(config.runtimeHome, 'auth.json'))).isSymbolicLink()).toBe(true);
    expect((await stat(config.runtimeHome)).mode & 0o777).toBe(0o700);
    expect((await stat(config.runtimeWorkDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(config.runtimeHome, 'config.toml'))).mode & 0o777).toBe(0o600);
    expect(MINIMAL_CODEX_CONFIG).not.toContain('opaque-auth-do-not-copy');
  });

  it('requires either explicit auth or an already provisioned runtime auth file', async () => {
    const { root } = await fixture();
    const config = parseRuntimeBridgeEnv({
      AGENT_BRIDGE_TOKEN: 'runtime-bridge-test-token-000000000000',
      CODEX_RUNTIME_HOME: path.join(root, 'fresh-home'),
      CODEX_RUNTIME_WORK_DIR: path.join(root, 'fresh-work'),
    });

    await expect(prepareCodexRuntime(config)).rejects.toThrow('auth');

    await mkdir(config.runtimeHome, { recursive: true });
    await writeFile(path.join(config.runtimeHome, 'auth.json'), 'pre-provisioned', { mode: 0o600 });
    await expect(prepareCodexRuntime(config)).resolves.toMatchObject({
      home: await realpath(config.runtimeHome),
    });
  });

  it('returns canonical identities for runtime directories reached through an OS path alias', async () => {
    const aliasRoot = await mkdtemp('/tmp/guideanything-runtime-alias-');
    roots.push(aliasRoot);
    const auth = path.join(aliasRoot, 'auth.json');
    await writeFile(auth, 'opaque', { mode: 0o600 });
    const config = parseRuntimeBridgeEnv({
      AGENT_BRIDGE_TOKEN: 'runtime-bridge-test-token-000000000000',
      CODEX_RUNTIME_HOME: path.join(aliasRoot, 'home'),
      CODEX_RUNTIME_WORK_DIR: path.join(aliasRoot, 'work'),
      CODEX_RUNTIME_AUTH_FILE: auth,
    });

    const prepared = await prepareCodexRuntime(config);

    expect(prepared.home).toBe(await realpath(config.runtimeHome));
    expect(prepared.workDir).toBe(await realpath(config.runtimeWorkDir));
  });

  it.each(['AGENTS.md', 'skills', 'plugins', 'hooks', 'mcp'])('rejects forbidden personal runtime entry %s', async (entry) => {
    const { config } = await fixture();
    await mkdir(config.runtimeHome, { recursive: true });
    const target = path.join(config.runtimeHome, entry);
    if (entry.includes('.')) await writeFile(target, 'personal instructions');
    else await mkdir(target);

    await expect(prepareCodexRuntime(config)).rejects.toThrow(entry);
  });

  it('purges only marker-owned system skills created by a previous app-server process', async () => {
    const { config } = await fixture();
    await prepareCodexRuntime(config);
    const skillsRoot = path.join(config.runtimeHome, 'skills');
    const systemRoot = path.join(skillsRoot, '.system');
    await mkdir(path.join(systemRoot, 'generated-skill'), { recursive: true });
    await writeFile(path.join(systemRoot, '.codex-system-skills.marker'), '');
    await writeFile(path.join(systemRoot, 'generated-skill', 'SKILL.md'), 'generated');

    await expect(prepareCodexRuntime(config)).resolves.toMatchObject({
      home: await realpath(config.runtimeHome),
    });
    await expect(lstat(skillsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('safely adopts a legacy bridge home after validating its exact config, auth, and generated skills', async () => {
    const { config } = await fixture();
    await prepareCodexRuntime(config);
    await import('node:fs/promises').then(({ rm }) => rm(path.join(config.runtimeHome, '.guideanything-runtime-home')));
    const skillsRoot = path.join(config.runtimeHome, 'skills');
    const systemRoot = path.join(skillsRoot, '.system');
    await mkdir(path.join(systemRoot, 'generated-skill'), { recursive: true });
    await writeFile(path.join(systemRoot, '.codex-system-skills.marker'), '');
    await writeFile(path.join(systemRoot, 'generated-skill', 'SKILL.md'), 'generated');

    await expect(prepareCodexRuntime(config)).resolves.toMatchObject({
      home: await realpath(config.runtimeHome),
    });
    await expect(readFile(path.join(config.runtimeHome, '.guideanything-runtime-home'), 'utf8'))
      .resolves.toBe('guideanything-runtime-home:v1\n');
    await expect(lstat(skillsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not purge a marker-owned skills tree when a personal sibling is present', async () => {
    const { config } = await fixture();
    await prepareCodexRuntime(config);
    const skillsRoot = path.join(config.runtimeHome, 'skills');
    const systemRoot = path.join(skillsRoot, '.system');
    await mkdir(systemRoot, { recursive: true });
    await writeFile(path.join(systemRoot, '.codex-system-skills.marker'), '');
    await mkdir(path.join(skillsRoot, 'personal-skill'));

    await expect(prepareCodexRuntime(config)).rejects.toThrow('skills');
    expect((await lstat(path.join(skillsRoot, 'personal-skill'))).isDirectory()).toBe(true);
  });

  it('does not claim or purge marker-looking skills from an unmanaged personal home', async () => {
    const { config } = await fixture();
    const systemRoot = path.join(config.runtimeHome, 'skills', '.system');
    const personalSkill = path.join(systemRoot, 'personal-skill', 'SKILL.md');
    await mkdir(path.dirname(personalSkill), { recursive: true });
    await writeFile(path.join(systemRoot, '.codex-system-skills.marker'), '');
    await writeFile(personalSkill, 'personal');
    await writeFile(path.join(config.runtimeHome, 'config.toml'), 'personal = true\n');

    await expect(prepareCodexRuntime(config)).rejects.toThrow('not managed by the runtime bridge');
    await expect(readFile(personalSkill, 'utf8')).resolves.toBe('personal');
    await expect(readFile(path.join(config.runtimeHome, 'config.toml'), 'utf8')).resolves.toBe('personal = true\n');
  });

  it('validates a managed config before purging generated system skills', async () => {
    const { config } = await fixture();
    await prepareCodexRuntime(config);
    const systemRoot = path.join(config.runtimeHome, 'skills', '.system');
    const generatedSkill = path.join(systemRoot, 'generated-skill', 'SKILL.md');
    await mkdir(path.dirname(generatedSkill), { recursive: true });
    await writeFile(path.join(systemRoot, '.codex-system-skills.marker'), '');
    await writeFile(generatedSkill, 'generated');
    await writeFile(path.join(config.runtimeHome, 'config.toml'), 'personal = true\n');

    await expect(prepareCodexRuntime(config)).rejects.toThrow('config.toml');
    await expect(readFile(generatedSkill, 'utf8')).resolves.toBe('generated');
  });

  it('validates managed auth before purging generated system skills', async () => {
    const { config } = await fixture();
    await prepareCodexRuntime(config);
    const systemRoot = path.join(config.runtimeHome, 'skills', '.system');
    const generatedSkill = path.join(systemRoot, 'generated-skill', 'SKILL.md');
    await mkdir(path.dirname(generatedSkill), { recursive: true });
    await writeFile(path.join(systemRoot, '.codex-system-skills.marker'), '');
    await writeFile(generatedSkill, 'generated');
    await import('node:fs/promises').then(({ rm }) => rm(path.join(config.runtimeHome, 'auth.json')));
    await writeFile(path.join(config.runtimeHome, 'auth.json'), 'personal-auth');

    await expect(prepareCodexRuntime(config)).rejects.toThrow('auth.json');
    await expect(readFile(generatedSkill, 'utf8')).resolves.toBe('generated');
  });

  it('rejects an inherited config and a non-empty or symlinked runtime work directory', async () => {
    const { root, config } = await fixture();
    await mkdir(config.runtimeHome, { recursive: true });
    await writeFile(path.join(config.runtimeHome, 'config.toml'), '[mcp_servers.personal]\ncommand="x"\n');
    await expect(prepareCodexRuntime(config)).rejects.toThrow('config.toml');

    await import('node:fs/promises').then(({ rm }) => rm(path.join(config.runtimeHome, 'config.toml')));
    await mkdir(config.runtimeWorkDir, { recursive: true });
    await writeFile(path.join(config.runtimeWorkDir, 'unexpected.txt'), 'x');
    await expect(prepareCodexRuntime(config)).rejects.toThrow('empty');

    await import('node:fs/promises').then(({ rm }) => rm(config.runtimeWorkDir, { recursive: true }));
    const actual = path.join(root, 'actual-work');
    await mkdir(actual);
    await import('node:fs/promises').then(({ symlink }) => symlink(actual, config.runtimeWorkDir));
    await expect(prepareCodexRuntime(config)).rejects.toThrow('symbolic link');
  });
});

describe('Codex feature fail-closed configuration', () => {
  it('uses the current installed feature names and disables every non-required capability', () => {
    const args = buildCodexAppServerArgs();
    const disabled = args.flatMap((value, index) => value === '--disable' ? [args[index + 1]] : []);

    expect(args.slice(0, 2)).toEqual(['app-server', '--strict-config']);
    expect(args.at(-1)).toBe('--stdio');
    expect(disabled).toEqual(REQUIRED_DISABLED_FEATURES);
    expect(disabled).toEqual(expect.arrayContaining([
      'plugins', 'remote_plugin', 'apps', 'browser_use', 'computer_use',
      'image_generation', 'hooks', 'goals', 'shell_tool', 'unified_exec',
      'workspace_dependencies', 'multi_agent', 'tool_suggest',
      'skill_mcp_dependency_install', 'memories', 'standalone_web_search',
    ]));
  });

  it('parses feature output and refuses to launch when a required disable is unknown', () => {
    const output = REQUIRED_DISABLED_FEATURES
      .map((feature) => `${feature.padEnd(32)} stable false`)
      .join('\n');
    const features = parseCodexFeatureList(output);

    expect(() => assertRequiredFeaturesAvailable(features)).not.toThrow();
    features.delete('plugins');
    expect(() => assertRequiredFeaturesAvailable(features)).toThrow('plugins');
  });
});

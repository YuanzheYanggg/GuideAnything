import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readTrustedPromptHarness } from '../knowledge/vault-indexer';
import { getTrustedSantexwellHarness } from './trusted-harness';

describe('trusted Santexwell harness adapter', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('exposes only the already validated last-good allowlisted bundle without its absolute root', async () => {
    root = await mkdtemp(join(tmpdir(), 'guideanything-harness-adapter-'));
    await mkdir(join(root, 'playbooks'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'AGENTS.md'), '只读回答。'),
      writeFile(join(root, 'CORE.md'), '核心边界。'),
      writeFile(join(root, 'SOUL.md'), '回答风格。'),
      writeFile(join(root, 'playbooks/qna.md'), '问答流程。'),
      writeFile(join(root, 'private-secret.md'), '不得进入 harness。'),
    ]);
    const indexed = await readTrustedPromptHarness(root, { intent: 'GENERAL_QA' });

    const result = getTrustedSantexwellHarness(root);

    expect(result).toEqual({ revision: indexed.revision, items: [indexed.content] });
    expect(result!.items.join('\n')).not.toContain(root);
    expect(result!.items.join('\n')).not.toContain('不得进入 harness');
  });

  it('returns null instead of reading arbitrary files when no last-good bundle exists', () => {
    expect(getTrustedSantexwellHarness('/tmp/not-indexed-vault')).toBeNull();
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { indexSantexwellVault, readTrustedPromptHarness } from '../knowledge/vault-indexer';
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
    expect(getTrustedSantexwellHarness(root)).toBeNull();

    const canonicalPage = `---
title: "Index"
page_type: "index"
status: "active"
tags:
  - "domain/textiles"
aliases:
  - "Index"
source_count: 1
evidence_status: "index-only"
last_compiled: "2026-07-15"
review_state: "review"
---
# Index

Published index.
`;
    await mkdir(join(root, 'wiki_v2', '_meta', 'build'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'wiki_v2', 'index.md'), canonicalPage),
      writeFile(join(root, 'wiki_v2', '_meta', 'Tag Taxonomy.md'), canonicalPage.replaceAll('Index', 'Taxonomy')),
      writeFile(join(root, 'wiki_v2', '_meta', 'build', 'provenance_manifest.json'), JSON.stringify({
        generated_on: '2026-07-15',
        pages: {},
      })),
    ]);
    const database = createDatabase(':memory:');
    migrateDatabase(database);
    try {
      await expect(indexSantexwellVault(database, root, AbortSignal.timeout(2_000)))
        .resolves.toMatchObject({ status: 'READY' });
    } finally {
      database.close();
    }

    const result = getTrustedSantexwellHarness(root);

    expect(result).toEqual({ revision: indexed.revision, items: [indexed.content] });
    expect(result!.items.join('\n')).not.toContain(root);
    expect(result!.items.join('\n')).not.toContain('不得进入 harness');
  });

  it('returns null instead of reading arbitrary files when no last-good bundle exists', () => {
    expect(getTrustedSantexwellHarness('/tmp/not-indexed-vault')).toBeNull();
  });
});

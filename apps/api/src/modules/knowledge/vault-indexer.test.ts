import { mkdtemp, mkdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { authorization, createTestContext } from '../../test/test-app';
import {
  getKnowledgeDocument,
  searchKnowledge,
  searchKnowledgeInternal,
} from './repository';
import {
  indexSantexwellVault,
  readSantexwellRawEvidence,
  readTrustedPromptHarness,
} from './vault-indexer';

const harnessFiles: Record<string, string> = {
  'AGENTS.md': '# Agent\n只读。',
  'CORE.md': '# Core\n证据优先。',
  'SOUL.md': '# Soul\n区分推断。',
  'playbooks/qna.md': '# QA\n先概念后摘要。',
  'playbooks/page-contracts.md': '# Contracts\n页面契约。',
};

function page(input: {
  title: string;
  type?: string;
  status?: string;
  review?: string;
  evidence?: string;
  aliases?: string[];
  sourceProfile?: boolean;
  body?: string;
}) {
  const list = (values: string[]) => values.map((value) => `  - "${value}"`).join('\n');
  return `---
title: "${input.title}"
page_type: "${input.type ?? 'concept'}"
status: "${input.status ?? 'active'}"
tags:
  - "domain/textiles"
aliases:
${list(input.aliases ?? [input.title])}
source_count: 1
evidence_status: "${input.evidence ?? 'sourced'}"
last_compiled: "2026-07-15"
review_state: "${input.review ?? 'review'}"
${input.sourceProfile ? `source_cluster: "textile-knowledge"
source_bucket: "engineering"
coverage_scope: "overview"
cross_cluster_policy: "direct"
attention_score: 80
source_paths:
  - "raw/textiles/source.md"
` : ''}---
# ${input.title}

${input.body ?? '花式纱线的分类与应用。'}
`;
}

describe('Santexwell vault indexing', () => {
  let root: string;
  let database: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'santexwell-vault-'));
    database = createDatabase(':memory:');
    migrateDatabase(database);
    for (const [relative, content] of Object.entries(harnessFiles)) {
      await put(relative, content);
    }
    await mkdir(join(root, 'wiki_v2', '_meta', 'build'), { recursive: true });
    await put('wiki_v2/index.md', page({ title: 'Santexwell Wiki', type: 'index', evidence: 'index-only' }));
    await put('wiki_v2/_meta/Tag Taxonomy.md', page({ title: 'Tag Taxonomy', type: 'index', evidence: 'index-only' }));
  });
  afterEach(() => database.close());

  it('reads only the exact trusted harness and preserves last-good bundles', async () => {
    await put('AGENTS.legacy.md', 'DO NOT LOAD');
    await put('skill-pack/query.md', 'DO NOT LOAD');
    const bundle = await readTrustedPromptHarness(root, { intent: 'GENERAL_QA' });
    expect(bundle.files.map((file) => file.name)).toEqual([
      'AGENTS.md', 'CORE.md', 'SOUL.md', 'playbooks/qna.md',
    ]);
    expect(bundle.content).not.toContain('DO NOT LOAD');
    const compiler = await readTrustedPromptHarness(root, { intent: 'COMPILER_CONTRACT' });
    expect(compiler.files.map((file) => file.name)).toContain('playbooks/page-contracts.md');

    await put('CORE.md', 'x'.repeat(33 * 1024));
    await expect(readTrustedPromptHarness(root, { intent: 'GENERAL_QA' })).rejects.toMatchObject({
      code: 'HARNESS_FILE_TOO_LARGE',
    });
  });

  it('indexes the exact allowlist, excludes conflicts and symlinks, and keeps DTOs path-free', async () => {
    await put('wiki_v2/concepts/花式纱线.md', page({
      title: '花式纱线', aliases: ['Fancy yarn', 'ファンシーヤーン'],
      body: '分类参考 [[纺纱方式#路线|纺纱路线]]。\n\n`[[代码链接]]`\n![[raw/private.png]]',
    }));
    await put('wiki_v2/concepts/纺纱方式.md', page({ title: '纺纱方式' }));
    await put('wiki_v2/concepts/花式纱线 2.md', page({ title: '冲突副本' }));
    await put('wiki_v2/concepts/Topic 2 工艺.md', page({ title: 'Topic 2 工艺' }));
    await put('wiki_v2/sources/资料摘要.md', page({ title: '资料摘要', type: 'source-digest', sourceProfile: true }));
    await put('wiki_v2/log.md', page({ title: '日志', type: 'index' }));
    await put('wiki_v2/concepts 2/错误.md', page({ title: '错误目录' }));
    await put('wiki_v2/_meta/templates/错误.md', page({ title: '模板' }));
    await put('raw/private.md', '# raw');
    await put('raw/textiles/source.md', '# 原始证据\n\n花式纱原始材料。\n\n![[private/image.png]]');
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({
      generated_on: '2026-07-15',
      pages: {
        'wiki_v2/concepts/花式纱线.md': {
          title: '花式纱线', page_type: 'concept', source_paths: ['raw/textiles/source.md'],
        },
      },
    }));
    await symlink(join(root, 'wiki_v2', 'concepts', '纺纱方式.md'), join(root, 'wiki_v2', 'concepts', '内部链接.md'));
    await symlink(join(root, 'raw', 'private.md'), join(root, 'wiki_v2', 'concepts', '外部链接.md'));

    const summary = await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    expect(summary.status).toBe('READY');
    expect(summary.indexedDocuments).toBe(6);
    const titles = database.prepare('SELECT title FROM knowledge_documents ORDER BY title').all()
      .map((row) => (row as { title: string }).title);
    expect(titles).toEqual(expect.arrayContaining(['花式纱线', '纺纱方式', 'Topic 2 工艺', '资料摘要']));
    expect(titles).not.toEqual(expect.arrayContaining(['冲突副本', '日志', '错误目录', '模板']));

    const hits = searchKnowledge(database, '花式纱', { sourceKinds: ['SANTEXWELL'] });
    expect(hits[0]).toMatchObject({ title: '花式纱线', sourceKind: 'SANTEXWELL' });
    expect(JSON.stringify(hits)).not.toMatch(/wiki_v2|raw\/|santexwell-vault|source_paths/u);
    const internalHits = searchKnowledgeInternal(database, '花式纱', { sourceKinds: ['SANTEXWELL'] });
    expect(internalHits[0]?.hit).toEqual(hits[0]);
    expect(internalHits[0]?.locator).toMatchObject({
      kind: 'SANTEXWELL',
      documentId: hits[0]?.documentId,
      fragmentId: hits[0]?.fragmentId,
    });
    const japanese = searchKnowledge(database, 'ファンシー', { sourceKinds: ['SANTEXWELL'] });
    expect(japanese[0]?.title).toBe('花式纱线');

    const row = database.prepare(`SELECT id FROM knowledge_documents WHERE title = '花式纱线'`).get() as { id: string };
    const document = getKnowledgeDocument(database, row.id, { sourceKinds: ['SANTEXWELL'] });
    expect(document?.rawEvidenceAvailable).toBe(true);
    expect(document?.resolvedLinks).toContainEqual(expect.objectContaining({ title: '纺纱方式', heading: '路线' }));
    expect(JSON.stringify(document)).not.toMatch(/raw\/|wiki_v2|private\.png/u);

    const evidence = await readSantexwellRawEvidence(database, root, row.id);
    expect(evidence).toMatchObject({ documentId: row.id, sourceIndex: 0 });
    expect(evidence.text).toContain('花式纱原始材料');
    expect(JSON.stringify(evidence)).not.toMatch(/raw\/|wiki_v2|private\/image/u);
  });

  it('keeps unchanged ids, preserves an unambiguous rename, and never deletes last-good on partial failure', async () => {
    await put('wiki_v2/concepts/原名.md', page({ title: '稳定页面', body: '稳定内容。' }));
    await put('wiki_v2/concepts/相邻页.md', page({ title: '相邻页面', body: '原始相邻内容。' }));
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({ generated_on: '2026-07-15', pages: {} }));
    await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    const before = database.prepare(`SELECT id, checksum FROM knowledge_documents WHERE title = '稳定页面'`).get() as {
      id: string; checksum: string;
    };
    const fragmentBefore = database.prepare(
      `SELECT id FROM knowledge_fragments WHERE document_id = ? ORDER BY ordinal LIMIT 1`,
    ).get(before.id) as { id: string };

    await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    expect(database.prepare(`SELECT id FROM knowledge_documents WHERE title = '稳定页面'`).get()).toEqual({ id: before.id });
    expect(database.prepare(
      `SELECT id FROM knowledge_fragments WHERE document_id = ? ORDER BY ordinal LIMIT 1`,
    ).get(before.id)).toEqual(fragmentBefore);

    await rename(join(root, 'wiki_v2/concepts/原名.md'), join(root, 'wiki_v2/concepts/新名.md'));
    await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    expect(database.prepare(`SELECT id FROM knowledge_documents WHERE title = '稳定页面'`).get()).toEqual({ id: before.id });

    const neighborBefore = database.prepare(
      `SELECT checksum FROM knowledge_documents WHERE title = '相邻页面'`,
    ).get();
    await put('wiki_v2/concepts/相邻页.md', page({ title: '相邻页面', body: '本轮不应发布的新内容。' }));
    await put('wiki_v2/concepts/新名.md', '---\ntitle: broken\ntitle: duplicate\n---\n# broken');
    const failed = await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    expect(failed.status).toBe('DEGRADED');
    expect(database.prepare(`SELECT id, checksum FROM knowledge_documents WHERE title = '稳定页面'`).get()).toEqual(before);
    expect(database.prepare(`SELECT checksum FROM knowledge_documents WHERE title = '相邻页面'`).get()).toEqual(neighborBefore);
  });

  it('does not expose partial documents before the first complete scan', async () => {
    await put('wiki_v2/concepts/有效.md', page({ title: '尚未发布页面' }));
    await put('wiki_v2/concepts/无效.md', '---\ntitle: broken\ntitle: duplicate\n---\n# broken');
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({ generated_on: '2026-07-15', pages: {} }));

    const summary = await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    expect(summary.status).toBe('UNAVAILABLE');
    expect(searchKnowledge(database, '尚未发布', { sourceKinds: ['SANTEXWELL'] })).toEqual([]);
    expect(database.prepare(`SELECT 1 FROM knowledge_documents WHERE title = '尚未发布页面'`).get()).toBeUndefined();
  });

  it('rejects an invalid provenance manifest without deleting the last-good index', async () => {
    await put('wiki_v2/concepts/保留.md', page({ title: '保留页面' }));
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({ generated_on: '2026-07-15', pages: {} }));
    await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({
      generated_on: '2026-07-15', pages: { x: { source_paths: ['../outside'] } },
    }));
    const summary = await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    expect(summary.status).toBe('DEGRADED');
    expect(database.prepare(`SELECT title FROM knowledge_documents WHERE title = '保留页面'`).get()).toEqual({ title: '保留页面' });
  });

  it('runs deletion only after a complete scan and preserves last-good counts when aborted', async () => {
    await put('wiki_v2/concepts/待删除.md', page({ title: '待删除页面' }));
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({ generated_on: '2026-07-15', pages: {} }));
    const first = await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    expect(first.status).toBe('READY');
    const firstCount = first.indexedDocuments;

    await unlink(join(root, 'wiki_v2/concepts/待删除.md'));
    const aborted = new AbortController();
    aborted.abort();
    expect((await indexSantexwellVault(database, root, aborted.signal)).status).toBe('DEGRADED');
    expect(database.prepare(`SELECT title FROM knowledge_documents WHERE title = '待删除页面'`).get()).toEqual({ title: '待删除页面' });
    const degradedConfig = JSON.parse((database.prepare(
      `SELECT config_json FROM knowledge_sources WHERE id = 'source-santexwell-vault'`,
    ).get() as { config_json: string }).config_json) as { indexedDocuments: number };
    expect(degradedConfig.indexedDocuments).toBe(firstCount);

    expect((await indexSantexwellVault(database, root, AbortSignal.timeout(2_000))).status).toBe('READY');
    expect(database.prepare(`SELECT title FROM knowledge_documents WHERE title = '待删除页面'`).get()).toBeUndefined();
  });

  it('serves authenticated path-free status, overview, search, and document DTOs', async () => {
    await put('wiki_v2/moc/纺织地图.md', page({ title: '纺织地图', type: 'moc', evidence: 'index-only' }));
    await put('wiki_v2/concepts/花式纱线.md', page({ title: '花式纱线' }));
    await put('wiki_v2/sources/花式纱摘要.md', page({ title: '花式纱摘要', type: 'source-digest', sourceProfile: true }));
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({ generated_on: '2026-07-15', pages: {} }));
    const context = await createTestContext();
    try {
      await indexSantexwellVault(context.database, root, AbortSignal.timeout(2_000));
      expect((await context.app.inject({
        method: 'GET', url: '/api/knowledge/santexwell/status',
      })).statusCode).toBe(401);
      const overview = await context.app.inject({
        method: 'GET', url: '/api/knowledge/santexwell/overview',
        headers: authorization(context.tokens.learner),
      });
      expect(overview.statusCode).toBe(200);
      expect(overview.json().mocs).toContainEqual(expect.objectContaining({ title: '纺织地图' }));
      expect(overview.json().clusters).toContainEqual(expect.objectContaining({ cluster: 'textile-knowledge', documentCount: 1 }));

      const searched = await context.app.inject({
        method: 'GET', url: `/api/knowledge/santexwell/search?q=${encodeURIComponent('花式纱线')}`,
        headers: authorization(context.tokens.learner),
      });
      expect(searched.statusCode).toBe(200);
      expect(searched.json().items[0]).toMatchObject({
        title: '花式纱线', href: expect.stringMatching(/^\/knowledge\/santexwell\/documents\//u), score: expect.any(Number),
      });
      const documentId = searched.json().items[0].documentId as string;
      const document = await context.app.inject({
        method: 'GET', url: `/api/knowledge/santexwell/documents/${documentId}`,
        headers: authorization(context.tokens.learner),
      });
      expect(document.statusCode).toBe(200);
      expect(JSON.stringify(document.json())).not.toMatch(/wiki_v2|raw\/|santexwell-vault|relative|locator/u);
    } finally {
      await context.close();
    }
  });

  async function put(relative: string, content: string) {
    const target = join(root, relative);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
});

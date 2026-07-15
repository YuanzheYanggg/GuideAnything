import { mkdtemp, mkdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { authorization, createTestContext } from '../../test/test-app';
import {
  getKnowledgeDocument,
  getSantexwellOverview,
  searchKnowledge,
  searchKnowledgeInternal,
} from './repository';
import {
  indexSantexwellVault,
  readSantexwellRawEvidence,
  readStableContainedFile,
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
  tags?: string[];
  sourceProfile?: boolean;
  body?: string;
}) {
  const list = (values: string[]) => values.map((value) => `  - ${JSON.stringify(value)}`).join('\n');
  return `---
title: "${input.title}"
page_type: "${input.type ?? 'concept'}"
status: "${input.status ?? 'active'}"
tags:
${list(input.tags ?? ['domain/textiles'])}
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

  it('reads from a no-follow descriptor and rejects a path replaced after open', async () => {
    await put('stable.md', 'safe bytes');
    const outside = `${root}-outside.md`;
    await writeFile(outside, 'outside secret');

    await expect(readStableContainedFile(root, 'stable.md', 1_024, 'PAGE', {
      afterOpen: async () => {
        await rename(join(root, 'stable.md'), join(root, 'stable-original.md'));
        await symlink(outside, join(root, 'stable.md'));
      },
    })).rejects.toMatchObject({ code: 'VAULT_PATH_ESCAPE' });
  });

  it('removes arbitrary absolute paths from every vault-controlled model and public field', async () => {
    await put('CORE.md', '# Core\n规则位于/custom-root/private-policy.md\n说明file:///Volumes/Private/policy.md。');
    const harness = await readTrustedPromptHarness(root, { intent: 'GENERAL_QA' });
    expect(harness.content).not.toMatch(privatePathPattern);

    await put('wiki_v2/concepts/路径安全.md', page({
      title: '路径安全/custom-title/secret-title.md',
      aliases: ['公开别名C:\\company\\secret-alias.txt', '说明file:///Volumes/Private/alias.md'],
      tags: ['domain/textiles', '/custom-tags/internal/private-tag'],
      body: '公开正文/custom-body/private.txt\n\n说明file:///tmp/evidence.md\n\n\\\\server\\share\\secret.docx',
    }));
    await put('raw/textiles/path-source.md', [
      '# Raw evidence',
      '证据/custom-raw/private.txt',
      '说明D:\\private\\evidence.txt',
      '位置file:///Volumes/Private/raw.md',
      '可公开证据。',
    ].join('\n'));
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({
      generated_on: '2026-07-15',
      pages: {
        'wiki_v2/concepts/路径安全.md': { source_paths: ['raw/textiles/path-source.md'] },
      },
    }));

    expect((await indexSantexwellVault(database, root, AbortSignal.timeout(2_000))).status).toBe('READY');
    const hit = searchKnowledge(database, '路径安全', { sourceKinds: ['SANTEXWELL'] })[0]!;
    const document = getKnowledgeDocument(database, hit.documentId, { sourceKinds: ['SANTEXWELL'] })!;
    const internalContent = database.prepare(
      `SELECT group_concat(content, '\n') AS content FROM knowledge_fragments WHERE document_id = ?`,
    ).get(hit.documentId) as { content: string };
    const raw = await readSantexwellRawEvidence(database, root, hit.documentId);

    expect(JSON.stringify(hit)).not.toMatch(privatePathPattern);
    expect(JSON.stringify(document)).not.toMatch(privatePathPattern);
    expect(internalContent.content).not.toMatch(privatePathPattern);
    expect(raw.text).not.toMatch(privatePathPattern);
    expect(document.title).toBe('路径安全');
    expect(document.aliases).toEqual(['公开别名', '说明']);
    expect(document.tags).toEqual(['domain/textiles']);
    expect(raw.text).toContain('可公开证据');
  });

  it('sanitizes a legacy last-good generation again at the public projection boundary', async () => {
    await put('wiki_v2/moc/旧数据.md', page({ title: '公开旧页', type: 'moc', evidence: 'index-only', body: '公开旧内容' }));
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({ generated_on: '2026-07-15', pages: {} }));
    await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    const row = database.prepare(`SELECT id, metadata_json FROM knowledge_documents WHERE title = '公开旧页'`).get() as {
      id: string;
      metadata_json: string;
    };
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    metadata.aliases = ['旧别名 Z:\\private\\alias.txt'];
    metadata.tags = ['/mnt/private/tag'];
    database.prepare(
      `UPDATE knowledge_documents SET title = ?, metadata_json = ? WHERE id = ?`,
    ).run('legacy 公开旧页 /root/private-title.md', JSON.stringify(metadata), row.id);
    database.prepare(
      `UPDATE knowledge_fragments SET title = ?, heading = ?, content = ?, search_text = ? WHERE document_id = ?`,
    ).run(
      'legacy 公开旧页 /root/private-title.md',
      '公开标题 Y:\\private\\heading.txt',
      '公开旧内容 file:///Volumes/Private/content.md',
      'legacy 公开旧页 公开旧内容',
      row.id,
    );

    const hit = searchKnowledge(database, 'legacy', { sourceKinds: ['SANTEXWELL'] })[0]!;
    const document = getKnowledgeDocument(database, row.id, { sourceKinds: ['SANTEXWELL'] })!;
    const overview = getSantexwellOverview(database);
    expect(JSON.stringify(hit)).not.toMatch(privatePathPattern);
    expect(JSON.stringify(document)).not.toMatch(privatePathPattern);
    expect(JSON.stringify(overview)).not.toMatch(privatePathPattern);
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

  it('publishes a vault generation atomically when a later document write fails', async () => {
    await put('wiki_v2/concepts/A.md', page({ title: '原子 A', body: 'A old generation' }));
    await put('wiki_v2/concepts/B.md', page({ title: '原子 B', body: 'B old generation' }));
    await put('wiki_v2/_meta/build/provenance_manifest.json', JSON.stringify({ generated_on: '2026-07-15', pages: {} }));
    const first = await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    expect(first.status).toBe('READY');
    const before = database.prepare(
      `SELECT d.title, d.checksum, f.content
       FROM knowledge_documents d JOIN knowledge_fragments f ON f.document_id = d.id AND f.ordinal = 0
       WHERE d.title IN ('原子 A', '原子 B') ORDER BY d.title`,
    ).all();

    await put('wiki_v2/concepts/A.md', page({ title: '原子 A', body: 'A new generation' }));
    await put('wiki_v2/concepts/B.md', page({ title: '原子 B', body: 'B new generation' }));
    database.exec(`CREATE TRIGGER reject_atomic_b_update
      BEFORE UPDATE OF checksum ON knowledge_documents
      WHEN OLD.title = '原子 B' AND NEW.checksum != OLD.checksum
      BEGIN SELECT RAISE(ABORT, 'reject B generation'); END`);
    const failed = await indexSantexwellVault(database, root, AbortSignal.timeout(2_000));
    database.exec('DROP TRIGGER reject_atomic_b_update');

    expect(failed.status).toBe('DEGRADED');
    expect(database.prepare(
      `SELECT d.title, d.checksum, f.content
       FROM knowledge_documents d JOIN knowledge_fragments f ON f.document_id = d.id AND f.ordinal = 0
       WHERE d.title IN ('原子 A', '原子 B') ORDER BY d.title`,
    ).all()).toEqual(before);
    expect(searchKnowledge(database, 'new generation', { sourceKinds: ['SANTEXWELL'] })
      .every((hit) => !hit.excerpt.includes('new generation'))).toBe(true);
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

const privatePathPattern = /file:\/\/|\/(?:custom-[^/]+|etc|opt|private|srv|tmp|var|Volumes)\/|[A-Za-z]:[\\/]|\\\\server\\/iu;

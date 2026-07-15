import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';
import { extractWorkspaceDocument, sanitizeUploadName } from './extractor';
import { reconcileGuideFlowSnapshots } from './flow-indexer';
import { parseCanonicalMarkdown } from './markdown';
import { searchKnowledge } from './repository';
import { buildSearchText, compileFtsQuery } from './search-text';

const validFrontmatter = (overrides = '') => `---
title: "花式纱线"
page_type: "concept"
status: "active"
tags:
  - "domain/textiles"
aliases:
  - "Fancy yarn"
source_count: 2
evidence_status: "sourced"
last_compiled: "2026-07-15"
review_state: "review"
${overrides}---
`;

describe('canonical Markdown and search safety', () => {
  it('parses bounded scalar frontmatter, heading paths, and safe wikilinks', () => {
    const markdown = `${validFrontmatter()}# 花式纱线\r\n\r\n正文 [[纺纱方式#分类|纺法]]。\r\n\r\n## 分类\r\n` +
      '`[[代码目标]]`\n\n```md\n[[围栏目标]]\n```\n![[raw/internal/private.png]]\n[[raw/private|原文]]\n' +
      '[资料摘要](<../sources/%E8%B5%84%E6%96%99.md>)\n' +
      '[raw/internal/private.md](<../../raw/internal/private.md>)\n' +
      '本机位置：/Users/operator/vault/wiki_v2/concepts/private.md';
    const parsed = parseCanonicalMarkdown(Buffer.from(`\ufeff${markdown}`, 'utf8'), 'wiki_v2/concepts/花式纱线.md');
    expect(parsed.frontmatter).toMatchObject({
      title: '花式纱线', pageType: 'concept', aliases: ['Fancy yarn'], sourceCount: 2,
    });
    expect(parsed.links.map((link) => link.target)).toEqual(['纺纱方式']);
    expect(parsed.links[0]).toMatchObject({ heading: '分类', label: '纺法' });
    expect(parsed.fragments.map((fragment) => fragment.headingPath)).toContain('花式纱线 / 分类');
    expect(parsed.visibleText).toContain('资料摘要');
    expect(parsed.visibleText).not.toMatch(/raw\/|wiki_v2|\/Users\/|\.\.\/|代码目标|围栏目标|private\.png/u);
  });

  it.each([
    ['duplicate keys', `${validFrontmatter('title: duplicate\n')}# x`],
    ['nested map', `${validFrontmatter('nested:\n  key: value\n')}# x`],
    ['anchor', `${validFrontmatter('extra: &anchor value\n')}# x`],
    ['alias', `${validFrontmatter('extra: *anchor\n')}# x`],
    ['custom tag', `${validFrontmatter('extra: !danger value\n')}# x`],
    ['prototype key', `${validFrontmatter('__proto__: value\n')}# x`],
    ['nul', `${validFrontmatter()}# x\u0000`],
  ])('rejects %s without a filename fallback', (_name, markdown) => {
    expect(() => parseCanonicalMarkdown(Buffer.from(markdown), 'wiki_v2/concepts/Fallback.md')).toThrow();
  });

  it('rejects invalid UTF-8 and oversized frontmatter values', () => {
    expect(() => parseCanonicalMarkdown(Buffer.from([0xc3, 0x28]), 'wiki_v2/concepts/x.md')).toThrow();
    expect(() => parseCanonicalMarkdown(
      Buffer.from(`${validFrontmatter(`extra: "${'x'.repeat(20_000)}"\n`)}# x`),
      'wiki_v2/concepts/x.md',
    )).toThrow();
  });

  it('creates stable bounded fragments for long sections and repeated headings', () => {
    const parsed = parseCanonicalMarkdown(Buffer.from(
      `${validFrontmatter()}# 标题\n${'甲'.repeat(8_200)}\n## 重复\n第一段\n## 重复\n第二段`,
    ), 'wiki_v2/concepts/long.md');
    expect(parsed.fragments.every((fragment) => [...fragment.content].length <= 4_000)).toBe(true);
    expect(parsed.fragments.filter((fragment) => fragment.heading === '重复').map((fragment) => fragment.headingOccurrence)).toEqual([0, 1]);
    expect(new Set(parsed.fragments.map((fragment) => fragment.stableKey)).size).toBe(parsed.fragments.length);
  });

  it('normalizes Latin/Japanese and emits CJK bigrams without raw MATCH syntax', () => {
    const searchText = buildSearchText(['Fancy YARN', '花式纱线', 'ウール']);
    expect(searchText).toContain('fancy');
    expect(searchText).toContain('花式');
    expect(searchText).toContain('式纱');
    expect(searchText).toContain('ウー');
    expect(compileFtsQuery('花式" OR *')).toBe('"or" OR "花式"');
    expect(compileFtsQuery('纱')).toBeNull();
  });

  it('sanitizes display names and validates text extraction', async () => {
    expect(sanitizeUploadName('../\u202Esecret.md')).toBe('secret.md');
    const extracted = await extractWorkspaceDocument({
      filename: 'notes.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from('# 安全资料\n正文'),
    });
    expect(extracted).toMatchObject({ extension: '.md', text: '# 安全资料\n正文' });
    await expect(extractWorkspaceDocument({
      filename: 'fake.pdf', mimeType: 'application/pdf', bytes: Buffer.from('not a pdf'),
    })).rejects.toMatchObject({ code: 'DOCUMENT_SIGNATURE_MISMATCH' });
    await expect(extractWorkspaceDocument({
      filename: 'oversized.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: fakeDocxCentralDirectory(40 * 1024 * 1024),
    })).rejects.toMatchObject({ code: 'DOCUMENT_ARCHIVE_LIMIT' });
  });
});

describe('knowledge routes, uploads, and flow synchronization', () => {
  let context: TestContext;
  let root: string;
  const workspaceId = 'workspace-knowledge';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'guideanything-knowledge-'));
    context = await createTestContext({ uploadDir: join(root, 'uploads') });
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId, slug: 'knowledge', name: '知识工作区',
    });
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.editor, 'EDIT');
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.learner, 'VIEW');
  });
  afterEach(async () => context.close());

  it('enforces 401/404/403 and accepts an AUTHOR/EDITOR persistent upload', async () => {
    expect((await context.app.inject({
      method: 'GET', url: `/api/workspaces/${workspaceId}/sources`,
    })).statusCode).toBe(401);
    expect((await context.app.inject({
      method: 'GET', url: `/api/workspaces/${workspaceId}/sources`,
      headers: authorization(context.tokens.otherAuthor),
    })).statusCode).toBe(404);

    const learnerUpload = await uploadMarkdown(context, context.tokens.learner, workspaceId, 'learner.md');
    expect(learnerUpload.statusCode).toBe(403);
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.otherAuthor, 'VIEW');
    expect((await uploadMarkdown(context, context.tokens.otherAuthor, workspaceId, 'view.md')).statusCode).toBe(403);

    const uploaded = await uploadMarkdown(context, context.tokens.editor, workspaceId, '../\u202E研发.md');
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().source).toMatchObject({
      title: '研发.md', originalName: '研发.md', mimeType: 'text/markdown', status: 'READY',
    });
    expect(JSON.stringify(uploaded.json())).not.toMatch(/storage|\/Users\/|uploads/u);

    const listed = await context.app.inject({
      method: 'GET', url: `/api/workspaces/${workspaceId}/sources`,
      headers: authorization(context.tokens.learner),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    const storage = context.database.prepare(
      `SELECT json_extract(config_json, '$.storageKey') AS storage_key
       FROM knowledge_sources WHERE id = ?`,
    ).get(uploaded.json().source.sourceId) as { storage_key: string };
    expect(storage.storage_key).toMatch(/^[0-9a-f-]+\.md$/u);
    expect((await readFile(join(root, 'uploads', 'knowledge', storage.storage_key), 'utf8'))).toContain('花式纱');

    expect(searchKnowledge(context.database, '花式纱', {
      sourceKinds: ['WORKSPACE_DOCUMENT'],
      workspaceId,
      userId: context.userIds.learner,
    })).toHaveLength(1);
    context.database.prepare(
      'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    ).run(workspaceId, context.userIds.otherAuthor);
    expect(searchKnowledge(context.database, '花式纱', {
      sourceKinds: ['WORKSPACE_DOCUMENT'],
      workspaceId,
      userId: context.userIds.otherAuthor,
    })).toEqual([]);
  });

  it('indexes draft and immutable published flow snapshots without exposing canvas internals', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '流程知识', summary: '审批流程', tags: ['审批'] },
    });
    const guideId = created.json().guide.id as string;
    const saved = await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.author),
      payload: { revision: 0, document: sampleDocument('# 审批说明\n检查负责人。') },
    });
    expect(saved.statusCode).toBe(200);
    expect(context.database.prepare(
      `SELECT origin_type, revision FROM flow_knowledge_snapshots WHERE guide_id = ?`,
    ).all(guideId)).toContainEqual({ origin_type: 'DRAFT', revision: 1 });

    const published = await context.app.inject({
      method: 'POST', url: `/api/guides/${guideId}/publish`, headers: authorization(context.tokens.author),
    });
    expect(published.statusCode).toBe(201);
    expect(context.database.prepare(
      `SELECT origin_type, version_id FROM flow_knowledge_snapshots WHERE guide_id = ?`,
    ).all(guideId)).toContainEqual({ origin_type: 'PUBLISHED', version_id: published.json().version.id });

    const listed = await context.app.inject({
      method: 'GET', url: `/api/workspaces/${workspaceId}/flow-snapshots`,
      headers: authorization(context.tokens.learner),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(JSON.stringify(listed.json())).not.toMatch(/position|viewport|sourceTrace|storage|url/u);
    const hits = searchKnowledge(context.database, '审批', {
      sourceKinds: ['WORKSPACE_FLOW'], workspaceId, userId: context.userIds.learner, userRole: 'LEARNER',
    });
    expect(hits.some((hit) => hit.sourceKind === 'WORKSPACE_FLOW')).toBe(true);
    expect(searchKnowledge(context.database, '审批', {
      sourceKinds: ['WORKSPACE_FLOW'], workspaceId, userId: context.userIds.otherAuthor, userRole: 'AUTHOR',
    })).toEqual([]);
    const indexedContent = context.database.prepare(
      `SELECT group_concat(fragment.content, ' ') AS content
       FROM knowledge_fragments fragment
       JOIN knowledge_documents document ON document.id = fragment.document_id
       WHERE document.flow_snapshot_id IS NOT NULL`,
    ).get() as { content: string };
    expect(indexedContent.content).not.toMatch(/position|viewport|sourceTrace|\/api\/media|storage/u);

    const publishedSnapshotId = (context.database.prepare(
      `SELECT id FROM flow_knowledge_snapshots
       WHERE guide_id = ? AND origin_type = 'PUBLISHED'`,
    ).get(guideId) as { id: string }).id;
    context.database.prepare('DELETE FROM knowledge_documents WHERE flow_snapshot_id = ?').run(publishedSnapshotId);
    expect(reconcileGuideFlowSnapshots(context.database)).toMatchObject({ indexed: 1, failed: 0 });
    expect(context.database.prepare(
      'SELECT flow_snapshot_id FROM knowledge_documents WHERE flow_snapshot_id = ?',
    ).get(publishedSnapshotId)).toEqual({ flow_snapshot_id: publishedSnapshotId });
  });

  it('does not roll back an authoritative guide save when flow indexing fails', async () => {
    const created = await context.app.inject({
      method: 'POST', url: '/api/guides', headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '索引失败仍保存' },
    });
    const guideId = created.json().guide.id as string;
    context.database.exec(`CREATE TRIGGER reject_test_flow_snapshot
      BEFORE INSERT ON flow_knowledge_snapshots BEGIN
        SELECT RAISE(ABORT, 'test flow failure');
      END`);
    const saved = await context.app.inject({
      method: 'PATCH', url: `/api/guides/${guideId}`, headers: authorization(context.tokens.author),
      payload: { revision: 0, document: sampleDocument('# 权威内容已保存') },
    });
    context.database.exec('DROP TRIGGER reject_test_flow_snapshot');
    expect(saved.statusCode).toBe(200);
    expect(saved.json().guide).toMatchObject({ revision: 1 });
    expect(context.database.prepare('SELECT revision FROM guides WHERE id = ?').get(guideId)).toEqual({ revision: 1 });
    expect(context.database.prepare(
      `SELECT status, json_extract(config_json, '$.lastFailureCode') AS failure
       FROM knowledge_sources WHERE kind = 'WORKSPACE_FLOW' AND workspace_id = ?`,
    ).get(workspaceId)).toEqual({ status: 'FAILED', failure: 'FLOW_INDEX_FAILED' });
  });
});

async function uploadMarkdown(context: TestContext, token: string, workspaceId: string, filename: string) {
  const boundary = 'guideanything-boundary';
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    'Content-Type: text/markdown\r\n\r\n# 花式纱资料\n正文\r\n' +
    `--${boundary}--\r\n`,
  );
  return context.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspaceId}/sources`,
    headers: { ...authorization(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

function fakeDocxCentralDirectory(uncompressedSize: number): Buffer {
  const entry = (name: string) => {
    const nameBytes = Buffer.from(name);
    const record = Buffer.alloc(46 + nameBytes.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(1, 20);
    record.writeUInt32LE(uncompressedSize, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    nameBytes.copy(record, 46);
    return record;
  };
  const localHeader = Buffer.alloc(4);
  localHeader.writeUInt32LE(0x04034b50, 0);
  return Buffer.concat([localHeader, entry('[Content_Types].xml'), entry('word/document.xml')]);
}

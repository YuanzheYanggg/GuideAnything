import type { MultipartFile } from '@fastify/multipart';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { deflateRawSync, deflateSync } from 'node:zlib';
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
import { searchKnowledge, searchKnowledgeInternal } from './repository';
import { buildSearchText, compileFtsQuery } from './search-text';
import { KnowledgeService } from './service';

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
      bytes: fakeDocxArchive(Buffer.from('document'), 40 * 1024 * 1024),
    })).rejects.toMatchObject({ code: 'DOCUMENT_ARCHIVE_LIMIT' });
  });

  it('bounds actual DOCX expansion independently of declared ZIP sizes', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'lying-expansion.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: fakeDocxArchive(Buffer.alloc(33 * 1024 * 1024, 0x41), 1),
    })).rejects.toMatchObject({ code: 'DOCUMENT_ARCHIVE_LIMIT' });
  });

  it('rejects overlapping DOCX ranges before inflating a shared payload', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'overlapping-ranges.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: fakeOverlappingDocxArchive(Buffer.alloc(33 * 1024 * 1024, 0x41)),
    })).rejects.toMatchObject({ code: 'DOCUMENT_ARCHIVE_INVALID' });
  });

  it('still extracts a bounded ordinary DOCX', async () => {
    const documentXml = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Hello secure DOCX</w:t></w:r></w:p></w:body></w:document>',
    );
    const extracted = await extractWorkspaceDocument({
      filename: 'ordinary.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: fakeDocxArchive(documentXml),
    });
    expect(extracted.text).toContain('Hello secure DOCX');
  });

  it('bounds actual PDF Flate expansion before invoking the document parser', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'flate-bomb.pdf',
      mimeType: 'application/pdf',
      bytes: fakePdfFlateStream(Buffer.alloc(17 * 1024 * 1024, 0x41)),
    })).rejects.toMatchObject({ code: 'DOCUMENT_PDF_EXPANSION_LIMIT' });
  });

  it('decodes escaped PDF dictionary keys before enforcing stream limits', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'escaped-filter-bomb.pdf',
      mimeType: 'application/pdf',
      bytes: fakePdfFlateStream(Buffer.alloc(17 * 1024 * 1024, 0x41), '/Fil#74er'),
    })).rejects.toMatchObject({ code: 'DOCUMENT_PDF_EXPANSION_LIMIT' });
  });

  it('ignores PDF comments containing endobj while locating a real stream', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'commented-stream-bomb.pdf',
      mimeType: 'application/pdf',
      bytes: fakePdfFlateStream(Buffer.alloc(17 * 1024 * 1024, 0x41), '/Filter', '% endobj\n'),
    })).rejects.toMatchObject({ code: 'DOCUMENT_PDF_EXPANSION_LIMIT' });
  });

  it('rejects PDF predictor expansion that is not covered by the Flate byte cap', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'predictor-bomb.pdf',
      mimeType: 'application/pdf',
      bytes: fakePdfPredictorStream(),
    })).rejects.toMatchObject({ code: 'DOCUMENT_PDF_FILTER_UNSUPPORTED' });
  });

  it('rejects an oversized declared PDF page tree before parser recovery', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'page-tree-bomb.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from(
        '%PDF-1.7\n1 0 obj\n<< /Type /Pages /Count 1001 /Kids [] >>\nendobj\n%%EOF\n',
      ),
    })).rejects.toMatchObject({ code: 'DOCUMENT_PDF_PAGE_LIMIT' });
  });

  it('reads PDF page counts only from the top-level page-tree dictionary', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'nested-page-count-bomb.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from(
        '%PDF-1.7\n1 0 obj\n' +
        '<< /Ty#70e /Pa#67es /Metadata << /Count 1 >> /Co#75nt 1001 /Kids [] >>\nendobj\n%%EOF\n',
      ),
    })).rejects.toMatchObject({ code: 'DOCUMENT_PDF_PAGE_LIMIT' });
  });

  it('rejects oversized PDF xref ranges before parser iteration', async () => {
    await expect(extractWorkspaceDocument({
      filename: 'xref-bomb.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from(
        '%PDF-1.7\n1 0 obj\n<< /Type /Pages /Count 1 /Kids [] >>\nendobj\n' +
        'xref\n0 999999999\ntrailer\n<< /Size 2 >>\n%%EOF\n',
      ),
    })).rejects.toMatchObject({ code: 'DOCUMENT_PDF_STRUCTURE_LIMIT' });
  });

  it('still extracts a bounded ordinary PDF', async () => {
    const extracted = await extractWorkspaceDocument({
      filename: 'ordinary.pdf',
      mimeType: 'application/pdf',
      bytes: fakeTextPdf(),
    });
    expect(extracted.text).toContain('Hello secure PDF');
  });

  it('still extracts a common single-Flate filter-array PDF', async () => {
    const extracted = await extractWorkspaceDocument({
      filename: 'ordinary-flate.pdf',
      mimeType: 'application/pdf',
      bytes: fakeTextPdf(true),
    });
    expect(extracted.text).toContain('Hello secure PDF');
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

  it('rechecks persistent upload permission after streaming and extraction', async () => {
    const service = new KnowledgeService(context.database, join(root, 'uploads'));
    const stream = Readable.from((async function* () {
      yield Buffer.from('# 中途撤权资料\n');
      context.database.prepare(
        'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      ).run(workspaceId, context.userIds.editor);
      yield Buffer.from('不得创建持久 source。');
    })());
    const file = {
      filename: 'revoked.md',
      mimetype: 'text/markdown',
      file: stream,
    } as unknown as MultipartFile;

    await expect(service.uploadWorkspaceSource(
      { id: context.userIds.editor, role: 'EDITOR' },
      workspaceId,
      file,
    )).rejects.toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
    expect(context.database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_sources WHERE kind = 'WORKSPACE_DOCUMENT'`,
    ).get()).toEqual({ count: 0 });
    expect(await readdir(join(root, 'uploads', 'knowledge')).catch(() => [])).toEqual([]);
  });

  it('applies workspace scope before the bounded FTS candidate window', () => {
    const noiseWorkspaceId = 'workspace-knowledge-noise';
    seedTestWorkspace(context.database, context.userIds.otherAuthor, {
      id: noiseWorkspaceId, slug: 'knowledge-noise', name: '噪声工作区',
    });
    seedWorkspaceSearchSource(
      context,
      'source-noise',
      noiseWorkspaceId,
      context.userIds.otherAuthor,
      Array.from({ length: 201 }, (_, index) => `document-a-${String(index).padStart(3, '0')}`),
    );
    seedWorkspaceSearchSource(
      context,
      'source-target',
      workspaceId,
      context.userIds.author,
      ['document-z-target'],
    );

    const hits = searchKnowledgeInternal(context.database, '共同术语', {
      sourceKinds: ['WORKSPACE_DOCUMENT'],
      workspaceId,
      userId: context.userIds.author,
      limit: 1,
    });

    expect(hits.map(({ hit }) => hit.documentId)).toEqual(['document-z-target']);
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

function seedWorkspaceSearchSource(
  context: TestContext,
  sourceId: string,
  workspaceId: string,
  createdBy: string,
  documentIds: string[],
): void {
  const now = '2026-07-15T00:00:00.000Z';
  context.database.prepare(
    `INSERT INTO knowledge_sources (
      id, scope, kind, workspace_id, conversation_id, created_by,
      status, revision, config_json, created_at, updated_at
    ) VALUES (?, 'WORKSPACE', 'WORKSPACE_DOCUMENT', ?, NULL, ?,
              'READY', 'search-r1', '{}', ?, ?)`,
  ).run(sourceId, workspaceId, createdBy, now, now);
  const insertDocument = context.database.prepare(
    `INSERT INTO knowledge_documents (
      id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
      parse_status, metadata_json, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, '共同术语资料', ?, 'search-r1', 'READY', ?, ?, ?)`,
  );
  const insertFragment = context.database.prepare(
    `INSERT INTO knowledge_fragments (
      id, document_id, ordinal, title, heading, content, search_text,
      internal_locator_json, created_at, updated_at
    ) VALUES (?, ?, 0, '共同术语资料', NULL, '共同术语正文', ?, ?, ?, ?)`,
  );
  for (const documentId of documentIds) {
    const fragmentId = `fragment-${documentId}`;
    insertDocument.run(
      documentId,
      sourceId,
      `${documentId}.md`,
      documentId,
      JSON.stringify({ sourceKind: 'WORKSPACE_DOCUMENT' }),
      now,
      now,
    );
    insertFragment.run(
      fragmentId,
      documentId,
      buildSearchText(['共同术语']),
      JSON.stringify({ kind: 'WORKSPACE_DOCUMENT', documentId, fragmentId, revision: 'search-r1' }),
      now,
      now,
    );
  }
}

function fakeDocxArchive(documentBytes: Buffer, declaredDocumentSize = documentBytes.length): Buffer {
  const entries = [
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types/>'), declaredSize: 8 },
    { name: 'word/document.xml', bytes: documentBytes, declaredSize: declaredDocumentSize },
  ];
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const compressed = deflateRawSync(entry.bytes);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.declaredSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localRecords.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.declaredSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function fakeOverlappingDocxArchive(expanded: Buffer): Buffer {
  const compressed = deflateRawSync(expanded);
  const definitions = [
    { name: '[Content_Types].xml', offset: 0 },
    { name: 'word/document.xml', offset: 128 },
  ];
  const sharedDataOffset = 512;
  const localArea = Buffer.alloc(sharedDataOffset);
  const centralRecords: Buffer[] = [];
  for (const definition of definitions) {
    const name = Buffer.from(definition.name);
    const local = definition.offset;
    localArea.writeUInt32LE(0x04034b50, local);
    localArea.writeUInt16LE(20, local + 4);
    localArea.writeUInt16LE(8, local + 8);
    localArea.writeUInt32LE(compressed.length, local + 18);
    localArea.writeUInt32LE(1, local + 22);
    localArea.writeUInt16LE(name.length, local + 26);
    localArea.writeUInt16LE(sharedDataOffset - (local + 30 + name.length), local + 28);
    name.copy(localArea, local + 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(1, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(local, 42);
    name.copy(central, 46);
    centralRecords.push(central);
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const centralOffset = sharedDataOffset + compressed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(definitions.length, 8);
  end.writeUInt16LE(definitions.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([localArea, compressed, centralDirectory, end]);
}

function fakePdfFlateStream(expanded: Buffer, filterKey = '/Filter', beforeStream = ''): Buffer {
  const compressed = deflateSync(expanded);
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Pages /Count 1 /Kids [] >>\nendobj\n' +
      `2 0 obj\n<< /Length ${compressed.length} ${filterKey} /FlateDecode >>\n${beforeStream}stream\n`),
    compressed,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  ]);
}

function fakePdfPredictorStream(): Buffer {
  const compressed = deflateSync(Buffer.from([0, 0]));
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Pages /Count 1 /Kids [] >>\nendobj\n' +
      `2 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode ` +
      '/DecodeParms << /Predictor 12 /Columns 17000000 >> >>\nstream\n'),
    compressed,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  ]);
}

function fakeTextPdf(flate = false): Buffer {
  const content = Buffer.from('BT /F1 12 Tf 72 72 Td (Hello secure PDF) Tj ET');
  const streamContent = flate ? deflateSync(content) : content;
  const bodies: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.concat([
      Buffer.from(`<< /Length ${streamContent.length}${flate ? ' /Filter [/FlateDecode]' : ''} >>\nstream\n`),
      streamContent,
      Buffer.from('\nendstream'),
    ]),
  ];
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [0];
  let offset = chunks[0]!.length;
  for (let index = 0; index < bodies.length; index += 1) {
    offsets.push(offset);
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      bodies[index]!,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(object);
    offset += object.length;
  }
  const xrefOffset = offset;
  const xref = [
    'xref',
    `0 ${bodies.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${bodies.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

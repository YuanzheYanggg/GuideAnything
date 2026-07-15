import { describe, expect, it } from 'vitest';

import {
  KnowledgeDocumentV1Schema,
  KnowledgeHealthV1Schema,
  KnowledgeSearchHitV1Schema,
} from './knowledge';

describe('path-free knowledge DTOs', () => {
  it('parses opaque search and document projections', () => {
    const hit = KnowledgeSearchHitV1Schema.parse({
      sourceKind: 'SANTEXWELL',
      documentId: 'doc-1',
      fragmentId: 'fragment-1',
      title: '花式纱线',
      heading: '分类',
      excerpt: '花式纱线可按结构与成纱方式分类。',
      pageType: 'concept',
      status: 'active',
      reviewState: 'review',
      evidenceStatus: 'sourced',
      evidenceRole: 'SUPPORT',
      revision: 'revision-1',
      indexedAt: '2026-07-15T00:00:00.000Z',
      rawEvidenceAvailable: true,
      href: '/knowledge/santexwell/documents/doc-1?fragment=fragment-1',
      score: 900,
    });
    expect(hit).not.toHaveProperty('path');

    const document = KnowledgeDocumentV1Schema.parse({
      sourceKind: hit.sourceKind,
      documentId: hit.documentId,
      title: hit.title,
      pageType: hit.pageType,
      status: hit.status,
      reviewState: hit.reviewState,
      evidenceStatus: hit.evidenceStatus,
      revision: hit.revision,
      indexedAt: hit.indexedAt,
      rawEvidenceAvailable: hit.rawEvidenceAvailable,
      aliases: ['Fancy yarn'],
      tags: ['hub/fancy-yarn'],
      sections: [{ fragmentId: 'fragment-1', heading: '分类', content: '正文' }],
      resolvedLinks: [{ documentId: 'doc-2', title: '纺纱方式' }],
      unresolvedLinkCount: 0,
    });
    expect(JSON.stringify(document)).not.toMatch(/wiki_v2|raw\/|\/Users\//u);
  });

  it('rejects unknown path-bearing fields and unsafe health reasons', () => {
    expect(KnowledgeSearchHitV1Schema.safeParse({
      sourceKind: 'SANTEXWELL',
      documentId: 'doc-1',
      fragmentId: 'fragment-1',
      title: '标题',
      excerpt: '摘要',
      evidenceRole: 'SUPPORT',
      revision: 'revision-1',
      indexedAt: '2026-07-15T00:00:00.000Z',
      rawEvidenceAvailable: false,
      href: '/knowledge/santexwell/documents/doc-1?fragment=fragment-1',
      score: 10,
      relativePath: 'wiki_v2/concepts/x.md',
    }).success).toBe(false);
    expect(KnowledgeHealthV1Schema.safeParse({
      status: 'DEGRADED', revision: null, indexedDocuments: 0, indexedFragments: 0,
      harnessRevision: null, harnessFileCount: 0, reasonCodes: ['/Users/private'], indexedAt: null,
    }).success).toBe(false);
  });
});

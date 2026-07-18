import { z } from 'zod';

const IdSchema = z.string().min(1).max(200);
const WorkspaceFolderIdSchema = IdSchema.refine(
  (value) => !value.includes('/') && !value.includes('\\'),
  'folder ID must be an opaque logical identifier',
);
const TimestampSchema = z.string().datetime();
const SafeProductHrefSchema = z.string().min(1).max(1_000).refine((value) =>
  value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !value.split(/[/?#]/u).includes('..')
    && !/(?:^|\/)raw(?:\/|$)|wiki_v2|\/Users\//iu.test(value),
  'href must be a backend-generated product-relative path',
);

export const KnowledgeSourceKindV1Schema = z.enum([
  'SANTEXWELL',
  'WORKSPACE_DOCUMENT',
  'WORKSPACE_FLOW',
  'SESSION_ATTACHMENT',
]);

export const KnowledgePageTypeV1Schema = z.enum([
  'index',
  'moc',
  'concept',
  'source-digest',
  'procedure',
  'case',
  'analysis',
]);

export const KnowledgeDocumentStatusV1Schema = z.enum([
  'active',
  'candidate',
]);

export const KnowledgeReviewStateV1Schema = z.enum(['review', 'draft', 'approved']);
export const KnowledgeEvidenceStatusV1Schema = z.enum([
  'sourced',
  'derived-from-source',
  'mixed',
  'index-only',
  'needs-review',
  'insufficient',
]);

export const KnowledgeSourceProfileV1Schema = z.object({
  cluster: z.enum(['textile-knowledge', 'quality-ops', 'complaint-case']),
  bucket: z.enum(['judge', 'engineering', 'operational', 'case', 'supplement', 'clue']),
  coverage: z.enum(['overview', 'branch', 'property', 'family', 'application', 'risk-control', 'case-specific']),
  crossClusterPolicy: z.enum(['direct', 'hub-only']),
  attention: z.number().int().min(0).max(100),
}).strict();

export const KnowledgeSearchHitV1Schema = z.object({
  sourceKind: KnowledgeSourceKindV1Schema,
  documentId: IdSchema,
  fragmentId: IdSchema,
  title: z.string().min(1).max(500),
  heading: z.string().min(1).max(500).optional(),
  excerpt: z.string().min(1).max(2_000),
  pageType: KnowledgePageTypeV1Schema.optional(),
  status: KnowledgeDocumentStatusV1Schema.optional(),
  reviewState: KnowledgeReviewStateV1Schema.optional(),
  evidenceStatus: KnowledgeEvidenceStatusV1Schema.optional(),
  sourceProfile: KnowledgeSourceProfileV1Schema.optional(),
  evidenceRole: z.enum(['SUPPORT', 'DISCOVERY', 'NAVIGATION']),
  revision: z.string().min(1).max(200),
  indexedAt: TimestampSchema,
  rawEvidenceAvailable: z.boolean(),
  href: SafeProductHrefSchema,
  score: z.number().min(0).max(1_000),
}).strict().superRefine((hit, context) => {
  if (hit.sourceKind === 'SANTEXWELL') {
    const expected = `/knowledge/santexwell/documents/${encodeURIComponent(hit.documentId)}?fragment=${encodeURIComponent(hit.fragmentId)}`;
    if (hit.href !== expected) context.addIssue({ code: 'custom', path: ['href'], message: 'Santexwell href 与 opaque identity 不匹配' });
  }
});

export const KnowledgeSectionV1Schema = z.object({
  fragmentId: IdSchema,
  heading: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(10_000),
}).strict();

export const KnowledgeResolvedLinkV1Schema = z.object({
  documentId: IdSchema,
  title: z.string().min(1).max(500),
  heading: z.string().min(1).max(500).optional(),
}).strict();

export const KnowledgeDocumentV1Schema = z.object({
  sourceKind: KnowledgeSourceKindV1Schema,
  documentId: IdSchema,
  title: z.string().min(1).max(500),
  aliases: z.array(z.string().min(1).max(500)).max(256),
  tags: z.array(z.string().min(1).max(200)).max(512),
  pageType: KnowledgePageTypeV1Schema.optional(),
  status: KnowledgeDocumentStatusV1Schema.optional(),
  reviewState: KnowledgeReviewStateV1Schema.optional(),
  evidenceStatus: KnowledgeEvidenceStatusV1Schema.optional(),
  sourceProfile: KnowledgeSourceProfileV1Schema.optional(),
  revision: z.string().min(1).max(200),
  indexedAt: TimestampSchema,
  rawEvidenceAvailable: z.boolean(),
  sections: z.array(KnowledgeSectionV1Schema).max(2_000),
  resolvedLinks: z.array(KnowledgeResolvedLinkV1Schema).max(2_000),
  unresolvedLinkCount: z.number().int().min(0).max(100_000),
}).strict();

export const KnowledgeHealthV1Schema = z.object({
  status: z.enum(['READY', 'DEGRADED', 'UNAVAILABLE']),
  revision: z.string().min(1).max(200).nullable(),
  indexedDocuments: z.number().int().min(0),
  indexedFragments: z.number().int().min(0),
  harnessRevision: z.string().min(1).max(200).nullable(),
  harnessFileCount: z.number().int().min(0).max(16),
  reasonCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/).max(80)).max(32),
  indexedAt: TimestampSchema.nullable(),
}).strict();

export const WorkspaceSourceV1Schema = z.object({
  sourceId: IdSchema,
  documentId: IdSchema,
  title: z.string().min(1).max(500),
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  size: z.number().int().min(0),
  status: z.enum(['PENDING', 'INDEXING', 'READY', 'FAILED']),
  parseStatus: z.enum(['PENDING', 'READY', 'FAILED']),
  revision: z.string().min(1).max(200),
  failureCode: z.string().regex(/^[A-Z0-9_]+$/).max(80).optional(),
  failureMessage: z.string().min(1).max(500).optional(),
  folderId: WorkspaceFolderIdSchema.nullable().default(null),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export const FlowSnapshotSummaryV1Schema = z.object({
  snapshotId: IdSchema,
  sourceId: IdSchema,
  documentId: IdSchema,
  guideId: IdSchema,
  guideTitle: z.string().min(1).max(200),
  origin: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('DRAFT'), revision: z.number().int().min(0) }).strict(),
    z.object({
      kind: z.literal('PUBLISHED'),
      versionId: IdSchema,
      version: z.number().int().positive(),
    }).strict(),
  ]),
  nodeCount: z.number().int().min(0),
  status: z.enum(['READY', 'FAILED', 'STALE']),
  href: SafeProductHrefSchema.nullable(),
  invalidReason: z.string().regex(/^[A-Z0-9_]+$/).max(80).optional(),
  createdAt: TimestampSchema,
}).strict();

export const WorkspaceSourcesResponseV1Schema = z.object({
  workspaceId: IdSchema,
  workspacePermission: z.enum(['OWNER', 'EDIT', 'VIEW']),
  capabilities: z.object({ canUploadPersistentSource: z.boolean() }).strict(),
  items: z.array(WorkspaceSourceV1Schema).max(10_000),
}).strict();

export const KnowledgeMocSummaryV1Schema = z.object({
  documentId: IdSchema,
  title: z.string().min(1).max(500),
  summary: z.string().max(1_000),
  href: SafeProductHrefSchema,
}).strict();

export const KnowledgeClusterSummaryV1Schema = z.object({
  cluster: z.enum(['textile-knowledge', 'quality-ops', 'complaint-case']),
  documentCount: z.number().int().min(0),
  supportCount: z.number().int().min(0),
  discoveryCount: z.number().int().min(0),
}).strict();

export type KnowledgeSearchHitV1 = z.infer<typeof KnowledgeSearchHitV1Schema>;
export type KnowledgeDocumentV1 = z.infer<typeof KnowledgeDocumentV1Schema>;
export type KnowledgeHealthV1 = z.infer<typeof KnowledgeHealthV1Schema>;
export type WorkspaceSourceV1 = z.infer<typeof WorkspaceSourceV1Schema>;
export type FlowSnapshotSummaryV1 = z.infer<typeof FlowSnapshotSummaryV1Schema>;
export type WorkspaceSourcesResponseV1 = z.infer<typeof WorkspaceSourcesResponseV1Schema>;
export type KnowledgeMocSummaryV1 = z.infer<typeof KnowledgeMocSummaryV1Schema>;
export type KnowledgeClusterSummaryV1 = z.infer<typeof KnowledgeClusterSummaryV1Schema>;

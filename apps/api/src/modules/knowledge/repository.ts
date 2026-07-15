import {
  KnowledgeClusterSummaryV1Schema,
  KnowledgeDocumentV1Schema,
  KnowledgeHealthV1Schema,
  KnowledgeMocSummaryV1Schema,
  KnowledgeSearchHitV1Schema,
  WorkspaceSourceV1Schema,
  type KnowledgeClusterSummaryV1,
  type KnowledgeDocumentV1,
  type KnowledgeHealthV1,
  type KnowledgeMocSummaryV1,
  type KnowledgeSearchHitV1,
  type WorkspaceSourceV1,
} from '@guideanything/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { CanonicalFrontmatter, ParsedMarkdownFragment, ParsedWikiLink } from './markdown';
import { getWorkspacePermission } from '../workspaces/repository';
import { buildSearchText, compileFtsQuery, isSingleCjkQuery, normalizeKnowledgeText } from './search-text';
import { sanitizeVaultControlledList, sanitizeVaultControlledText } from './vault-text';

export const SANTEXWELL_SOURCE_ID = 'source-santexwell-vault';
const PUBLIC_EXCERPT_LENGTH = 600;

export interface InternalDocumentRow {
  id: string;
  sourceId: string;
  relativeLocator: string;
  title: string;
  checksum: string;
  revision: string;
  parseStatus: 'PENDING' | 'READY' | 'FAILED';
  metadata: InternalDocumentMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface InternalResolvedLink {
  target: string;
  heading?: string;
  label?: string;
  resolvedDocumentId?: string;
  resolvedTitle?: string;
  ambiguous?: boolean;
}

export interface InternalDocumentMetadata {
  sourceKind: 'SANTEXWELL' | 'WORKSPACE_DOCUMENT' | 'WORKSPACE_FLOW' | 'SESSION_ATTACHMENT';
  aliases?: string[];
  tags?: string[];
  pageType?: CanonicalFrontmatter['pageType'];
  status?: CanonicalFrontmatter['status'];
  reviewState?: CanonicalFrontmatter['reviewState'];
  evidenceStatus?: CanonicalFrontmatter['evidenceStatus'];
  sourceProfile?: CanonicalFrontmatter['sourceProfile'];
  rawEvidenceAvailable?: boolean;
  sourcePaths?: string[];
  links?: InternalResolvedLink[];
  unresolvedLinkCount?: number;
  originalName?: string;
  mimeType?: string;
  size?: number;
  failureCode?: string;
  guideId?: string;
  guideTitle?: string;
  origin?: { kind: 'DRAFT'; revision: number } | { kind: 'PUBLISHED'; versionId: string; version: number };
}

export interface CanonicalDocumentInput {
  id: string;
  relativeLocator: string;
  checksum: string;
  frontmatter: CanonicalFrontmatter;
  fragments: ParsedMarkdownFragment[];
  links: InternalResolvedLink[];
  rawEvidenceAvailable: boolean;
  sourcePaths: string[];
}

export interface KnowledgeSearchScope {
  sourceKinds: Array<'SANTEXWELL' | 'WORKSPACE_DOCUMENT' | 'WORKSPACE_FLOW' | 'SESSION_ATTACHMENT'>;
  workspaceId?: string;
  conversationId?: string;
  userId?: string;
  userRole?: string;
  pageTypes?: CanonicalFrontmatter['pageType'][];
  statuses?: CanonicalFrontmatter['status'][];
  cluster?: NonNullable<CanonicalFrontmatter['sourceProfile']>['cluster'];
  bucket?: NonNullable<CanonicalFrontmatter['sourceProfile']>['bucket'];
  coverage?: NonNullable<CanonicalFrontmatter['sourceProfile']>['coverage'];
  minimumAttention?: number;
  limit?: number;
}

export function ensureSantexwellSource(database: DatabaseSync): void {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO knowledge_sources (
      id, scope, kind, workspace_id, conversation_id, created_by,
      status, revision, config_json, created_at, updated_at
    ) VALUES (?, 'GLOBAL', 'SANTEXWELL_VAULT', NULL, NULL, NULL,
      'UNAVAILABLE', 'unindexed', ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`,
  ).run(SANTEXWELL_SOURCE_ID, JSON.stringify({ reasonCodes: ['NOT_INDEXED'] }), now, now);
}

export function listSourceDocuments(database: DatabaseSync, sourceId: string): InternalDocumentRow[] {
  const rows = database.prepare(
    `SELECT id, source_id, relative_locator, title, checksum, revision, parse_status,
            metadata_json, created_at, updated_at
     FROM knowledge_documents WHERE source_id = ? ORDER BY relative_locator, updated_at DESC`,
  ).all(sourceId) as unknown as DatabaseDocumentRow[];
  const seen = new Set<string>();
  const result: InternalDocumentRow[] = [];
  for (const row of rows) {
    if (seen.has(row.relative_locator)) continue;
    seen.add(row.relative_locator);
    result.push(mapInternalDocument(row));
  }
  return result;
}

export function publishCanonicalVaultGeneration(
  database: DatabaseSync,
  input: {
    documents: CanonicalDocumentInput[];
    revision: string;
    harnessRevision: string;
    harnessFileCount: number;
    indexedFragments: number;
  },
): { changedDocuments: number } {
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    let changedDocuments = 0;
    for (const document of input.documents) {
      if (writeCanonicalDocument(database, document, now)) changedDocuments += 1;
    }

    const seenDocumentIds = new Set(input.documents.map((document) => document.id));
    const existing = listSourceDocuments(database, SANTEXWELL_SOURCE_ID);
    const remove = database.prepare('DELETE FROM knowledge_documents WHERE id = ? AND source_id = ?');
    for (const document of existing) {
      if (!seenDocumentIds.has(document.id)) remove.run(document.id, SANTEXWELL_SOURCE_ID);
    }
    database.prepare(
      `UPDATE knowledge_sources
       SET status = 'READY', revision = ?, config_json = ?, updated_at = ? WHERE id = ?`,
    ).run(input.revision, JSON.stringify({
      harnessRevision: input.harnessRevision,
      harnessFileCount: input.harnessFileCount,
      indexedDocuments: input.documents.length,
      indexedFragments: input.indexedFragments,
      reasonCodes: [],
      indexedAt: now,
    }), now, SANTEXWELL_SOURCE_ID);
    database.exec('COMMIT');
    return { changedDocuments };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function writeCanonicalDocument(database: DatabaseSync, input: CanonicalDocumentInput, now: string): boolean {
  const metadata: InternalDocumentMetadata = {
    sourceKind: 'SANTEXWELL',
    aliases: input.frontmatter.aliases,
    tags: input.frontmatter.tags,
    pageType: input.frontmatter.pageType,
    status: input.frontmatter.status,
    reviewState: input.frontmatter.reviewState,
    evidenceStatus: input.frontmatter.evidenceStatus,
    ...(input.frontmatter.sourceProfile ? { sourceProfile: input.frontmatter.sourceProfile } : {}),
    rawEvidenceAvailable: input.rawEvidenceAvailable,
    sourcePaths: input.sourcePaths,
    links: input.links,
    unresolvedLinkCount: input.links.filter((link) => !link.resolvedDocumentId).length,
  };
  const existing = database.prepare(
    `SELECT id, checksum FROM knowledge_documents WHERE id = ?`,
  ).get(input.id) as { id: string; checksum: string } | undefined;
  const unchangedContent = existing?.checksum === input.checksum;
  const metadataJson = JSON.stringify(metadata);
  if (!existing) {
    database.prepare(
      `INSERT INTO knowledge_documents (
        id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
        parse_status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'READY', ?, ?, ?)`,
    ).run(
      input.id, SANTEXWELL_SOURCE_ID, input.relativeLocator, input.frontmatter.title,
      input.checksum, input.checksum, metadataJson, now, now,
    );
  } else {
    database.prepare(
      `UPDATE knowledge_documents
       SET relative_locator = ?, title = ?, checksum = ?, revision = ?,
           parse_status = 'READY', metadata_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.relativeLocator, input.frontmatter.title, input.checksum, input.checksum,
      metadataJson, now, input.id,
    );
  }
  if (!unchangedContent) {
    database.prepare('DELETE FROM knowledge_fragments WHERE document_id = ?').run(input.id);
    insertCanonicalFragments(database, input, now);
  }
  return !unchangedContent;
}

export function markVaultScanFailure(
  database: DatabaseSync,
  reasonCodes: string[],
  harness?: { revision: string; fileCount: number },
): 'DEGRADED' | 'UNAVAILABLE' {
  ensureSantexwellSource(database);
  const source = database.prepare(
    `SELECT revision, config_json FROM knowledge_sources WHERE id = ?`,
  ).get(SANTEXWELL_SOURCE_ID) as { revision: string; config_json: string };
  const hasLastGood = source.revision !== 'unindexed';
  const status = hasLastGood ? 'STALE' : 'UNAVAILABLE';
  const now = new Date().toISOString();
  const previous = safeObject(source.config_json);
  database.prepare(
    `UPDATE knowledge_sources SET status = ?, config_json = ?, updated_at = ? WHERE id = ?`,
  ).run(status, JSON.stringify({
    ...(source.revision !== 'unindexed' ? {
      indexedDocuments: safeInteger(previous.indexedDocuments),
      indexedFragments: safeInteger(previous.indexedFragments),
      indexedAt: safeTimestamp(previous.indexedAt),
    } : {}),
    reasonCodes: normalizeReasonCodes(reasonCodes),
    ...(harness ? { harnessRevision: harness.revision, harnessFileCount: harness.fileCount } : {}),
  }), now, SANTEXWELL_SOURCE_ID);
  return hasLastGood ? 'DEGRADED' : 'UNAVAILABLE';
}

export function getSantexwellHealth(database: DatabaseSync): KnowledgeHealthV1 {
  ensureSantexwellSource(database);
  const row = database.prepare(
    `SELECT status, revision, config_json FROM knowledge_sources WHERE id = ?`,
  ).get(SANTEXWELL_SOURCE_ID) as { status: string; revision: string; config_json: string };
  const config = safeObject(row.config_json);
  const status = row.status === 'READY' ? 'READY' : row.revision === 'unindexed' ? 'UNAVAILABLE' : 'DEGRADED';
  return KnowledgeHealthV1Schema.parse({
    status,
    revision: row.revision === 'unindexed' ? null : row.revision,
    indexedDocuments: safeInteger(config.indexedDocuments),
    indexedFragments: safeInteger(config.indexedFragments),
    harnessRevision: safeString(config.harnessRevision),
    harnessFileCount: safeInteger(config.harnessFileCount),
    reasonCodes: normalizeReasonCodes(Array.isArray(config.reasonCodes) ? config.reasonCodes.filter(isString) : []),
    indexedAt: safeTimestamp(config.indexedAt),
  });
}

export function getSantexwellOverview(database: DatabaseSync): {
  mocs: KnowledgeMocSummaryV1[];
  clusters: KnowledgeClusterSummaryV1[];
} {
  const rows = database.prepare(
    `SELECT d.id, d.title, d.metadata_json,
            (SELECT content FROM knowledge_fragments f
             WHERE f.document_id = d.id ORDER BY f.ordinal LIMIT 1) AS content
     FROM knowledge_documents d
     JOIN knowledge_sources source ON source.id = d.source_id
     WHERE d.source_id = ? AND d.parse_status = 'READY'
       AND source.status IN ('READY', 'STALE')
     ORDER BY d.title, d.id`,
  ).all(SANTEXWELL_SOURCE_ID) as unknown as Array<{
    id: string;
    title: string;
    metadata_json: string;
    content: string | null;
  }>;
  const mocs: KnowledgeMocSummaryV1[] = [];
  const clusterCounts = new Map<KnowledgeClusterSummaryV1['cluster'], {
    documentCount: number;
    supportCount: number;
    discoveryCount: number;
  }>();
  for (const row of rows) {
    const metadata = parseMetadata(row.metadata_json);
    if (metadata.pageType === 'moc') {
      const title = sanitizeVaultControlledText(row.title);
      if (!title) continue;
      mocs.push({
        documentId: row.id,
        title,
        summary: sanitizeExcerpt(sanitizeVaultControlledText(row.content ?? '')).slice(0, 1_000),
        href: `/knowledge/santexwell/documents/${encodeURIComponent(row.id)}`,
      });
    }
    const cluster = metadata.sourceProfile?.cluster;
    if (!cluster) continue;
    const counts = clusterCounts.get(cluster) ?? { documentCount: 0, supportCount: 0, discoveryCount: 0 };
    counts.documentCount += 1;
    if (knowledgeEvidenceRole(metadata) === 'SUPPORT') counts.supportCount += 1;
    else counts.discoveryCount += 1;
    clusterCounts.set(cluster, counts);
  }
  const clusters = (['textile-knowledge', 'quality-ops', 'complaint-case'] as const).map((cluster) => ({
    cluster,
    ...(clusterCounts.get(cluster) ?? { documentCount: 0, supportCount: 0, discoveryCount: 0 }),
  }));
  return {
    mocs: mocs.map((moc) => KnowledgeMocSummaryV1Schema.parse(moc)),
    clusters: clusters.map((cluster) => KnowledgeClusterSummaryV1Schema.parse(cluster)),
  };
}

export function searchKnowledge(
  database: DatabaseSync,
  query: string,
  scope: KnowledgeSearchScope,
): KnowledgeSearchHitV1[] {
  const limit = Math.min(Math.max(scope.limit ?? 20, 1), 50);
  if (normalizeKnowledgeText(query).length === 0 || scope.sourceKinds.length === 0) return [];
  const rows = isSingleCjkQuery(query)
    ? singleCharacterCandidates(database, query, scope, limit)
    : ftsCandidates(database, query, scope, Math.min(Math.max(limit * 20, 200), 1_000));
  const normalizedQuery = normalizeKnowledgeText(query);
  const hits = rows
    .filter((row) => documentMatchesScope(database, row, scope))
    .map((row) => toSearchCandidate(row, normalizedQuery))
    .filter((candidate): candidate is SearchCandidate => candidate !== null)
    .sort(compareCandidates);
  const seen = new Set<string>();
  const result: KnowledgeSearchHitV1[] = [];
  for (const candidate of hits) {
    if (seen.has(candidate.hit.documentId)) continue;
    seen.add(candidate.hit.documentId);
    result.push(candidate.hit);
    if (result.length >= limit) break;
  }
  return result;
}

export interface InternalKnowledgeSearchHit {
  hit: KnowledgeSearchHitV1;
  locator: Record<string, unknown>;
}

export function searchKnowledgeInternal(
  database: DatabaseSync,
  query: string,
  scope: KnowledgeSearchScope,
): InternalKnowledgeSearchHit[] {
  return searchKnowledge(database, query, scope).flatMap((hit) => {
    const row = database.prepare(
      `SELECT internal_locator_json FROM knowledge_fragments
       WHERE id = ? AND document_id = ?`,
    ).get(hit.fragmentId, hit.documentId) as { internal_locator_json: string } | undefined;
    if (!row) return [];
    try {
      const locator = JSON.parse(row.internal_locator_json) as unknown;
      if (!locator || typeof locator !== 'object' || Array.isArray(locator)) return [];
      return [{ hit, locator: locator as Record<string, unknown> }];
    } catch {
      return [];
    }
  });
}

export function getInternalKnowledgeDocument(
  database: DatabaseSync,
  documentId: string,
): InternalDocumentRow | null {
  const row = database.prepare(
    `SELECT id, source_id, relative_locator, title, checksum, revision, parse_status,
            metadata_json, created_at, updated_at
     FROM knowledge_documents WHERE id = ?`,
  ).get(documentId) as unknown as DatabaseDocumentRow | undefined;
  return row ? mapInternalDocument(row) : null;
}

export function getKnowledgeDocument(
  database: DatabaseSync,
  documentId: string,
  scope: KnowledgeSearchScope,
): KnowledgeDocumentV1 | null {
  const row = database.prepare(
    `SELECT d.id, d.source_id, d.relative_locator, d.title, d.checksum, d.revision,
            d.parse_status, d.metadata_json, d.created_at, d.updated_at,
            s.kind AS source_kind, s.workspace_id, s.conversation_id
     FROM knowledge_documents d JOIN knowledge_sources s ON s.id = d.source_id
     WHERE d.id = ? AND d.parse_status = 'READY'
       AND s.status IN ('READY', 'STALE')`,
  ).get(documentId) as unknown as SearchRow | undefined;
  if (!row || !documentMatchesScope(database, row, scope)) return null;
  const metadata = parseMetadata(row.metadata_json);
  const fragments = database.prepare(
    `SELECT id, heading, content FROM knowledge_fragments
     WHERE document_id = ? ORDER BY ordinal LIMIT 2000`,
  ).all(documentId) as unknown as Array<{ id: string; heading: string | null; content: string }>;
  const sanitizeVault = metadata.sourceKind === 'SANTEXWELL';
  const title = sanitizeVault ? sanitizeVaultControlledText(row.title) : row.title;
  if (!title) return null;
  const links = (metadata.links ?? [])
    .filter((link) => link.resolvedDocumentId && link.resolvedTitle)
    .slice(0, 2_000)
    .flatMap((link) => {
      const linkTitle = sanitizeVault ? sanitizeVaultControlledText(link.resolvedTitle!) : link.resolvedTitle!;
      const linkHeading = sanitizeVault && link.heading ? sanitizeVaultControlledText(link.heading) : link.heading;
      if (!linkTitle) return [];
      return [{
        documentId: link.resolvedDocumentId!,
        title: linkTitle,
        ...(linkHeading ? { heading: linkHeading } : {}),
      }];
    });
  const sections = fragments.flatMap((fragment) => {
    const content = sanitizeVault ? sanitizeVaultControlledText(fragment.content) : fragment.content;
    const heading = sanitizeVault && fragment.heading
      ? sanitizeVaultControlledText(fragment.heading)
      : fragment.heading;
    if (!content) return [];
    return [{
      fragmentId: fragment.id,
      ...(heading ? { heading } : {}),
      content: content.slice(0, 10_000),
    }];
  });
  return KnowledgeDocumentV1Schema.parse({
    sourceKind: metadata.sourceKind,
    documentId: row.id,
    title,
    aliases: sanitizeVault ? sanitizeVaultControlledList(metadata.aliases ?? []) : metadata.aliases ?? [],
    tags: sanitizeVault ? sanitizeVaultControlledList(metadata.tags ?? []) : metadata.tags ?? [],
    ...(metadata.pageType ? { pageType: metadata.pageType } : {}),
    ...(metadata.status ? { status: metadata.status } : {}),
    ...(metadata.reviewState ? { reviewState: metadata.reviewState } : {}),
    ...(metadata.evidenceStatus ? { evidenceStatus: metadata.evidenceStatus } : {}),
    ...(metadata.sourceProfile ? { sourceProfile: metadata.sourceProfile } : {}),
    revision: row.revision,
    indexedAt: row.updated_at,
    rawEvidenceAvailable: metadata.rawEvidenceAvailable === true,
    sections,
    resolvedLinks: links,
    unresolvedLinkCount: metadata.unresolvedLinkCount ?? 0,
  });
}

export function insertWorkspaceDocument(input: {
  database: DatabaseSync;
  workspaceId: string;
  userId: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  checksum: string;
  text?: string;
  failureCode?: string;
}): WorkspaceSourceV1 {
  const sourceId = randomUUID();
  const documentId = randomUUID();
  const workspaceItemId = randomUUID();
  const now = new Date().toISOString();
  const ready = input.text !== undefined;
  const status = ready ? 'READY' : 'FAILED';
  const metadata: InternalDocumentMetadata = {
    sourceKind: 'WORKSPACE_DOCUMENT',
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  };
  const revision = input.checksum;
  input.database.exec('BEGIN IMMEDIATE');
  try {
    input.database.prepare(
      `INSERT INTO knowledge_sources (
        id, scope, kind, workspace_id, conversation_id, created_by,
        status, revision, config_json, created_at, updated_at
      ) VALUES (?, 'WORKSPACE', 'WORKSPACE_DOCUMENT', ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(sourceId, input.workspaceId, input.userId, status, revision, JSON.stringify({ storageKey: input.storageKey }), now, now);
    input.database.prepare(
      `INSERT INTO knowledge_documents (
        id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
        parse_status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      documentId, sourceId, input.storageKey, input.title, input.checksum, revision,
      ready ? 'READY' : 'FAILED', JSON.stringify(metadata), now, now,
    );
    if (ready) insertWorkspaceFragments(input.database, documentId, input.title, revision, input.text!, now);
    input.database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES (?, ?, 'SOURCE', ?, ?, '', ?, ?, ?)`,
    ).run(workspaceItemId, input.workspaceId, sourceId, input.title, input.userId, now, now);
    input.database.exec('COMMIT');
  } catch (error) {
    input.database.exec('ROLLBACK');
    throw error;
  }
  return WorkspaceSourceV1Schema.parse({
    sourceId,
    documentId,
    title: input.title,
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    status,
    parseStatus: ready ? 'READY' : 'FAILED',
    revision,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    ...(input.failureCode ? { failureMessage: publicFailureMessage(input.failureCode) } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

export function listWorkspaceSources(database: DatabaseSync, workspaceId: string): WorkspaceSourceV1[] {
  const rows = database.prepare(
    `SELECT s.id, s.status, s.revision, s.created_at, s.updated_at,
            d.id AS document_id, d.title, d.parse_status, d.metadata_json
     FROM knowledge_sources s
     JOIN knowledge_documents d ON d.source_id = s.id
     WHERE s.workspace_id = ? AND s.kind = 'WORKSPACE_DOCUMENT'
     ORDER BY s.updated_at DESC`,
  ).all(workspaceId) as unknown as Array<{
    id: string;
    status: WorkspaceSourceV1['status'];
    revision: string;
    created_at: string;
    updated_at: string;
    title: string;
    document_id: string;
    parse_status: WorkspaceSourceV1['parseStatus'];
    metadata_json: string;
  }>;
  return rows.map((row) => {
    const metadata = parseMetadata(row.metadata_json);
    return WorkspaceSourceV1Schema.parse({
      sourceId: row.id,
      documentId: row.document_id,
      title: row.title,
      originalName: metadata.originalName ?? row.title,
      mimeType: metadata.mimeType ?? 'application/octet-stream',
      size: metadata.size ?? 0,
      status: row.status,
      parseStatus: row.parse_status,
      revision: row.revision,
      ...(metadata.failureCode ? { failureCode: metadata.failureCode } : {}),
      ...(metadata.failureCode ? { failureMessage: publicFailureMessage(metadata.failureCode) } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });
}

function insertCanonicalFragments(database: DatabaseSync, input: CanonicalDocumentInput, now: string): void {
  const insert = database.prepare(
    `INSERT INTO knowledge_fragments (
      id, document_id, ordinal, title, heading, content, search_text,
      internal_locator_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  input.fragments.forEach((fragment, ordinal) => {
    const id = opaqueFragmentId(input.id, fragment.stableKey);
    insert.run(
      id,
      input.id,
      ordinal,
      input.frontmatter.title,
      fragment.heading ?? null,
      fragment.content,
      buildSearchText([
        input.frontmatter.title,
        ...input.frontmatter.aliases,
        ...input.frontmatter.tags,
        ...Object.values(input.frontmatter.routing).flatMap((value) =>
          Array.isArray(value) ? value : [String(value)]),
        fragment.heading ?? '',
        fragment.content,
      ]),
      JSON.stringify({
        kind: 'SANTEXWELL',
        documentId: input.id,
        revision: input.checksum,
        fragmentId: id,
        ...(fragment.headingPath ? { heading: fragment.headingPath } : {}),
        headingOccurrence: fragment.headingOccurrence,
        chunkOrdinal: fragment.chunkOrdinal,
      }),
      now,
      now,
    );
  });
}

function insertWorkspaceFragments(
  database: DatabaseSync,
  documentId: string,
  title: string,
  revision: string,
  text: string,
  now: string,
): void {
  const characters = [...text];
  const insert = database.prepare(
    `INSERT INTO knowledge_fragments (
      id, document_id, ordinal, title, heading, content, search_text,
      internal_locator_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  for (let offset = 0, ordinal = 0; offset < characters.length; offset += 4_000, ordinal += 1) {
    const content = characters.slice(offset, offset + 4_000).join('').trim();
    if (!content) continue;
    const id = opaqueFragmentId(documentId, String(ordinal));
    insert.run(
      id, documentId, ordinal, title, content, buildSearchText([title, content]),
      JSON.stringify({ kind: 'WORKSPACE_DOCUMENT', documentId, revision, fragmentId: id }), now, now,
    );
  }
}

function ftsCandidates(database: DatabaseSync, query: string, scope: KnowledgeSearchScope, limit: number): SearchRow[] {
  const match = compileFtsQuery(query);
  if (!match) return [];
  const kinds = databaseSourceKinds(scope.sourceKinds);
  if (kinds.length === 0) return [];
  const placeholders = kinds.map(() => '?').join(', ');
  return database.prepare(
    `SELECT d.id, d.source_id, d.relative_locator, d.title, d.checksum, d.revision,
            d.parse_status, d.metadata_json, d.created_at, d.updated_at,
            s.kind AS source_kind, s.workspace_id, s.conversation_id,
            f.fragment_id, f.heading, f.content, bm25(knowledge_fragment_search) AS rank
     FROM knowledge_fragment_search f
     JOIN knowledge_fragments fragment ON fragment.id = f.fragment_id
     JOIN knowledge_documents d ON d.id = fragment.document_id
     JOIN knowledge_sources s ON s.id = d.source_id
     WHERE knowledge_fragment_search MATCH ?
       AND d.parse_status = 'READY' AND s.status IN ('READY', 'STALE')
       AND s.kind IN (${placeholders})
     ORDER BY rank ASC, d.id ASC LIMIT ?`,
  ).all(match, ...kinds, limit) as unknown as SearchRow[];
}

function singleCharacterCandidates(
  database: DatabaseSync,
  query: string,
  scope: KnowledgeSearchScope,
  limit: number,
): SearchRow[] {
  const kinds = databaseSourceKinds(scope.sourceKinds);
  if (kinds.length === 0) return [];
  const placeholders = kinds.map(() => '?').join(', ');
  const rows = database.prepare(
    `SELECT d.id, d.source_id, d.relative_locator, d.title, d.checksum, d.revision,
            d.parse_status, d.metadata_json, d.created_at, d.updated_at,
            s.kind AS source_kind, s.workspace_id, s.conversation_id,
            f.id AS fragment_id, f.heading, f.content, 0.0 AS rank
     FROM knowledge_documents d
     JOIN knowledge_sources s ON s.id = d.source_id
     JOIN knowledge_fragments f ON f.document_id = d.id AND f.ordinal = 0
     WHERE d.parse_status = 'READY' AND s.status IN ('READY', 'STALE')
       AND s.kind IN (${placeholders})
     ORDER BY d.updated_at DESC LIMIT 1000`,
  ).all(...kinds) as unknown as SearchRow[];
  const normalized = normalizeKnowledgeText(query);
  return rows.filter((row) => {
    const metadata = parseMetadata(row.metadata_json);
    return normalizeKnowledgeText(row.title).startsWith(normalized)
      || (metadata.aliases ?? []).some((alias) => normalizeKnowledgeText(alias).startsWith(normalized));
  }).slice(0, limit * 2);
}

function documentMatchesScope(database: DatabaseSync, row: SearchRow, scope: KnowledgeSearchScope): boolean {
  const metadata = parseMetadata(row.metadata_json);
  if (!scope.sourceKinds.includes(metadata.sourceKind)) return false;
  if (scope.workspaceId !== undefined && row.workspace_id !== scope.workspaceId) return false;
  if (scope.conversationId !== undefined && row.conversation_id !== scope.conversationId) return false;
  if (scope.pageTypes && (!metadata.pageType || !scope.pageTypes.includes(metadata.pageType))) return false;
  if (scope.statuses && (!metadata.status || !scope.statuses.includes(metadata.status))) return false;
  if (scope.cluster && metadata.sourceProfile?.cluster !== scope.cluster) return false;
  if (scope.bucket && metadata.sourceProfile?.bucket !== scope.bucket) return false;
  if (scope.coverage && metadata.sourceProfile?.coverage !== scope.coverage) return false;
  if (scope.minimumAttention !== undefined && (metadata.sourceProfile?.attention ?? -1) < scope.minimumAttention) return false;
  if (metadata.sourceKind === 'WORKSPACE_DOCUMENT' || metadata.sourceKind === 'WORKSPACE_FLOW') {
    if (!scope.userId || !row.workspace_id
      || getWorkspacePermission(database, row.workspace_id, scope.userId) === null) return false;
  }
  if (metadata.sourceKind === 'SESSION_ATTACHMENT') return canReadSessionAttachment(database, row, scope);
  if (metadata.sourceKind === 'WORKSPACE_FLOW') return canReadFlow(database, row.id, scope);
  return true;
}

function canReadSessionAttachment(database: DatabaseSync, row: SearchRow, scope: KnowledgeSearchScope): boolean {
  if (!scope.userId || !scope.conversationId || row.conversation_id !== scope.conversationId) return false;
  return Boolean(database.prepare(
    `SELECT 1
     FROM conversations AS conversation
     JOIN workspaces AS workspace
       ON workspace.id = conversation.workspace_id AND workspace.status = 'ACTIVE'
     JOIN workspace_members AS member
       ON member.workspace_id = conversation.workspace_id AND member.user_id = conversation.owner_id
     JOIN conversation_attachments AS attachment
       ON attachment.conversation_id = conversation.id
      AND attachment.owner_id = conversation.owner_id
      AND attachment.source_id = ?
     WHERE conversation.id = ?
       AND conversation.owner_id = ?
       AND conversation.scope = 'WORKSPACE'
       AND conversation.status = 'ACTIVE'
       AND attachment.status = 'READY'
       AND attachment.expires_at > ?`,
  ).get(row.source_id, row.conversation_id, scope.userId, new Date().toISOString()));
}

function canReadFlow(database: DatabaseSync, documentId: string, scope: KnowledgeSearchScope): boolean {
  if (!scope.userId) return false;
  return Boolean(database.prepare(
    `SELECT 1
     FROM knowledge_documents d
     JOIN flow_knowledge_snapshots snapshot ON snapshot.id = d.flow_snapshot_id
     JOIN guides guide ON guide.id = snapshot.guide_id
     LEFT JOIN guide_collaborators collaborator
       ON collaborator.guide_id = guide.id AND collaborator.user_id = ?
     WHERE d.id = ? AND (
       snapshot.origin_type = 'PUBLISHED'
       OR guide.owner_id = ?
       OR collaborator.user_id IS NOT NULL
     )`,
  ).get(scope.userId, documentId, scope.userId));
}

interface SearchCandidate {
  hit: KnowledgeSearchHitV1;
  titleRank: number;
  evidenceRank: number;
  sourceRank: number;
  lexicalRank: number;
}

function toSearchCandidate(row: SearchRow, normalizedQuery: string): SearchCandidate | null {
  const metadata = parseMetadata(row.metadata_json);
  const publicTitle = metadata.sourceKind === 'SANTEXWELL'
    ? sanitizeVaultControlledText(row.title)
    : row.title;
  const publicAliases = metadata.sourceKind === 'SANTEXWELL'
    ? sanitizeVaultControlledList(metadata.aliases ?? [])
    : metadata.aliases ?? [];
  const publicHeading = metadata.sourceKind === 'SANTEXWELL' && row.heading
    ? sanitizeVaultControlledText(row.heading)
    : row.heading;
  const publicContent = metadata.sourceKind === 'SANTEXWELL'
    ? sanitizeVaultControlledText(row.content)
    : row.content;
  if (!publicTitle) return null;
  const title = normalizeKnowledgeText(publicTitle);
  const aliases = publicAliases.map(normalizeKnowledgeText);
  const exactTitle = title === normalizedQuery;
  const exactAlias = aliases.includes(normalizedQuery);
  const prefix = title.startsWith(normalizedQuery) || aliases.some((alias) => alias.startsWith(normalizedQuery));
  const evidenceRole = knowledgeEvidenceRole(metadata);
  const bucketRank = metadata.sourceProfile ? sourceBucketRank(metadata.sourceProfile.bucket) : 0;
  const excerpt = sanitizeExcerpt(publicContent);
  if (!excerpt) return null;
  return {
    hit: KnowledgeSearchHitV1Schema.parse({
      sourceKind: metadata.sourceKind,
      documentId: row.id,
      fragmentId: row.fragment_id,
      title: publicTitle,
      ...(publicHeading ? { heading: publicHeading } : {}),
      excerpt,
      ...(metadata.pageType ? { pageType: metadata.pageType } : {}),
      ...(metadata.status ? { status: metadata.status } : {}),
      ...(metadata.reviewState ? { reviewState: metadata.reviewState } : {}),
      ...(metadata.evidenceStatus ? { evidenceStatus: metadata.evidenceStatus } : {}),
      ...(metadata.sourceProfile ? { sourceProfile: metadata.sourceProfile } : {}),
      evidenceRole,
      revision: row.revision,
      indexedAt: row.updated_at,
      rawEvidenceAvailable: metadata.rawEvidenceAvailable === true,
      href: publicKnowledgeHref(metadata.sourceKind, row),
      score: Math.min(1_000, Math.max(0,
        (exactTitle ? 600 : exactAlias ? 500 : prefix ? 400 : 0)
        + (evidenceRole === 'SUPPORT' ? 150 : evidenceRole === 'DISCOVERY' ? 75 : 25)
        + Math.min(150, Math.max(0, bucketRank * 20 + (metadata.sourceProfile?.attention ?? 0)))
        + Math.min(100, Math.max(0, Number.isFinite(row.rank) ? -row.rank : 0)),
      )),
    }),
    titleRank: exactTitle ? 3 : exactAlias ? 2 : prefix ? 1 : 0,
    evidenceRank: evidenceRole === 'SUPPORT' ? 2 : evidenceRole === 'DISCOVERY' ? 1 : 0,
    sourceRank: bucketRank * 100 + (metadata.sourceProfile?.attention ?? 0),
    lexicalRank: Number.isFinite(row.rank) ? -row.rank : 0,
  };
}

function compareCandidates(left: SearchCandidate, right: SearchCandidate): number {
  return right.titleRank - left.titleRank
    || right.evidenceRank - left.evidenceRank
    || right.sourceRank - left.sourceRank
    || right.lexicalRank - left.lexicalRank
    || left.hit.documentId.localeCompare(right.hit.documentId);
}

function knowledgeEvidenceRole(metadata: InternalDocumentMetadata): KnowledgeSearchHitV1['evidenceRole'] {
  if (metadata.pageType === 'index' || metadata.pageType === 'moc' || metadata.evidenceStatus === 'index-only') {
    return 'NAVIGATION';
  }
  if (metadata.status !== 'active'
    || metadata.reviewState === 'draft'
    || metadata.evidenceStatus === 'needs-review'
    || metadata.evidenceStatus === 'insufficient'
    || metadata.tags?.some((tag) => normalizeKnowledgeText(tag) === 'qa-history')
    || metadata.sourceProfile?.bucket === 'clue') {
    return 'DISCOVERY';
  }
  return 'SUPPORT';
}

function sourceBucketRank(bucket: NonNullable<CanonicalFrontmatter['sourceProfile']>['bucket']): number {
  return ({ judge: 6, engineering: 5, operational: 4, case: 3, supplement: 2, clue: 1 })[bucket];
}

function databaseSourceKinds(sourceKinds: KnowledgeSearchScope['sourceKinds']): string[] {
  const map = {
    SANTEXWELL: 'SANTEXWELL_VAULT',
    WORKSPACE_DOCUMENT: 'WORKSPACE_DOCUMENT',
    WORKSPACE_FLOW: 'WORKSPACE_FLOW',
    SESSION_ATTACHMENT: 'SESSION_ATTACHMENT',
  } as const;
  return [...new Set(sourceKinds.map((kind) => map[kind]))];
}

function parseMetadata(value: string): InternalDocumentMetadata {
  const parsed = JSON.parse(value) as InternalDocumentMetadata;
  return parsed;
}

function mapInternalDocument(row: DatabaseDocumentRow): InternalDocumentRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    relativeLocator: row.relative_locator,
    title: row.title,
    checksum: row.checksum,
    revision: row.revision,
    parseStatus: row.parse_status,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function opaqueFragmentId(documentId: string, stableKey: string): string {
  return `fragment-${createHash('sha256').update(`${documentId}\u0000${stableKey}`).digest('hex').slice(0, 32)}`;
}

function sanitizeExcerpt(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, PUBLIC_EXCERPT_LENGTH);
}

function publicKnowledgeHref(sourceKind: InternalDocumentMetadata['sourceKind'], row: SearchRow): string {
  const document = encodeURIComponent(row.id);
  const fragment = encodeURIComponent(row.fragment_id);
  if (sourceKind === 'SANTEXWELL') {
    return `/knowledge/santexwell/documents/${document}?fragment=${fragment}`;
  }
  if (sourceKind === 'SESSION_ATTACHMENT' && row.conversation_id) {
    return `/conversations/${encodeURIComponent(row.conversation_id)}?document=${document}&fragment=${fragment}`;
  }
  return `/workspaces/${encodeURIComponent(row.workspace_id ?? 'unknown')}/sources?document=${document}&fragment=${fragment}`;
}

function publicFailureMessage(code: string): string {
  return ({
    DOCUMENT_EXTRACTION_FAILED: '文档解析失败，请检查文件是否完整。',
    DOCUMENT_NO_TEXT: '文档中没有可检索文本。',
    DOCUMENT_INVALID_UTF8: '文本文件编码无效，请转换为 UTF-8。',
    DOCUMENT_NUL: '文本文件包含不支持的控制字符。',
  } as Record<string, string>)[code] ?? '文档暂时无法建立索引。';
}

function safeObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function safeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

function safeTimestamp(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function normalizeReasonCodes(values: readonly unknown[]): string[] {
  return [...new Set(values.filter(isString).map((value) => value.toUpperCase().replace(/[^A-Z0-9_]/gu, '_').slice(0, 80)).filter(Boolean))].slice(0, 32);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

interface DatabaseDocumentRow {
  id: string;
  source_id: string;
  relative_locator: string;
  title: string;
  checksum: string;
  revision: string;
  parse_status: 'PENDING' | 'READY' | 'FAILED';
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface SearchRow extends DatabaseDocumentRow {
  source_kind: string;
  workspace_id: string | null;
  conversation_id: string | null;
  fragment_id: string;
  heading: string | null;
  content: string;
  rank: number;
}

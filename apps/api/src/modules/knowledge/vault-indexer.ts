import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { isSafeRawPath, KnowledgeInputError, parseCanonicalMarkdown, type ParsedCanonicalMarkdown } from './markdown';
import {
  ensureSantexwellSource,
  listSourceDocuments,
  markVaultScanFailure,
  publishCanonicalVaultGeneration,
  SANTEXWELL_SOURCE_ID,
  type InternalDocumentRow,
  type InternalResolvedLink,
  getInternalKnowledgeDocument,
} from './repository';
import { normalizeKnowledgeText } from './search-text';
import { sanitizeVaultControlledText } from './vault-text';

const CANONICAL_DIRECTORIES = ['moc', 'indexes', 'concepts', 'sources', 'procedures', 'cases', 'analysis'] as const;
const ALWAYS_HARNESS = ['AGENTS.md', 'CORE.md', 'SOUL.md', 'playbooks/qna.md'] as const;
const COMPILER_HARNESS = 'playbooks/page-contracts.md';
const DEVELOPMENT_HARNESS = 'playbooks/knitwear-development.md';
const COMPLEX_DEVELOPMENT_HARNESS = [
  'meta/knitwear-kb-os/index.md',
  'meta/knitwear-kb-os/00_CORE_MENTALITY.md',
  'meta/knitwear-kb-os/01_REQUIREMENT_NORMALIZER.md',
  'meta/knitwear-kb-os/02_KB_TAXONOMY.md',
  'meta/knitwear-kb-os/03_NOTE_SCHEMA_AND_TAGS.md',
  'meta/knitwear-kb-os/04_AGENT_WORKFLOW_AND_OUTPUT.md',
  'meta/knitwear-kb-os/05_MINDMAP.md',
  'meta/knitwear-kb-os/06_LAYERING_AND_OWNERSHIP.md',
] as const;
const MAX_HARNESS_FILE_BYTES = 32 * 1024;
const MAX_HARNESS_READ_BYTES = 96 * 1024;
const MAX_HARNESS_INJECTION_BYTES = 64 * 1024;
const MAX_HARNESS_LINES = 2_000;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

const activeScans = new WeakMap<DatabaseSync, Promise<IndexSummary>>();
const lastGoodHarness = new Map<string, PromptHarnessBundle>();

export interface IndexSummary {
  status: 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'SKIPPED';
  revision: string | null;
  indexedDocuments: number;
  indexedFragments: number;
  changedDocuments: number;
  reasonCodes: string[];
}

export interface PromptHarnessFile {
  name: string;
  checksum: string;
  content: string;
}

export interface PromptHarnessBundle {
  revision: string;
  files: PromptHarnessFile[];
  content: string;
  lineCount: number;
}

export class VaultReadError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'VaultReadError';
  }
}

export async function readTrustedPromptHarness(
  root: string,
  options: {
    intent: 'GENERAL_QA' | 'COMPILER_CONTRACT' | 'DEVELOPMENT_SELECTION' | 'COMPLEX_DEVELOPMENT';
  },
): Promise<PromptHarnessBundle> {
  const names: string[] = [...ALWAYS_HARNESS];
  if (options.intent === 'COMPILER_CONTRACT') names.push(COMPILER_HARNESS);
  if (options.intent === 'DEVELOPMENT_SELECTION' || options.intent === 'COMPLEX_DEVELOPMENT') {
    names.push(DEVELOPMENT_HARNESS);
  }
  if (options.intent === 'COMPLEX_DEVELOPMENT') names.push(...COMPLEX_DEVELOPMENT_HARNESS);
  const rootReal = await safeRootRealpath(root);
  const files: PromptHarnessFile[] = [];
  let readBytes = 0;
  let lines = 0;
  for (const name of names) {
    const bytes = await readStableContainedFile(rootReal, name, MAX_HARNESS_FILE_BYTES, 'HARNESS');
    readBytes += bytes.length;
    if (readBytes > MAX_HARNESS_READ_BYTES) throw new VaultReadError('HARNESS_ALLOWLIST_TOO_LARGE', '可信 Harness 总读取量超过限制');
    const decoded = decodeUtf8(bytes, 'HARNESS_INVALID_UTF8');
    lines += countLines(decoded);
    if (lines > MAX_HARNESS_LINES) throw new VaultReadError('HARNESS_TOO_MANY_LINES', '可信 Harness 行数超过限制');
    files.push({ name, checksum: sha256(bytes), content: sanitizeVaultControlledText(decoded) });
  }
  const content = files.map((file) => `<!-- ${file.name} -->\n${file.content}`).join('\n\n');
  if (Buffer.byteLength(content) > MAX_HARNESS_INJECTION_BYTES) {
    throw new VaultReadError('HARNESS_INJECTION_TOO_LARGE', '可信 Harness 单次注入量超过限制');
  }
  const revision = sha256(Buffer.from(
    files.map((file) => `${file.name}\u0000${file.checksum}`).sort().join('\n'),
  ));
  return { revision, files, content, lineCount: lines };
}

export function getLastGoodPromptHarness(root: string): PromptHarnessBundle | null {
  return lastGoodHarness.get(resolve(root)) ?? null;
}

export type VaultIndexFunction = (
  database: DatabaseSync,
  root: string,
  signal: AbortSignal,
) => Promise<IndexSummary>;

export interface SantexwellVaultRefreshController {
  refresh(): Promise<IndexSummary>;
  close(): Promise<void>;
}

export function createSantexwellVaultRefreshController(options: {
  database: DatabaseSync;
  root: string;
  timeoutMs: number;
  indexVault?: VaultIndexFunction;
}): SantexwellVaultRefreshController {
  const indexVault = options.indexVault ?? indexSantexwellVault;
  let closed = false;
  let active: {
    abortController: AbortController;
    promise: Promise<IndexSummary>;
  } | null = null;

  return {
    refresh(): Promise<IndexSummary> {
      if (closed) return Promise.resolve(skippedRefreshSummary('REFRESH_CLOSED'));
      if (active) return Promise.resolve(skippedRefreshSummary('SCAN_ALREADY_RUNNING'));

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);
      timeout.unref();
      const promise = Promise.resolve()
        .then(() => indexVault(options.database, options.root, abortController.signal))
        .finally(() => {
          clearTimeout(timeout);
          if (active?.promise === promise) active = null;
        });
      active = { abortController, promise };
      return promise;
    },

    async close(): Promise<void> {
      closed = true;
      const current = active;
      if (!current) return;
      current.abortController.abort();
      await current.promise.catch(() => undefined);
    },
  };
}

function skippedRefreshSummary(reason: string): IndexSummary {
  return {
    status: 'SKIPPED',
    revision: null,
    indexedDocuments: 0,
    indexedFragments: 0,
    changedDocuments: 0,
    reasonCodes: [reason],
  };
}

export async function indexSantexwellVault(
  database: DatabaseSync,
  root: string,
  signal: AbortSignal,
): Promise<IndexSummary> {
  const active = activeScans.get(database);
  if (active) {
    return { status: 'SKIPPED', revision: null, indexedDocuments: 0, indexedFragments: 0, changedDocuments: 0, reasonCodes: ['SCAN_ALREADY_RUNNING'] };
  }
  const scan = performIndex(database, root, signal).finally(() => activeScans.delete(database));
  activeScans.set(database, scan);
  return scan;
}

async function performIndex(database: DatabaseSync, root: string, signal: AbortSignal): Promise<IndexSummary> {
  ensureSantexwellSource(database);
  let harness: PromptHarnessBundle;
  try {
    harness = await readTrustedPromptHarness(root, { intent: 'GENERAL_QA' });
  } catch (error) {
    const reason = safeReason(error, 'HARNESS_INVALID');
    const status = markVaultScanFailure(database, [reason]);
    return failureSummary(database, status, [reason]);
  }

  let rootReal: string;
  let manifest: ProvenanceManifest;
  let manifestChecksum: string;
  let relativeFiles: string[];
  try {
    abortIfNeeded(signal);
    rootReal = await safeRootRealpath(root);
    const loadedManifest = await readProvenanceManifest(rootReal);
    manifest = loadedManifest.manifest;
    manifestChecksum = loadedManifest.checksum;
    relativeFiles = await enumerateCanonicalPages(rootReal, signal);
  } catch (error) {
    const reason = safeReason(error, 'VAULT_ENUMERATION_FAILED');
    const status = markVaultScanFailure(database, [reason], { revision: harness.revision, fileCount: harness.files.length });
    return failureSummary(database, status, [reason]);
  }

  const parsedCandidates: Candidate[] = [];
  const reasonCodes: string[] = [];
  for (const relativeLocator of relativeFiles) {
    try {
      abortIfNeeded(signal);
      const bytes = await readStableContainedFile(rootReal, relativeLocator, 2 * 1024 * 1024, 'PAGE');
      parsedCandidates.push({
        relativeLocator,
        parsed: parseCanonicalMarkdown(bytes, relativeLocator),
      });
    } catch (error) {
      reasonCodes.push(safeReason(error, 'PAGE_INVALID'));
    }
  }
  if (signal.aborted) reasonCodes.push('SCAN_ABORTED');

  if (reasonCodes.length > 0) {
    const normalizedReasons = uniqueReasonCodes(reasonCodes);
    const status = markVaultScanFailure(database, normalizedReasons, {
      revision: harness.revision,
      fileCount: harness.files.length,
    });
    return failureSummary(database, status, normalizedReasons);
  }

  const existing = listSourceDocuments(database, SANTEXWELL_SOURCE_ID);
  assignDocumentIds(parsedCandidates, existing);
  resolveCandidateLinks(parsedCandidates);
  const rawEvidence = manifestRawEvidence(manifest);
  let indexedFragments = 0;
  const documents = [];
  for (const candidate of parsedCandidates) {
    if (!candidate.documentId) continue;
    indexedFragments += candidate.parsed.fragments.length;
    documents.push({
      id: candidate.documentId,
      relativeLocator: candidate.relativeLocator,
      checksum: candidate.parsed.checksum,
      frontmatter: candidate.parsed.frontmatter,
      fragments: candidate.parsed.fragments,
      links: candidate.resolvedLinks ?? [],
      rawEvidenceAvailable: rawEvidence.has(candidate.relativeLocator)
        || candidate.parsed.frontmatter.sourcePaths.length > 0,
      sourcePaths: uniqueSourcePaths([
        ...candidate.parsed.frontmatter.sourcePaths,
        ...(manifest.pages[candidate.relativeLocator]?.sourcePaths ?? []),
      ]),
    });
  }

  const revision = sha256(Buffer.from([
    ...parsedCandidates.map((candidate) => `${candidate.relativeLocator}\u0000${candidate.parsed.checksum}`),
    `harness\u0000${harness.revision}`,
    `manifest\u0000${manifestChecksum}`,
  ].sort().join('\n')));
  if (documents.length !== relativeFiles.length || signal.aborted) {
    const normalizedReasons = uniqueReasonCodes(signal.aborted ? ['SCAN_ABORTED'] : ['SCAN_INCOMPLETE']);
    const status = markVaultScanFailure(database, normalizedReasons, { revision: harness.revision, fileCount: harness.files.length });
    return failureSummary(database, status, normalizedReasons);
  }

  let changedDocuments: number;
  try {
    abortIfNeeded(signal);
    changedDocuments = publishCanonicalVaultGeneration(database, {
      documents,
      revision,
      harnessRevision: harness.revision,
      harnessFileCount: harness.files.length,
      indexedFragments,
    }).changedDocuments;
    lastGoodHarness.set(resolve(root), harness);
  } catch (error) {
    const reason = safeReason(error, 'DOCUMENT_APPLY_FAILED');
    const status = markVaultScanFailure(database, [reason], {
      revision: harness.revision,
      fileCount: harness.files.length,
    });
    return failureSummary(database, status, [reason]);
  }
  return {
    status: 'READY',
    revision,
    indexedDocuments: parsedCandidates.length,
    indexedFragments,
    changedDocuments,
    reasonCodes: [],
  };
}

export async function readSantexwellRawEvidence(
  database: DatabaseSync,
  root: string,
  documentId: string,
  sourceIndex = 0,
): Promise<{ documentId: string; revision: string; sourceIndex: number; text: string }> {
  const document = getInternalKnowledgeDocument(database, documentId);
  if (!document || document.sourceId !== SANTEXWELL_SOURCE_ID || document.parseStatus !== 'READY') {
    throw new VaultReadError('RAW_DOCUMENT_NOT_FOUND', '原始证据所属页面不存在');
  }
  const source = database.prepare(
    `SELECT 1 FROM knowledge_sources WHERE id = ? AND status IN ('READY', 'STALE')`,
  ).get(SANTEXWELL_SOURCE_ID);
  if (!source) throw new VaultReadError('RAW_SOURCE_UNAVAILABLE', '原始证据源当前不可用');
  const sourcePaths = document.metadata.sourcePaths ?? [];
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= sourcePaths.length) {
    throw new VaultReadError('RAW_SOURCE_NOT_AVAILABLE', '页面没有对应的原始证据');
  }
  const rootReal = await safeRootRealpath(root);
  const bytes = await readStableContainedFile(rootReal, sourcePaths[sourceIndex]!, 512 * 1024, 'RAW');
  const text = sanitizeRawEvidence(decodeUtf8(bytes, 'RAW_INVALID_UTF8'));
  if (!text) throw new VaultReadError('RAW_SOURCE_EMPTY', '原始证据没有可读取文本');
  return { documentId, revision: document.revision, sourceIndex, text };
}

async function enumerateCanonicalPages(rootReal: string, signal: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  await addCandidate(rootReal, 'wiki_v2/index.md', files);
  await addCandidate(rootReal, 'wiki_v2/_meta/Tag Taxonomy.md', files);
  for (const directory of CANONICAL_DIRECTORIES) {
    abortIfNeeded(signal);
    await walkAllowedDirectory(rootReal, `wiki_v2/${directory}`, files, signal);
  }
  return [...new Set(files)].sort();
}

async function walkAllowedDirectory(rootReal: string, relativeDirectory: string, output: string[], signal: AbortSignal): Promise<void> {
  const absolute = join(rootReal, relativeDirectory);
  let entries;
  try {
    const directoryStat = await lstat(absolute);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return;
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  const names = new Set(entries.map((entry) => entry.name));
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    abortIfNeeded(signal);
    if (entry.name.startsWith('.')) continue;
    const relativeLocator = `${relativeDirectory}/${entry.name}`;
    const entryStat = await lstat(join(rootReal, relativeLocator));
    if (entryStat.isSymbolicLink()) continue;
    if (entryStat.isDirectory()) {
      await walkAllowedDirectory(rootReal, relativeLocator, output, signal);
      continue;
    }
    if (!entryStat.isFile() || extname(entry.name).toLocaleLowerCase('en-US') !== '.md') continue;
    const conflict = /^(.*) 2\.md$/u.exec(entry.name);
    if (conflict && names.has(`${conflict[1]}.md`)) continue;
    await addCandidate(rootReal, relativeLocator, output);
  }
}

async function addCandidate(rootReal: string, relativeLocator: string, output: string[]): Promise<void> {
  const absolute = join(rootReal, relativeLocator);
  let fileStat;
  try {
    fileStat = await lstat(absolute);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) return;
  const resolved = await realpath(absolute);
  requireContained(rootReal, resolved);
  output.push(relativeLocator);
}

async function readProvenanceManifest(rootReal: string): Promise<{ manifest: ProvenanceManifest; checksum: string }> {
  const relativeLocator = 'wiki_v2/_meta/build/provenance_manifest.json';
  const bytes = await readStableContainedFile(rootReal, relativeLocator, MAX_MANIFEST_BYTES, 'MANIFEST');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(bytes, 'MANIFEST_INVALID_UTF8'));
  } catch (error) {
    if (error instanceof VaultReadError) throw error;
    throw new VaultReadError('MANIFEST_INVALID_JSON', 'provenance manifest JSON 无效');
  }
  if (!isPlainRecord(parsed) || typeof parsed.generated_on !== 'string' || !isPlainRecord(parsed.pages)) {
    throw new VaultReadError('MANIFEST_SCHEMA_INVALID', 'provenance manifest 结构无效');
  }
  const pages: ProvenanceManifest['pages'] = {};
  const entries = Object.entries(parsed.pages);
  if (entries.length > 20_000) throw new VaultReadError('MANIFEST_TOO_MANY_PAGES', 'provenance manifest 页面过多');
  for (const [pagePath, value] of entries) {
    if (!isSafeManifestPagePath(pagePath) || !isPlainRecord(value)) {
      throw new VaultReadError('MANIFEST_PAGE_INVALID', 'provenance manifest 页面记录无效');
    }
    const sourcePaths = value.source_paths;
    if (!Array.isArray(sourcePaths) || sourcePaths.length > 2_000 || !sourcePaths.every((path) => typeof path === 'string' && isSafeRawPath(path))) {
      throw new VaultReadError('MANIFEST_SOURCE_PATH_INVALID', 'provenance manifest source_paths 无效');
    }
    if (value.title !== undefined && typeof value.title !== 'string') {
      throw new VaultReadError('MANIFEST_PAGE_INVALID', 'provenance manifest title 无效');
    }
    if (value.page_type !== undefined && typeof value.page_type !== 'string') {
      throw new VaultReadError('MANIFEST_PAGE_INVALID', 'provenance manifest page_type 无效');
    }
    pages[pagePath] = { sourcePaths: [...sourcePaths] };
  }
  return { manifest: { generatedOn: parsed.generated_on, pages }, checksum: sha256(bytes) };
}

function assignDocumentIds(candidates: Candidate[], existing: InternalDocumentRow[]): void {
  const byPath = new Map(existing.map((document) => [document.relativeLocator, document]));
  const candidatePaths = new Set(candidates.map((candidate) => candidate.relativeLocator));
  const claimed = new Set<string>();
  for (const candidate of candidates) {
    const exact = byPath.get(candidate.relativeLocator);
    if (exact) {
      candidate.documentId = exact.id;
      claimed.add(exact.id);
    }
  }
  for (const candidate of candidates) {
    if (candidate.documentId) continue;
    const matches = existing.filter((document) =>
      !claimed.has(document.id)
      && !candidatePaths.has(document.relativeLocator)
      && document.checksum === candidate.parsed.checksum
      && document.title === candidate.parsed.frontmatter.title
      && document.metadata.pageType === candidate.parsed.frontmatter.pageType);
    if (matches.length === 1) {
      candidate.documentId = matches[0]!.id;
      claimed.add(matches[0]!.id);
    } else {
      candidate.documentId = randomUUID();
    }
  }
}

function resolveCandidateLinks(candidates: Candidate[]): void {
  const pathMap = new Map<string, Candidate>();
  const exactTitleMap = groupCandidates(candidates, (candidate) => candidate.parsed.frontmatter.title);
  const stemMap = groupCandidates(candidates, (candidate) => basename(candidate.relativeLocator, '.md'));
  const aliasMap = new Map<string, Candidate[]>();
  const normalizedMap = new Map<string, Candidate[]>();
  candidates.forEach((candidate) => {
    const withoutExtension = candidate.relativeLocator.slice(0, -3);
    pathMap.set(candidate.relativeLocator, candidate);
    pathMap.set(withoutExtension, candidate);
    pathMap.set(withoutExtension.replace(/^wiki_v2\//u, ''), candidate);
    candidate.parsed.frontmatter.aliases.forEach((alias) => appendGroup(aliasMap, alias, candidate));
    [candidate.parsed.frontmatter.title, basename(candidate.relativeLocator, '.md'), ...candidate.parsed.frontmatter.aliases]
      .forEach((value) => appendGroup(normalizedMap, normalizeKnowledgeText(value), candidate));
  });
  candidates.forEach((candidate) => {
    candidate.resolvedLinks = candidate.parsed.links.map((link) => {
      const matches = resolveLinkMatches(link.target, pathMap, exactTitleMap, stemMap, aliasMap, normalizedMap);
      if (matches.length !== 1 || !matches[0]!.documentId) {
        return { target: safeLinkAuditTarget(link.target), ...(link.heading ? { heading: link.heading } : {}), ...(link.label ? { label: link.label } : {}), ...(matches.length > 1 ? { ambiguous: true } : {}) };
      }
      return {
        target: safeLinkAuditTarget(link.target),
        ...(link.heading ? { heading: link.heading } : {}),
        ...(link.label ? { label: link.label } : {}),
        resolvedDocumentId: matches[0]!.documentId,
        resolvedTitle: matches[0]!.parsed.frontmatter.title,
      };
    });
  });
}

function resolveLinkMatches(
  target: string,
  pathMap: Map<string, Candidate>,
  titleMap: Map<string, Candidate[]>,
  stemMap: Map<string, Candidate[]>,
  aliasMap: Map<string, Candidate[]>,
  normalizedMap: Map<string, Candidate[]>,
): Candidate[] {
  const normalizedPath = target.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!normalizedPath.startsWith('/') && !normalizedPath.split('/').includes('..')) {
    const path = normalizedPath.endsWith('.md') ? normalizedPath : `${normalizedPath}.md`;
    const direct = pathMap.get(path) ?? pathMap.get(path.replace(/^wiki_v2\//u, ''));
    if (direct) return [direct];
  }
  const exactTitle = titleMap.get(target);
  if (exactTitle?.length) return exactTitle;
  const stem = stemMap.get(target);
  if (stem?.length) return stem;
  const aliases = aliasMap.get(target);
  if (aliases?.length) return aliases;
  return normalizedMap.get(normalizeKnowledgeText(target)) ?? [];
}

export async function readStableContainedFile(
  rootReal: string,
  relativeLocator: string,
  maximumBytes: number,
  prefix: string,
  hooks: { afterOpen?: () => Promise<void> } = {},
): Promise<Buffer> {
  if (!isSafeRelativeLocator(relativeLocator)) throw new VaultReadError(`${prefix}_PATH_INVALID`, '文件路径不在允许范围');
  const absolute = join(rootReal, relativeLocator);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await requireNoSymlinkComponents(rootReal, relativeLocator, prefix);
    let handle: FileHandle;
    try {
      handle = await open(
        absolute,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
    } catch (error) {
      if (hasErrorCode(error, 'ELOOP')) {
        throw new VaultReadError(`${prefix}_TYPE_INVALID`, '所需文件不能是符号链接');
      }
      throw new VaultReadError(`${prefix}_MISSING`, '所需文件不存在');
    }
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new VaultReadError(`${prefix}_TYPE_INVALID`, '所需文件不是普通文件');
      if (before.size > maximumBytes) throw new VaultReadError(`${prefix}_FILE_TOO_LARGE`, '文件超过读取限制');
      await hooks.afterOpen?.();

      const resolvedBefore = await realpath(absolute);
      requireContained(rootReal, resolvedBefore);
      const linkedBefore = await stat(resolvedBefore);
      if (!sameFileIdentity(before, linkedBefore)) continue;

      const bytes = await readBoundedFileHandle(handle, maximumBytes, prefix);
      const after = await handle.stat();
      const resolvedAfter = await realpath(absolute);
      requireContained(rootReal, resolvedAfter);
      const linkedAfter = await stat(resolvedAfter);
      const finalPath = await lstat(absolute);
      if (!finalPath.isSymbolicLink()
        && finalPath.isFile()
        && sameFileSnapshot(before, after)
        && sameFileIdentity(after, linkedAfter)
        && resolvedBefore === resolvedAfter
        && bytes.length === before.size) return bytes;
    } catch (error) {
      if (error instanceof VaultReadError) throw error;
      if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ELOOP')) continue;
      throw new VaultReadError(`${prefix}_READ_FAILED`, '文件安全读取失败');
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
  throw new VaultReadError(`${prefix}_CHANGED_DURING_READ`, '文件读取期间发生变化');
}

async function readBoundedFileHandle(handle: FileHandle, maximumBytes: number, prefix: string): Promise<Buffer> {
  const buffer = Buffer.alloc(maximumBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > maximumBytes) throw new VaultReadError(`${prefix}_FILE_TOO_LARGE`, '文件超过读取限制');
  return buffer.subarray(0, offset);
}

async function requireNoSymlinkComponents(rootReal: string, relativeLocator: string, prefix: string): Promise<void> {
  const parts = relativeLocator.split('/');
  let current = rootReal;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    let entry;
    try {
      entry = await lstat(current);
    } catch {
      throw new VaultReadError(`${prefix}_MISSING`, '所需文件不存在');
    }
    if (entry.isSymbolicLink()) throw new VaultReadError(`${prefix}_TYPE_INVALID`, '路径不能包含符号链接');
    if (index < parts.length - 1 && !entry.isDirectory()) {
      throw new VaultReadError(`${prefix}_TYPE_INVALID`, '文件父路径不是目录');
    }
  }
}

function sameFileIdentity(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileSnapshot(
  left: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
  right: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
): boolean {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function safeRootRealpath(root: string): Promise<string> {
  let resolvedRoot: string;
  try {
    const configuredRootStat = await lstat(root);
    if (configuredRootStat.isSymbolicLink() || !configuredRootStat.isDirectory()) throw new Error('not directory');
    resolvedRoot = await realpath(root);
    const rootStat = await lstat(resolvedRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('not directory');
  } catch {
    throw new VaultReadError('VAULT_ROOT_UNAVAILABLE', 'vault 根目录不可用');
  }
  return resolvedRoot;
}

function requireContained(rootReal: string, candidateReal: string): void {
  const relation = relative(rootReal, candidateReal);
  if (relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !relation.startsWith(sep))) return;
  throw new VaultReadError('VAULT_PATH_ESCAPE', '文件超出 vault 根目录');
}

function isSafeRelativeLocator(value: string): boolean {
  return value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'));
}

function isSafeManifestPagePath(value: string): boolean {
  return isSafeRelativeLocator(value) && value.startsWith('wiki_v2/') && value.endsWith('.md');
}

function manifestRawEvidence(manifest: ProvenanceManifest): Set<string> {
  return new Set(Object.entries(manifest.pages)
    .filter(([, record]) => record.sourcePaths.length > 0)
    .map(([page]) => page));
}

function uniqueSourcePaths(values: readonly string[]): string[] {
  return [...new Set(values.filter(isSafeRawPath))].slice(0, 2_000);
}

function sanitizeRawEvidence(value: string): string {
  const normalized = value.startsWith('\ufeff') ? value.slice(1) : value;
  const withoutMarkup = normalized
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replace(/!\[\[[^\]\n]{1,2000}\]\]/gu, '')
    .replace(/!\[([^\]\n]{0,500})\]\([^\n)]{1,2000}\)/gu, '$1')
    .replace(/\[\[([^\]\n]{1,2000})\]\]/gu, (_match, value: string) => {
      const [destination = '', label] = value.split('|', 2);
      const title = destination.split('#', 1)[0]!.trim();
      return label?.trim() || (!title.includes('/') && !title.includes('\\') ? title : '');
    })
    .replace(/\[([^\]\n]{1,500})\]\([^\n)]{1,2000}\)/gu, '$1')
    .split('\n')
    .filter((line) => !/^\s*(?:[-*]\s*)?(?:Raw note|Raw path|Source paths?)\s*:/iu.test(line))
    .join('\n');
  return sanitizeVaultControlledText(withoutMarkup);
}

function groupCandidates(candidates: Candidate[], selector: (candidate: Candidate) => string): Map<string, Candidate[]> {
  const map = new Map<string, Candidate[]>();
  candidates.forEach((candidate) => appendGroup(map, selector(candidate), candidate));
  return map;
}

function appendGroup(map: Map<string, Candidate[]>, key: string, candidate: Candidate): void {
  const values = map.get(key);
  if (values) values.push(candidate);
  else map.set(key, [candidate]);
}

function safeLinkAuditTarget(value: string): string {
  return value.split('/').at(-1)?.slice(0, 500) ?? value.slice(0, 500);
}

function failureSummary(database: DatabaseSync, status: 'DEGRADED' | 'UNAVAILABLE', reasons: string[]): IndexSummary {
  return {
    status,
    revision: currentRevision(database),
    indexedDocuments: listSourceDocuments(database, SANTEXWELL_SOURCE_ID).length,
    indexedFragments: fragmentCount(database),
    changedDocuments: 0,
    reasonCodes: uniqueReasonCodes(reasons),
  };
}

function currentRevision(database: DatabaseSync): string | null {
  const row = database.prepare(`SELECT revision FROM knowledge_sources WHERE id = ?`).get(SANTEXWELL_SOURCE_ID) as { revision: string } | undefined;
  return !row || row.revision === 'unindexed' ? null : row.revision;
}

function fragmentCount(database: DatabaseSync): number {
  const row = database.prepare(
    `SELECT COUNT(*) AS count FROM knowledge_fragments f
     JOIN knowledge_documents d ON d.id = f.document_id WHERE d.source_id = ?`,
  ).get(SANTEXWELL_SOURCE_ID) as { count: number };
  return row.count;
}

function safeReason(error: unknown, fallback: string): string {
  if (error instanceof VaultReadError || error instanceof KnowledgeInputError) return error.code;
  return fallback;
}

function uniqueReasonCodes(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/[^A-Z0-9_]/gu, '_').slice(0, 80)))].slice(0, 32);
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new VaultReadError('SCAN_ABORTED', '扫描已取消');
}

function decodeUtf8(bytes: Buffer, code: string): string {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (value.includes('\u0000')) throw new Error('nul');
    return value.startsWith('\ufeff') ? value.slice(1) : value;
  } catch {
    throw new VaultReadError(code, '文件不是有效 UTF-8');
  }
}

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r\n|\r|\n/u).length;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isMissing(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT');
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface Candidate {
  relativeLocator: string;
  parsed: ParsedCanonicalMarkdown;
  documentId?: string;
  resolvedLinks?: InternalResolvedLink[];
}

interface ProvenanceManifest {
  generatedOn: string;
  pages: Record<string, { sourcePaths: string[] }>;
}

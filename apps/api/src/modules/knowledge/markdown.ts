import { createHash } from 'node:crypto';

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
const MAX_KEYS = 128;
const MAX_LIST_ITEMS = 512;
const MAX_SCALAR_LENGTH = 16_384;
const MAX_FRAGMENT_CHARS = 4_000;

const REQUIRED_FIELDS = [
  'title', 'page_type', 'status', 'tags', 'aliases', 'source_count',
  'evidence_status', 'last_compiled', 'review_state',
] as const;
const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  'source_paths', 'source_cluster', 'source_bucket', 'coverage_scope',
  'cross_cluster_policy', 'attention_score', 'question_mode', 'stage_nodes',
  'object_roles', 'goal_tags', 'risk_tags', 'requires', 'enables', 'improves',
  'worsens', 'conflicts_with', 'compensated_by', 'validated_by',
  'parent_concepts', 'child_concepts', 'sibling_concepts', 'route_children',
  'route_sequence', 'route_policy', 'graph_role', 'node_class', 'utility_scope',
  'utility_parent', 'research_gap_count', 'research_gap_labels',
]);
const LIST_FIELDS = new Set([
  'tags', 'aliases', 'source_paths', 'stage_nodes', 'object_roles', 'goal_tags',
  'risk_tags', 'requires', 'enables', 'improves', 'worsens', 'conflicts_with',
  'compensated_by', 'validated_by', 'parent_concepts', 'child_concepts',
  'sibling_concepts', 'route_children', 'route_sequence', 'research_gap_labels',
]);
const INTEGER_FIELDS = new Set(['source_count', 'attention_score', 'research_gap_count']);
const PAGE_TYPES = new Set(['index', 'moc', 'concept', 'source-digest', 'procedure', 'case', 'analysis']);
const STATUSES = new Set(['active', 'candidate']);
const REVIEW_STATES = new Set(['review', 'draft', 'approved']);
const EVIDENCE_STATUSES = new Set([
  'sourced', 'derived-from-source', 'mixed', 'index-only', 'needs-review', 'insufficient',
]);
const SOURCE_CLUSTERS = new Set(['textile-knowledge', 'quality-ops', 'complaint-case']);
const SOURCE_BUCKETS = new Set(['judge', 'engineering', 'operational', 'case', 'supplement', 'clue']);
const COVERAGE = new Set(['overview', 'branch', 'property', 'family', 'application', 'risk-control', 'case-specific']);
const CROSS_CLUSTER = new Set(['direct', 'hub-only']);

export class KnowledgeInputError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'KnowledgeInputError';
  }
}

export interface CanonicalFrontmatter {
  title: string;
  pageType: 'index' | 'moc' | 'concept' | 'source-digest' | 'procedure' | 'case' | 'analysis';
  status: 'active' | 'candidate';
  tags: string[];
  aliases: string[];
  sourceCount: number;
  evidenceStatus: 'sourced' | 'derived-from-source' | 'mixed' | 'index-only' | 'needs-review' | 'insufficient';
  lastCompiled: string;
  reviewState: 'review' | 'draft' | 'approved';
  sourcePaths: string[];
  sourceProfile?: {
    cluster: 'textile-knowledge' | 'quality-ops' | 'complaint-case';
    bucket: 'judge' | 'engineering' | 'operational' | 'case' | 'supplement' | 'clue';
    coverage: 'overview' | 'branch' | 'property' | 'family' | 'application' | 'risk-control' | 'case-specific';
    crossClusterPolicy: 'direct' | 'hub-only';
    attention: number;
  };
  routing: Record<string, string | number | string[]>;
}

export interface ParsedWikiLink {
  target: string;
  heading?: string;
  label?: string;
}

export interface ParsedMarkdownFragment {
  heading?: string;
  headingPath?: string;
  headingOccurrence: number;
  chunkOrdinal: number;
  content: string;
  stableKey: string;
}

export interface ParsedCanonicalMarkdown {
  frontmatter: CanonicalFrontmatter;
  checksum: string;
  visibleText: string;
  links: ParsedWikiLink[];
  fragments: ParsedMarkdownFragment[];
}

export function parseCanonicalMarkdown(bytes: Buffer, relativeLocator: string): ParsedCanonicalMarkdown {
  if (bytes.length === 0 || bytes.length > MAX_MARKDOWN_BYTES) {
    throw new KnowledgeInputError('MARKDOWN_SIZE_INVALID', 'Markdown 文件大小不符合限制');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new KnowledgeInputError('MARKDOWN_INVALID_UTF8', 'Markdown 文件不是有效 UTF-8');
  }
  if (text.startsWith('\ufeff')) text = text.slice(1);
  if (text.includes('\u0000')) throw new KnowledgeInputError('MARKDOWN_NUL', 'Markdown 文件包含 NUL');
  text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (!text.startsWith('---\n')) {
    throw new KnowledgeInputError('FRONTMATTER_REQUIRED', `规范页面缺少 frontmatter: ${safeAuditName(relativeLocator)}`);
  }
  const closing = text.indexOf('\n---\n', 4);
  if (closing < 0) throw new KnowledgeInputError('FRONTMATTER_UNTERMINATED', 'frontmatter 未闭合');
  const frontmatterText = text.slice(4, closing);
  if (Buffer.byteLength(frontmatterText) > MAX_FRONTMATTER_BYTES) {
    throw new KnowledgeInputError('FRONTMATTER_TOO_LARGE', 'frontmatter 超出限制');
  }
  const frontmatter = validateFrontmatter(parseFrontmatter(frontmatterText));
  const body = text.slice(closing + 5);
  const sanitized = sanitizeMarkdownBody(body);
  const links = parseWikiLinks(body);
  const fragments = fragmentMarkdown(sanitized);
  if (fragments.length === 0) {
    fragments.push({
      headingOccurrence: 0,
      chunkOrdinal: 0,
      content: frontmatter.title,
      stableKey: stableFragmentKey('', 0, 0),
    });
  }
  return {
    frontmatter,
    checksum: createHash('sha256').update(bytes).digest('hex'),
    visibleText: sanitized.trim(),
    links,
    fragments,
  };
}

function parseFrontmatter(input: string): Map<string, string | number | string[]> {
  const values = new Map<string, string | number | string[]>();
  const lines = input.split('\n');
  let activeList: { key: string; values: string[] } | null = null;

  const finishList = () => {
    if (!activeList) return;
    values.set(activeList.key, activeList.values);
    activeList = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const listMatch = /^\s{2}-\s+(.+)$/u.exec(line);
    if (listMatch) {
      if (!activeList) throw new KnowledgeInputError('FRONTMATTER_NESTED', '列表项没有对应的顶层字段');
      if (activeList.values.length >= MAX_LIST_ITEMS) {
        throw new KnowledgeInputError('FRONTMATTER_LIST_TOO_LONG', 'frontmatter 列表过长');
      }
      activeList.values.push(parseScalar(listMatch[1]!));
      continue;
    }
    if (/^\s/u.test(line)) {
      throw new KnowledgeInputError('FRONTMATTER_NESTED', 'frontmatter 不允许嵌套对象');
    }
    finishList();
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/u.exec(line);
    if (!match) throw new KnowledgeInputError('FRONTMATTER_SYNTAX', `frontmatter 第 ${index + 1} 行格式错误`);
    const key = match[1]!;
    const raw = match[2] ?? '';
    if (PROTOTYPE_KEYS.has(key)) throw new KnowledgeInputError('FRONTMATTER_PROTOTYPE_KEY', 'frontmatter 包含保留字段');
    if (!ALLOWED_FIELDS.has(key)) throw new KnowledgeInputError('FRONTMATTER_UNKNOWN_KEY', `不支持的 frontmatter 字段: ${key}`);
    if (values.has(key)) throw new KnowledgeInputError('FRONTMATTER_DUPLICATE_KEY', `frontmatter 字段重复: ${key}`);
    if (values.size >= MAX_KEYS) throw new KnowledgeInputError('FRONTMATTER_TOO_MANY_KEYS', 'frontmatter 字段过多');
    if (raw === '') {
      if (!LIST_FIELDS.has(key)) throw new KnowledgeInputError('FRONTMATTER_NESTED', `${key} 不能是嵌套对象`);
      activeList = { key, values: [] };
      continue;
    }
    if (LIST_FIELDS.has(key)) {
      if (!raw.startsWith('[') || !raw.endsWith(']')) {
        throw new KnowledgeInputError('FRONTMATTER_EXPECTED_LIST', `${key} 必须是标量列表`);
      }
      const inner = raw.slice(1, -1).trim();
      const list = inner ? inner.split(',').map((value) => parseScalar(value.trim())) : [];
      if (list.length > MAX_LIST_ITEMS) throw new KnowledgeInputError('FRONTMATTER_LIST_TOO_LONG', 'frontmatter 列表过长');
      values.set(key, list);
      continue;
    }
    const scalar = parseScalar(raw);
    if (INTEGER_FIELDS.has(key)) {
      if (!/^-?\d+$/u.test(scalar)) throw new KnowledgeInputError('FRONTMATTER_EXPECTED_INTEGER', `${key} 必须是整数`);
      values.set(key, Number(scalar));
    } else {
      values.set(key, scalar);
    }
  }
  finishList();
  return values;
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_SCALAR_LENGTH) {
    throw new KnowledgeInputError('FRONTMATTER_SCALAR_SIZE', 'frontmatter 标量为空或过长');
  }
  if (/(^|\s)[&*][A-Za-z0-9_-]+/u.test(trimmed)) {
    throw new KnowledgeInputError('FRONTMATTER_ALIAS_FORBIDDEN', 'frontmatter 不允许 YAML anchor 或 alias');
  }
  if (/^!/u.test(trimmed)) throw new KnowledgeInputError('FRONTMATTER_TAG_FORBIDDEN', 'frontmatter 不允许自定义 YAML tag');
  if (/^[{|>]/u.test(trimmed) || /:\s*[{[]/u.test(trimmed)) {
    throw new KnowledgeInputError('FRONTMATTER_NESTED', 'frontmatter 只允许标量或标量列表');
  }
  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"')) throw new KnowledgeInputError('FRONTMATTER_QUOTE', 'frontmatter 引号未闭合');
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== 'string') throw new Error('not string');
      return parsed;
    } catch {
      throw new KnowledgeInputError('FRONTMATTER_QUOTE', 'frontmatter 双引号字符串无效');
    }
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'")) throw new KnowledgeInputError('FRONTMATTER_QUOTE', 'frontmatter 引号未闭合');
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (/[[\]{}]/u.test(trimmed)) throw new KnowledgeInputError('FRONTMATTER_COMPLEX_VALUE', 'frontmatter 不允许复杂值');
  return trimmed;
}

function validateFrontmatter(values: Map<string, string | number | string[]>): CanonicalFrontmatter {
  REQUIRED_FIELDS.forEach((key) => {
    if (!values.has(key)) throw new KnowledgeInputError('FRONTMATTER_REQUIRED_FIELD', `缺少 frontmatter 字段: ${key}`);
  });
  const title = scalar(values, 'title');
  const pageType = scalar(values, 'page_type');
  const status = scalar(values, 'status');
  const evidenceStatus = scalar(values, 'evidence_status');
  const reviewState = scalar(values, 'review_state');
  if (!PAGE_TYPES.has(pageType)) throw new KnowledgeInputError('PAGE_TYPE_INVALID', 'page_type 不受支持');
  if (!STATUSES.has(status)) throw new KnowledgeInputError('PAGE_STATUS_INVALID', 'status 不受支持');
  if (!EVIDENCE_STATUSES.has(evidenceStatus)) throw new KnowledgeInputError('EVIDENCE_STATUS_INVALID', 'evidence_status 不受支持');
  if (!REVIEW_STATES.has(reviewState)) throw new KnowledgeInputError('REVIEW_STATE_INVALID', 'review_state 不受支持');
  const sourceCount = integer(values, 'source_count');
  if (sourceCount < 0 || sourceCount > 1_000_000) throw new KnowledgeInputError('SOURCE_COUNT_INVALID', 'source_count 超出限制');
  const sourcePaths = list(values, 'source_paths', false);
  sourcePaths.forEach((path) => {
    if (!isSafeRawPath(path)) throw new KnowledgeInputError('SOURCE_PATH_INVALID', 'source_paths 必须是安全 raw 相对路径');
  });

  let sourceProfile: CanonicalFrontmatter['sourceProfile'];
  if (pageType === 'source-digest') {
    const cluster = scalar(values, 'source_cluster');
    const bucket = scalar(values, 'source_bucket');
    const coverage = scalar(values, 'coverage_scope');
    const crossClusterPolicy = scalar(values, 'cross_cluster_policy');
    const attention = integer(values, 'attention_score');
    if (!SOURCE_CLUSTERS.has(cluster) || !SOURCE_BUCKETS.has(bucket) || !COVERAGE.has(coverage)
      || !CROSS_CLUSTER.has(crossClusterPolicy) || attention < 0 || attention > 100) {
      throw new KnowledgeInputError('SOURCE_PROFILE_INVALID', 'source-digest 检索画像无效');
    }
    sourceProfile = {
      cluster: cluster as NonNullable<CanonicalFrontmatter['sourceProfile']>['cluster'],
      bucket: bucket as NonNullable<CanonicalFrontmatter['sourceProfile']>['bucket'],
      coverage: coverage as NonNullable<CanonicalFrontmatter['sourceProfile']>['coverage'],
      crossClusterPolicy: crossClusterPolicy as NonNullable<CanonicalFrontmatter['sourceProfile']>['crossClusterPolicy'],
      attention,
    };
    if (sourcePaths.length === 0) throw new KnowledgeInputError('SOURCE_PATH_REQUIRED', 'source-digest 必须包含安全 source_paths');
  }
  const routing: Record<string, string | number | string[]> = {};
  for (const [key, value] of values) {
    if (!REQUIRED_FIELDS.includes(key as typeof REQUIRED_FIELDS[number])
      && !['source_paths', 'source_cluster', 'source_bucket', 'coverage_scope', 'cross_cluster_policy', 'attention_score'].includes(key)) {
      routing[key] = value;
    }
  }
  return {
    title,
    pageType: pageType as CanonicalFrontmatter['pageType'],
    status: status as CanonicalFrontmatter['status'],
    tags: list(values, 'tags'),
    aliases: list(values, 'aliases'),
    sourceCount,
    evidenceStatus: evidenceStatus as CanonicalFrontmatter['evidenceStatus'],
    lastCompiled: scalar(values, 'last_compiled'),
    reviewState: reviewState as CanonicalFrontmatter['reviewState'],
    sourcePaths,
    ...(sourceProfile ? { sourceProfile } : {}),
    routing,
  };
}

function scalar(values: Map<string, string | number | string[]>, key: string): string {
  const value = values.get(key);
  if (typeof value !== 'string') throw new KnowledgeInputError('FRONTMATTER_EXPECTED_SCALAR', `${key} 必须是标量`);
  return value;
}

function integer(values: Map<string, string | number | string[]>, key: string): number {
  const value = values.get(key);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new KnowledgeInputError('FRONTMATTER_EXPECTED_INTEGER', `${key} 必须是安全整数`);
  }
  return value;
}

function list(values: Map<string, string | number | string[]>, key: string, required = true): string[] {
  const value = values.get(key);
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new KnowledgeInputError('FRONTMATTER_EXPECTED_LIST', `${key} 必须是列表`);
  return value;
}

function sanitizeMarkdownBody(body: string): string {
  const output: string[] = [];
  let fenced = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^\s*(?:[-*]\s*)?(?:Raw note|Raw path|Source paths?)\s*:/iu.test(line)) continue;
    let safe = line.replace(/`[^`]*`/gu, '');
    safe = safe.replace(/!\[\[[^\]]+\]\]/gu, '');
    safe = safe.replace(/\[\[([^\]]+)\]\]/gu, (_whole, inner: string) => {
      const { target, label } = splitWikiTarget(inner);
      if (isRawTarget(target)) return '';
      return label ?? target.split('#', 1)[0] ?? '';
    });
    safe = safe.replace(/(!?)\[([^\]\n]{0,1000})\]\((?:<([^>\n]{1,4000})>|([^\n)]{1,4000}))\)/gu,
      (_whole, imageMarker: string, label: string, _angledTarget: string | undefined, _target: string | undefined) => {
        if (imageMarker) return isVaultPath(label) ? '' : label;
        return isVaultPath(label) ? '' : label;
      });
    safe = safe.replace(/<[^>\n]{1,4000}>/gu, '');
    safe = stripVaultPaths(safe);
    if (safe.trim()) output.push(safe.replace(/\s+/gu, ' ').trim());
    else if (output.at(-1) !== '') output.push('');
  }
  return output.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function parseWikiLinks(body: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  let fenced = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const withoutInline = line.replace(/`[^`]*`/gu, '').replace(/!\[\[[^\]]+\]\]/gu, '');
    for (const match of withoutInline.matchAll(/\[\[([^\]]+)\]\]/gu)) {
      const { target, heading, label } = splitWikiTarget(match[1]!);
      if (!target || isRawTarget(target)) continue;
      links.push({ target, ...(heading ? { heading } : {}), ...(label ? { label } : {}) });
    }
  }
  return links;
}

function splitWikiTarget(inner: string): { target: string; heading?: string; label?: string } {
  const [destination = '', label] = inner.split('|', 2);
  const hash = destination.indexOf('#');
  const target = (hash < 0 ? destination : destination.slice(0, hash)).trim().normalize('NFKC');
  const heading = hash < 0 ? undefined : destination.slice(hash + 1).trim().normalize('NFKC');
  return { target, ...(heading ? { heading } : {}), ...(label?.trim() ? { label: label.trim() } : {}) };
}

function fragmentMarkdown(body: string): ParsedMarkdownFragment[] {
  const fragments: ParsedMarkdownFragment[] = [];
  const headingStack: string[] = [];
  const occurrenceByPath = new Map<string, number>();
  let heading: string | undefined;
  let headingPath: string | undefined;
  let headingOccurrence = 0;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    buffer = [];
    if (!content) return;
    const chunks = splitBounded(content, MAX_FRAGMENT_CHARS);
    chunks.forEach((chunk, chunkOrdinal) => {
      fragments.push({
        ...(heading ? { heading } : {}),
        ...(headingPath ? { headingPath } : {}),
        headingOccurrence,
        chunkOrdinal,
        content: chunk,
        stableKey: stableFragmentKey(headingPath ?? '', headingOccurrence, chunkOrdinal),
      });
    });
  };

  for (const line of body.split('\n')) {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (!match) {
      buffer.push(line);
      continue;
    }
    flush();
    const level = match[1]!.length;
    heading = match[2]!.trim().normalize('NFKC');
    headingStack.length = level - 1;
    headingStack[level - 1] = heading;
    headingPath = headingStack.filter(Boolean).join(' / ');
    headingOccurrence = occurrenceByPath.get(headingPath) ?? 0;
    occurrenceByPath.set(headingPath, headingOccurrence + 1);
    buffer.push(heading);
  }
  flush();
  return fragments;
}

function splitBounded(value: string, max: number): string[] {
  const characters = [...value];
  const chunks: string[] = [];
  for (let offset = 0; offset < characters.length; offset += max) {
    chunks.push(characters.slice(offset, offset + max).join('').trim());
  }
  return chunks.filter(Boolean);
}

function stableFragmentKey(path: string, occurrence: number, ordinal: number): string {
  return createHash('sha256').update(`${path}\u0000${occurrence}\u0000${ordinal}`).digest('hex');
}

function isRawTarget(target: string): boolean {
  const normalized = target.replaceAll('\\', '/').replace(/^\.\//u, '');
  return normalized === 'raw' || normalized.startsWith('raw/') || normalized.includes('/raw/');
}

function stripVaultPaths(value: string): string {
  return value
    .replace(/(^|[^\p{Letter}\p{Number}_])(?:\.\.?\/)*(?:raw|wiki_v2)\/[^\s<>"'|)\]}]+/giu, '$1')
    .replace(/(^|[^\p{Letter}\p{Number}_])(?:\.\.\/)+(?:moc|indexes|concepts|sources|procedures|cases|analysis)\/[^\s<>"'|)\]}]+/giu, '$1')
    .replace(/(^|[^\p{Letter}\p{Number}_])\/Users\/[^\s<>"'|)\]}]+/giu, '$1');
}

function isVaultPath(value: string): boolean {
  const normalized = value.trim().replaceAll('\\', '/');
  return /(?:^|\/)raw(?:\/|$)|(?:^|\/)wiki_v2(?:\/|$)|^\/Users\//iu.test(normalized)
    || /^(?:\.\.\/)+(?:moc|indexes|concepts|sources|procedures|cases|analysis)\//iu.test(normalized);
}

export function isSafeRawPath(value: string): boolean {
  return value.startsWith('raw/')
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..')
    && !/\p{Cc}/u.test(value);
}

function safeAuditName(relativeLocator: string): string {
  return relativeLocator.split('/').at(-1)?.slice(0, 200) ?? 'unknown';
}

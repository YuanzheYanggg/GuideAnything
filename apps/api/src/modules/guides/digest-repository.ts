import {
  GuideDigestDraftV1Schema,
  type GuideDigestDraftV1,
} from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export type GuideDigestProposalStatus = 'DRAFT' | 'REJECTED' | 'APPLIED' | 'STALE' | 'FAILED';
export type GuideDigestAuditEventType =
  | 'GENERATED'
  | 'VALIDATION_FAILED'
  | 'REJECTED'
  | 'MARKED_STALE'
  | 'APPLIED';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const AcceptedTagsSchema = z.array(z.string().trim().min(1).max(50)).max(20)
  .refine((tags) => new Set(tags).size === tags.length, 'accepted tags must be unique');

interface ProposalRow {
  id: string;
  guide_id: string;
  workspace_id: string;
  base_snapshot_id: string;
  base_revision: number;
  bundle_revision: number;
  renderer_version: string;
  generation_metadata_json: string;
  status: GuideDigestProposalStatus;
  draft_json: string | null;
  markdown: string | null;
  failure_code: string | null;
  supersedes_proposal_id: string | null;
  applied_revision: number | null;
  selected_summary: number | null;
  accepted_tags_json: string | null;
  accepted_markdown: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface AuditRow {
  id: string;
  proposal_id: string;
  guide_id: string;
  workspace_id: string;
  actor_id: string;
  event: GuideDigestAuditEventType;
  metadata_json: string;
  created_at: string;
}

export interface GuideDigestProposal {
  id: string;
  guideId: string;
  workspaceId: string;
  baseSnapshotId: string;
  baseRevision: number;
  bundleRevision: number;
  rendererVersion: string;
  generationMetadata: JsonObject;
  status: GuideDigestProposalStatus;
  draft: GuideDigestDraftV1 | null;
  markdown: string | null;
  failureCode: string | null;
  supersedesProposalId: string | null;
  appliedRevision: number | null;
  selectedSummary: boolean | null;
  acceptedTags: string[] | null;
  acceptedMarkdown: boolean | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface GuideDigestAuditEvent {
  id: string;
  proposalId: string;
  guideId: string;
  workspaceId: string;
  actorId: string;
  event: GuideDigestAuditEventType;
  metadata: JsonObject;
  createdAt: string;
}

export interface GuideDigestGenerationIdentity {
  guideId: string;
  workspaceId: string;
  baseSnapshotId: string;
  baseRevision: number;
  bundleRevision: number;
  rendererVersion: string;
  generationMetadata: Record<string, unknown>;
}

export interface CreateGuideDigestProposalInput extends GuideDigestGenerationIdentity {
  draft: GuideDigestDraftV1;
  markdown: string;
  createdBy: string;
  supersedesProposalId?: string | null;
}

export interface CreateFailedGuideDigestProposalInput extends GuideDigestGenerationIdentity {
  failureCode: string;
  createdBy: string;
  supersedesProposalId?: string | null;
}

export interface ApplyGuideDigestProposalInput {
  appliedRevision: number;
  selectedSummary: boolean;
  acceptedTags: string[];
  acceptedMarkdown: boolean;
  auditMetadata?: Record<string, unknown>;
}

export class GuideDigestRepositoryError extends Error {
  constructor(readonly code: 'GUIDE_DIGEST_SCOPE_MISMATCH' | 'GUIDE_DIGEST_INVALID_STATE', message: string) {
    super(message);
    this.name = 'GuideDigestRepositoryError';
  }
}

export function createGuideDigestProposal(
  database: DatabaseSync,
  input: CreateGuideDigestProposalInput,
): GuideDigestProposal {
  const draft = GuideDigestDraftV1Schema.parse(input.draft);
  if (!input.markdown.trim()) throw new Error('guide digest Markdown must not be empty');
  return insertProposal(database, {
    ...input,
    status: 'DRAFT',
    draftJson: JSON.stringify(draft),
    markdown: input.markdown,
    failureCode: null,
  });
}

export function createFailedGuideDigestProposal(
  database: DatabaseSync,
  input: CreateFailedGuideDigestProposalInput,
): GuideDigestProposal {
  if (!/^[A-Z0-9_]{1,100}$/.test(input.failureCode)) {
    throw new Error('guide digest failure code must contain only A-Z, 0-9, and underscore');
  }
  return insertProposal(database, {
    ...input,
    status: 'FAILED',
    draftJson: null,
    markdown: null,
    failureCode: input.failureCode,
  });
}

/**
 * Marks the current draft stale and inserts its linked successor. The caller
 * owns the surrounding transaction; this function deliberately issues no
 * BEGIN, COMMIT, or ROLLBACK statements.
 */
export function regenerateGuideDigestProposal(
  database: DatabaseSync,
  priorProposalId: string,
  input: CreateGuideDigestProposalInput,
): GuideDigestProposal {
  markGuideDigestProposalStale(database, input.guideId, priorProposalId, input.createdBy, {
    reasonCode: 'REGENERATED',
  });
  return createGuideDigestProposal(database, {
    ...input,
    supersedesProposalId: priorProposalId,
  });
}

export function getGuideDigestProposal(
  database: DatabaseSync,
  guideId: string,
  proposalId: string,
): GuideDigestProposal | null {
  const row = getProposalRow(database, proposalId);
  if (!row) return null;
  assertGuideScope(row, guideId);
  return mapProposal(row);
}

export function listGuideDigestProposals(database: DatabaseSync, guideId: string): GuideDigestProposal[] {
  const rows = database.prepare(
    `${PROPOSAL_SELECT}
     WHERE guide_id = ?
     ORDER BY created_at DESC, id DESC`,
  ).all(guideId) as unknown as ProposalRow[];
  return rows.map(mapProposal);
}

export function findDraftGuideDigestProposal(
  database: DatabaseSync,
  input: { guideId: string; baseSnapshotId: string; bundleRevision: number },
): GuideDigestProposal | null {
  const row = database.prepare(
    `${PROPOSAL_SELECT}
     WHERE guide_id = ? AND base_snapshot_id = ? AND bundle_revision = ? AND status = 'DRAFT'`,
  ).get(input.guideId, input.baseSnapshotId, input.bundleRevision) as unknown as ProposalRow | undefined;
  return row ? mapProposal(row) : null;
}

export function rejectGuideDigestProposal(
  database: DatabaseSync,
  guideId: string,
  proposalId: string,
  actorId: string,
  auditMetadata: Record<string, unknown> = {},
): GuideDigestProposal {
  return transitionDraft(database, guideId, proposalId, actorId, {
    status: 'REJECTED',
    event: 'REJECTED',
    auditMetadata,
  });
}

export function markGuideDigestProposalStale(
  database: DatabaseSync,
  guideId: string,
  proposalId: string,
  actorId: string,
  auditMetadata: Record<string, unknown> = {},
): GuideDigestProposal {
  return transitionDraft(database, guideId, proposalId, actorId, {
    status: 'STALE',
    event: 'MARKED_STALE',
    auditMetadata,
  });
}

export function applyGuideDigestProposal(
  database: DatabaseSync,
  guideId: string,
  proposalId: string,
  actorId: string,
  input: ApplyGuideDigestProposalInput,
): GuideDigestProposal {
  if (!Number.isSafeInteger(input.appliedRevision) || input.appliedRevision < 0) {
    throw new Error('applied revision must be a non-negative safe integer');
  }
  const acceptedTags = AcceptedTagsSchema.parse(input.acceptedTags);
  return transitionDraft(database, guideId, proposalId, actorId, {
    status: 'APPLIED',
    event: 'APPLIED',
    appliedRevision: input.appliedRevision,
    selectedSummary: input.selectedSummary,
    acceptedTags,
    acceptedMarkdown: input.acceptedMarkdown,
    auditMetadata: {
      appliedRevision: input.appliedRevision,
      selectedSummary: input.selectedSummary,
      acceptedTagCount: acceptedTags.length,
      acceptedMarkdown: input.acceptedMarkdown,
      ...(input.auditMetadata ?? {}),
    },
  });
}

export function listGuideDigestAuditEvents(
  database: DatabaseSync,
  guideId: string,
  proposalId: string,
): GuideDigestAuditEvent[] {
  const proposal = getProposalRow(database, proposalId);
  if (!proposal) return [];
  assertGuideScope(proposal, guideId);
  const rows = database.prepare(
    `SELECT id, proposal_id, guide_id, workspace_id, actor_id, event, metadata_json, created_at
     FROM guide_digest_audit_events
     WHERE proposal_id = ?
     ORDER BY created_at ASC, rowid ASC`,
  ).all(proposalId) as unknown as AuditRow[];
  return rows.map(mapAuditEvent);
}

type InsertProposalInput = GuideDigestGenerationIdentity & {
  status: 'DRAFT' | 'FAILED';
  draftJson: string | null;
  markdown: string | null;
  failureCode: string | null;
  createdBy: string;
  supersedesProposalId?: string | null;
};

function insertProposal(database: DatabaseSync, input: InsertProposalInput): GuideDigestProposal {
  assertGenerationIdentity(input);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const supersedesProposalId = input.supersedesProposalId ?? null;
  const generationMetadata = sanitizeMetadata(input.generationMetadata);
  database.prepare(
    `INSERT INTO guide_digest_proposals (
      id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
      renderer_version, generation_metadata_json, status, draft_json, markdown,
      failure_code, supersedes_proposal_id, applied_revision, selected_summary,
      accepted_tags_json, accepted_markdown, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
  ).run(
    id,
    input.guideId,
    input.workspaceId,
    input.baseSnapshotId,
    input.baseRevision,
    input.bundleRevision,
    input.rendererVersion,
    JSON.stringify(generationMetadata),
    input.status,
    input.draftJson,
    input.markdown,
    input.failureCode,
    supersedesProposalId,
    input.createdBy,
    createdAt,
    createdAt,
  );
  recordAuditEvent(database, {
    proposalId: id,
    guideId: input.guideId,
    workspaceId: input.workspaceId,
    actorId: input.createdBy,
    event: input.status === 'DRAFT' ? 'GENERATED' : 'VALIDATION_FAILED',
    metadata: input.status === 'DRAFT'
      ? { bundleRevision: input.bundleRevision, rendererVersion: input.rendererVersion, supersedesProposalId }
      : {
          bundleRevision: input.bundleRevision,
          rendererVersion: input.rendererVersion,
          failureCode: input.failureCode!,
          supersedesProposalId,
        },
    createdAt,
  });
  return getGuideDigestProposal(database, input.guideId, id)!;
}

function transitionDraft(
  database: DatabaseSync,
  guideId: string,
  proposalId: string,
  actorId: string,
  input: {
    status: 'REJECTED' | 'APPLIED' | 'STALE';
    event: 'REJECTED' | 'APPLIED' | 'MARKED_STALE';
    appliedRevision?: number;
    selectedSummary?: boolean;
    acceptedTags?: string[];
    acceptedMarkdown?: boolean;
    auditMetadata: Record<string, unknown>;
  },
): GuideDigestProposal {
  const current = getProposalRow(database, proposalId);
  if (!current) {
    throw new GuideDigestRepositoryError('GUIDE_DIGEST_INVALID_STATE', 'guide digest proposal does not exist');
  }
  assertGuideScope(current, guideId);
  if (current.status !== 'DRAFT') {
    throw new GuideDigestRepositoryError(
      'GUIDE_DIGEST_INVALID_STATE',
      `cannot transition guide digest proposal from ${current.status}`,
    );
  }
  const updatedAt = new Date().toISOString();
  const result = database.prepare(
    `UPDATE guide_digest_proposals
     SET status = ?, applied_revision = ?, selected_summary = ?, accepted_tags_json = ?,
         accepted_markdown = ?, updated_at = ?
     WHERE id = ? AND guide_id = ? AND status = 'DRAFT'`,
  ).run(
    input.status,
    input.appliedRevision ?? null,
    input.selectedSummary === undefined ? null : Number(input.selectedSummary),
    input.acceptedTags === undefined ? null : JSON.stringify(input.acceptedTags),
    input.acceptedMarkdown === undefined ? null : Number(input.acceptedMarkdown),
    updatedAt,
    proposalId,
    guideId,
  );
  if (result.changes !== 1) {
    throw new GuideDigestRepositoryError('GUIDE_DIGEST_INVALID_STATE', 'guide digest proposal state changed');
  }
  recordAuditEvent(database, {
    proposalId,
    guideId,
    workspaceId: current.workspace_id,
    actorId,
    event: input.event,
    metadata: sanitizeMetadata(input.auditMetadata),
    createdAt: updatedAt,
  });
  return getGuideDigestProposal(database, guideId, proposalId)!;
}

function recordAuditEvent(
  database: DatabaseSync,
  input: {
    proposalId: string;
    guideId: string;
    workspaceId: string;
    actorId: string;
    event: GuideDigestAuditEventType;
    metadata: Record<string, unknown> | JsonObject;
    createdAt: string;
  },
): void {
  database.prepare(
    `INSERT INTO guide_digest_audit_events (
      id, proposal_id, guide_id, workspace_id, actor_id, event, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.proposalId,
    input.guideId,
    input.workspaceId,
    input.actorId,
    input.event,
    JSON.stringify(sanitizeMetadata(input.metadata)),
    input.createdAt,
  );
}

function assertGenerationIdentity(input: GuideDigestGenerationIdentity): void {
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new Error('base revision must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(input.bundleRevision) || input.bundleRevision <= 0) {
    throw new Error('bundle revision must be a positive safe integer');
  }
  if (!input.rendererVersion.trim()) throw new Error('renderer version must not be empty');
}

function assertGuideScope(row: ProposalRow, guideId: string): void {
  if (row.guide_id !== guideId) {
    throw new GuideDigestRepositoryError(
      'GUIDE_DIGEST_SCOPE_MISMATCH',
      'guide digest proposal does not belong to the requested guide',
    );
  }
}

function getProposalRow(database: DatabaseSync, proposalId: string): ProposalRow | undefined {
  return database.prepare(`${PROPOSAL_SELECT} WHERE id = ?`).get(proposalId) as unknown as ProposalRow | undefined;
}

const PROPOSAL_SELECT = `SELECT
  id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
  renderer_version, generation_metadata_json, status, draft_json, markdown,
  failure_code, supersedes_proposal_id, applied_revision, selected_summary,
  accepted_tags_json, accepted_markdown, created_by, created_at, updated_at
FROM guide_digest_proposals`;

function mapProposal(row: ProposalRow): GuideDigestProposal {
  return {
    id: row.id,
    guideId: row.guide_id,
    workspaceId: row.workspace_id,
    baseSnapshotId: row.base_snapshot_id,
    baseRevision: row.base_revision,
    bundleRevision: row.bundle_revision,
    rendererVersion: row.renderer_version,
    generationMetadata: parseJsonObject(row.generation_metadata_json),
    status: row.status,
    draft: row.draft_json === null ? null : GuideDigestDraftV1Schema.parse(JSON.parse(row.draft_json)),
    markdown: row.markdown,
    failureCode: row.failure_code,
    supersedesProposalId: row.supersedes_proposal_id,
    appliedRevision: row.applied_revision,
    selectedSummary: row.selected_summary === null ? null : row.selected_summary === 1,
    acceptedTags: row.accepted_tags_json === null
      ? null
      : AcceptedTagsSchema.parse(JSON.parse(row.accepted_tags_json)),
    acceptedMarkdown: row.accepted_markdown === null ? null : row.accepted_markdown === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAuditEvent(row: AuditRow): GuideDigestAuditEvent {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    guideId: row.guide_id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    event: row.event,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

function parseJsonObject(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!isPlainObject(parsed)) throw new Error('persisted metadata must be a JSON object');
  return sanitizeMetadata(parsed);
}

function sanitizeMetadata(value: Record<string, unknown>): JsonObject {
  const sanitized = sanitizeJsonValue(value);
  if (!isPlainObject(sanitized)) throw new Error('metadata must be a JSON object');
  return sanitized;
}

function sanitizeJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('metadata numbers must be finite');
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const sanitized = sanitizeJsonValue(item);
      if (sanitized === undefined) throw new Error('metadata arrays must contain JSON values');
      return sanitized;
    });
  }
  if (isPlainObject(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (isForbiddenAuditKey(key)) continue;
      const sanitized = sanitizeJsonValue(item);
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  }
  if (value === undefined) return undefined;
  throw new Error('metadata must contain only JSON values');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isForbiddenAuditKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('prompt')
    || normalized.includes('hiddenreasoning')
    || normalized.includes('chainofthought')
    || normalized.includes('rawmodeloutput')
    || normalized === 'modeloutput';
}

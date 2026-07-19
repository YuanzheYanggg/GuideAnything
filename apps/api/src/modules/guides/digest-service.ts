import {
  FlowKnowledgeSnapshotV2Schema,
  type FlowKnowledgeSnapshotV2,
  type GuideDigestDraftV1,
} from '@guideanything/contracts';
import { normalizeFlowKnowledgeSnapshot } from '@guideanything/canvas-core';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ZodError } from 'zod';

import { httpError } from '../../lib/http-error';
import {
  GUIDE_DIGEST_BUNDLE,
  buildGuideDigestInputEnvelope,
  buildGuideDigestPrompt,
} from '../agents/bundles/guide-digest';
import type { AgentRuntimeClient } from '../agents/runtime-client';
import { invokeGuideDigestRuntime } from '../agents/typed-runtime';
import {
  FlowIndexError,
  recordFlowIndexFailure,
  syncGuideFlowSnapshot,
  type GuideFlowContext,
} from '../knowledge/flow-indexer';
import {
  canSeeGuideMetadata,
  getGuide,
  getGuideAccess,
  updateGuideInTransaction,
  type GuideDraft,
} from './repository';
import {
  applyGuideDigestProposal,
  createFailedGuideDigestProposal,
  createGuideDigestProposal,
  findDraftGuideDigestProposal,
  getGuideDigestProposal,
  GuideDigestRepositoryError,
  listGuideDigestProposals,
  markGuideDigestProposalStale,
  regenerateGuideDigestProposal,
  rejectGuideDigestProposal,
  type GuideDigestProposal,
} from './digest-repository';
import {
  DIGEST_RENDERER_VERSION,
  GuideDigestSourceValidationError,
  renderGuideDigestMarkdown,
  validateGuideDigestSources,
} from './digest-renderer';

const SAFE_FAILURE_CODE = /^[A-Z0-9_]{1,80}$/u;

type GuideUser = { id: string; role: string };

export interface GuideFlowSnapshotStatus {
  guideRevision: number;
  sourceStatus: string | null;
  snapshotId: string | null;
  snapshotRevision: number | null;
  snapshotSchemaVersion: number | null;
  failureCode: string | null;
}

interface SourceStatusRow {
  status: string;
  config_json: string;
}

interface SnapshotStatusRow {
  id: string;
  revision: number;
  schema_version: number | null;
}

interface ReadySnapshotRow {
  id: string;
  workspace_id: string;
  revision: number;
  snapshot_json: string;
}

interface ReadyGuideSnapshot {
  guide: GuideDraft;
  snapshot: FlowKnowledgeSnapshotV2;
}

interface GenerationMetadata extends Record<string, unknown> {
  modelRole: typeof GUIDE_DIGEST_BUNDLE.role;
  reasoningEffort: typeof GUIDE_DIGEST_BUNDLE.reasoningEffort;
  outputSchemaVersion: 1;
  attemptCount: number;
  repairAttempted: boolean;
  truncatedResourceCount: number;
}

type GenerationResult =
  | { ok: true; draft: GuideDigestDraftV1; markdown: string; metadata: GenerationMetadata }
  | { ok: false; failureCode: string; metadata: GenerationMetadata };

export interface CreateGuideDigestResult {
  created: boolean;
  proposal: GuideDigestProposal;
}

export interface ApplyGuideDigestSelection {
  applySummary: boolean;
  acceptedTagLabels: string[];
  acceptMarkdown: boolean;
}

export interface ApplyGuideDigestResult {
  guide: GuideDraft;
  proposal: GuideDigestProposal;
}

export class GuideDigestService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly runtime?: AgentRuntimeClient,
  ) {}

  getFlowSnapshotStatus(user: GuideUser, guideId: string): GuideFlowSnapshotStatus {
    const guide = this.requireGuideAccess(user, guideId);
    const source = this.getFlowSource(guide);
    const snapshot = this.database.prepare(
      `SELECT id, revision, json_extract(snapshot_json, '$.schemaVersion') AS schema_version
       FROM flow_knowledge_snapshots
       WHERE guide_id = ? AND origin_type = 'DRAFT'
       ORDER BY revision DESC, created_at DESC, id DESC
       LIMIT 1`,
    ).get(guide.id) as unknown as SnapshotStatusRow | undefined;
    return {
      guideRevision: guide.revision,
      sourceStatus: source?.status ?? null,
      snapshotId: snapshot?.id ?? null,
      snapshotRevision: snapshot?.revision ?? null,
      snapshotSchemaVersion: snapshot?.schema_version ?? null,
      failureCode: source?.status === 'FAILED'
        ? safeFailureCode(source.config_json)
        : null,
    };
  }

  reconcileFlowSnapshot(user: GuideUser, guideId: string): GuideFlowSnapshotStatus {
    const guide = this.requireGuideAccess(user, guideId);
    const context = guideFlowContext(guide);
    try {
      syncGuideFlowSnapshot(this.database, context);
      this.markCurrentFlowSourceReady(guide);
    } catch (error) {
      recordFlowIndexFailure(
        this.database,
        context,
        error instanceof FlowIndexError ? error.code : 'FLOW_RECONCILE_FAILED',
      );
    }
    return this.getFlowSnapshotStatus(user, guideId);
  }

  listProposals(user: GuideUser, guideId: string): GuideDigestProposal[] {
    this.requireGuideAccess(user, guideId);
    return listGuideDigestProposals(this.database, guideId);
  }

  getProposal(user: GuideUser, guideId: string, proposalId: string): GuideDigestProposal {
    this.requireGuideAccess(user, guideId);
    return this.requireProposal(guideId, proposalId);
  }

  rejectProposal(user: GuideUser, guideId: string, proposalId: string): GuideDigestProposal {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.requireGuideAccess(user, guideId);
      this.requireProposal(guideId, proposalId);
      const proposal = rejectGuideDigestProposal(
        this.database,
        guideId,
        proposalId,
        user.id,
        { reasonCode: 'USER_REJECTED' },
      );
      this.database.exec('COMMIT');
      return proposal;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw mapProposalStateError(error);
    }
  }

  applyProposal(
    user: GuideUser,
    guideId: string,
    proposalId: string,
    input: ApplyGuideDigestSelection,
  ): ApplyGuideDigestResult {
    let stale = false;
    let result: ApplyGuideDigestResult | undefined;
    let guideToSync: GuideDraft | undefined;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const guide = this.requireGuideAccess(user, guideId);
      const proposal = this.requireProposal(guideId, proposalId);
      if (proposal.status !== 'DRAFT' || !proposal.draft) {
        throw httpError(409, 'GUIDE_DIGEST_INVALID_STATE', '指南摘要提案状态已发生变化');
      }
      if (guide.revision !== proposal.baseRevision) {
        markGuideDigestProposalStale(this.database, guideId, proposalId, user.id, {
          reasonCode: 'BASE_REVISION_CHANGED',
          baseRevision: proposal.baseRevision,
        });
        this.database.exec('COMMIT');
        stale = true;
      } else {
        if (!input.applySummary && input.acceptedTagLabels.length === 0 && !input.acceptMarkdown) {
          throw httpError(400, 'VALIDATION_ERROR', '至少选择一项摘要、标签或 Markdown');
        }
        const acceptedTags = acceptedProposalTags(proposal, input.acceptedTagLabels);
        const nextTags = acceptedTags.length === 0
          ? guide.tags
          : appendAcceptedTags(guide.tags, acceptedTags);
        if (acceptedTags.length > 0) validateFinalTags(nextTags);
        const summaryChanged = input.applySummary && guide.summary !== proposal.draft.shortSummary;
        const tagsChanged = !sameStrings(guide.tags, nextTags);
        const guideFieldsChanged = summaryChanged || tagsChanged;
        if (!guideFieldsChanged && !input.acceptMarkdown) {
          throw httpError(409, 'NO_EFFECTIVE_CHANGE', '所选内容不会改变指南草稿');
        }
        const updatedGuide = guideFieldsChanged
          ? updateGuideInTransaction(this.database, guideId, user.id, guide.revision, {
              ...(summaryChanged ? { summary: proposal.draft.shortSummary } : {}),
              ...(tagsChanged ? { tags: nextTags } : {}),
            })
          : guide;
        const appliedProposal = applyGuideDigestProposal(
          this.database,
          guideId,
          proposalId,
          user.id,
          {
            appliedRevision: updatedGuide.revision,
            selectedSummary: input.applySummary,
            acceptedTags,
            acceptedMarkdown: input.acceptMarkdown,
          },
        );
        this.database.exec('COMMIT');
        result = { guide: updatedGuide, proposal: appliedProposal };
        if (guideFieldsChanged) guideToSync = updatedGuide;
      }
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw mapProposalStateError(error);
    }
    if (stale) {
      throw httpError(409, 'GUIDE_DIGEST_PROPOSAL_STALE', '指南已更新，此摘要提案已过期');
    }
    if (!result) throw new Error('guide digest apply did not produce a result');
    if (guideToSync) this.bestEffortFlowSync(guideToSync);
    return result;
  }

  async createProposal(
    user: GuideUser,
    guideId: string,
    input: { regenerate?: boolean },
  ): Promise<CreateGuideDigestResult> {
    const ready = this.requireReadySnapshot(user, guideId);
    const identity = generationIdentity(ready);
    const existing = findDraftGuideDigestProposal(this.database, identity);
    if (existing && input.regenerate !== true) {
      return { created: false, proposal: existing };
    }
    const runtime = this.runtime;
    if (!runtime) {
      throw httpError(503, 'GUIDE_DIGEST_RUNTIME_UNAVAILABLE', '指南摘要生成服务暂不可用');
    }
    const generation = await generateDigest(runtime, ready);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.requireReadySnapshot(user, guideId);
      assertSameSnapshot(ready, current);
      const currentDraft = findDraftGuideDigestProposal(this.database, identity);
      if (currentDraft && input.regenerate !== true) {
        this.database.exec('COMMIT');
        return { created: false, proposal: currentDraft };
      }
      if (!generation.ok) {
        const proposal = createFailedGuideDigestProposal(this.database, {
          ...identity,
          rendererVersion: rendererVersion(),
          generationMetadata: generation.metadata,
          failureCode: generation.failureCode,
          createdBy: user.id,
        });
        this.database.exec('COMMIT');
        return { created: true, proposal };
      }
      if (existing && !currentDraft) {
        throw httpError(409, 'GUIDE_DIGEST_PROPOSAL_CHANGED', '指南摘要提案状态已发生变化');
      }
      const proposalInput = {
        ...identity,
        rendererVersion: rendererVersion(),
        generationMetadata: generation.metadata,
        draft: generation.draft,
        markdown: generation.markdown,
        createdBy: user.id,
      };
      const proposal = currentDraft
        ? regenerateGuideDigestProposal(this.database, currentDraft.id, proposalInput)
        : createGuideDigestProposal(this.database, proposalInput);
      this.database.exec('COMMIT');
      return { created: true, proposal };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private requireGuideAccess(user: GuideUser, guideId: string): GuideDraft {
    const access = getGuideAccess(this.database, guideId, user.id);
    if (!access) {
      if (!canSeeGuideMetadata(this.database, guideId, user)) {
        throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
      }
      throw httpError(403, 'FORBIDDEN', '没有查看或编辑此草稿的权限');
    }
    return getGuide(this.database, guideId)!;
  }

  private requireReadySnapshot(user: GuideUser, guideId: string): ReadyGuideSnapshot {
    const guide = this.requireGuideAccess(user, guideId);
    const row = this.database.prepare(
      `SELECT snapshot.id, snapshot.workspace_id, snapshot.revision, snapshot.snapshot_json
       FROM flow_knowledge_snapshots AS snapshot
       JOIN knowledge_documents AS document
         ON document.flow_snapshot_id = snapshot.id AND document.parse_status = 'READY'
       JOIN knowledge_sources AS source
        ON source.id = document.source_id
        AND source.kind = 'WORKSPACE_FLOW'
        AND source.status = 'READY'
       WHERE snapshot.guide_id = ?
         AND snapshot.origin_type = 'DRAFT'
         AND snapshot.revision = ?
       LIMIT 1`,
    ).get(guide.id, guide.revision) as unknown as ReadySnapshotRow | undefined;
    if (!row) throw flowSnapshotNotReady();

    let snapshot: FlowKnowledgeSnapshotV2;
    try {
      snapshot = normalizeFlowKnowledgeSnapshot(
        FlowKnowledgeSnapshotV2Schema.parse(JSON.parse(row.snapshot_json)),
      );
    } catch {
      throw flowSnapshotNotReady();
    }
    if (
      snapshot.schemaVersion !== 2
      || snapshot.snapshotId !== row.id
      || snapshot.guideId !== guide.id
      || snapshot.workspaceId !== row.workspace_id
      || snapshot.origin.kind !== 'DRAFT'
      || snapshot.origin.revision !== guide.revision
    ) {
      throw flowSnapshotNotReady();
    }
    return { guide, snapshot };
  }

  private getFlowSource(guide: GuideDraft): SourceStatusRow | undefined {
    return this.database.prepare(
      `SELECT status, config_json
       FROM knowledge_sources
       WHERE kind = 'WORKSPACE_FLOW'
         AND workspace_id = ?
         AND json_extract(config_json, '$.guideId') = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    ).get(guide.workspaceId, guide.id) as unknown as SourceStatusRow | undefined;
  }

  private markCurrentFlowSourceReady(guide: GuideDraft): void {
    this.database.prepare(
      `UPDATE knowledge_sources AS source
       SET status = 'READY',
           config_json = json_remove(config_json, '$.lastFailureCode'),
           updated_at = ?
       WHERE source.kind = 'WORKSPACE_FLOW'
         AND source.workspace_id = ?
         AND json_extract(source.config_json, '$.guideId') = ?
         AND EXISTS (
           SELECT 1
           FROM knowledge_documents AS document
           JOIN flow_knowledge_snapshots AS snapshot ON snapshot.id = document.flow_snapshot_id
           WHERE document.source_id = source.id
             AND document.parse_status = 'READY'
             AND snapshot.guide_id = ?
             AND snapshot.origin_type = 'DRAFT'
             AND snapshot.revision = ?
         )`,
    ).run(new Date().toISOString(), guide.workspaceId, guide.id, guide.id, guide.revision);
  }

  private requireProposal(guideId: string, proposalId: string): GuideDigestProposal {
    try {
      const proposal = getGuideDigestProposal(this.database, guideId, proposalId);
      if (!proposal) throw proposalNotFound();
      return proposal;
    } catch (error) {
      if (
        error instanceof GuideDigestRepositoryError
        && error.code === 'GUIDE_DIGEST_SCOPE_MISMATCH'
      ) {
        throw proposalNotFound();
      }
      throw error;
    }
  }

  private bestEffortFlowSync(guide: GuideDraft): void {
    const context = guideFlowContext(guide);
    try {
      syncGuideFlowSnapshot(this.database, context);
    } catch (error) {
      try {
        recordFlowIndexFailure(
          this.database,
          context,
          error instanceof FlowIndexError ? error.code : 'FLOW_INDEX_FAILED',
        );
      } catch {
        // The committed guide/apply transaction is authoritative; reconcile repairs derived state.
      }
    }
  }
}

function safeFailureCode(configJson: string): string | null {
  try {
    const value = (JSON.parse(configJson) as { lastFailureCode?: unknown }).lastFailureCode;
    return typeof value === 'string' && SAFE_FAILURE_CODE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function flowSnapshotNotReady() {
  return httpError(409, 'FLOW_SNAPSHOT_NOT_READY', '当前指南流程快照尚未就绪');
}

function guideFlowContext(guide: GuideDraft): GuideFlowContext {
  return {
    workspaceId: guide.workspaceId,
    workspaceItemId: guide.workspaceItemId,
    guideId: guide.id,
    ownerId: guide.ownerId,
    title: guide.title,
    summary: guide.summary,
    tags: guide.tags,
    origin: { kind: 'DRAFT', revision: guide.revision },
    document: guide.document,
  };
}

function generationIdentity(ready: ReadyGuideSnapshot) {
  return {
    guideId: ready.guide.id,
    workspaceId: ready.guide.workspaceId,
    baseSnapshotId: ready.snapshot.snapshotId,
    baseRevision: ready.guide.revision,
    bundleRevision: GUIDE_DIGEST_BUNDLE.revision,
  };
}

function guideDigestRequest(snapshot: FlowKnowledgeSnapshotV2, repairNote?: string) {
  return {
    type: 'RUN' as const,
    requestId: randomUUID(),
    runId: randomUUID(),
    planVersion: GUIDE_DIGEST_BUNDLE.revision,
    role: GUIDE_DIGEST_BUNDLE.role,
    reasoningEffort: GUIDE_DIGEST_BUNDLE.reasoningEffort,
    outputKind: GUIDE_DIGEST_BUNDLE.outputKind,
    prompt: buildGuideDigestPrompt(snapshot, repairNote === undefined
      ? {}
      : { schemaRepairNote: repairNote }),
    allowedRoots: [],
  };
}

function rendererVersion(): string {
  return `guide-digest-markdown-v${DIGEST_RENDERER_VERSION}`;
}

function assertSameSnapshot(initial: ReadyGuideSnapshot, current: ReadyGuideSnapshot): void {
  if (
    initial.guide.revision !== current.guide.revision
    || initial.snapshot.snapshotId !== current.snapshot.snapshotId
  ) {
    throw flowSnapshotNotReady();
  }
}

async function generateDigest(
  runtime: AgentRuntimeClient,
  ready: ReadyGuideSnapshot,
): Promise<GenerationResult> {
  const envelope = buildGuideDigestInputEnvelope(ready.snapshot);
  let repairNote: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const draft = validateGuideDigestSources(
        ready.snapshot,
        await invokeGuideDigestRuntime(runtime, guideDigestRequest(ready.snapshot, repairNote)),
      );
      return {
        ok: true,
        draft,
        markdown: renderGuideDigestMarkdown({
          snapshot: ready.snapshot,
          draft,
          baseRevision: ready.guide.revision,
        }),
        metadata: generationMetadata(attempt, envelope.truncation.truncatedResourceIds.length),
      };
    } catch (error) {
      const failureCode = repairableFailureCode(error);
      if (!failureCode) throw runtimeFailure(error);
      if (attempt === 2) {
        return {
          ok: false,
          failureCode,
          metadata: generationMetadata(attempt, envelope.truncation.truncatedResourceIds.length),
        };
      }
      repairNote = `上次输出未通过 ${failureCode} 验证。请仅依据同一快照重新输出严格匹配 GuideDigestDraftV1 的 JSON。`;
    }
  }
  throw new Error('unreachable guide digest generation state');
}

function generationMetadata(attemptCount: number, truncatedResourceCount: number): GenerationMetadata {
  return {
    modelRole: GUIDE_DIGEST_BUNDLE.role,
    reasoningEffort: GUIDE_DIGEST_BUNDLE.reasoningEffort,
    outputSchemaVersion: 1,
    attemptCount,
    repairAttempted: attemptCount > 1,
    truncatedResourceCount,
  };
}

function repairableFailureCode(error: unknown): string | null {
  if (error instanceof GuideDigestSourceValidationError) return error.code;
  if (error instanceof ZodError) return 'INVALID_GUIDE_DIGEST_OUTPUT';
  const code = errorCode(error);
  return code === 'INVALID_GUIDE_DIGEST_OUTPUT' || code === 'BRIDGE_OUTPUT_MISSING'
    ? code
    : null;
}

function runtimeFailure(error: unknown) {
  const code = errorCode(error);
  return httpError(
    503,
    code && SAFE_FAILURE_CODE.test(code) ? code : 'GUIDE_DIGEST_RUNTIME_FAILED',
    '指南摘要生成服务暂不可用',
  );
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : null;
}

function proposalNotFound() {
  return httpError(404, 'GUIDE_DIGEST_PROPOSAL_NOT_FOUND', '指南摘要提案不存在');
}

function mapProposalStateError(error: unknown): unknown {
  if (
    error instanceof GuideDigestRepositoryError
    && error.code === 'GUIDE_DIGEST_INVALID_STATE'
  ) {
    return httpError(409, error.code, '指南摘要提案状态已发生变化');
  }
  return error;
}

function acceptedProposalTags(proposal: GuideDigestProposal, requestedLabels: readonly string[]): string[] {
  const proposedByKey = new Map(
    (proposal.draft?.tagSuggestions ?? []).map((tag) => [normalizeTag(tag.label), tag.label]),
  );
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const requested of requestedLabels) {
    const key = normalizeTag(requested);
    const canonical = proposedByKey.get(key);
    if (!canonical) {
      throw httpError(400, 'GUIDE_DIGEST_TAG_NOT_PROPOSED', '只能接受当前提案中存在的标签');
    }
    if (!seen.has(key)) {
      accepted.push(canonical);
      seen.add(key);
    }
  }
  return accepted;
}

function appendAcceptedTags(existing: readonly string[], accepted: readonly string[]): string[] {
  const result = [...existing];
  const seen = new Set(existing.map(normalizeTag));
  for (const label of accepted) {
    const display = label.normalize('NFC').trim();
    const key = normalizeTag(display);
    if (!display || seen.has(key)) continue;
    result.push(display);
    seen.add(key);
  }
  return result;
}

function validateFinalTags(tags: readonly string[]): void {
  if (tags.length > 20) {
    throw httpError(400, 'GUIDE_TAG_LIMIT_EXCEEDED', '指南标签不能超过 20 个');
  }
  if (tags.some((tag) => tag.length > 50)) {
    throw httpError(400, 'GUIDE_TAG_LABEL_TOO_LONG', '指南标签不能超过 50 个字符');
  }
}

function normalizeTag(label: string): string {
  return label.normalize('NFKC').trim().toLocaleLowerCase('und');
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

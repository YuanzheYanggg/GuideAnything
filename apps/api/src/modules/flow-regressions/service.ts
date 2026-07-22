import {
  AgentCommittedAnswerV1Schema,
  AgentRetrievalDiagnosticV1Schema,
  FlowAnnotationHealthV1Schema,
  FlowAnnotationHealthIssueV1Schema,
  FlowKnowledgeSnapshotSchema,
  FlowRegressionCaseListV1Schema,
  FlowRegressionReferenceEligibilityV1Schema,
  InternalEvidenceLocatorV1Schema,
  UpdateFlowRegressionCaseStatusRequestV1Schema,
  WorkspaceFlowRegressionCaseV1Schema,
  type AgentRetrievalDiagnosticV1,
  type FlowAnnotationHealthV1,
  type FlowAnnotationHealthIssueV1,
  type FlowRegressionReferenceEligibilityV1,
  type FlowRegressionVerificationV1,
  type FlowKnowledgeResourceV2,
  type FlowKnowledgeSnapshotV2,
  type WorkspaceFlowRegressionCaseV1,
} from '@guideanything/contracts';
import { normalizeFlowKnowledgeSnapshot } from '@guideanything/canvas-core';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import { createConversation, enqueueConversationRun } from '../conversations/repository';
import { canSeeGuideMetadata, getGuide, getGuideAccess } from '../guides/repository';
import { searchKnowledgeInternal } from '../knowledge/repository';
import { normalizeKnowledgeText } from '../knowledge/search-text';
import { resolveFlowAnnotationTarget } from './targets';

const FOCUSED_FLOW_CANDIDATE_BUDGET = 6;

type HealthIssueCode = FlowAnnotationHealthIssueV1['code'];

interface RawFlowFragmentLocator {
  kind: 'WORKSPACE_FLOW';
  guideId: string;
  snapshotId: string;
  nodeId: string;
  annotationId?: string;
  projection?: string;
}

interface IndexedFlowFragment {
  id: string;
  content: string;
  locator: RawFlowFragmentLocator;
}

interface DeterministicVerification {
  verification: FlowRegressionVerificationV1;
  issues: HealthIssueCode[];
}

interface RegressionCaseRow {
  id: string;
  guide_id: string;
  resource_node_id: string;
  annotation_id: string;
  question: string;
  expected_agent_status: 'SUPPORTED' | 'PARTIAL';
  status: 'ACTIVE' | 'NEEDS_REVIEW' | 'ARCHIVED';
  created_at: string;
  updated_at: string;
  last_verified_snapshot_id: string | null;
  last_retrieval_verification: FlowRegressionVerificationV1 | null;
  last_agent_verification: FlowRegressionVerificationV1 | null;
}

interface RegressionCaseSourceRow extends RegressionCaseRow {
  workspace_id: string;
  source_reference_id: string;
}

interface CitationCandidateRow {
  reference_id: string;
  source_kind: string;
  internal_locator_json: string;
  workspace_id: string | null;
  question: string;
  assistant_content: string | null;
}

interface CurrentSnapshotRow {
  id: string;
  workspace_id: string;
  revision: number;
  snapshot_json: string;
}

interface FlowAnnotationCitationCandidate {
  referenceId: string;
  workspaceId: string;
  guideId: string;
  resourceNodeId: string;
  annotationId: string;
  question: string;
  expectedAgentStatus: 'SUPPORTED' | 'PARTIAL';
}

type GuideActor = { id: string; role: string };

/**
 * Editor-facing, low-maintenance workflow for pinning a cited annotation as a
 * durable regression case. Every writable operation first rechecks guide edit
 * access; no client-supplied question, expected answer, or target is accepted.
 */
export class FlowRegressionService {
  readonly #createId: () => string;
  readonly #now: () => Date;

  constructor(
    private readonly database: DatabaseSync,
    options: { createId?: () => string; now?: () => Date } = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  referenceEligibility(user: GuideActor, referenceId: string): FlowRegressionReferenceEligibilityV1 {
    const prepared = this.findFlowAnnotationCitation(user, referenceId);
    if (prepared.kind === 'ineligible') return prepared.value;
    if (!this.canEditGuide(user, prepared.candidate.guideId)) {
      return FlowRegressionReferenceEligibilityV1Schema.parse({
        eligible: false,
        reasonCode: 'GUIDE_ACCESS_REQUIRED',
      });
    }
    try {
      const { snapshot } = this.requireCurrentSnapshot(user, prepared.candidate.guideId);
      resolveFlowAnnotationTarget(snapshot, prepared.candidate.resourceNodeId, prepared.candidate.annotationId);
    } catch {
      return FlowRegressionReferenceEligibilityV1Schema.parse({
        eligible: false,
        reasonCode: 'TARGET_STALE',
      });
    }
    return FlowRegressionReferenceEligibilityV1Schema.parse({
      eligible: true,
      guideId: prepared.candidate.guideId,
      resourceNodeId: prepared.candidate.resourceNodeId,
      annotationId: prepared.candidate.annotationId,
      expectedAgentStatus: prepared.candidate.expectedAgentStatus,
    });
  }

  createFromReference(
    user: GuideActor,
    referenceId: string,
  ): { created: boolean; case: WorkspaceFlowRegressionCaseV1 } {
    const prepared = this.findFlowAnnotationCitation(user, referenceId);
    if (prepared.kind === 'ineligible') {
      throw eligibilityError(prepared.value.reasonCode);
    }
    const candidate = prepared.candidate;
    const { snapshot } = this.requireCurrentSnapshot(user, candidate.guideId);
    try {
      resolveFlowAnnotationTarget(snapshot, candidate.resourceNodeId, candidate.annotationId);
    } catch {
      throw httpError(409, 'FLOW_REGRESSION_TARGET_STALE', '引用的图片标注已经变化，需要人工确认');
    }
    const existing = this.findCaseByReference(referenceId);
    if (existing) return { created: false, case: mapRegressionCase(existing) };

    const now = this.#now().toISOString();
    const id = this.#createId();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(
        `INSERT INTO workspace_flow_regression_cases (
          id, workspace_id, guide_id, source_reference_id, resource_node_id, annotation_id,
          question, expected_agent_status, status, created_by, created_at, updated_at,
          last_verified_snapshot_id, last_retrieval_verification, last_agent_verification
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, NULL, NULL, NULL)`,
      ).run(
        id,
        candidate.workspaceId,
        candidate.guideId,
        candidate.referenceId,
        candidate.resourceNodeId,
        candidate.annotationId,
        candidate.question,
        candidate.expectedAgentStatus,
        user.id,
        now,
        now,
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      const raced = this.findCaseByReference(referenceId);
      if (raced) return { created: false, case: mapRegressionCase(raced) };
      throw error;
    }
    const created = this.findCaseById(candidate.guideId, id);
    if (!created) throw new Error('新建的流程回归用例无法读取');
    const verified = replayFlowRegressionCase(this.database, {
      snapshot,
      ownerId: user.id,
      caseId: created.id,
    });
    if (!verified) throw new Error('新建的流程回归用例无法复跑');
    return { created: true, case: verified };
  }

  listCases(user: GuideActor, guideId: string): WorkspaceFlowRegressionCaseV1[] {
    this.requireGuideEdit(user, guideId);
    const rows = this.database.prepare(
      `SELECT id, workspace_id, guide_id, source_reference_id, resource_node_id, annotation_id,
              question, expected_agent_status, status, created_at, updated_at,
              last_verified_snapshot_id, last_retrieval_verification, last_agent_verification
       FROM workspace_flow_regression_cases
       WHERE guide_id = ?
       ORDER BY created_at DESC, id DESC`,
    ).all(guideId) as unknown as RegressionCaseSourceRow[];
    return FlowRegressionCaseListV1Schema.parse({
      items: rows.map(mapRegressionCase),
    }).items;
  }

  replay(user: GuideActor, guideId: string, caseId: string): WorkspaceFlowRegressionCaseV1 {
    const { snapshot } = this.requireCurrentSnapshot(user, guideId);
    const current = this.findCaseById(guideId, caseId);
    if (!current) throw httpError(404, 'FLOW_REGRESSION_CASE_NOT_FOUND', '回归用例不存在');
    if (current.status === 'ARCHIVED') {
      throw httpError(409, 'FLOW_REGRESSION_CASE_ARCHIVED', '已归档的回归用例不能复跑');
    }
    const replayed = replayFlowRegressionCase(this.database, {
      snapshot,
      ownerId: user.id,
      caseId,
    });
    if (!replayed) throw httpError(404, 'FLOW_REGRESSION_CASE_NOT_FOUND', '回归用例不存在');
    return replayed;
  }

  archive(user: GuideActor, guideId: string, caseId: string): WorkspaceFlowRegressionCaseV1 {
    UpdateFlowRegressionCaseStatusRequestV1Schema.parse({ status: 'ARCHIVED' });
    this.requireGuideEdit(user, guideId);
    const current = this.findCaseById(guideId, caseId);
    if (!current) throw httpError(404, 'FLOW_REGRESSION_CASE_NOT_FOUND', '回归用例不存在');
    if (current.status !== 'ARCHIVED') {
      this.database.prepare(
        `UPDATE workspace_flow_regression_cases
         SET status = 'ARCHIVED', updated_at = ?
         WHERE id = ? AND guide_id = ?`,
      ).run(this.#now().toISOString(), caseId, guideId);
    }
    const archived = this.findCaseById(guideId, caseId);
    if (!archived) throw new Error('归档后的回归用例无法读取');
    return mapRegressionCase(archived);
  }

  annotationHealth(user: GuideActor, guideId: string): FlowAnnotationHealthV1 {
    const { snapshot } = this.requireCurrentSnapshot(user, guideId);
    const rows = this.database.prepare(
      `SELECT resource_node_id, annotation_id, code
       FROM flow_annotation_health_issues
       WHERE snapshot_id = ?
       ORDER BY resource_node_id, annotation_id, code`,
    ).all(snapshot.snapshotId) as Array<{
      resource_node_id: string;
      annotation_id: string;
      code: FlowAnnotationHealthIssueV1['code'];
    }>;
    return FlowAnnotationHealthV1Schema.parse({
      snapshotId: snapshot.snapshotId,
      issues: rows.map((row) => ({
        resourceNodeId: row.resource_node_id,
        annotationId: row.annotation_id,
        code: row.code,
      })),
    });
  }

  createRealRun(
    user: GuideActor,
    guideId: string,
    caseId: string,
  ): { run: ReturnType<typeof enqueueConversationRun>['accepted']['run'] } {
    const { guide, snapshot } = this.requireCurrentSnapshot(user, guideId);
    const current = this.findCaseById(guideId, caseId);
    if (!current) throw httpError(404, 'FLOW_REGRESSION_CASE_NOT_FOUND', '回归用例不存在');
    if (current.status === 'ARCHIVED') {
      throw httpError(409, 'FLOW_REGRESSION_CASE_ARCHIVED', '已归档的回归用例不能运行');
    }
    if (current.status === 'NEEDS_REVIEW') {
      throw httpError(409, 'FLOW_REGRESSION_CASE_NEEDS_REVIEW', '该用例的稳定标注目标需要人工确认');
    }
    try {
      resolveFlowAnnotationTarget(snapshot, current.resource_node_id, current.annotation_id);
    } catch {
      throw httpError(409, 'FLOW_REGRESSION_TARGET_STALE', '该用例的图片标注已变化，需要人工确认');
    }

    const conversation = createConversation(this.database, {
      scope: 'WORKSPACE',
      workspaceId: guide.workspaceId,
      ownerId: user.id,
      title: `回归验证 · ${guide.title}`.slice(0, 200),
    });
    const queued = enqueueConversationRun(this.database, {
      conversationId: conversation.id,
      ownerId: user.id,
      request: {
        clientMessageId: this.#createId(),
        text: current.question,
        sources: {
          workspaceFlows: true,
          workspaceDocuments: false,
          sessionAttachments: false,
          santexwell: false,
        },
        attachmentIds: [],
      },
    });
    this.database.prepare(
      `INSERT INTO workspace_flow_regression_runs (run_id, case_id, requested_by, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(queued.accepted.run.id, current.id, user.id, this.#now().toISOString());
    return { run: queued.accepted.run };
  }

  getRetrievalDiagnostic(user: GuideActor, runId: string): AgentRetrievalDiagnosticV1 | null {
    const row = this.database.prepare(
      `SELECT diagnostic.id, diagnostic.run_id, diagnostic.workspace_id, diagnostic.guide_id,
              diagnostic.target_resource_node_id, diagnostic.target_annotation_id,
              diagnostic.query_fingerprint, diagnostic.reason_code,
              diagnostic.candidates_json, diagnostic.closure_json,
              diagnostic.created_at, diagnostic.expires_at,
              conversation.owner_id
       FROM agent_retrieval_diagnostics AS diagnostic
       JOIN agent_runs AS run ON run.id = diagnostic.run_id
       JOIN conversations AS conversation ON conversation.id = run.conversation_id
       WHERE diagnostic.run_id = ?`,
    ).get(runId) as {
      id: string;
      run_id: string;
      workspace_id: string | null;
      guide_id: string | null;
      target_resource_node_id: string | null;
      target_annotation_id: string | null;
      query_fingerprint: string;
      reason_code: AgentRetrievalDiagnosticV1['reasonCode'];
      candidates_json: string;
      closure_json: string;
      created_at: string;
      expires_at: string;
      owner_id: string;
    } | undefined;
    if (!row) return null;
    if (row.owner_id !== user.id && (!row.guide_id || !this.canEditGuide(user, row.guide_id))) {
      return null;
    }
    return AgentRetrievalDiagnosticV1Schema.parse({
      id: row.id,
      runId: row.run_id,
      guideId: row.guide_id,
      targetResourceNodeId: row.target_resource_node_id,
      targetAnnotationId: row.target_annotation_id,
      queryFingerprint: row.query_fingerprint,
      reasonCode: row.reason_code,
      candidates: JSON.parse(row.candidates_json),
      closure: JSON.parse(row.closure_json),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
  }

  private findFlowAnnotationCitation(
    user: GuideActor,
    referenceId: string,
  ): { kind: 'candidate'; candidate: FlowAnnotationCitationCandidate } | {
    kind: 'ineligible'; value: Exclude<FlowRegressionReferenceEligibilityV1, { eligible: true }>;
  } {
    const row = this.database.prepare(
      `SELECT citation.reference_id, citation.source_kind, citation.internal_locator_json,
              conversation.workspace_id, user_message.content AS question,
              assistant_message.content AS assistant_content
       FROM answer_citations AS citation
       JOIN agent_runs AS run ON run.id = citation.run_id
       JOIN conversations AS conversation ON conversation.id = run.conversation_id
       JOIN conversation_messages AS user_message
         ON user_message.id = run.initiating_message_id
        AND user_message.conversation_id = conversation.id
        AND user_message.role = 'USER' AND user_message.committed = 1
       LEFT JOIN conversation_messages AS assistant_message
         ON assistant_message.conversation_id = conversation.id
        AND assistant_message.role = 'ASSISTANT'
        AND json_extract(assistant_message.content, '$.runId') = run.id
       WHERE citation.reference_id = ? AND conversation.owner_id = ?`,
    ).get(referenceId, user.id) as CitationCandidateRow | undefined;
    if (!row) throw httpError(404, 'REFERENCE_NOT_FOUND', '引用不存在');
    if (row.source_kind !== 'WORKSPACE_FLOW' || !row.workspace_id) {
      return { kind: 'ineligible', value: ineligible('NOT_IMAGE_ANNOTATION_REFERENCE') };
    }
    let locator: { kind: 'WORKSPACE_FLOW'; guideId: string; snapshotId: string; nodeId: string; annotationId?: string };
    try {
      const parsed = InternalEvidenceLocatorV1Schema.parse(JSON.parse(row.internal_locator_json));
      if (parsed.kind !== 'WORKSPACE_FLOW' || !parsed.annotationId) throw new Error();
      locator = {
        kind: 'WORKSPACE_FLOW',
        guideId: parsed.guideId,
        snapshotId: parsed.snapshotId,
        nodeId: parsed.nodeId,
        annotationId: parsed.annotationId,
      };
    } catch {
      return { kind: 'ineligible', value: ineligible('NOT_IMAGE_ANNOTATION_REFERENCE') };
    }
    const target = this.loadSnapshotTarget(locator, row.workspace_id);
    if (!target) return { kind: 'ineligible', value: ineligible('TARGET_STALE') };
    const expectedStatus = expectedAgentStatus(row.assistant_content);
    if (!expectedStatus) {
      return { kind: 'ineligible', value: ineligible('ANSWER_STATUS_UNSUPPORTED') };
    }
    const question = row.question.trim();
    if (!question || question.length > 20_000) {
      return { kind: 'ineligible', value: ineligible('ANSWER_STATUS_UNSUPPORTED') };
    }
    return {
      kind: 'candidate',
      candidate: {
        referenceId: row.reference_id,
        workspaceId: row.workspace_id,
        guideId: locator.guideId,
        resourceNodeId: locator.nodeId,
        annotationId: locator.annotationId!,
        question,
        expectedAgentStatus: expectedStatus,
      },
    };
  }

  private loadSnapshotTarget(
    locator: { guideId: string; snapshotId: string; nodeId: string; annotationId?: string },
    workspaceId: string,
  ): boolean {
    const row = this.database.prepare(
      `SELECT snapshot_json FROM flow_knowledge_snapshots
       WHERE id = ? AND guide_id = ? AND workspace_id = ?`,
    ).get(locator.snapshotId, locator.guideId, workspaceId) as { snapshot_json: string } | undefined;
    if (!row || !locator.annotationId) return false;
    try {
      const snapshot = normalizeFlowKnowledgeSnapshot(
        FlowKnowledgeSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
      );
      resolveFlowAnnotationTarget(snapshot, locator.nodeId, locator.annotationId);
      return true;
    } catch {
      return false;
    }
  }

  private requireCurrentSnapshot(
    user: GuideActor,
    guideId: string,
  ): { guide: NonNullable<ReturnType<typeof getGuide>>; snapshot: FlowKnowledgeSnapshotV2 } {
    const guide = this.requireGuideEdit(user, guideId);
    const row = this.database.prepare(
      `SELECT snapshot.id, snapshot.workspace_id, snapshot.revision, snapshot.snapshot_json
       FROM flow_knowledge_snapshots AS snapshot
       JOIN knowledge_documents AS document
         ON document.flow_snapshot_id = snapshot.id AND document.parse_status = 'READY'
       JOIN knowledge_sources AS source
         ON source.id = document.source_id AND source.kind = 'WORKSPACE_FLOW' AND source.status = 'READY'
       WHERE snapshot.guide_id = ?
         AND snapshot.origin_type = 'DRAFT'
         AND snapshot.revision = ?
       LIMIT 1`,
    ).get(guide.id, guide.revision) as CurrentSnapshotRow | undefined;
    if (!row) throw httpError(409, 'FLOW_SNAPSHOT_NOT_READY', '当前指南的流程索引尚未就绪');
    let snapshot: FlowKnowledgeSnapshotV2;
    try {
      snapshot = normalizeFlowKnowledgeSnapshot(
        FlowKnowledgeSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
      );
    } catch {
      throw httpError(409, 'FLOW_SNAPSHOT_NOT_READY', '当前指南的流程索引尚未就绪');
    }
    if (
      snapshot.snapshotId !== row.id
      || snapshot.guideId !== guide.id
      || snapshot.workspaceId !== row.workspace_id
      || snapshot.origin.kind !== 'DRAFT'
      || snapshot.origin.revision !== guide.revision
    ) {
      throw httpError(409, 'FLOW_SNAPSHOT_NOT_READY', '当前指南的流程索引尚未就绪');
    }
    return { guide, snapshot };
  }

  private findCaseByReference(referenceId: string): RegressionCaseSourceRow | null {
    const row = this.database.prepare(
      `SELECT id, workspace_id, guide_id, source_reference_id, resource_node_id, annotation_id,
              question, expected_agent_status, status, created_at, updated_at,
              last_verified_snapshot_id, last_retrieval_verification, last_agent_verification
       FROM workspace_flow_regression_cases WHERE source_reference_id = ?`,
    ).get(referenceId) as RegressionCaseSourceRow | undefined;
    return row ?? null;
  }

  private findCaseById(guideId: string, caseId: string): RegressionCaseSourceRow | null {
    const row = this.database.prepare(
      `SELECT id, workspace_id, guide_id, source_reference_id, resource_node_id, annotation_id,
              question, expected_agent_status, status, created_at, updated_at,
              last_verified_snapshot_id, last_retrieval_verification, last_agent_verification
       FROM workspace_flow_regression_cases WHERE id = ? AND guide_id = ?`,
    ).get(caseId, guideId) as RegressionCaseSourceRow | undefined;
    return row ?? null;
  }

  private canEditGuide(user: GuideActor, guideId: string): boolean {
    return getGuideAccess(this.database, guideId, user.id) !== null;
  }

  private requireGuideEdit(user: GuideActor, guideId: string): NonNullable<ReturnType<typeof getGuide>> {
    if (!this.canEditGuide(user, guideId)) {
      if (!canSeeGuideMetadata(this.database, guideId, user)) {
        throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
      }
      throw httpError(403, 'FORBIDDEN', '只有指南作者或编辑者可以管理流程回归用例');
    }
    const guide = getGuide(this.database, guideId);
    if (!guide) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
    return guide;
  }
}

function mapRegressionCase(row: RegressionCaseRow): WorkspaceFlowRegressionCaseV1 {
  return WorkspaceFlowRegressionCaseV1Schema.parse({
    id: row.id,
    guideId: row.guide_id,
    resourceNodeId: row.resource_node_id,
    annotationId: row.annotation_id,
    question: row.question,
    expectedAgentStatus: row.expected_agent_status,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedSnapshotId: row.last_verified_snapshot_id,
    lastRetrievalVerification: row.last_retrieval_verification,
    lastAgentVerification: row.last_agent_verification,
  });
}

function ineligible(
  reasonCode: Exclude<FlowRegressionReferenceEligibilityV1, { eligible: true }>['reasonCode'],
): Exclude<FlowRegressionReferenceEligibilityV1, { eligible: true }> {
  const parsed = FlowRegressionReferenceEligibilityV1Schema.parse({ eligible: false, reasonCode });
  if (parsed.eligible) throw new Error('unreachable flow regression eligibility state');
  return parsed;
}

function eligibilityError(
  reasonCode: Exclude<FlowRegressionReferenceEligibilityV1, { eligible: true }>['reasonCode'],
): ReturnType<typeof httpError> {
  if (reasonCode === 'GUIDE_ACCESS_REQUIRED') {
    return httpError(403, 'FORBIDDEN', '只有指南作者或编辑者可以管理流程回归用例');
  }
  if (reasonCode === 'TARGET_STALE') {
    return httpError(409, 'FLOW_REGRESSION_TARGET_STALE', '引用的图片标注已经变化，需要人工确认');
  }
  if (reasonCode === 'ANSWER_STATUS_UNSUPPORTED') {
    return httpError(409, 'FLOW_REGRESSION_ANSWER_UNSUPPORTED', '只有证据状态为已支持或部分支持的回答可以钉选为回归用例');
  }
  return httpError(400, 'FLOW_REGRESSION_REFERENCE_INVALID', '该引用不是可回归的图片标注');
}

function expectedAgentStatus(content: string | null): 'SUPPORTED' | 'PARTIAL' | null {
  if (!content) return null;
  try {
    const envelope = JSON.parse(content) as { runId?: unknown; answer?: unknown };
    if (typeof envelope.runId !== 'string' || !envelope.answer) return null;
    const answer = AgentCommittedAnswerV1Schema.parse(envelope.answer);
    return answer.evidenceStatus === 'SUPPORTED' || answer.evidenceStatus === 'PARTIAL'
      ? answer.evidenceStatus
      : null;
  } catch {
    return null;
  }
}

/**
 * Runs the inexpensive all-annotation health check for one materialized
 * snapshot. Successful checks deliberately leave no rows behind.
 */
export function runFlowAnnotationHealthChecks(
  database: DatabaseSync,
  input: { snapshot: FlowKnowledgeSnapshotV2; ownerId: string },
): FlowAnnotationHealthIssueV1[] {
  const fragments = indexedFlowFragments(database, input.snapshot.snapshotId);
  const titleCounts = annotationTitleCounts(input.snapshot);
  const issues: FlowAnnotationHealthIssueV1[] = [];

  for (const resource of input.snapshot.resources) {
    if (resource.kind !== 'IMAGE') continue;
    for (const annotation of resource.annotations) {
      const target = resolveFlowAnnotationTarget(input.snapshot, resource.id, annotation.id);
      const verification = verifyTarget(database, {
        snapshot: input.snapshot,
        ownerId: input.ownerId,
        resourceId: resource.id,
        annotationId: annotation.id,
        query: syntheticHealthQuestion(input.snapshot, target.ownerNodeIds, annotation.title, titleCounts),
        fragments,
      });
      for (const code of verification.issues) {
        issues.push(FlowAnnotationHealthIssueV1Schema.parse({
          resourceNodeId: resource.id,
          annotationId: annotation.id,
          code,
        }));
      }
    }
  }

  replaceSnapshotHealthIssues(database, input.snapshot, issues);
  return issues;
}

/**
 * Replays only active cases against the just-materialized snapshot. A missing
 * stable target is terminal for automatic replay: it becomes NEEDS_REVIEW and
 * is never rebound by title.
 */
export function refreshActiveFlowRegressionCases(
  database: DatabaseSync,
  input: { snapshot: FlowKnowledgeSnapshotV2; ownerId: string },
): WorkspaceFlowRegressionCaseV1[] {
  const rows = database.prepare(
    `SELECT id, guide_id, resource_node_id, annotation_id, question, expected_agent_status,
            status, created_at, updated_at, last_verified_snapshot_id,
            last_retrieval_verification, last_agent_verification
     FROM workspace_flow_regression_cases
     WHERE guide_id = ? AND status = 'ACTIVE'
     ORDER BY created_at, id`,
  ).all(input.snapshot.guideId) as unknown as RegressionCaseRow[];
  const fragments = indexedFlowFragments(database, input.snapshot.snapshotId);
  const now = new Date().toISOString();
  const updated: WorkspaceFlowRegressionCaseV1[] = [];

  for (const row of rows) {
    const verification = verifyCaseTarget(database, input, row, fragments);
    const nextStatus = verification.verification === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'ACTIVE';
    database.prepare(
      `UPDATE workspace_flow_regression_cases
       SET status = ?, last_verified_snapshot_id = ?, last_retrieval_verification = ?, updated_at = ?
       WHERE id = ?`,
    ).run(nextStatus, input.snapshot.snapshotId, verification.verification, now, row.id);
    updated.push(WorkspaceFlowRegressionCaseV1Schema.parse({
      id: row.id,
      guideId: row.guide_id,
      resourceNodeId: row.resource_node_id,
      annotationId: row.annotation_id,
      question: row.question,
      expectedAgentStatus: row.expected_agent_status,
      status: nextStatus,
      createdAt: row.created_at,
      updatedAt: now,
      lastVerifiedSnapshotId: input.snapshot.snapshotId,
      lastRetrievalVerification: verification.verification,
      lastAgentVerification: row.last_agent_verification,
    }));
  }
  return updated;
}

export function replayFlowRegressionCase(
  database: DatabaseSync,
  input: { snapshot: FlowKnowledgeSnapshotV2; ownerId: string; caseId: string },
): WorkspaceFlowRegressionCaseV1 | null {
  const row = database.prepare(
    `SELECT id, guide_id, resource_node_id, annotation_id, question, expected_agent_status,
            status, created_at, updated_at, last_verified_snapshot_id,
            last_retrieval_verification, last_agent_verification
     FROM workspace_flow_regression_cases
     WHERE id = ? AND guide_id = ?`,
  ).get(input.caseId, input.snapshot.guideId) as unknown as RegressionCaseRow | undefined;
  if (!row || row.status === 'ARCHIVED') return null;
  const verification = verifyCaseTarget(database, input, row, indexedFlowFragments(database, input.snapshot.snapshotId));
  const nextStatus = verification.verification === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : row.status;
  const now = new Date().toISOString();
  database.prepare(
    `UPDATE workspace_flow_regression_cases
     SET status = ?, last_verified_snapshot_id = ?, last_retrieval_verification = ?, updated_at = ?
     WHERE id = ?`,
  ).run(nextStatus, input.snapshot.snapshotId, verification.verification, now, row.id);
  return WorkspaceFlowRegressionCaseV1Schema.parse({
    id: row.id,
    guideId: row.guide_id,
    resourceNodeId: row.resource_node_id,
    annotationId: row.annotation_id,
    question: row.question,
    expectedAgentStatus: row.expected_agent_status,
    status: nextStatus,
    createdAt: row.created_at,
    updatedAt: now,
    lastVerifiedSnapshotId: input.snapshot.snapshotId,
    lastRetrievalVerification: verification.verification,
    lastAgentVerification: row.last_agent_verification,
  });
}

function verifyCaseTarget(
  database: DatabaseSync,
  input: { snapshot: FlowKnowledgeSnapshotV2; ownerId: string },
  row: RegressionCaseRow,
  fragments: IndexedFlowFragment[],
): DeterministicVerification {
  try {
    resolveFlowAnnotationTarget(input.snapshot, row.resource_node_id, row.annotation_id);
  } catch {
    return { verification: 'NEEDS_REVIEW', issues: ['ANNOTATION_LEAF_MISSING'] };
  }
  return verifyTarget(database, {
    snapshot: input.snapshot,
    ownerId: input.ownerId,
    resourceId: row.resource_node_id,
    annotationId: row.annotation_id,
    query: row.question,
    fragments,
  });
}

function verifyTarget(
  database: DatabaseSync,
  input: {
    snapshot: FlowKnowledgeSnapshotV2;
    ownerId: string;
    resourceId: string;
    annotationId: string;
    query: string;
    fragments: IndexedFlowFragment[];
  },
): DeterministicVerification {
  const issues = new Set<HealthIssueCode>();
  let target;
  try {
    target = resolveFlowAnnotationTarget(input.snapshot, input.resourceId, input.annotationId);
  } catch {
    return { verification: 'NEEDS_REVIEW', issues: ['ANNOTATION_LEAF_MISSING'] };
  }

  const annotationLeaf = input.fragments.find((fragment) => isAnnotationLeaf(fragment.locator, input.resourceId, input.annotationId));
  if (!annotationLeaf) {
    issues.add(hasConflictingAnnotationLeaf(input.fragments, input.resourceId, input.annotationId)
      ? 'ANNOTATION_TARGET_MISMATCH'
      : 'ANNOTATION_LEAF_MISSING');
  } else if (!hasExpectedLeafContext(input.snapshot, target.resource, target.annotation.title, target.ownerNodeIds, annotationLeaf)) {
    issues.add('ANNOTATION_CONTEXT_MISSING');
  }

  if (!hasStructuralClosure(input.snapshot, input.fragments, target.ownerNodeIds)) {
    issues.add('ANNOTATION_CONTEXT_MISSING');
  }

  const hits = searchKnowledgeInternal(database, input.query, {
    sourceKinds: ['WORKSPACE_FLOW'],
    workspaceId: input.snapshot.workspaceId,
    userId: input.ownerId,
    userRole: 'AUTHOR',
    limit: FOCUSED_FLOW_CANDIDATE_BUDGET,
  });
  const targetRank = hits.findIndex((candidate) => {
    const locator = rawFlowLocator(candidate.locator);
    return locator !== null && isAnnotationLeaf(locator, input.resourceId, input.annotationId);
  });
  const genericBeforeTarget = targetRank > 0 && hits.slice(0, targetRank).some((candidate) => {
    const locator = rawFlowLocator(candidate.locator);
    return locator !== null && locator.guideId === input.snapshot.guideId
      && locator.snapshotId === input.snapshot.snapshotId
      && isGenericFlowFragment(locator, input.resourceId);
  });
  if (targetRank < 0 || genericBeforeTarget) issues.add('ANNOTATION_NOT_RANKED');

  if (issues.has('ANNOTATION_LEAF_MISSING') || issues.has('ANNOTATION_TARGET_MISMATCH') || issues.has('ANNOTATION_CONTEXT_MISSING')) {
    return { verification: 'NEEDS_REVIEW', issues: [...issues] };
  }
  if (issues.has('ANNOTATION_NOT_RANKED')) return { verification: 'FAIL', issues: [...issues] };
  return { verification: 'PASS', issues: [] };
}

function indexedFlowFragments(database: DatabaseSync, snapshotId: string): IndexedFlowFragment[] {
  const rows = database.prepare(
    `SELECT fragment.id, fragment.content, fragment.internal_locator_json
     FROM knowledge_fragments AS fragment
     JOIN knowledge_documents AS document ON document.id = fragment.document_id
     WHERE document.flow_snapshot_id = ?
     ORDER BY fragment.ordinal, fragment.id`,
  ).all(snapshotId) as Array<{ id: string; content: string; internal_locator_json: string }>;
  return rows.flatMap((row) => {
    try {
      const locator = rawFlowLocator(JSON.parse(row.internal_locator_json));
      return locator ? [{ id: row.id, content: row.content, locator }] : [];
    } catch {
      return [];
    }
  });
}

function replaceSnapshotHealthIssues(
  database: DatabaseSync,
  snapshot: FlowKnowledgeSnapshotV2,
  issues: FlowAnnotationHealthIssueV1[],
): void {
  const unique = [...new Map(issues.map((issue) => [
    `${issue.resourceNodeId}\u0000${issue.annotationId}\u0000${issue.code}`,
    issue,
  ])).values()];
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM flow_annotation_health_issues WHERE snapshot_id = ?').run(snapshot.snapshotId);
    const insert = database.prepare(
      `INSERT INTO flow_annotation_health_issues (
        id, snapshot_id, guide_id, resource_node_id, annotation_id, code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    unique.forEach((issue) => insert.run(
      randomUUID(),
      snapshot.snapshotId,
      snapshot.guideId,
      issue.resourceNodeId,
      issue.annotationId,
      issue.code,
      now,
    ));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function annotationTitleCounts(snapshot: FlowKnowledgeSnapshotV2): Map<string, number> {
  const counts = new Map<string, number>();
  snapshot.resources.forEach((resource) => {
    if (resource.kind !== 'IMAGE') return;
    resource.annotations.forEach((annotation) => {
      const key = normalizeKnowledgeText(annotation.title);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  });
  return counts;
}

function syntheticHealthQuestion(
  snapshot: FlowKnowledgeSnapshotV2,
  ownerNodeIds: string[],
  annotationTitle: string,
  titleCounts: ReadonlyMap<string, number>,
): string {
  if ((titleCounts.get(normalizeKnowledgeText(annotationTitle)) ?? 0) <= 1) return `${annotationTitle} 怎么设置？`;
  const ownerTitle = ownerNodeIds
    .map((nodeId) => snapshot.nodes.find((node) => node.id === nodeId)?.title)
    .find((title): title is string => Boolean(title))
    ?? snapshot.title;
  return `${ownerTitle} 中的 ${annotationTitle} 是什么？`;
}

function rawFlowLocator(value: unknown): RawFlowFragmentLocator | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'WORKSPACE_FLOW') return null;
  const strings = ['guideId', 'snapshotId', 'nodeId'] as const;
  if (strings.some((key) => typeof candidate[key] !== 'string' || (candidate[key] as string).length === 0 || (candidate[key] as string).length > 200)) {
    return null;
  }
  if (candidate.annotationId !== undefined && (typeof candidate.annotationId !== 'string' || candidate.annotationId.length === 0 || candidate.annotationId.length > 200)) {
    return null;
  }
  return {
    kind: 'WORKSPACE_FLOW',
    guideId: candidate.guideId as string,
    snapshotId: candidate.snapshotId as string,
    nodeId: candidate.nodeId as string,
    ...(typeof candidate.annotationId === 'string' ? { annotationId: candidate.annotationId } : {}),
    ...(typeof candidate.projection === 'string' ? { projection: candidate.projection } : {}),
  };
}

function isAnnotationLeaf(locator: RawFlowFragmentLocator, resourceId: string, annotationId: string): boolean {
  return locator.projection === 'IMAGE_ANNOTATION'
    && locator.nodeId === resourceId
    && locator.annotationId === annotationId;
}

function hasConflictingAnnotationLeaf(
  fragments: IndexedFlowFragment[],
  resourceId: string,
  annotationId: string,
): boolean {
  return fragments.some(({ locator }) => locator.projection === 'IMAGE_ANNOTATION'
    && (locator.annotationId === annotationId || locator.nodeId === resourceId));
}

function hasExpectedLeafContext(
  snapshot: FlowKnowledgeSnapshotV2,
  resource: Extract<FlowKnowledgeResourceV2, { kind: 'IMAGE' }>,
  annotationTitle: string,
  ownerNodeIds: string[],
  leaf: IndexedFlowFragment,
): boolean {
  const expected = [
    annotationTitle,
    resource.alt,
    ...ownerNodeIds.flatMap((nodeId) => snapshot.nodes.find((node) => node.id === nodeId)?.title ?? []),
  ];
  return expected.every((value) => leaf.content.includes(value));
}

function hasStructuralClosure(
  snapshot: FlowKnowledgeSnapshotV2,
  fragments: IndexedFlowFragment[],
  ownerNodeIds: string[],
): boolean {
  const overview = fragments.some(({ locator }) => locator.projection === 'OVERVIEW');
  const owners = ownerNodeIds.every((nodeId) => fragments.some(({ locator }) => (
    locator.nodeId === nodeId && locator.projection === undefined && locator.annotationId === undefined
  )));
  return overview && owners;
}

function isGenericFlowFragment(locator: RawFlowFragmentLocator, resourceId: string): boolean {
  return locator.projection === 'OVERVIEW'
    || (locator.projection === undefined && locator.annotationId === undefined && locator.nodeId === resourceId);
}

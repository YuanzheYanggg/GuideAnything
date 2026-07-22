import {
  AgentCommittedAnswerV1Schema,
  AgentRetrievalDiagnosticV1Schema,
  PublicReferenceV1Schema,
  ValidatedEvidenceV1Schema,
  type AgentRetrievalDiagnosticV1,
} from '@guideanything/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  AgentOutputCommitter,
  CommitAgentOutputInput,
  AgentRetrievalTrace,
  ResolvedAgentReference,
} from './orchestrator';
import { recordWorkspaceQuestionGap } from './editorial-question-recorder';

interface DatabaseAgentOutputCommitterOptions {
  createId?: () => string;
  now?: () => Date;
}

interface CommitRunRow {
  conversation_id: string;
  status: string;
  owner_id: string;
  scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspace_id: string | null;
  conversation_status: 'ACTIVE' | 'ARCHIVED';
}

interface RegressionDiagnosticTarget {
  case_id: string;
  workspace_id: string;
  guide_id: string;
  resource_node_id: string;
  annotation_id: string;
  expected_agent_status: 'SUPPORTED' | 'PARTIAL';
}

const RETRIEVAL_DIAGNOSTIC_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export class DatabaseAgentOutputCommitter implements AgentOutputCommitter {
  readonly #createId: () => string;
  readonly #now: () => Date;

  constructor(
    private readonly database: DatabaseSync,
    options: DatabaseAgentOutputCommitterOptions = {},
  ) {
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  async commit(untrustedInput: CommitAgentOutputInput): Promise<{ messageId: string }> {
    const answer = AgentCommittedAnswerV1Schema.parse(untrustedInput.answer);
    const references = untrustedInput.references.map(validateResolvedReference);
    assertAnswerReferenceSet(answer, references);
    const now = this.#now().toISOString();
    const generatedMessageId = validId(this.#createId());

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const run = this.requireCommittableRun(untrustedInput);
      for (const resolved of references) {
        this.persistReference(untrustedInput.context.runId, resolved, now);
      }
      for (const artifact of answer.artifacts) {
        this.persistArtifact(run, untrustedInput, artifact);
      }
      const existing = this.database.prepare(
        `SELECT id, content FROM conversation_messages
         WHERE role = 'ASSISTANT' AND json_extract(content, '$.runId') = ?
         LIMIT 1`,
      ).get(untrustedInput.context.runId) as { id: string; content: string } | undefined;
      const expectedContent = JSON.stringify({ runId: untrustedInput.context.runId, answer });
      let messageId: string;
      if (existing) {
        if (existing.content !== expectedContent) {
          throw new Error('当前运行已经提交了不同的助手答案');
        }
        messageId = existing.id;
      } else {
        messageId = generatedMessageId;
        this.database.prepare(
          `INSERT INTO conversation_messages (
            id, conversation_id, role, client_message_id, content, source_options_json,
            selected_context_json, attachment_ids_json, committed, created_at
          ) VALUES (?, ?, 'ASSISTANT', NULL, ?, NULL, NULL, '[]', 1, ?)`,
        ).run(messageId, run.conversation_id, expectedContent, now);
      }
      recordWorkspaceQuestionGap(this.database, { context: untrustedInput.context, answer });
      const regression = this.findRegressionDiagnosticTarget(untrustedInput.context.runId);
      if (regression && regression.workspace_id !== run.workspace_id) {
        throw new Error('回归运行所属工作区与当前 Agent 运行不匹配');
      }
      this.recordRegressionAgentVerification(regression, answer, references, now);
      this.persistRetrievalDiagnostic(untrustedInput, answer, run, now, regression);
      this.database.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
        .run(now, run.conversation_id);
      this.database.exec('COMMIT');
      return { messageId };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private requireCommittableRun(input: CommitAgentOutputInput): CommitRunRow {
    const run = this.database.prepare(
      `SELECT run.conversation_id, run.status, conversation.owner_id, conversation.scope,
              conversation.workspace_id, conversation.status AS conversation_status
       FROM agent_runs AS run
       JOIN conversations AS conversation ON conversation.id = run.conversation_id
       WHERE run.id = ?`,
    ).get(input.context.runId) as unknown as CommitRunRow | undefined;
    if (!run) throw new Error('Agent 运行不存在');
    if (run.status !== 'VALIDATING') throw new Error('只有 VALIDATING 运行可以提交答案');
    if (run.conversation_status !== 'ACTIVE') throw new Error('归档会话不能提交答案');
    if (
      run.conversation_id !== input.context.conversationId
      || run.owner_id !== input.context.ownerId
      || run.scope !== input.context.scope
      || run.workspace_id !== input.context.workspaceId
    ) {
      throw new Error('答案提交上下文与当前运行不匹配');
    }
    if (run.workspace_id) {
      const access = this.database.prepare(
        `SELECT 1
         FROM workspaces AS workspace
         JOIN workspace_members AS member ON member.workspace_id = workspace.id
         WHERE workspace.id = ? AND workspace.status = 'ACTIVE' AND member.user_id = ?`,
      ).get(run.workspace_id, run.owner_id);
      if (!access) throw new Error('用户已失去工作区答案提交权限');
    }
    return run;
  }

  private persistReference(runId: string, resolved: ResolvedAgentReference, now: string): void {
    const evidence = resolved.evidence;
    const referenceId = resolved.reference.referenceId;
    const locatorJson = JSON.stringify(evidence.locator);
    const revision = evidenceRevision(evidence);
    const existing = this.database.prepare(
      `SELECT run_id, source_kind, internal_locator_json, title, excerpt, revision
       FROM answer_citations WHERE reference_id = ?`,
    ).get(referenceId) as {
      run_id: string;
      source_kind: string;
      internal_locator_json: string;
      title: string;
      excerpt: string;
      revision: string;
    } | undefined;
    if (existing) {
      if (
        existing.run_id !== runId
        || existing.source_kind !== evidence.source
        || existing.internal_locator_json !== locatorJson
        || existing.title !== evidence.title
        || existing.excerpt !== evidence.excerpt
        || existing.revision !== revision
      ) {
        throw new Error('引用 ID 已属于不同证据');
      }
      return;
    }
    this.database.prepare(
      `INSERT INTO answer_citations (
        reference_id, run_id, source_kind, internal_locator_json,
        title, excerpt, revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      referenceId,
      runId,
      evidence.source,
      locatorJson,
      evidence.title,
      evidence.excerpt,
      revision,
      now,
    );
  }

  private persistArtifact(
    run: CommitRunRow,
    input: CommitAgentOutputInput,
    artifact: CommitAgentOutputInput['answer']['artifacts'][number],
  ): void {
    if (artifact.runId !== input.context.runId) throw new Error('产物 runId 与当前运行不匹配');
    const payload = JSON.stringify(artifact);
    const existing = this.database.prepare(
      `SELECT conversation_id, owner_id, run_id, kind, title, payload_json
       FROM artifacts WHERE id = ?`,
    ).get(artifact.id) as {
      conversation_id: string;
      owner_id: string;
      run_id: string;
      kind: string;
      title: string;
      payload_json: string;
    } | undefined;
    if (existing) {
      if (
        existing.conversation_id !== run.conversation_id
        || existing.owner_id !== run.owner_id
        || existing.run_id !== input.context.runId
        || existing.kind !== artifact.kind
        || existing.title !== artifact.title
        || existing.payload_json !== payload
      ) {
        throw new Error('产物 ID 已属于不同内容');
      }
      return;
    }
    this.database.prepare(
      `INSERT INTO artifacts (
        id, conversation_id, owner_id, run_id, kind, title, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      artifact.id,
      run.conversation_id,
      run.owner_id,
      input.context.runId,
      artifact.kind,
      artifact.title,
      payload,
      artifact.createdAt,
    );
  }

  private persistRetrievalDiagnostic(
    input: CommitAgentOutputInput,
    answer: CommitAgentOutputInput['answer'],
    run: CommitRunRow,
    now: string,
    regression: RegressionDiagnosticTarget | null,
  ): void {
    if (answer.evidenceStatus === 'SUPPORTED' && !regression) return;
    if (!input.retrievalTrace) return;

    const expiresAt = new Date(Date.parse(now) + RETRIEVAL_DIAGNOSTIC_TTL_MS).toISOString();
    const diagnostic = AgentRetrievalDiagnosticV1Schema.parse({
      id: randomUUID(),
      runId: input.context.runId,
      guideId: regression?.guide_id ?? null,
      targetResourceNodeId: regression?.resource_node_id ?? null,
      targetAnnotationId: regression?.annotation_id ?? null,
      queryFingerprint: fingerprintQuestion(input.context.text),
      reasonCode: diagnosticReason(this.database, answer, input.retrievalTrace, regression),
      candidates: input.retrievalTrace.candidates,
      closure: input.retrievalTrace.closure,
      createdAt: now,
      expiresAt,
    });

    this.database.prepare('DELETE FROM agent_retrieval_diagnostics WHERE expires_at <= ?').run(now);
    this.database.prepare(
      `INSERT INTO agent_retrieval_diagnostics (
        id, run_id, workspace_id, guide_id, target_resource_node_id, target_annotation_id,
        query_fingerprint, reason_code, candidates_json, closure_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (run_id) DO NOTHING`,
    ).run(
      diagnostic.id,
      diagnostic.runId,
      run.workspace_id,
      diagnostic.guideId,
      diagnostic.targetResourceNodeId ?? null,
      diagnostic.targetAnnotationId ?? null,
      diagnostic.queryFingerprint,
      diagnostic.reasonCode,
      JSON.stringify(diagnostic.candidates),
      JSON.stringify(diagnostic.closure),
      diagnostic.createdAt,
      diagnostic.expiresAt,
    );
  }

  private recordRegressionAgentVerification(
    regression: RegressionDiagnosticTarget | null,
    answer: CommitAgentOutputInput['answer'],
    references: readonly ResolvedAgentReference[],
    now: string,
  ): void {
    if (!regression) return;
    const citesTarget = references.some(({ evidence }) => {
      const locator = evidence.locator;
      return locator.kind === 'WORKSPACE_FLOW'
        && locator.guideId === regression.guide_id
        && locator.nodeId === regression.resource_node_id
        && locator.annotationId === regression.annotation_id;
    });
    const verification = answer.evidenceStatus === regression.expected_agent_status && citesTarget
      ? 'PASS'
      : 'FAIL';
    this.database.prepare(
      `UPDATE workspace_flow_regression_cases
       SET last_agent_verification = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).run(verification, now, regression.case_id, regression.workspace_id);
  }

  private findRegressionDiagnosticTarget(runId: string): RegressionDiagnosticTarget | null {
    const row = this.database.prepare(
      `SELECT regression.case_id, item.workspace_id, item.guide_id,
              item.resource_node_id, item.annotation_id, item.expected_agent_status
       FROM workspace_flow_regression_runs AS regression
       JOIN workspace_flow_regression_cases AS item ON item.id = regression.case_id
       WHERE regression.run_id = ?`,
    ).get(runId) as RegressionDiagnosticTarget | undefined;
    return row ?? null;
  }
}

function validateResolvedReference(value: ResolvedAgentReference): ResolvedAgentReference {
  const reference = PublicReferenceV1Schema.parse(value.reference);
  const evidence = ValidatedEvidenceV1Schema.parse(value.evidence);
  return { reference, evidence };
}

function assertAnswerReferenceSet(
  answer: CommitAgentOutputInput['answer'],
  references: readonly ResolvedAgentReference[],
): void {
  const expected = new Map<string, {
    source?: string;
    title?: string;
    excerpt?: string;
  }>();
  for (const citation of answer.citations) {
    if (expected.has(citation.referenceId)) throw new Error('答案中存在重复引用 ID');
    expected.set(citation.referenceId, {
      source: citation.source,
      title: citation.title,
      excerpt: citation.excerpt,
    });
  }
  for (const feedback of answer.flowFeedback) {
    if (expected.has(feedback.referenceId)) throw new Error('答案中存在重复引用 ID');
    expected.set(feedback.referenceId, { source: 'WORKSPACE_FLOW' });
  }
  const actual = new Map(references.map((item) => [item.reference.referenceId, item]));
  if (actual.size !== references.length || actual.size !== expected.size) {
    throw new Error('答案与后端引用记录不匹配');
  }
  for (const [referenceId, projection] of expected) {
    const resolved = actual.get(referenceId);
    if (!resolved) throw new Error('答案缺少后端引用记录');
    if (
      (projection.source && projection.source !== resolved.evidence.source)
      || (projection.title && projection.title !== resolved.evidence.title)
      || (projection.excerpt && projection.excerpt !== resolved.evidence.excerpt)
    ) {
      throw new Error('答案引用内容与后端证据不匹配');
    }
  }
}

function evidenceRevision(evidence: ResolvedAgentReference['evidence']): string {
  const locator = evidence.locator;
  if (locator.kind === 'WORKSPACE_FLOW') return locator.snapshotId;
  if (locator.kind === 'PRIOR_CONVERSATION') return locator.messageId;
  return locator.revision;
}

function validId(value: string): string {
  const result = value.trim();
  if (!result || result.length > 200) throw new Error('生成的助手消息 ID 无效');
  return result;
}

function fingerprintQuestion(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, ' ')
    .replace(/[？?！!。；;，,、:：()（）「」『』“”"']/gu, '')
    .trim()
    .slice(0, 2_000);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function diagnosticReason(
  database: DatabaseSync,
  answer: CommitAgentOutputInput['answer'],
  trace: AgentRetrievalTrace,
  regression: RegressionDiagnosticTarget | null,
): AgentRetrievalDiagnosticV1['reasonCode'] {
  if (!regression) return 'BUDGET_EXHAUSTED';
  if (!hasIndexedRegressionTarget(database, regression)) return 'NO_TARGET_LEAF';
  if (!traceContainsRegressionTarget(database, trace, regression)) return 'TARGET_NOT_RANKED';
  if (!hasMinimalFlowClosure(trace)) return 'CONTEXT_NOT_CLOSED';
  if (answer.evidenceStatus !== regression.expected_agent_status) return 'MODEL_STATUS_MISMATCH';
  return 'BUDGET_EXHAUSTED';
}

function hasIndexedRegressionTarget(
  database: DatabaseSync,
  target: RegressionDiagnosticTarget,
): boolean {
  return Boolean(database.prepare(
    `SELECT 1
     FROM knowledge_fragments AS fragment
     JOIN knowledge_documents AS document ON document.id = fragment.document_id
     JOIN flow_knowledge_snapshots AS snapshot ON snapshot.id = document.flow_snapshot_id
     WHERE snapshot.guide_id = ?
       AND json_extract(fragment.internal_locator_json, '$.projection') = 'IMAGE_ANNOTATION'
       AND json_extract(fragment.internal_locator_json, '$.nodeId') = ?
       AND json_extract(fragment.internal_locator_json, '$.annotationId') = ?
     LIMIT 1`,
  ).get(target.guide_id, target.resource_node_id, target.annotation_id));
}

function traceContainsRegressionTarget(
  database: DatabaseSync,
  trace: AgentRetrievalTrace,
  target: RegressionDiagnosticTarget,
): boolean {
  const statement = database.prepare(
    `SELECT 1 FROM knowledge_fragments
     WHERE id = ?
       AND json_extract(internal_locator_json, '$.projection') = 'IMAGE_ANNOTATION'
       AND json_extract(internal_locator_json, '$.nodeId') = ?
       AND json_extract(internal_locator_json, '$.annotationId') = ?`,
  );
  return trace.candidates.some((candidate) => Boolean(statement.get(
    candidate.fragmentId,
    target.resource_node_id,
    target.annotation_id,
  )));
}

function hasMinimalFlowClosure(trace: AgentRetrievalTrace): boolean {
  return trace.closure.some((item) => item.kind === 'OVERVIEW')
    && trace.closure.some((item) => item.kind === 'NODE');
}

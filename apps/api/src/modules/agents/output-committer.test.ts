import type { AgentCommittedAnswerV1, ValidatedEvidenceV1 } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { AgentRunEventStore, RunEventBroker } from '../conversations/events';
import { createConversation, enqueueConversationRun } from '../conversations/repository';
import type { AgentRunExecutionContext, ResolvedAgentReference } from './orchestrator';
import { DatabaseAgentOutputCommitter } from './output-committer';

describe('DatabaseAgentOutputCommitter', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedUser(database, 'owner-1');
    seedWorkspace(database, 'workspace-1', 'owner-1');
  });

  afterEach(() => database.close());

  it('atomically persists reference records, artifacts, and the committed assistant answer', async () => {
    const context = seedValidatingRun(database);
    const answer = committedAnswer(context.runId);
    const committer = new DatabaseAgentOutputCommitter(database, {
      createId: () => 'assistant-message-1',
      now: () => new Date('2026-07-15T03:00:00.000Z'),
    });

    const first = await committer.commit({ context, answer, references: [resolvedReference()] });
    const replay = await committer.commit({ context, answer, references: [resolvedReference()] });

    expect(first).toEqual({ messageId: 'assistant-message-1' });
    expect(replay).toEqual(first);
    expect(database.prepare('SELECT COUNT(*) AS count FROM answer_citations').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE role = 'ASSISTANT'").get())
      .toEqual({ count: 1 });
    const stored = database.prepare(
      "SELECT content FROM conversation_messages WHERE id = 'assistant-message-1'",
    ).get() as { content: string };
    expect(JSON.parse(stored.content)).toEqual({ runId: context.runId, answer });
  });

  it('rejects an answer/reference mismatch without leaving partial rows', async () => {
    const context = seedValidatingRun(database);
    const committer = new DatabaseAgentOutputCommitter(database);

    await expect(committer.commit({
      context,
      answer: committedAnswer(context.runId),
      references: [],
    })).rejects.toThrow(/引用/u);

    expect(database.prepare('SELECT COUNT(*) AS count FROM answer_citations').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM artifacts').get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE role = 'ASSISTANT'").get())
      .toEqual({ count: 0 });
  });

  it('reauthorizes the run owner and validating state at commit time', async () => {
    const context = seedValidatingRun(database);
    const committer = new DatabaseAgentOutputCommitter(database);
    database.prepare("UPDATE agent_runs SET status = 'FAILED', error_code = 'TEST', error_message = 'x', error_retryable = 0 WHERE id = ?")
      .run(context.runId);

    await expect(committer.commit({
      context,
      answer: committedAnswer(context.runId),
      references: [resolvedReference()],
    })).rejects.toThrow(/VALIDATING/u);
  });

  it('records an evidence-gap workspace answer once for the editorial queue', async () => {
    const context = seedValidatingRun(database);
    const answer = { ...committedAnswer(context.runId), evidenceStatus: 'PARTIAL' as const };
    const committer = new DatabaseAgentOutputCommitter(database, {
      createId: () => 'assistant-message-gap',
    });

    await committer.commit({ context, answer, references: [resolvedReference()] });
    await committer.commit({ context, answer, references: [resolvedReference()] });

    expect(database.prepare(
      `SELECT occurrence_count, owner_visible_example_count, summary
       FROM workspace_question_clusters`,
    ).all()).toEqual([{
      occurrence_count: 1,
      owner_visible_example_count: 1,
      summary: '工作区问答存在待补充的内部证据覆盖。',
    }]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM workspace_question_cluster_examples').get())
      .toEqual({ count: 1 });
  });

  it('does not persist a retrieval diagnostic for an ordinary supported answer', async () => {
    const context = seedValidatingRun(database);
    const committer = new DatabaseAgentOutputCommitter(database, {
      now: () => new Date('2026-07-21T04:00:00.000Z'),
    });

    await committer.commit({
      context,
      answer: committedAnswer(context.runId),
      references: [resolvedReference()],
      retrievalTrace: minimalRetrievalTrace(),
    } as Parameters<typeof committer.commit>[0]);

    expect(database.prepare('SELECT COUNT(*) AS count FROM agent_retrieval_diagnostics').get())
      .toEqual({ count: 0 });
  });

  it('persists a diagnostic for an explicitly mapped regression run even when the answer is supported', async () => {
    const context = seedValidatingRun(database);
    seedRegressionRun(database, context);
    const committer = new DatabaseAgentOutputCommitter(database, {
      now: () => new Date('2026-07-21T04:00:00.000Z'),
    });

    await committer.commit({
      context,
      answer: committedAnswer(context.runId),
      references: [resolvedReference()],
      retrievalTrace: minimalRetrievalTrace(),
    } as Parameters<typeof committer.commit>[0]);

    expect(database.prepare(
      `SELECT guide_id, target_resource_node_id, target_annotation_id, reason_code
       FROM agent_retrieval_diagnostics WHERE run_id = ?`,
    ).get(context.runId)).toEqual({
      guide_id: 'guide-regression',
      target_resource_node_id: 'image-version-type',
      target_annotation_id: 'version-type',
      reason_code: 'NO_TARGET_LEAF',
    });
    expect(database.prepare(
      `SELECT last_agent_verification
       FROM workspace_flow_regression_cases WHERE id = 'case-regression'`,
    ).get()).toEqual({ last_agent_verification: 'PASS' });
  });

  it('records a failed real-run verification when the committed Agent status differs from the case', async () => {
    const context = seedValidatingRun(database);
    seedRegressionRun(database, context);
    const committer = new DatabaseAgentOutputCommitter(database, {
      now: () => new Date('2026-07-21T04:00:00.000Z'),
    });

    await committer.commit({
      context,
      answer: { ...committedAnswer(context.runId), evidenceStatus: 'PARTIAL' },
      references: [resolvedReference()],
    });

    expect(database.prepare(
      `SELECT last_agent_verification
       FROM workspace_flow_regression_cases WHERE id = 'case-regression'`,
    ).get()).toEqual({ last_agent_verification: 'FAIL' });
  });

  it('records a failed real-run verification when the answer omits the pinned annotation citation', async () => {
    const context = seedValidatingRun(database);
    seedRegressionRun(database, context);
    const committer = new DatabaseAgentOutputCommitter(database, {
      now: () => new Date('2026-07-21T04:00:00.000Z'),
    });

    await committer.commit({
      context,
      answer: committedAnswer(context.runId),
      references: [resolvedReference({
        ...flowEvidence(),
        locator: {
          kind: 'WORKSPACE_FLOW',
          guideId: 'guide-regression',
          snapshotId: 'snapshot-regression',
          nodeId: 'other-image',
          annotationId: 'other-annotation',
        },
      })],
    });

    expect(database.prepare(
      `SELECT last_agent_verification
       FROM workspace_flow_regression_cases WHERE id = 'case-regression'`,
    ).get()).toEqual({ last_agent_verification: 'FAIL' });
  });

  it('persists only a bounded retrieval trace and fingerprint for a partial answer', async () => {
    const context = seedValidatingRun(database);
    const committer = new DatabaseAgentOutputCommitter(database, {
      now: () => new Date('2026-07-21T04:00:00.000Z'),
      createId: () => 'assistant-message-diagnostic',
    });

    await committer.commit({
      context,
      answer: { ...committedAnswer(context.runId), evidenceStatus: 'PARTIAL' },
      references: [resolvedReference()],
      retrievalTrace: minimalRetrievalTrace(),
    } as Parameters<typeof committer.commit>[0]);

    const diagnostic = database.prepare(
      `SELECT run_id, workspace_id, guide_id, target_resource_node_id, target_annotation_id,
              query_fingerprint, reason_code, candidates_json, closure_json, created_at, expires_at
       FROM agent_retrieval_diagnostics WHERE run_id = ?`,
    ).get(context.runId) as Record<string, unknown> | undefined;
    expect(diagnostic).toMatchObject({
      run_id: context.runId,
      workspace_id: 'workspace-1',
      guide_id: null,
      target_resource_node_id: null,
      target_annotation_id: null,
      reason_code: 'BUDGET_EXHAUSTED',
      candidates_json: JSON.stringify([{
        fragmentId: 'evidence-flow', projection: 'NODE', rank: 1, selected: true,
      }]),
      closure_json: JSON.stringify([{
        id: 'approve', kind: 'NODE',
      }]),
      created_at: '2026-07-21T04:00:00.000Z',
      expires_at: '2026-08-20T04:00:00.000Z',
    });
    expect(diagnostic?.query_fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(diagnostic)).not.toContain('当前节点由谁负责');
    expect(JSON.stringify(diagnostic)).not.toContain('隐藏推理');
  });

  it('removes only expired diagnostics when a new exceptional result is inserted', async () => {
    const context = seedValidatingRun(database);
    const stale = enqueueConversationRun(database, {
      conversationId: context.conversationId,
      ownerId: context.ownerId,
      request: {
        clientMessageId: 'client-expired-diagnostic',
        text: '旧的诊断。',
        sources: context.sources,
        attachmentIds: [],
      },
    });
    database.prepare(
      `INSERT INTO agent_retrieval_diagnostics (
        id, run_id, workspace_id, guide_id, target_resource_node_id, target_annotation_id,
        query_fingerprint, reason_code, candidates_json, closure_json, created_at, expires_at
      ) VALUES ('expired-diagnostic', ?, 'workspace-1', NULL, NULL, NULL,
                ?, 'BUDGET_EXHAUSTED', '[]', '[]', '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
    ).run(stale.accepted.run.id, 'a'.repeat(64));
    const committer = new DatabaseAgentOutputCommitter(database, {
      now: () => new Date('2026-07-21T04:00:00.000Z'),
    });

    await committer.commit({
      context,
      answer: { ...committedAnswer(context.runId), evidenceStatus: 'PARTIAL' },
      references: [resolvedReference()],
      retrievalTrace: minimalRetrievalTrace(),
    } as Parameters<typeof committer.commit>[0]);

    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM agent_retrieval_diagnostics WHERE run_id = ?',
    ).get(stale.accepted.run.id)).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM agent_retrieval_diagnostics').get())
      .toEqual({ count: 1 });
  });
});

function seedValidatingRun(database: DatabaseSync): AgentRunExecutionContext {
  const conversation = createConversation(database, {
    scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '提交测试',
  });
  const queued = enqueueConversationRun(database, {
    conversationId: conversation.id,
    ownerId: 'owner-1',
    request: {
      clientMessageId: 'client-output',
      text: '当前节点由谁负责？',
      sources: {
        workspaceFlows: true,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: false,
      },
      attachmentIds: [],
    },
  });
  const events = new AgentRunEventStore(database, new RunEventBroker());
  events.append({
    runId: queued.accepted.run.id, planVersion: 1, phase: 'PROVISIONAL',
    type: 'route.started', payload: {},
  });
  events.append({
    runId: queued.accepted.run.id, planVersion: 1, phase: 'PROVISIONAL',
    type: 'plan.committed', payload: { plan: {
      route: 'FOCUSED', userFacingPlan: '检查当前流程。', executionMode: 'SEQUENTIAL',
      tasks: [{ id: 'flow', label: '检查流程', sourceKind: 'WORKSPACE_FLOW' }],
    } },
  });
  events.append({
    runId: queued.accepted.run.id, planVersion: 1, phase: 'COMMITTED',
    type: 'answer.validating', payload: {},
  });
  return {
    runId: queued.accepted.run.id,
    conversationId: conversation.id,
    ownerId: 'owner-1',
    scope: 'WORKSPACE',
    workspaceId: 'workspace-1',
    planVersion: 1,
    status: 'VALIDATING',
    text: '当前节点由谁负责？',
    sources: queued.accepted.run.sources,
    attachmentIds: [],
  };
}

function committedAnswer(runId: string): AgentCommittedAnswerV1 {
  return {
    mode: 'REPORT',
    conclusion: '当前节点由复核员负责。',
    sections: [{ id: 'detail', title: '依据', markdown: '流程节点标记为复核。' }],
    evidenceStatus: 'SUPPORTED',
    citations: [{
      referenceId: 'reference-flow',
      href: '/references/reference-flow',
      source: 'WORKSPACE_FLOW',
      title: '审批节点',
      excerpt: '复核员负责审批。',
    }],
    flowFeedback: [],
    artifacts: [{
      id: 'artifact-report',
      runId,
      kind: 'REPORT',
      title: '流程检查报告',
      summary: '审批责任检查。',
      sections: [{ title: '结论', markdown: '复核员负责。' }],
      createdAt: '2026-07-15T02:00:00.000Z',
    }],
    suggestedQuestions: [],
  };
}

function resolvedReference(evidence: ValidatedEvidenceV1 = flowEvidence()): ResolvedAgentReference {
  return {
    reference: { referenceId: 'reference-flow', href: '/references/reference-flow' },
    evidence,
  };
}

function flowEvidence(): ValidatedEvidenceV1 {
  return {
    id: 'evidence-flow',
    source: 'WORKSPACE_FLOW',
    title: '审批节点',
    excerpt: '复核员负责审批。',
    locator: {
      kind: 'WORKSPACE_FLOW',
      guideId: 'guide-regression',
      snapshotId: 'snapshot-regression',
      nodeId: 'image-version-type',
      annotationId: 'version-type',
    },
  };
}

function minimalRetrievalTrace() {
  return {
    candidates: [{
      fragmentId: 'evidence-flow', projection: 'NODE', rank: 1, selected: true,
    }],
    closure: [{ id: 'approve', kind: 'NODE' }],
  };
}

function seedRegressionRun(database: DatabaseSync, context: AgentRunExecutionContext): void {
  const now = '2026-07-21T00:00:00.000Z';
  database.prepare(
    `INSERT INTO guides (
      id, owner_id, title, summary, tags_json, status, visibility, revision,
      draft_document, created_at, updated_at
    ) VALUES ('guide-regression', 'owner-1', '标注回归流程', '', '[]', 'DRAFT', 'INTERNAL', 0,
              '{"schemaVersion":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1},"steps":[],"exitNodeIds":[]}', ?, ?)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO workspace_items (
      id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
    ) VALUES ('item-guide-regression', 'workspace-1', 'GUIDE', 'guide-regression',
              '标注回归流程', '', 'owner-1', ?, ?)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO answer_citations (
      reference_id, run_id, source_kind, internal_locator_json,
      title, excerpt, revision, created_at
    ) VALUES ('reference-regression-source', ?, 'WORKSPACE_FLOW', ?,
              '版类型', '初样用于新建版型。', 'snapshot-regression', ?)`,
  ).run(context.runId, JSON.stringify({
    kind: 'WORKSPACE_FLOW',
    guideId: 'guide-regression',
    snapshotId: 'snapshot-regression',
    nodeId: 'image-version-type',
    annotationId: 'version-type',
  }), now);
  database.prepare(
    `INSERT INTO workspace_flow_regression_cases (
      id, workspace_id, guide_id, source_reference_id, resource_node_id, annotation_id,
      question, expected_agent_status, status, created_by, created_at, updated_at,
      last_verified_snapshot_id, last_retrieval_verification, last_agent_verification
    ) VALUES ('case-regression', 'workspace-1', 'guide-regression', 'reference-regression-source',
              'image-version-type', 'version-type', '版类型怎么设置？', 'SUPPORTED', 'ACTIVE',
              'owner-1', ?, ?, NULL, NULL, NULL)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO workspace_flow_regression_runs (run_id, case_id, requested_by, created_at)
     VALUES (?, 'case-regression', 'owner-1', ?)`,
  ).run(context.runId, now);
}

function seedUser(database: DatabaseSync, id: string): void {
  database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, 'not-used', ?, 'AUTHOR', ?)`,
  ).run(id, `${id}@guide.local`, id, '2026-07-15T00:00:00.000Z');
}

function seedWorkspace(database: DatabaseSync, id: string, ownerId: string): void {
  const now = '2026-07-15T00:00:00.000Z';
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, created_at, updated_at
    ) VALUES (?, ?, '测试工作区', '', 'SquaresFour', 'general', ?, ?, ?)`,
  ).run(id, id, ownerId, now, now);
  database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES (?, ?, 'OWNER', ?)`,
  ).run(id, ownerId, now);
}

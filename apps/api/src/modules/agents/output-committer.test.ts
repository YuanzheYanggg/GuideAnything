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

function resolvedReference(): ResolvedAgentReference {
  return {
    reference: { referenceId: 'reference-flow', href: '/references/reference-flow' },
    evidence: flowEvidence(),
  };
}

function flowEvidence(): ValidatedEvidenceV1 {
  return {
    id: 'evidence-flow',
    source: 'WORKSPACE_FLOW',
    title: '审批节点',
    excerpt: '复核员负责审批。',
    locator: {
      kind: 'WORKSPACE_FLOW', guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'approve',
    },
  };
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

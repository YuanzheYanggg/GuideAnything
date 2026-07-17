import type { CanvasNode } from '@guideanything/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';
import { createConversation, enqueueConversationRun } from '../conversations/repository';

describe('workspace editorial routes', () => {
  let context: TestContext;
  let workspaceId: string;
  let guideId: string;

  beforeEach(async () => {
    context = await createTestContext();
    workspaceId = 'workspace-editorial';
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId,
      slug: 'editorial',
      name: '知识演进测试工作区',
    });
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.editor, 'EDIT');
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.learner, 'VIEW');

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: authorization(context.tokens.author),
      payload: { workspaceId, title: '订单异常处理', summary: '', tags: [] },
    });
    expect(created.statusCode).toBe(201);
    guideId = created.json().guide.id as string;
    const saved = await context.app.inject({
      method: 'PATCH',
      url: `/api/guides/${guideId}`,
      headers: authorization(context.tokens.author),
      payload: { revision: 0, document: sampleDocument() },
    });
    expect(saved.statusCode).toBe(200);

    context.database.prepare(
      `INSERT INTO workspace_question_clusters (
        id, workspace_id, cluster_key, summary, status, occurrence_count,
        owner_visible_example_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'OPEN', 1, 0, ?, ?)`,
    ).run('cluster-1', workspaceId, 'question-gap-key', '异常处理职责尚未覆盖', now(), now());
  });

  afterEach(async () => context.close());

  it('permits aggregates to EDIT members but reserves raw question examples for the workspace owner', async () => {
    const clusters = await context.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceId}/editorial/question-clusters`,
      headers: authorization(context.tokens.editor),
    });
    expect(clusters.statusCode).toBe(200);
    expect(clusters.json().items).toEqual([
      expect.objectContaining({ id: 'cluster-1', summary: '异常处理职责尚未覆盖' }),
    ]);

    const editorExamples = await context.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceId}/editorial/question-clusters/cluster-1/examples`,
      headers: authorization(context.tokens.editor),
    });
    expect(editorExamples.statusCode).toBe(403);

    const ownerExamples = await context.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceId}/editorial/question-clusters/cluster-1/examples`,
      headers: authorization(context.tokens.author),
    });
    expect(ownerExamples.statusCode).toBe(200);
    expect(ownerExamples.json()).toEqual({ items: [] });
  });

  it('denies a VIEW member every editorial route', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspaceId}/editorial/cards`,
      headers: authorization(context.tokens.learner),
    });
    expect(response.statusCode).toBe(403);
  });

  it('marks a proposal stale rather than applying it when its base revision changed', async () => {
    seedProposal(context, workspaceId, guideId, 'proposal-stale', 0);

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/editorial/proposals/proposal-stale/apply`,
      headers: authorization(context.tokens.editor),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'PROPOSAL_STALE' });
    expect(context.database.prepare('SELECT status FROM workspace_flow_proposals WHERE id = ?').get('proposal-stale'))
      .toEqual({ status: 'STALE' });
  });

  it('allows an EDIT member to apply an accepted proposal but not publish the guide', async () => {
    seedProposal(context, workspaceId, guideId, 'proposal-apply', 1);

    const applied = await context.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/editorial/proposals/proposal-apply/apply`,
      headers: authorization(context.tokens.editor),
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().guide.revision).toBe(2);
    expect(applied.json().proposal).toMatchObject({ id: 'proposal-apply', status: 'APPLIED', appliedRevision: 2 });

    const published = await context.app.inject({
      method: 'POST',
      url: `/api/guides/${guideId}/publish`,
      headers: authorization(context.tokens.editor),
    });
    expect(published.statusCode).toBe(403);
  });
});

function seedProposal(
  context: TestContext,
  workspaceId: string,
  guideId: string,
  proposalId: string,
  baseRevision: number,
): void {
  const operation = {
    kind: 'ADD_NODE',
    node: reviewNode(proposalId),
  };
  context.database.prepare(
    `INSERT INTO workspace_flow_proposals (
      id, workspace_id, card_id, guide_id, base_revision, status, summary,
      created_by, created_at, updated_at, applied_revision
    ) VALUES (?, ?, NULL, ?, ?, 'ACCEPTED', '补充异常复核步骤', ?, ?, ?, NULL)`,
  ).run(proposalId, workspaceId, guideId, baseRevision, context.userIds.author, now(), now());
  context.database.prepare(
    `INSERT INTO workspace_flow_proposal_operations (proposal_id, ordinal, operation_json)
     VALUES (?, 0, ?)`,
  ).run(proposalId, JSON.stringify(operation));
  const conversation = createConversation(context.database, {
    scope: 'WORKSPACE',
    workspaceId,
    ownerId: context.userIds.author,
    title: `提案证据 ${proposalId}`,
  });
  const queued = enqueueConversationRun(context.database, {
    conversationId: conversation.id,
    ownerId: context.userIds.author,
    request: {
      clientMessageId: `question-${proposalId}`,
      text: '异常处理由谁复核？',
      sources: {
        workspaceFlows: true,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: false,
      },
      attachmentIds: [],
    },
  });
  const referenceId = `reference-${proposalId}`;
  context.database.prepare(
    `INSERT INTO answer_citations (
      reference_id, run_id, source_kind, internal_locator_json, title, excerpt, revision, created_at
    ) VALUES (?, ?, 'WORKSPACE_FLOW', ?, '订单异常处理', '复核异常', 'draft:1', ?)`,
  ).run(
    referenceId,
    queued.accepted.run.id,
    JSON.stringify({ kind: 'WORKSPACE_FLOW', guideId, snapshotId: 'snapshot-1', nodeId: 'instructions' }),
    now(),
  );
  context.database.prepare(
    `INSERT INTO workspace_flow_proposal_evidence (proposal_id, reference_id, workspace_id, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(proposalId, referenceId, workspaceId, now());
}

function reviewNode(id: string): CanvasNode {
  return {
    id: `review-${id}`,
    type: 'process',
    position: { x: 520, y: 0 },
    zIndex: 2,
    data: { label: '复核异常', shape: 'process' },
  };
}

function now(): string {
  return '2026-07-17T00:00:00.000Z';
}

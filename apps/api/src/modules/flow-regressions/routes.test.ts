import type { CanvasDocument } from '@guideanything/contracts';
import { RunEventBroker } from '../conversations/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';
import { syncGuideFlowSnapshot } from '../knowledge/flow-indexer';

describe('flow regression routes', () => {
  let context: TestContext;
  let scheduleRun: ReturnType<typeof vi.fn<(runId: string) => Promise<void>>>;
  const workspaceId = 'workspace-regression-routes';
  const guideId = 'guide-regression-routes';
  const now = '2026-07-21T12:00:00.000Z';
  let snapshotId = '';

  beforeEach(async () => {
    scheduleRun = vi.fn<(runId: string) => Promise<void>>(async () => undefined);
    context = await createTestContext({
      agentRuntime: {
        broker: new RunEventBroker(),
        scheduleRun,
        cancelRun: vi.fn(async () => undefined),
        steerRun: vi.fn(async () => undefined),
      },
    });
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId, slug: workspaceId, name: '回归路由工作区',
    });
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.otherAuthor, 'VIEW');
    const document = annotatedDocument();
    seedGuide(document);
    snapshotId = syncGuideFlowSnapshot(context.database, {
      workspaceId,
      workspaceItemId: 'item-regression-routes',
      guideId,
      ownerId: context.userIds.author,
      title: '打样流程',
      summary: '',
      tags: [],
      origin: { kind: 'DRAFT', revision: 0 },
      document,
    }).snapshotId;
    seedRunAndCitation({
      ownerId: context.userIds.author,
      runId: 'run-author-citation',
      referenceId: 'reference-author-version-type',
      question: '打样流程里版类型应该怎么设置？',
    });
    seedRunAndCitation({
      ownerId: context.userIds.otherAuthor,
      runId: 'run-viewer-citation',
      referenceId: 'reference-viewer-version-type',
      question: '查看版类型如何设置。',
    });
  });

  afterEach(async () => context.close());

  it('allows only a guide owner or collaborator to pin a cited image annotation', async () => {
    const eligibility = await context.app.inject({
      method: 'GET',
      url: '/api/references/reference-author-version-type/flow-regression-eligibility',
      headers: authorization(context.tokens.author),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json()).toEqual({
      eligibility: {
        eligible: true,
        guideId,
        resourceNodeId: 'annotated-image',
        annotationId: 'version-type',
        expectedAgentStatus: 'SUPPORTED',
      },
    });

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/references/reference-author-version-type/flow-regression-cases',
      headers: authorization(context.tokens.author),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().case).toMatchObject({
      guideId,
      resourceNodeId: 'annotated-image',
      annotationId: 'version-type',
      question: '打样流程里版类型应该怎么设置？',
      expectedAgentStatus: 'SUPPORTED',
      status: 'ACTIVE',
      lastVerifiedSnapshotId: snapshotId,
      lastRetrievalVerification: 'PASS',
    });

    const replayedPin = await context.app.inject({
      method: 'POST',
      url: '/api/references/reference-author-version-type/flow-regression-cases',
      headers: authorization(context.tokens.author),
    });
    expect(replayedPin.statusCode).toBe(200);
    expect(replayedPin.json().case.id).toBe(created.json().case.id);

    const viewer = await context.app.inject({
      method: 'POST',
      url: '/api/references/reference-viewer-version-type/flow-regression-cases',
      headers: authorization(context.tokens.otherAuthor),
    });
    expect(viewer.statusCode).toBe(403);

    const viewerEligibility = await context.app.inject({
      method: 'GET',
      url: '/api/references/reference-viewer-version-type/flow-regression-eligibility',
      headers: authorization(context.tokens.otherAuthor),
    });
    expect(viewerEligibility.statusCode).toBe(200);
    expect(viewerEligibility.json()).toEqual({
      eligibility: { eligible: false, reasonCode: 'GUIDE_ACCESS_REQUIRED' },
    });
  });

  it('lists, deterministically replays, archives, and reports current annotation health for a guide', async () => {
    const pin = await pinAuthorCase();
    const caseId = pin.case.id as string;

    const listed = await context.app.inject({
      method: 'GET',
      url: `/api/guides/${guideId}/flow-regression-cases`,
      headers: authorization(context.tokens.author),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([expect.objectContaining({ id: caseId, status: 'ACTIVE' })]);

    const replay = await context.app.inject({
      method: 'POST',
      url: `/api/guides/${guideId}/flow-regression-cases/${caseId}/replay`,
      headers: authorization(context.tokens.author),
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().case).toMatchObject({
      id: caseId,
      lastVerifiedSnapshotId: snapshotId,
      lastRetrievalVerification: 'PASS',
    });

    const health = await context.app.inject({
      method: 'GET',
      url: `/api/guides/${guideId}/flow-annotation-health`,
      headers: authorization(context.tokens.author),
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ health: { snapshotId, issues: [] } });

    const archived = await context.app.inject({
      method: 'PATCH',
      url: `/api/guides/${guideId}/flow-regression-cases/${caseId}/status`,
      headers: authorization(context.tokens.author),
      payload: { status: 'ARCHIVED' },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().case).toMatchObject({ id: caseId, status: 'ARCHIVED' });
  });

  it('schedules a normal workspace-flow Agent run only after an editor explicitly requests a real trial', async () => {
    const pin = await pinAuthorCase();
    const caseId = pin.case.id as string;

    const response = await context.app.inject({
      method: 'POST',
      url: `/api/guides/${guideId}/flow-regression-cases/${caseId}/real-run`,
      headers: authorization(context.tokens.author),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().run).toMatchObject({
      status: 'QUEUED',
      sources: {
        workspaceFlows: true,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: false,
      },
    });
    const runId = response.json().run.id as string;
    await vi.waitFor(() => expect(scheduleRun).toHaveBeenCalledWith(runId));
    expect(context.database.prepare(
      'SELECT case_id, requested_by FROM workspace_flow_regression_runs WHERE run_id = ?',
    ).get(runId)).toEqual({ case_id: caseId, requested_by: context.userIds.author });
  });

  it('returns a bounded retrieval diagnostic only to its conversation owner or a guide editor', async () => {
    context.database.prepare(
      `INSERT INTO agent_retrieval_diagnostics (
        id, run_id, workspace_id, guide_id, target_resource_node_id, target_annotation_id,
        query_fingerprint, reason_code, candidates_json, closure_json, created_at, expires_at
      ) VALUES ('diagnostic-author', 'run-author-citation', ?, ?, 'annotated-image', 'version-type',
                ?, 'TARGET_NOT_RANKED',
                '[{"fragmentId":"fragment-1","projection":"NODE","rank":1,"selected":false}]',
                '[{"id":"start","kind":"NODE"}]', ?, ?)`,
    ).run(
      workspaceId,
      guideId,
      'a'.repeat(64),
      now,
      '2026-08-20T12:00:00.000Z',
    );

    const owner = await context.app.inject({
      method: 'GET',
      url: '/api/agent-runs/run-author-citation/retrieval-diagnostic',
      headers: authorization(context.tokens.author),
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().diagnostic).toMatchObject({
      runId: 'run-author-citation',
      reasonCode: 'TARGET_NOT_RANKED',
      candidates: [{ fragmentId: 'fragment-1', projection: 'NODE', rank: 1, selected: false }],
    });

    const viewer = await context.app.inject({
      method: 'GET',
      url: '/api/agent-runs/run-author-citation/retrieval-diagnostic',
      headers: authorization(context.tokens.otherAuthor),
    });
    expect(viewer.statusCode).toBe(404);
  });

  async function pinAuthorCase() {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/references/reference-author-version-type/flow-regression-cases',
      headers: authorization(context.tokens.author),
    });
    expect([200, 201]).toContain(response.statusCode);
    return response.json() as { case: { id: string } };
  }

  function seedGuide(document: CanvasDocument): void {
    context.database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, created_at, updated_at
      ) VALUES (?, ?, '打样流程', '', '[]', 'DRAFT', 'INTERNAL', 0, ?, ?, ?)`,
    ).run(guideId, context.userIds.author, JSON.stringify(document), now, now);
    context.database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES ('item-regression-routes', ?, 'GUIDE', ?, '打样流程', '', ?, ?, ?)`,
    ).run(workspaceId, guideId, context.userIds.author, now, now);
  }

  function seedRunAndCitation(input: {
    ownerId: string;
    runId: string;
    referenceId: string;
    question: string;
  }): void {
    const conversationId = `conversation-${input.runId}`;
    const messageId = `message-${input.runId}`;
    context.database.prepare(
      `INSERT INTO conversations (
        id, scope, workspace_id, owner_id, title, status, created_at, updated_at
      ) VALUES (?, 'WORKSPACE', ?, ?, '标注问答', 'ACTIVE', ?, ?)`,
    ).run(conversationId, workspaceId, input.ownerId, now, now);
    context.database.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json,
        selected_context_json, attachment_ids_json, committed, created_at
      ) VALUES (?, ?, 'USER', ?, ?,
                '{"workspaceFlows":true,"workspaceDocuments":false,"sessionAttachments":false,"santexwell":false}',
                NULL, '[]', 1, ?)`,
    ).run(messageId, conversationId, `client-${input.runId}`, input.question, now);
    context.database.prepare(
      `INSERT INTO agent_runs (
        id, conversation_id, initiating_message_id, run_sequence, plan_version, status,
        source_options_json, created_at, completed_at, updated_at
      ) VALUES (?, ?, ?, 1, 1, 'COMPLETED',
                '{"workspaceFlows":true,"workspaceDocuments":false,"sessionAttachments":false,"santexwell":false}',
                ?, ?, ?)`,
    ).run(input.runId, conversationId, messageId, now, now, now);
    const answer = {
      mode: 'ANSWER', conclusion: '版类型按标注说明设置。', sections: [], evidenceStatus: 'SUPPORTED',
      citations: [], flowFeedback: [], artifacts: [], suggestedQuestions: [],
    };
    context.database.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json,
        selected_context_json, attachment_ids_json, committed, created_at
      ) VALUES (?, ?, 'ASSISTANT', NULL, ?, NULL, NULL, '[]', 1, ?)`,
    ).run(`assistant-${input.runId}`, conversationId, JSON.stringify({ runId: input.runId, answer }), now);
    context.database.prepare(
      `INSERT INTO answer_citations (
        reference_id, run_id, source_kind, internal_locator_json,
        title, excerpt, revision, created_at
      ) VALUES (?, ?, 'WORKSPACE_FLOW', ?, '版类型', '初样用于新建版型。', ?, ?)`,
    ).run(input.referenceId, input.runId, JSON.stringify({
      kind: 'WORKSPACE_FLOW', guideId, snapshotId, nodeId: 'annotated-image', annotationId: 'version-type',
    }), snapshotId, now);
  }
});

function annotatedDocument(): CanvasDocument {
  const document = sampleDocument('# 打样流程\n确认版类型。');
  document.nodes.push({
    id: 'annotated-image',
    type: 'image',
    position: { x: 520, y: 0 },
    zIndex: 2,
    attachment: { ownerNodeId: 'start', order: 0 },
    data: {
      url: 'https://example.com/sample.png',
      alt: '打样页面',
      annotations: [{
        id: 'version-type',
        order: 0,
        title: '版类型',
        body: '初样用于新建版型，修改样用于局部修改。',
        shape: 'POINT',
        region: { x: 0.45, y: 0.35 },
      }],
    },
  });
  return document;
}

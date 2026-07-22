import type { CanvasDocument } from '@guideanything/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';
import { syncGuideFlowSnapshot } from '../knowledge/flow-indexer';
import {
  refreshActiveFlowRegressionCases,
  runFlowAnnotationHealthChecks,
} from './service';

describe('flow annotation health and deterministic regressions', () => {
  let context: TestContext;
  const workspaceId = 'workspace-flow-regressions';
  const now = '2026-07-21T10:00:00.000Z';

  beforeEach(async () => {
    context = await createTestContext();
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId, slug: workspaceId, name: '流程回归工作区',
    });
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.editor, 'EDIT');
  });

  afterEach(async () => context.close());

  it('keeps no health row when every annotation query ranks its own leaf', () => {
    const document = annotatedDocument('annotated-image');
    seedGuide('guide-health', 'item-health', document, 0);
    const snapshot = syncGuideFlowSnapshot(context.database, flowContext('guide-health', 'item-health', document, 0));

    expect(runFlowAnnotationHealthChecks(context.database, {
      snapshot,
      ownerId: context.userIds.author,
    })).toEqual([]);
    expect(context.database.prepare('SELECT * FROM flow_annotation_health_issues').all()).toEqual([]);
  });

  it('marks an active case NEEDS_REVIEW when its stable image target is deleted instead of rebinding a same-title annotation', () => {
    const original = annotatedDocument('annotated-image');
    seedGuide('guide-case', 'item-case', original, 0);
    const originalSnapshot = syncGuideFlowSnapshot(context.database, flowContext('guide-case', 'item-case', original, 0));
    seedActiveCase('guide-case', originalSnapshot.snapshotId);

    const moved = annotatedDocument('other-image');
    context.database.prepare('UPDATE guides SET revision = 1, draft_document = ? WHERE id = ?')
      .run(JSON.stringify(moved), 'guide-case');
    const nextSnapshot = syncGuideFlowSnapshot(context.database, flowContext('guide-case', 'item-case', moved, 1));

    refreshActiveFlowRegressionCases(context.database, {
      snapshot: nextSnapshot,
      ownerId: context.userIds.author,
    });

    expect(context.database.prepare(
      `SELECT status, last_verified_snapshot_id, last_retrieval_verification
       FROM workspace_flow_regression_cases WHERE id = 'case-version-type'`,
    ).get()).toEqual({
      status: 'NEEDS_REVIEW',
      last_verified_snapshot_id: nextSnapshot.snapshotId,
      last_retrieval_verification: 'NEEDS_REVIEW',
    });
  });

  function seedGuide(guideId: string, workspaceItemId: string, document: CanvasDocument, revision: number) {
    context.database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, created_at, updated_at
      ) VALUES (?, ?, '打样流程', '', '[]', 'DRAFT', 'INTERNAL', ?, ?, ?, ?)`,
    ).run(guideId, context.userIds.author, revision, JSON.stringify(document), now, now);
    context.database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES (?, ?, 'GUIDE', ?, '打样流程', '', ?, ?, ?)`,
    ).run(workspaceItemId, workspaceId, guideId, context.userIds.author, now, now);
  }

  function flowContext(guideId: string, workspaceItemId: string, document: CanvasDocument, revision: number) {
    return {
      workspaceId,
      workspaceItemId,
      guideId,
      ownerId: context.userIds.author,
      title: '打样流程',
      summary: '',
      tags: [],
      origin: { kind: 'DRAFT' as const, revision },
      document,
    };
  }

  function seedActiveCase(guideId: string, snapshotId: string) {
    context.database.prepare(
      `INSERT INTO conversations (
        id, scope, workspace_id, owner_id, title, status, created_at, updated_at
      ) VALUES ('conversation-case', 'WORKSPACE', ?, ?, '版类型问题', 'ACTIVE', ?, ?)`,
    ).run(workspaceId, context.userIds.author, now, now);
    context.database.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json,
        selected_context_json, attachment_ids_json, committed, created_at
      ) VALUES ('message-case', 'conversation-case', 'USER', 'client-case', '打样流程里版类型应该怎么设置？',
                '{"workspaceFlows":true,"workspaceDocuments":false,"sessionAttachments":false,"santexwell":false}',
                NULL, '[]', 1, ?)`,
    ).run(now);
    context.database.prepare(
      `INSERT INTO agent_runs (
        id, conversation_id, initiating_message_id, run_sequence, plan_version, status,
        source_options_json, created_at, updated_at
      ) VALUES ('run-case', 'conversation-case', 'message-case', 1, 1, 'COMPLETED',
                '{"workspaceFlows":true,"workspaceDocuments":false,"sessionAttachments":false,"santexwell":false}', ?, ?)`,
    ).run(now, now);
    context.database.prepare(
      `INSERT INTO answer_citations (
        reference_id, run_id, source_kind, internal_locator_json,
        title, excerpt, revision, created_at
      ) VALUES ('reference-version-type', 'run-case', 'WORKSPACE_FLOW', ?,
                '版类型', '初样用于新建版型。', ?, ?)`,
    ).run(JSON.stringify({
      kind: 'WORKSPACE_FLOW', guideId, snapshotId, nodeId: 'annotated-image', annotationId: 'version-type',
    }), snapshotId, now);
    context.database.prepare(
      `INSERT INTO workspace_flow_regression_cases (
        id, workspace_id, guide_id, source_reference_id, resource_node_id, annotation_id,
        question, expected_agent_status, status, created_by, created_at, updated_at,
        last_verified_snapshot_id, last_retrieval_verification, last_agent_verification
      ) VALUES ('case-version-type', ?, ?, 'reference-version-type', 'annotated-image', 'version-type',
                '打样流程里版类型应该怎么设置？', 'SUPPORTED', 'ACTIVE', ?, ?, ?, NULL, NULL, NULL)`,
    ).run(workspaceId, guideId, context.userIds.author, now, now);
  }
});

function annotatedDocument(imageId: string): CanvasDocument {
  const document = sampleDocument('# 打样流程\n确认版类型。');
  document.nodes.push({
    id: imageId,
    type: 'image',
    position: { x: 520, y: 0 },
    zIndex: 2,
    attachment: { ownerNodeId: 'start', order: 0 },
    data: {
      url: 'https://example.com/sample.png',
      alt: '打样提案页面',
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

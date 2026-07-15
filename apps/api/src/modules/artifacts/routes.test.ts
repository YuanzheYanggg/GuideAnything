import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  sampleDocument,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';
import { syncGuideFlowSnapshot } from '../knowledge/flow-indexer';

describe('private artifact and opaque reference routes', () => {
  let context: TestContext;
  const now = '2026-07-15T08:00:00.000Z';

  beforeEach(async () => {
    context = await createTestContext();
    seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-artifacts', slug: 'workspace-artifacts', name: '产物工作区',
    });
    addTestWorkspaceMember(
      context.database,
      'workspace-artifacts',
      context.userIds.otherAuthor,
      'VIEW',
    );
  });

  afterEach(async () => context.close());

  it('lists only the current owners artifacts inside the requested readable workspace', async () => {
    seedRun('conversation-owner', 'run-owner', context.userIds.author, 'WORKSPACE', 'workspace-artifacts');
    seedRun('conversation-other', 'run-other', context.userIds.otherAuthor, 'WORKSPACE', 'workspace-artifacts');
    seedArtifact('artifact-owner', 'conversation-owner', 'run-owner', context.userIds.author, '作者报告');
    seedArtifact('artifact-other', 'conversation-other', 'run-other', context.userIds.otherAuthor, '他人报告');

    const owner = await context.app.inject({
      method: 'GET', url: '/api/workspaces/workspace-artifacts/artifacts',
      headers: authorization(context.tokens.author),
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().items).toEqual([expect.objectContaining({ id: 'artifact-owner', title: '作者报告' })]);

    const other = await context.app.inject({
      method: 'GET', url: '/api/workspaces/workspace-artifacts/artifacts',
      headers: authorization(context.tokens.otherAuthor),
    });
    expect(other.statusCode).toBe(200);
    expect(other.json().items).toEqual([expect.objectContaining({ id: 'artifact-other', title: '他人报告' })]);
  });

  it('reauthorizes a Santexwell citation and reports a changed revision as stale', async () => {
    seedRun('conversation-global', 'run-global', context.userIds.author, 'GLOBAL_SANTEXWELL', null);
    seedKnowledgeDocument({
      sourceId: 'source-vault', sourceScope: 'GLOBAL', sourceKind: 'SANTEXWELL_VAULT',
      documentId: 'document-vault', fragmentId: 'fragment-vault', revision: 'revision-vault',
      relativeLocator: 'concepts/fancy-yarn.md',
    });
    seedCitation('reference-vault', 'run-global', 'SANTEXWELL', {
      kind: 'SANTEXWELL', documentId: 'document-vault', fragmentId: 'fragment-vault',
      relativePath: 'concepts/fancy-yarn.md', revision: 'revision-vault', heading: '分类',
    }, 'revision-vault');

    const valid = await resolve('reference-vault', context.tokens.author);
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({
      status: 'VALID', source: 'SANTEXWELL',
      target: {
        kind: 'SANTEXWELL_FRAGMENT',
        href: '/knowledge/santexwell/documents/document-vault?fragment=fragment-vault',
      },
    });

    const hidden = await resolve('reference-vault', context.tokens.otherAuthor);
    expect(hidden.statusCode).toBe(404);

    context.database.prepare('UPDATE knowledge_documents SET revision = ? WHERE id = ?')
      .run('revision-new', 'document-vault');
    const stale = await resolve('reference-vault', context.tokens.author);
    expect(stale.json()).toMatchObject({ status: 'INVALID', reasonCode: 'STALE' });
  });

  it('resolves a workspace document only while workspace and source-item authorization remain current', async () => {
    seedRun('conversation-workspace', 'run-workspace', context.userIds.author, 'WORKSPACE', 'workspace-artifacts');
    seedKnowledgeDocument({
      sourceId: 'source-workspace', sourceScope: 'WORKSPACE', sourceKind: 'WORKSPACE_DOCUMENT',
      documentId: 'document-workspace', fragmentId: 'fragment-workspace', revision: 'revision-workspace',
      relativeLocator: 'opaque-storage-key.md', workspaceId: 'workspace-artifacts',
      createdBy: context.userIds.author,
    });
    context.database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES ('source-item', 'workspace-artifacts', 'SOURCE', 'source-workspace',
                '工艺说明', '', ?, ?, ?)`,
    ).run(context.userIds.author, now, now);
    seedCitation('reference-workspace', 'run-workspace', 'WORKSPACE_DOCUMENT', {
      kind: 'WORKSPACE_DOCUMENT', workspaceId: 'workspace-artifacts', sourceItemId: 'source-item',
      documentId: 'document-workspace', fragmentId: 'fragment-workspace', revision: 'revision-workspace',
    }, 'revision-workspace');

    const valid = await resolve('reference-workspace', context.tokens.author);
    expect(valid.json()).toMatchObject({
      status: 'VALID', source: 'WORKSPACE_DOCUMENT',
      target: {
        kind: 'WORKSPACE_DOCUMENT',
        href: '/workspaces/workspace-artifacts/sources?source=source-workspace&document=document-workspace&fragment=fragment-workspace',
      },
    });

    context.database.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .run('workspace-artifacts', context.userIds.author);
    const forbidden = await resolve('reference-workspace', context.tokens.author);
    expect(forbidden.json()).toMatchObject({ status: 'INVALID', reasonCode: 'FORBIDDEN' });
  });

  it('maps an unexpired session attachment back to the initiating conversation message', async () => {
    seedRun('conversation-session', 'run-session', context.userIds.author, 'WORKSPACE', 'workspace-artifacts');
    seedKnowledgeDocument({
      sourceId: 'source-session', sourceScope: 'SESSION', sourceKind: 'SESSION_ATTACHMENT',
      documentId: 'document-session', fragmentId: 'fragment-session', revision: 'revision-session',
      relativeLocator: 'attachment.pdf', conversationId: 'conversation-session',
      createdBy: context.userIds.author,
    });
    context.database.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, source_id, original_name, mime_type, size,
        storage_key, status, expires_at, created_at, updated_at
      ) VALUES ('attachment-session', 'conversation-session', ?, 'source-session',
                '附件.pdf', 'application/pdf', 20, 'attachment-session.pdf', 'READY',
                '2027-07-15T08:00:00.000Z', ?, ?)`,
    ).run(context.userIds.author, now, now);
    seedCitation('reference-session', 'run-session', 'SESSION_ATTACHMENT', {
      kind: 'SESSION_ATTACHMENT', conversationId: 'conversation-session',
      attachmentId: 'attachment-session', documentId: 'document-session',
      fragmentId: 'fragment-session', revision: 'revision-session',
    }, 'revision-session');

    const valid = await resolve('reference-session', context.tokens.author);
    expect(valid.json()).toMatchObject({
      status: 'VALID', source: 'SESSION_ATTACHMENT',
      target: {
        kind: 'CONVERSATION_MESSAGE',
        href: '/workspaces/workspace-artifacts/agents?conversation=conversation-session&message=message-run-session',
      },
    });

    context.database.prepare('UPDATE conversation_attachments SET expires_at = ? WHERE id = ?')
      .run('2026-07-15T08:00:01.000Z', 'attachment-session');
    const expired = await resolve('reference-session', context.tokens.author);
    expect(expired.json()).toMatchObject({ status: 'INVALID', reasonCode: 'SOURCE_UNAVAILABLE' });
  });

  it('opens the exact current draft node and invalidates the reference after a draft revision change', async () => {
    seedRun('conversation-flow', 'run-flow', context.userIds.author, 'WORKSPACE', 'workspace-artifacts');
    const document = sampleDocument();
    context.database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, created_at, updated_at
      ) VALUES ('guide-flow', ?, '审批流程', '', '[]', 'DRAFT', 'INTERNAL', 0, ?, ?, ?)`,
    ).run(context.userIds.author, JSON.stringify(document), now, now);
    context.database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES ('guide-item', 'workspace-artifacts', 'GUIDE', 'guide-flow',
                '审批流程', '', ?, ?, ?)`,
    ).run(context.userIds.author, now, now);
    const snapshot = syncGuideFlowSnapshot(context.database, {
      workspaceId: 'workspace-artifacts', workspaceItemId: 'guide-item', guideId: 'guide-flow',
      ownerId: context.userIds.author, title: '审批流程', summary: '', tags: [],
      origin: { kind: 'DRAFT', revision: 0 }, document,
    });
    const node = snapshot.nodes[0]!;
    seedCitation('reference-flow', 'run-flow', 'WORKSPACE_FLOW', {
      kind: 'WORKSPACE_FLOW', ...node.locator,
    }, snapshot.snapshotId);

    const valid = await resolve('reference-flow', context.tokens.author);
    expect(valid.json()).toMatchObject({
      status: 'VALID', source: 'WORKSPACE_FLOW',
      target: {
        kind: 'CURRENT_DRAFT_FLOW_NODE',
        href: `/guides/guide-flow/edit?nodeId=${node.id}`,
      },
    });

    const resource = [
      ...snapshot.nodes.flatMap((item) => item.attachments),
      ...snapshot.unattachedResources,
    ][0]!;
    seedCitation('reference-flow-resource', 'run-flow', 'WORKSPACE_FLOW', {
      kind: 'WORKSPACE_FLOW', ...resource.locator,
    }, snapshot.snapshotId);
    const resourceReference = await resolve('reference-flow-resource', context.tokens.author);
    expect(resourceReference.json()).toMatchObject({
      status: 'VALID', source: 'WORKSPACE_FLOW',
      target: {
        kind: 'CURRENT_DRAFT_FLOW_NODE',
        href: `/guides/guide-flow/edit?nodeId=${resource.nodeId}`,
      },
    });

    context.database.prepare('UPDATE guides SET revision = 1 WHERE id = ?').run('guide-flow');
    const stale = await resolve('reference-flow', context.tokens.author);
    expect(stale.json()).toMatchObject({ status: 'INVALID', reasonCode: 'STALE' });
  });

  function seedRun(
    conversationId: string,
    runId: string,
    ownerId: string,
    scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE',
    workspaceId: string | null,
  ) {
    context.database.prepare(
      `INSERT INTO conversations (
        id, scope, workspace_id, owner_id, title, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '测试会话', 'ACTIVE', ?, ?)`,
    ).run(conversationId, scope, workspaceId, ownerId, now, now);
    context.database.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json,
        selected_context_json, attachment_ids_json, committed, created_at
      ) VALUES (?, ?, 'USER', ?, '测试问题',
                '{"workspaceFlows":false,"workspaceDocuments":false,"sessionAttachments":false,"santexwell":false}',
                NULL, '[]', 1, ?)`,
    ).run(`message-${runId}`, conversationId, `client-${runId}`, now);
    context.database.prepare(
      `INSERT INTO agent_runs (
        id, conversation_id, initiating_message_id, run_sequence, plan_version, status,
        source_options_json, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 1, 'COMPLETED',
                '{"workspaceFlows":false,"workspaceDocuments":false,"sessionAttachments":false,"santexwell":false}',
                ?, ?)`,
    ).run(runId, conversationId, `message-${runId}`, now, now);
  }

  function seedArtifact(
    id: string,
    conversationId: string,
    runId: string,
    ownerId: string,
    title: string,
  ) {
    const artifact = {
      id, runId, kind: 'REPORT', title, summary: '只读摘要', sections: [], createdAt: now,
    };
    context.database.prepare(
      `INSERT INTO artifacts (
        id, conversation_id, owner_id, run_id, kind, title, payload_json, created_at
      ) VALUES (?, ?, ?, ?, 'REPORT', ?, ?, ?)`,
    ).run(id, conversationId, ownerId, runId, title, JSON.stringify(artifact), now);
  }

  function seedKnowledgeDocument(input: {
    sourceId: string;
    sourceScope: 'GLOBAL' | 'WORKSPACE' | 'SESSION';
    sourceKind: 'SANTEXWELL_VAULT' | 'WORKSPACE_DOCUMENT' | 'SESSION_ATTACHMENT';
    documentId: string;
    fragmentId: string;
    revision: string;
    relativeLocator: string;
    workspaceId?: string;
    conversationId?: string;
    createdBy?: string;
  }) {
    context.database.prepare(
      `INSERT INTO knowledge_sources (
        id, scope, kind, workspace_id, conversation_id, created_by, status, revision,
        config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, '{}', ?, ?)`,
    ).run(
      input.sourceId, input.sourceScope, input.sourceKind, input.workspaceId ?? null,
      input.conversationId ?? null, input.createdBy ?? null, input.revision, now, now,
    );
    context.database.prepare(
      `INSERT INTO knowledge_documents (
        id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
        parse_status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, '证据标题', ?, ?, 'READY', '{}', ?, ?)`,
    ).run(
      input.documentId, input.sourceId, input.relativeLocator, input.revision,
      input.revision, now, now,
    );
    context.database.prepare(
      `INSERT INTO knowledge_fragments (
        id, document_id, ordinal, title, heading, content, search_text,
        internal_locator_json, created_at, updated_at
      ) VALUES (?, ?, 0, '证据标题', NULL, '证据摘录', '证据摘录', '{}', ?, ?)`,
    ).run(input.fragmentId, input.documentId, now, now);
  }

  function seedCitation(
    referenceId: string,
    runId: string,
    source: string,
    locator: Record<string, unknown>,
    revision: string,
  ) {
    context.database.prepare(
      `INSERT INTO answer_citations (
        reference_id, run_id, source_kind, internal_locator_json,
        title, excerpt, revision, created_at
      ) VALUES (?, ?, ?, ?, '证据标题', '证据摘录', ?, ?)`,
    ).run(referenceId, runId, source, JSON.stringify(locator), revision, now);
  }

  function resolve(referenceId: string, token: string) {
    return context.app.inject({
      method: 'GET', url: `/api/references/${referenceId}`, headers: authorization(token),
    });
  }
});

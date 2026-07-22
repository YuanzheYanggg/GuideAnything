import {
  RouteDecisionV1Schema,
  type CanvasDocument,
  type RouteDecisionV1,
  type SourceOptionsV1,
} from '@guideanything/contracts';
import { compileFlowKnowledgeSnapshotV1 } from '@guideanything/canvas-core';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { createConversation, enqueueConversationRun } from '../conversations/repository';
import { syncGuideFlowSnapshot } from '../knowledge/flow-indexer';
import { insertWorkspaceDocument } from '../knowledge/repository';
import { loadAgentRunExecutionContext } from './execution-context';
import { createDatabaseAgentKnowledgeAdapters, retrievalQuery } from './knowledge-adapters';
import type {
  AgentRetrievalRequest,
  AgentRetrievalTask,
  AgentRunExecutionContext,
} from './orchestrator';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const CREATED_AT = '2026-07-15T00:00:00.000Z';

describe('database-backed Agent knowledge adapters', () => {
  let database: DatabaseSync;
  let referenceSequence: number;

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedUser(database, 'owner-1');
    seedUser(database, 'other-1');
    seedWorkspace(database, 'workspace-1', 'owner-1');
    referenceSequence = 0;
  });

  afterEach(() => database.close());

  it('prioritizes selected workspace context, completes its locator, and never exposes storage locators', async () => {
    const selected = insertWorkspaceDocument({
      database,
      workspaceId: 'workspace-1',
      userId: 'owner-1',
      title: '选中的本地制度',
      originalName: 'selected.md',
      mimeType: 'text/markdown',
      size: 42,
      storageKey: 'private-storage-key.md',
      checksum: 'workspace-revision-selected',
      text: '这是当前明确选中的资料，内容不包含检索词。',
    });
    insertWorkspaceDocument({
      database,
      workspaceId: 'workspace-1',
      userId: 'owner-1',
      title: '花式纱分类命中',
      originalName: 'search-hit.md',
      mimeType: 'text/markdown',
      size: 42,
      storageKey: 'other-storage-key.md',
      checksum: 'workspace-revision-other',
      text: '花式纱分类包括结构分类和工艺分类。',
    });
    const context = seedRun({
      database,
      sources: sources({ workspaceDocuments: true }),
      selectedContext: { kind: 'WORKSPACE_SOURCE', sourceId: selected.sourceId },
      text: '花式纱有什么分类？',
    });
    const decision = focusedDecision('WORKSPACE_DOCUMENT', context.sources, '查找花式纱分类');

    const evidence = await adapters().retriever.retrieve(request(context, decision, 1));

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      source: 'WORKSPACE_DOCUMENT',
      title: '选中的本地制度',
      locator: {
        kind: 'WORKSPACE_DOCUMENT',
        workspaceId: 'workspace-1',
        documentId: selected.documentId,
        revision: 'workspace-revision-selected',
      },
    });
    expect((evidence[0]!.locator as { sourceItemId?: string }).sourceItemId).toMatch(/^[-a-f0-9]+$/u);
    expect(JSON.stringify(evidence)).not.toMatch(/private-storage-key|other-storage-key|\/Users\//u);
  });

  it('retrieves mounted resource-center documents but excludes unmounted private centers', async () => {
    seedWorkspace(database, 'workspace-finance', 'other-1', 'FINANCE', '财务资源中心');
    seedWorkspace(database, 'workspace-private-finance', 'other-1', 'FINANCE');
    database.prepare(
      `INSERT INTO workspace_resource_mounts (
        id, consumer_workspace_id, provider_workspace_id, created_by, created_at, updated_at
      ) VALUES ('mount-finance', 'workspace-1', 'workspace-finance', 'owner-1', ?, ?)`,
    ).run(CREATED_AT, CREATED_AT);
    const finance = insertWorkspaceDocument({
      database, workspaceId: 'workspace-finance', userId: 'other-1', title: '财务付款条款',
      originalName: 'payment.md', mimeType: 'text/markdown', size: 42, storageKey: 'finance-private.md',
      checksum: 'finance-r1', text: '付款期限为见提单副本后 30 天，请财务复核。',
    });
    insertWorkspaceDocument({
      database, workspaceId: 'workspace-private-finance', userId: 'other-1', title: '私有付款条款',
      originalName: 'private-payment.md', mimeType: 'text/markdown', size: 42, storageKey: 'private.md',
      checksum: 'private-r1', text: '付款期限为 90 天，仅限未共享的私有中心。',
    });
    const context = seedRun({
      database, sources: sources({ workspaceDocuments: true }), text: '付款期限如何约定？',
    });
    const decision = focusedDecision('WORKSPACE_DOCUMENT', context.sources, '付款期限');

    expect(context).toMatchObject({ sharedWorkspaceIds: ['workspace-finance'] });
    const evidence = await adapters().retriever.retrieve(request(context, decision, 3));

    expect(evidence).toEqual([expect.objectContaining({
      title: '财务资源中心 · 财务付款条款',
      locator: expect.objectContaining({ workspaceId: 'workspace-finance', documentId: finance.documentId }),
    })]);
  });

  it('retrieves only published flows from a mounted resource center', async () => {
    seedWorkspace(database, 'workspace-finance', 'other-1', 'FINANCE');
    database.prepare(
      `INSERT INTO workspace_resource_mounts (
        id, consumer_workspace_id, provider_workspace_id, created_by, created_at, updated_at
      ) VALUES ('mount-finance', 'workspace-1', 'workspace-finance', 'owner-1', ?, ?)`,
    ).run(CREATED_AT, CREATED_AT);
    const published = seedPublishedFlow(database, flowDocument('财务已发布审批节点'), {
      guideId: 'guide-finance-published',
      workspaceId: 'workspace-finance',
      ownerId: 'owner-1',
      title: '财务已发布流程',
    });
    const draft = seedDraftFlow(database, flowDocument('财务草稿专属节点'), {
      guideId: 'guide-finance-draft',
      workspaceId: 'workspace-finance',
      ownerId: 'owner-1',
      title: '财务草稿流程',
    });
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      text: '查找财务审批流程。',
    });

    const publishedEvidence = await adapters().retriever.retrieve(
      request(context, focusedDecision('WORKSPACE_FLOW', context.sources, '财务已发布审批节点'), 3),
    );
    const draftEvidence = await adapters().retriever.retrieve(
      request(context, focusedDecision('WORKSPACE_FLOW', context.sources, '财务草稿专属节点'), 3),
    );

    expect(publishedEvidence).toEqual(expect.arrayContaining([expect.objectContaining({
      source: 'WORKSPACE_FLOW',
      locator: expect.objectContaining({ guideId: published.guideId, snapshotId: published.snapshotId }),
    })]));
    expect(draftEvidence).not.toEqual(expect.arrayContaining([expect.objectContaining({
      locator: expect.objectContaining({ guideId: draft.guideId, snapshotId: draft.snapshotId }),
    })]));
  });

  it('fails closed if a captured shared-resource mount is revoked or forged before retrieval', async () => {
    seedWorkspace(database, 'workspace-finance', 'other-1', 'FINANCE');
    database.prepare(
      `INSERT INTO workspace_resource_mounts (
        id, consumer_workspace_id, provider_workspace_id, created_by, created_at, updated_at
      ) VALUES ('mount-finance', 'workspace-1', 'workspace-finance', 'owner-1', ?, ?)`,
    ).run(CREATED_AT, CREATED_AT);
    insertWorkspaceDocument({
      database, workspaceId: 'workspace-finance', userId: 'other-1', title: '财务付款条款',
      originalName: 'payment.md', mimeType: 'text/markdown', size: 42, storageKey: 'finance-private.md',
      checksum: 'finance-r1', text: '付款期限为见提单副本后 30 天。',
    });
    const context = seedRun({
      database, sources: sources({ workspaceDocuments: true }), text: '付款期限如何约定？',
    });
    const decision = focusedDecision('WORKSPACE_DOCUMENT', context.sources, '付款期限');
    database.prepare("DELETE FROM workspace_resource_mounts WHERE id = 'mount-finance'").run();

    await expect(adapters().retriever.retrieve(request(context, decision, 1)))
      .rejects.toThrow(/共享|挂载|上下文/u);
    const forged = { ...context, sharedWorkspaceIds: ['workspace-private-finance'] };
    await expect(adapters().retriever.retrieve(request(forged, decision, 1)))
      .rejects.toThrow(/共享|挂载|上下文/u);
  });

  it('uses Santexwell only when both the immutable request and route enable it, and completes relativePath', async () => {
    seedSantexwell(database, {
      documentId: 'vault-document',
      fragmentId: 'vault-fragment',
      relativePath: 'wiki_v2/concepts/fancy-yarn.md',
      title: '花式纱分类',
      content: '花式纱可按结构、工艺与效果分类。',
    });
    const disabled = seedRun({
      database,
      sources: sources({ workspaceDocuments: true }),
      text: '花式纱有什么分类？',
    });
    const unauthorizedDecision = focusedDecision(
      'SANTEXWELL',
      sources({ santexwell: true }),
      '查找花式纱分类',
    );
    await expect(adapters().retriever.retrieve(request(disabled, unauthorizedDecision, 1)))
      .rejects.toThrow(/未授权|未启用/u);

    const enabled = seedRun({
      database,
      sources: sources({ santexwell: true }),
      text: '花式纱分类',
    });
    const decision = focusedDecision('SANTEXWELL', enabled.sources, '查找花式纱分类');
    const evidence = await adapters().retriever.retrieve(request(enabled, decision, 1));

    expect(evidence).toEqual([expect.objectContaining({
      id: 'vault-fragment',
      source: 'SANTEXWELL',
      locator: {
        kind: 'SANTEXWELL',
        documentId: 'vault-document',
        fragmentId: 'vault-fragment',
        relativePath: 'wiki_v2/concepts/fancy-yarn.md',
        revision: 'vault-document-revision',
        heading: '分类',
      },
    })]);
  });

  it('uses the leading subject instead of generic question wording for Santexwell retrieval', () => {
    const context = seedRun({
      database,
      sources: sources({ santexwell: true }),
      text: '花式纱有哪些分类？',
    });
    const decision = focusedDecision(
      'SANTEXWELL',
      context.sources,
      '检索并提取已验证知识库证据与性能标准。',
    );

    expect(retrievalQuery(request(context, decision, 1))).toBe('花式纱');
  });

  it('upgrades a title-only Vault hit to the document evidence excerpt', async () => {
    seedSantexwell(database, {
      documentId: 'vault-rich-document',
      fragmentId: 'vault-title-fragment',
      relativePath: 'wiki_v2/concepts/fancy-yarn.md',
      title: '花式纱线综合分类',
      content: '花式纱线综合分类',
    });
    database.prepare(
      `INSERT INTO knowledge_fragments (
        id, document_id, ordinal, title, heading, content, search_text,
        internal_locator_json, created_at, updated_at
      ) VALUES (?, 'vault-rich-document', 1, '花式纱线综合分类', '证据摘录', ?, ?, ?, ?, ?)`,
    ).run(
      'vault-evidence-fragment',
      '结子纱、螺旋纱与圈圈纱属于典型花式纱类型。',
      '证据摘录 结子纱 螺旋纱 圈圈纱',
      JSON.stringify({
        kind: 'SANTEXWELL', documentId: 'vault-rich-document', revision: 'vault-document-revision',
        fragmentId: 'vault-evidence-fragment', heading: '证据摘录',
      }),
      CREATED_AT,
      CREATED_AT,
    );
    database.prepare(
      `INSERT INTO knowledge_fragments (
        id, document_id, ordinal, title, heading, content, search_text,
        internal_locator_json, created_at, updated_at
      ) VALUES (?, 'vault-rich-document', 2, '花式纱线综合分类', '关键事实', ?, ?, ?, ?, ?)`,
    ).run(
      'vault-key-facts-fragment',
      '典型花式纱包括结子纱、螺旋纱、圈圈纱与雪尼尔纱。',
      '关键事实 结子纱 螺旋纱 圈圈纱 雪尼尔纱',
      JSON.stringify({
        kind: 'SANTEXWELL', documentId: 'vault-rich-document', revision: 'vault-document-revision',
        fragmentId: 'vault-key-facts-fragment', heading: '关键事实',
      }),
      CREATED_AT,
      CREATED_AT,
    );
    const context = seedRun({
      database,
      sources: sources({ santexwell: true }),
      text: '花式纱线综合分类',
    });
    const decision = focusedDecision('SANTEXWELL', context.sources, '检索花式纱分类');

    const evidence = await adapters().retriever.retrieve(request(context, decision, 1));

    expect(evidence).toEqual([expect.objectContaining({
      id: 'vault-key-facts-fragment',
      excerpt: expect.stringContaining('结子纱'),
    })]);
  });

  it('restricts session search to explicitly selected ready attachments and completes their locator', async () => {
    const conversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '附件问答',
    });
    seedSessionAttachment(database, conversation.id, {
      attachmentId: 'attachment-selected', sourceId: 'session-source-z', documentId: 'session-document-z',
      fragmentId: 'session-fragment-z', title: '选中附件', content: '附件包含花式纱分类答案。',
    });
    seedSessionAttachment(database, conversation.id, {
      attachmentId: 'attachment-not-selected', sourceId: 'session-source-a', documentId: 'session-document-a',
      fragmentId: 'session-fragment-a', title: '未选附件', content: '附件包含花式纱分类答案。',
    });
    const context = enqueueRun({
      database,
      conversationId: conversation.id,
      sources: sources({ sessionAttachments: true }),
      attachmentIds: ['attachment-selected'],
      text: '总结附件中的花式纱分类。',
    });
    const decision = focusedDecision('SESSION_ATTACHMENT', context.sources, '花式纱分类');

    const evidence = await adapters().retriever.retrieve(request(context, decision, 1));

    expect(evidence).toEqual([expect.objectContaining({
      id: 'session-fragment-z',
      source: 'SESSION_ATTACHMENT',
      locator: {
        kind: 'SESSION_ATTACHMENT',
        conversationId: conversation.id,
        attachmentId: 'attachment-selected',
        documentId: 'session-document-z',
        revision: 'session-revision-attachment-selected',
        fragmentId: 'session-fragment-z',
      },
    })]);
  });

  it('rejects a forged context that swaps in a ready attachment not persisted on the initiating message', async () => {
    const conversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '附件换绑',
    });
    seedSessionAttachment(database, conversation.id, {
      attachmentId: 'attachment-original', sourceId: 'session-source-original', documentId: 'session-document-original',
      fragmentId: 'session-fragment-original', title: '原附件', content: '原附件答案。',
    });
    seedSessionAttachment(database, conversation.id, {
      attachmentId: 'attachment-forged', sourceId: 'session-source-forged', documentId: 'session-document-forged',
      fragmentId: 'session-fragment-forged', title: '伪造附件', content: '伪造附件答案。',
    });
    const context = enqueueRun({
      database,
      conversationId: conversation.id,
      sources: sources({ sessionAttachments: true }),
      attachmentIds: ['attachment-original'],
      text: '总结原附件。',
    });
    const forged = { ...context, attachmentIds: ['attachment-forged'] };
    const decision = focusedDecision('SESSION_ATTACHMENT', context.sources, '附件答案');

    await expect(adapters().retriever.retrieve(request(forged, decision, 1)))
      .rejects.toThrow(/发起消息|附件.*变化|上下文/u);
  });

  it('returns a selected flow node first and expands only within the requested hop and candidate budgets', async () => {
    const flow = seedDraftFlow(database, threeNodeDocument());
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      selectedContext: { kind: 'FLOW_NODE', snapshotId: flow.snapshotId, nodeId: 'middle' },
      text: '解释当前审批节点。',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '完全不匹配的查询');

    const evidence = await adapters().retriever.retrieve({
      ...request(context, decision, 2),
      maxFlowHops: 1,
    });

    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      source: 'WORKSPACE_FLOW',
      locator: { kind: 'WORKSPACE_FLOW', snapshotId: flow.snapshotId, nodeId: 'middle' },
    });
    expect(['start', 'end']).toContain((evidence[1]!.locator as { nodeId: string }).nodeId);
    expect(Object.keys(evidence[0]!.locator).sort()).toEqual(['guideId', 'kind', 'nodeId', 'snapshotId']);
  });

  it('returns an image annotation when a flow overview also matches the question', async () => {
    const flow = seedDraftFlow(database, annotatedFlowDocument(), { title: '打样提案流程' });
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      text: '打样流程里应该怎么设置版类型？',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '查找打样流程中的版类型设置');

    const evidence = await adapters().retriever.retrieve(request(context, decision, 3));

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'WORKSPACE_FLOW',
        excerpt: expect.stringContaining('版类型'),
        locator: expect.objectContaining({ nodeId: 'annotated-image' }),
      }),
    ]));
    expect(flow.snapshotId).toBeTruthy();
  });

  it('returns structural context for an exact image annotation leaf', async () => {
    const flow = seedDraftFlow(database, annotatedFlowDocument(), { title: '打样提案流程' });
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      text: '打样流程里版类型应该怎么设置？',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '查找打样流程中的版类型设置');

    const evidence = await adapters().retriever.retrieve(request(context, decision, 3));

    expect(evidence[0]).toMatchObject({
      source: 'WORKSPACE_FLOW',
      excerpt: expect.stringContaining('版类型'),
      locator: expect.objectContaining({
        nodeId: 'annotated-image',
        annotationId: 'annotation-version-type',
      }),
    });
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ locator: expect.objectContaining({ nodeId: 'middle' }) }),
      expect.objectContaining({ excerpt: expect.stringContaining('流程结构索引') }),
    ]));
    expect(evidence.every((item) => (
      item.locator.kind !== 'WORKSPACE_FLOW' || item.locator.snapshotId === flow.snapshotId
    ))).toBe(true);
  });

  it('captures a bounded content-free trace for an exact image annotation retrieval', async () => {
    seedDraftFlow(database, annotatedFlowDocument(), { title: '打样提案流程' });
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      text: '打样流程里版类型应该怎么设置？',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '查找打样流程中的版类型设置');
    const adapter = adapters();

    adapter.retriever.resetTrace?.(context.runId);
    await adapter.retriever.retrieve(request(context, decision, 3));
    const trace = adapter.retriever.consumeTrace?.(context.runId);

    expect(trace?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ projection: 'IMAGE_ANNOTATION', rank: 1, selected: true }),
    ]));
    expect(trace?.closure).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'OVERVIEW' }),
      expect.objectContaining({ id: 'middle', kind: 'NODE' }),
    ]));
    expect(JSON.stringify(trace)).not.toContain(context.text);
    expect(JSON.stringify(trace)).not.toContain('我们内部用来做版本区分');
    expect(adapter.retriever.consumeTrace?.(context.runId)).toBeNull();
  });

  it('retrieves a later image annotation as its own leaf instead of relying on the image summary', async () => {
    seedDraftFlow(database, annotatedFlowDocument(), { title: '打样提案流程' });
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      text: '打样流程里希望日期及紧急度应该怎么填写？',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '查找希望日期及紧急度的填写说明');

    const evidence = await adapters().retriever.retrieve(request(context, decision, 3));

    expect(evidence[0]).toMatchObject({
      id: expect.stringMatching(/^flow-annotation-/),
      source: 'WORKSPACE_FLOW',
      excerpt: expect.stringContaining('希望日期及紧急度'),
      locator: expect.objectContaining({ nodeId: 'annotated-image' }),
    });
  });

  it('keeps an exact annotation hit within budget when the same guide has published history', async () => {
    const document = annotatedFlowDocument();
    const draft = seedDraftFlow(database, document, { guideId: 'guide-annotated-history', title: '打样提案流程' });
    seedAdditionalPublishedFlow(database, document, {
      guideId: draft.guideId,
      version: 1,
      versionId: 'version-annotated-history-1',
      title: '打样提案流程',
    });
    seedAdditionalPublishedFlow(database, document, {
      guideId: draft.guideId,
      version: 2,
      versionId: 'version-annotated-history-2',
      title: '打样提案流程',
    });
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      text: '打样流程里应该怎么设置版类型？',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '查找打样流程中的版类型设置');

    const evidence = await adapters().retriever.retrieve(request(context, decision, 3));

    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'WORKSPACE_FLOW',
        excerpt: expect.stringContaining('版类型'),
        locator: expect.objectContaining({ nodeId: 'annotated-image' }),
      }),
    ]));
  });

  it('does not expand a flow overview as if it were a real node', async () => {
    seedDraftFlow(database, annotatedFlowDocument(), { title: '打样提案流程' });
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      text: '打样流程是什么？',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '查看打样流程概览');

    const evidence = await adapters().retriever.retrieve(request(context, decision, 3));

    expect(evidence.some((item) => (
      item.locator.kind === 'WORKSPACE_FLOW' && item.locator.nodeId === 'middle'
    ))).toBe(false);
  });

  it('resolves and expands a selected flow node from a stored V1 snapshot', async () => {
    const document = threeNodeDocument();
    const flow = seedDraftFlow(database, document, { guideId: 'guide-legacy-v1' });
    replaceFlowSnapshotWithV1(database, flow.snapshotId, {
      snapshotId: flow.snapshotId,
      workspaceId: 'workspace-1',
      workspaceItemId: 'item-guide-legacy-v1',
      guideId: flow.guideId,
      title: '审批流程',
      summary: '审批流程摘要',
      tags: ['审批'],
      origin: { kind: 'DRAFT', revision: 0 },
      document,
    });
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      selectedContext: { kind: 'FLOW_NODE', snapshotId: flow.snapshotId, nodeId: 'middle' },
      text: '解释旧版审批节点。',
    });

    const evidence = await adapters().retriever.retrieve({
      ...request(context, focusedDecision('WORKSPACE_FLOW', context.sources, '旧版审批节点'), 2),
      maxFlowHops: 1,
    });

    expect(evidence[0]).toMatchObject({
      source: 'WORKSPACE_FLOW',
      locator: { kind: 'WORKSPACE_FLOW', snapshotId: flow.snapshotId, nodeId: 'middle' },
    });
    expect(evidence).toHaveLength(2);
  });

  it('fails closed when retrieval access is revoked or an internal locator conflicts with authoritative rows', async () => {
    const source = insertWorkspaceDocument({
      database,
      workspaceId: 'workspace-1',
      userId: 'owner-1',
      title: '审批规则',
      originalName: 'rules.md',
      mimeType: 'text/markdown',
      size: 20,
      storageKey: 'rules.md',
      checksum: 'rules-r1',
      text: '审批规则要求复核。',
    });
    const context = seedRun({
      database,
      sources: sources({ workspaceDocuments: true }),
      text: '审批规则是什么？',
    });
    const decision = focusedDecision('WORKSPACE_DOCUMENT', context.sources, '审批规则');
    database.prepare(
      `UPDATE knowledge_fragments SET internal_locator_json = ? WHERE document_id = ?`,
    ).run(JSON.stringify({
      kind: 'WORKSPACE_DOCUMENT', documentId: source.documentId,
      revision: 'forged-revision', fragmentId: 'forged-fragment',
    }), source.documentId);

    await expect(adapters().retriever.retrieve(request(context, decision, 1)))
      .rejects.toThrow(/locator|定位|冲突/u);

    database.prepare(
      `DELETE FROM workspace_members WHERE workspace_id = 'workspace-1' AND user_id = 'owner-1'`,
    ).run();
    await expect(adapters().retriever.retrieve(request(context, decision, 1)))
      .rejects.toThrow(/访问权限|授权/u);
  });

  it('rejects a route that broadens any source beyond the immutable request even when its current task is allowed', async () => {
    insertWorkspaceDocument({
      database,
      workspaceId: 'workspace-1',
      userId: 'owner-1',
      title: '审批规则',
      originalName: 'rules.md',
      mimeType: 'text/markdown',
      size: 20,
      storageKey: 'rules.md',
      checksum: 'rules-r1',
      text: '审批规则要求复核。',
    });
    const context = seedRun({
      database,
      sources: sources({ workspaceDocuments: true }),
      text: '审批规则是什么？',
    });
    const broadened = focusedDecision(
      'WORKSPACE_DOCUMENT',
      sources({ workspaceDocuments: true, santexwell: true }),
      '审批规则',
    );

    await expect(adapters().retriever.retrieve(request(context, broadened, 1)))
      .rejects.toThrow(/来源|未授权|扩大/u);
  });

  it('deterministically skips Vault only after focused hits or complete composite workspace coverage', async () => {
    const document = insertWorkspaceDocument({
      database,
      workspaceId: 'workspace-1',
      userId: 'owner-1',
      title: '审批资料',
      originalName: 'approval.md',
      mimeType: 'text/markdown',
      size: 20,
      storageKey: 'approval.md',
      checksum: 'approval-r1',
      text: '审批节点必须复核。',
    });
    const flow = seedDraftFlow(database, threeNodeDocument());
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true, workspaceDocuments: true, santexwell: true }),
      text: '检查审批流程和制度。',
    });
    const focused = focusedDecision('WORKSPACE_FLOW', context.sources, '审批节点');
    const flowEvidence = await adapters().retriever.retrieve(request(context, focused, 1));
    expect(await adapters().retriever.isWorkspaceEvidenceSufficient!({
      context, decision: focused, evidence: flowEvidence, signal: new AbortController().signal,
    })).toBe(true);

    const composite = compositeDecision(context.sources);
    expect(await adapters().retriever.isWorkspaceEvidenceSufficient!({
      context, decision: composite, evidence: flowEvidence, signal: new AbortController().signal,
    })).toBe(false);

    const documentContext = seedRun({
      database,
      sources: context.sources,
      selectedContext: { kind: 'KNOWLEDGE_FRAGMENT', documentId: document.documentId },
      text: '检查审批流程和制度。',
    });
    const documentTask = composite.tasks.find((task) => task.kind === 'WORKSPACE_DOCUMENT') as AgentRetrievalTask;
    const documentEvidence = await adapters().retriever.retrieve({
      context: documentContext,
      decision: composite,
      task: documentTask,
      maxCandidates: 1,
      maxFlowHops: 0,
      allowRaw: false,
      signal: new AbortController().signal,
    });
    expect(await adapters().retriever.isWorkspaceEvidenceSufficient!({
      context, decision: composite, evidence: [...flowEvidence, ...documentEvidence],
      signal: new AbortController().signal,
    })).toBe(true);
    expect(flow.snapshotId).toBeTruthy();
  });

  it('reauthorizes workspace evidence and rejects stale revisions before issuing an opaque reference', async () => {
    const source = insertWorkspaceDocument({
      database,
      workspaceId: 'workspace-1',
      userId: 'owner-1',
      title: '审批规则',
      originalName: 'rules.md',
      mimeType: 'text/markdown',
      size: 20,
      storageKey: 'rules.md',
      checksum: 'rules-r1',
      text: '审批规则要求复核。',
    });
    const context = seedRun({
      database,
      sources: sources({ workspaceDocuments: true }),
      text: '审批规则是什么？',
    });
    const decision = focusedDecision('WORKSPACE_DOCUMENT', context.sources, '审批规则');
    const [evidence] = await adapters().retriever.retrieve(request(context, decision, 1));

    await expect(adapters().evidenceResolver.resolveEvidence(context, evidence!)).resolves.toEqual({
      reference: { referenceId: 'reference-1', href: '/references/reference-1' },
      evidence,
    });

    database.prepare('UPDATE knowledge_documents SET revision = ? WHERE id = ?')
      .run('rules-r2', source.documentId);
    await expect(adapters().evidenceResolver.resolveEvidence(context, evidence!))
      .rejects.toThrow(/变化|revision|版本|locator/u);
  });

  it('rejects expired attachments and references from another conversation at resolution time', async () => {
    const conversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '附件问答',
    });
    seedSessionAttachment(database, conversation.id, {
      attachmentId: 'attachment-1', sourceId: 'session-source-1', documentId: 'session-document-1',
      fragmentId: 'session-fragment-1', title: '附件资料', content: '附件审批答案。',
    });
    const context = enqueueRun({
      database,
      conversationId: conversation.id,
      sources: sources({ sessionAttachments: true }),
      attachmentIds: ['attachment-1'],
      text: '附件审批答案是什么？',
    });
    const decision = focusedDecision('SESSION_ATTACHMENT', context.sources, '附件审批答案');
    const [evidence] = await adapters().retriever.retrieve(request(context, decision, 1));

    database.prepare(
      `UPDATE conversation_attachments SET expires_at = '2026-07-15T01:00:00.000Z'
       WHERE id = 'attachment-1'`,
    ).run();
    await expect(adapters().evidenceResolver.resolveEvidence(context, evidence!))
      .rejects.toThrow(/附件|过期|失效/u);

    const otherConversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '另一个会话',
    });
    const forgedContext = { ...context, conversationId: otherConversation.id };
    await expect(adapters().evidenceResolver.resolveEvidence(forgedContext, evidence!))
      .rejects.toThrow(/会话|上下文/u);
  });

  it('validates current draft flow revision and exact feedback locator on every resolution', async () => {
    const flow = seedDraftFlow(database, threeNodeDocument());
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      selectedContext: { kind: 'FLOW_NODE', snapshotId: flow.snapshotId, nodeId: 'middle' },
      text: '检查当前审批节点。',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '审批节点');
    const [evidence] = await adapters().retriever.retrieve(request(context, decision, 1));
    const locator = evidence!.locator;
    if (locator.kind !== 'WORKSPACE_FLOW') throw new Error('expected flow evidence');

    await expect(adapters().evidenceResolver.resolveFlowFeedback(context, {
      kind: 'IMPROVEMENT', message: '建议补充复核人。',
      locator: { guideId: locator.guideId, snapshotId: locator.snapshotId, nodeId: locator.nodeId },
    }, evidence!)).resolves.toMatchObject({
      reference: { referenceId: 'reference-1', href: '/references/reference-1' },
    });
    await expect(adapters().evidenceResolver.resolveFlowFeedback(context, {
      kind: 'GAP', message: '伪造节点。',
      locator: { guideId: locator.guideId, snapshotId: locator.snapshotId, nodeId: 'missing-node' },
    }, evidence!)).rejects.toThrow(/locator|节点|匹配/u);

    database.prepare(`UPDATE guides SET revision = revision + 1 WHERE id = ?`).run(flow.guideId);
    await expect(adapters().evidenceResolver.resolveEvidence(context, evidence!))
      .rejects.toThrow(/草稿|revision|版本|变化/u);
  });

  it('rejects flow evidence when its indexed document revision no longer matches the snapshot origin', async () => {
    const flow = seedDraftFlow(database, threeNodeDocument());
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      selectedContext: { kind: 'FLOW_NODE', snapshotId: flow.snapshotId, nodeId: 'middle' },
      text: '检查当前审批节点。',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '审批节点');
    const [evidence] = await adapters().retriever.retrieve(request(context, decision, 1));
    database.prepare(
      `UPDATE knowledge_documents SET revision = 'forged-flow-revision'
       WHERE flow_snapshot_id = ?`,
    ).run(flow.snapshotId);

    await expect(adapters().evidenceResolver.resolveEvidence(context, evidence!))
      .rejects.toThrow(/流程.*revision|版本|变化/u);
  });

  it('keeps an immutable published flow reference valid after the draft advances', async () => {
    const flow = seedPublishedFlow(database, threeNodeDocument());
    const context = seedRun({
      database,
      sources: sources({ workspaceFlows: true }),
      selectedContext: { kind: 'FLOW_NODE', snapshotId: flow.snapshotId, nodeId: 'middle' },
      text: '检查已发布审批节点。',
    });
    const decision = focusedDecision('WORKSPACE_FLOW', context.sources, '审批节点');
    const [evidence] = await adapters().retriever.retrieve(request(context, decision, 1));

    database.prepare(`UPDATE guides SET revision = revision + 1 WHERE id = ?`).run(flow.guideId);

    await expect(adapters().evidenceResolver.resolveEvidence(context, evidence!)).resolves.toMatchObject({
      reference: { href: '/references/reference-1' },
    });
  });

  it('supports a global Vault-only context and honors cancellation and candidate budgets', async () => {
    seedSantexwell(database, {
      documentId: 'global-vault-document',
      fragmentId: 'global-vault-fragment',
      relativePath: 'wiki_v2/concepts/global.md',
      title: '全局花式纱',
      content: '全局知识库答案。',
    });
    const context = seedGlobalRun(database, '全局知识库答案是什么？', {
      kind: 'KNOWLEDGE_FRAGMENT',
      documentId: 'global-vault-document',
      fragmentId: 'global-vault-fragment',
    });
    const decision = focusedDecision('SANTEXWELL', context.sources, '全局知识库答案');
    const [evidence] = await adapters().retriever.retrieve(request(context, decision, 1));
    expect(evidence).toMatchObject({ source: 'SANTEXWELL' });

    await expect(adapters().retriever.retrieve(request(context, decision, 3)))
      .rejects.toThrow(/预算/u);
    const controller = new AbortController();
    controller.abort(new Error('test-cancelled'));
    await expect(adapters().retriever.retrieve({
      ...request(context, decision, 1), signal: controller.signal,
    })).rejects.toThrow(/test-cancelled/u);
  });

  function adapters() {
    return createDatabaseAgentKnowledgeAdapters({
      database,
      now: () => NOW,
      createReferenceId: () => `reference-${++referenceSequence}`,
    });
  }
});

function sources(overrides: Partial<SourceOptionsV1> = {}): SourceOptionsV1 {
  return {
    workspaceFlows: false,
    workspaceDocuments: false,
    sessionAttachments: false,
    santexwell: false,
    ...overrides,
  };
}

function seedRun(input: {
  database: DatabaseSync;
  sources: SourceOptionsV1;
  text: string;
  selectedContext?: AgentRunExecutionContext['selectedContext'];
}): AgentRunExecutionContext {
  const conversation = createConversation(input.database, {
    scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: input.text,
  });
  return enqueueRun({
    ...input,
    conversationId: conversation.id,
    attachmentIds: [],
  });
}

function enqueueRun(input: {
  database: DatabaseSync;
  conversationId: string;
  sources: SourceOptionsV1;
  text: string;
  selectedContext?: AgentRunExecutionContext['selectedContext'];
  attachmentIds: string[];
}): AgentRunExecutionContext {
  const queued = enqueueConversationRun(input.database, {
    conversationId: input.conversationId,
    ownerId: 'owner-1',
    request: {
      clientMessageId: `client-${input.conversationId}`,
      text: input.text,
      sources: input.sources,
      ...(input.selectedContext ? { selectedContext: input.selectedContext } : {}),
      attachmentIds: input.attachmentIds,
    },
  });
  return loadAgentRunExecutionContext(input.database, queued.accepted.run.id, NOW);
}

function seedGlobalRun(
  database: DatabaseSync,
  text: string,
  selectedContext?: AgentRunExecutionContext['selectedContext'],
): AgentRunExecutionContext {
  const conversation = createConversation(database, {
    scope: 'GLOBAL_SANTEXWELL', workspaceId: null, ownerId: 'owner-1', title: text,
  });
  const queued = enqueueConversationRun(database, {
    conversationId: conversation.id,
    ownerId: 'owner-1',
    request: {
      clientMessageId: `client-${conversation.id}`,
      text,
      sources: sources({ santexwell: true }),
      ...(selectedContext ? { selectedContext } : {}),
      attachmentIds: [],
    },
  });
  return loadAgentRunExecutionContext(database, queued.accepted.run.id, NOW);
}

function focusedDecision(
  kind: AgentRetrievalTask['kind'],
  enabledSources: SourceOptionsV1,
  objective: string,
): RouteDecisionV1 {
  return RouteDecisionV1Schema.parse({
    intent: objective,
    complexity: {
      scopeBreadth: 1, evidenceDepth: 1, crossSourceNeed: 1, decompositionNeed: 1, ambiguity: 1,
    },
    contextAssessment: '聚焦检索一个来源。',
    route: 'FOCUSED',
    sources: enabledSources,
    tasks: [{ id: `task-${kind.toLowerCase()}`, kind, objective, dependsOn: [], priority: 1 }],
    budget: {
      maxWorkers: 1,
      maxConcurrency: 1,
      maxWorkspaceCandidates: kind === 'SANTEXWELL' ? 0 : 3,
      maxFlowHops: kind === 'WORKSPACE_FLOW' ? 2 : 0,
      maxVaultClusters: kind === 'SANTEXWELL' ? 1 : 0,
      maxVaultDigests: kind === 'SANTEXWELL' ? 2 : 0,
      allowRaw: false,
      useReducer: false,
    },
    executionMode: 'SEQUENTIAL',
    maxConcurrency: 1,
    stopConditions: ['找到聚焦答案或确认没有证据。'],
    confidence: 0.9,
    userFacingPlan: '检查最相关的已授权资料。',
  });
}

function compositeDecision(enabledSources: SourceOptionsV1): RouteDecisionV1 {
  return RouteDecisionV1Schema.parse({
    intent: '检查流程、资料，并在必要时补充 Vault。',
    complexity: {
      scopeBreadth: 3, evidenceDepth: 3, crossSourceNeed: 3, decompositionNeed: 3, ambiguity: 2,
    },
    contextAssessment: '需要覆盖两个工作区来源。',
    route: 'COMPOSITE',
    sources: enabledSources,
    tasks: [
      { id: 'task-flow', kind: 'WORKSPACE_FLOW', objective: '检查审批流程', dependsOn: [], priority: 1 },
      { id: 'task-document', kind: 'WORKSPACE_DOCUMENT', objective: '检查审批资料', dependsOn: [], priority: 1 },
      { id: 'task-vault', kind: 'SANTEXWELL', objective: '必要时补充知识库', dependsOn: [], priority: 2 },
      { id: 'task-reduce', kind: 'REDUCE', objective: '汇总', dependsOn: ['task-flow', 'task-document', 'task-vault'], priority: 3 },
    ],
    budget: {
      maxWorkers: 3,
      maxConcurrency: 3,
      maxWorkspaceCandidates: 12,
      maxFlowHops: 2,
      maxVaultClusters: 1,
      maxVaultDigests: 2,
      allowRaw: false,
      useReducer: true,
    },
    executionMode: 'PARALLEL',
    maxConcurrency: 3,
    stopConditions: ['覆盖全部工作区来源。'],
    confidence: 0.8,
    userFacingPlan: '并行检查流程和资料。',
  });
}

function request(
  context: AgentRunExecutionContext,
  decision: RouteDecisionV1,
  maxCandidates: number,
): AgentRetrievalRequest {
  const task = decision.tasks.find((item) => item.kind !== 'REDUCE') as AgentRetrievalTask;
  return {
    context,
    decision,
    task,
    maxCandidates,
    maxFlowHops: task.kind === 'WORKSPACE_FLOW' ? decision.budget.maxFlowHops : 0,
    allowRaw: false,
    signal: new AbortController().signal,
  };
}

function seedUser(database: DatabaseSync, id: string): void {
  database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, 'not-used', ?, 'AUTHOR', ?)`,
  ).run(id, `${id}@guide.local`, id, CREATED_AT);
}

function seedWorkspace(
  database: DatabaseSync,
  id: string,
  ownerId: string,
  kind: 'BUSINESS_TEAM' | 'FINANCE' | 'TECHNICAL' | 'FOLLOW_UP' | 'PRODUCTION' = 'BUSINESS_TEAM',
  name = '测试工作区',
): void {
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, kind, owner_id, created_at, updated_at
    ) VALUES (?, ?, ?, '', 'SquaresFour', 'general', ?, ?, ?, ?)`,
  ).run(id, id, name, kind, ownerId, CREATED_AT, CREATED_AT);
  database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES (?, ?, 'OWNER', ?)`,
  ).run(id, ownerId, CREATED_AT);
}

function seedSantexwell(database: DatabaseSync, input: {
  documentId: string;
  fragmentId: string;
  relativePath: string;
  title: string;
  content: string;
}): void {
  database.prepare(
    `INSERT INTO knowledge_sources (
      id, scope, kind, workspace_id, conversation_id, created_by,
      status, revision, config_json, created_at, updated_at
    ) VALUES ('source-santexwell-vault', 'GLOBAL', 'SANTEXWELL_VAULT', NULL, NULL, NULL,
      'READY', 'vault-generation-1', '{}', ?, ?)`,
  ).run(CREATED_AT, CREATED_AT);
  database.prepare(
    `INSERT INTO knowledge_documents (
      id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
      parse_status, metadata_json, created_at, updated_at
    ) VALUES (?, 'source-santexwell-vault', NULL, ?, ?, 'vault-checksum',
      'vault-document-revision', 'READY', ?, ?, ?)`,
  ).run(input.documentId, input.relativePath, input.title, JSON.stringify({
    sourceKind: 'SANTEXWELL',
    pageType: 'concept',
    status: 'active',
    reviewState: 'approved',
    evidenceStatus: 'sourced',
    rawEvidenceAvailable: false,
  }), CREATED_AT, CREATED_AT);
  database.prepare(
    `INSERT INTO knowledge_fragments (
      id, document_id, ordinal, title, heading, content, search_text,
      internal_locator_json, created_at, updated_at
    ) VALUES (?, ?, 0, ?, '分类', ?, ?, ?, ?, ?)`,
  ).run(
    input.fragmentId,
    input.documentId,
    input.title,
    input.content,
    `${input.title} ${input.content}`,
    JSON.stringify({
      kind: 'SANTEXWELL',
      documentId: input.documentId,
      revision: 'vault-document-revision',
      fragmentId: input.fragmentId,
      heading: '分类',
    }),
    CREATED_AT,
    CREATED_AT,
  );
}

function seedSessionAttachment(database: DatabaseSync, conversationId: string, input: {
  attachmentId: string;
  sourceId: string;
  documentId: string;
  fragmentId: string;
  title: string;
  content: string;
}): void {
  const revision = `session-revision-${input.attachmentId}`;
  database.prepare(
    `INSERT INTO knowledge_sources (
      id, scope, kind, workspace_id, conversation_id, created_by,
      status, revision, config_json, created_at, updated_at
    ) VALUES (?, 'SESSION', 'SESSION_ATTACHMENT', NULL, ?, 'owner-1',
      'READY', ?, '{}', ?, ?)`,
  ).run(input.sourceId, conversationId, revision, CREATED_AT, CREATED_AT);
  database.prepare(
    `INSERT INTO knowledge_documents (
      id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
      parse_status, metadata_json, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'READY', ?, ?, ?)`,
  ).run(
    input.documentId,
    input.sourceId,
    `attachments/${input.attachmentId}.md`,
    input.title,
    revision,
    revision,
    JSON.stringify({ sourceKind: 'SESSION_ATTACHMENT', rawEvidenceAvailable: false }),
    CREATED_AT,
    CREATED_AT,
  );
  database.prepare(
    `INSERT INTO knowledge_fragments (
      id, document_id, ordinal, title, heading, content, search_text,
      internal_locator_json, created_at, updated_at
    ) VALUES (?, ?, 0, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    input.fragmentId,
    input.documentId,
    input.title,
    input.content,
    `${input.title} ${input.content}`,
    JSON.stringify({
      kind: 'SESSION_ATTACHMENT',
      documentId: input.documentId,
      revision,
      fragmentId: input.fragmentId,
    }),
    CREATED_AT,
    CREATED_AT,
  );
  database.prepare(
    `INSERT INTO conversation_attachments (
      id, conversation_id, owner_id, source_id, original_name, mime_type, size,
      storage_key, status, expires_at, created_at, updated_at
    ) VALUES (?, ?, 'owner-1', ?, ?, 'text/markdown', 20, ?, 'READY', ?, ?, ?)`,
  ).run(
    input.attachmentId,
    conversationId,
    input.sourceId,
    `${input.title}.md`,
    `session/${input.attachmentId}.md`,
    '2026-07-16T00:00:00.000Z',
    CREATED_AT,
    CREATED_AT,
  );
}

function seedDraftFlow(database: DatabaseSync, document: CanvasDocument, options: FlowSeedOptions = {}) {
  const guideId = options.guideId ?? 'guide-draft';
  const workspaceId = options.workspaceId ?? 'workspace-1';
  const ownerId = options.ownerId ?? 'owner-1';
  const title = options.title ?? '审批流程';
  seedGuide(database, guideId, document, { workspaceId, ownerId, title });
  const snapshot = syncGuideFlowSnapshot(database, {
    workspaceId,
    workspaceItemId: `item-${guideId}`,
    guideId,
    ownerId,
    title,
    summary: '审批流程摘要',
    tags: ['审批'],
    origin: { kind: 'DRAFT', revision: 0 },
    document,
  });
  return { guideId, snapshotId: snapshot.snapshotId };
}

function seedPublishedFlow(database: DatabaseSync, document: CanvasDocument, options: FlowSeedOptions = {}) {
  const guideId = options.guideId ?? 'guide-published';
  const workspaceId = options.workspaceId ?? 'workspace-1';
  const ownerId = options.ownerId ?? 'owner-1';
  const title = options.title ?? '审批流程';
  seedGuide(database, guideId, document, { workspaceId, ownerId, title });
  const versionId = `version-${guideId}`;
  database.prepare(
    `INSERT INTO guide_versions (
      id, guide_id, version, title, summary, tags_json, document_json,
      search_text, published_by, published_at
    ) VALUES (?, ?, 1, ?, '审批流程摘要', '["审批"]', ?, '审批', ?, ?)`,
  ).run(versionId, guideId, title, JSON.stringify(document), ownerId, CREATED_AT);
  const snapshot = syncGuideFlowSnapshot(database, {
    workspaceId,
    workspaceItemId: `item-${guideId}`,
    guideId,
    ownerId,
    title,
    summary: '审批流程摘要',
    tags: ['审批'],
    origin: { kind: 'PUBLISHED', versionId, version: 1 },
    document,
  });
  return { guideId, snapshotId: snapshot.snapshotId, versionId };
}

function seedAdditionalPublishedFlow(
  database: DatabaseSync,
  document: CanvasDocument,
  input: { guideId: string; version: number; versionId: string; title: string },
): void {
  database.prepare(
    `INSERT INTO guide_versions (
      id, guide_id, version, title, summary, tags_json, document_json,
      search_text, published_by, published_at
    ) VALUES (?, ?, ?, ?, '审批流程摘要', '["审批"]', ?, '打样 版类型', ?, ?)`,
  ).run(
    input.versionId,
    input.guideId,
    input.version,
    input.title,
    JSON.stringify(document),
    'owner-1',
    CREATED_AT,
  );
  syncGuideFlowSnapshot(database, {
    workspaceId: 'workspace-1',
    workspaceItemId: `item-${input.guideId}`,
    guideId: input.guideId,
    ownerId: 'owner-1',
    title: input.title,
    summary: '审批流程摘要',
    tags: ['审批'],
    origin: { kind: 'PUBLISHED', versionId: input.versionId, version: input.version },
    document,
  });
}

function replaceFlowSnapshotWithV1(
  database: DatabaseSync,
  snapshotId: string,
  input: Parameters<typeof compileFlowKnowledgeSnapshotV1>[0],
): void {
  const legacy = compileFlowKnowledgeSnapshotV1(input);
  database.exec('DROP TRIGGER flow_knowledge_snapshots_immutable');
  database.prepare('UPDATE flow_knowledge_snapshots SET snapshot_json = ? WHERE id = ?')
    .run(JSON.stringify(legacy), snapshotId);
}

interface FlowSeedOptions {
  guideId?: string;
  workspaceId?: string;
  ownerId?: string;
  title?: string;
}

function seedGuide(
  database: DatabaseSync,
  guideId: string,
  document: CanvasDocument,
  options: Required<Omit<FlowSeedOptions, 'guideId'>>,
): void {
  database.prepare(
    `INSERT INTO guides (
      id, owner_id, title, summary, tags_json, status, visibility, revision,
      draft_document, created_at, updated_at
    ) VALUES (?, ?, ?, '审批流程摘要', '["审批"]', 'DRAFT', 'INTERNAL', 0, ?, ?, ?)`,
  ).run(guideId, options.ownerId, options.title, JSON.stringify(document), CREATED_AT, CREATED_AT);
  database.prepare(
    `INSERT INTO workspace_items (
      id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
    ) VALUES (?, ?, 'GUIDE', ?, ?, '', ?, ?, ?)`,
  ).run(`item-${guideId}`, options.workspaceId, guideId, options.title, options.ownerId, CREATED_AT, CREATED_AT);
}

function threeNodeDocument(): CanvasDocument {
  return flowDocument('审批复核');
}

function annotatedFlowDocument(): CanvasDocument {
  const document = flowDocument('确认原料');
  document.nodes.push({
    id: 'annotated-image',
    type: 'image',
    position: { x: 720, y: 0 },
    zIndex: 3,
    attachment: { ownerNodeId: 'middle', order: 0 },
    data: {
      url: 'https://example.com/erp.png',
      alt: 'ERP 操作界面截图',
      caption: '进入ERP系统-> 打样系统-> 样板单界面',
      annotations: [{
        id: 'annotation-version-type',
        order: 0,
        title: '版类型',
        body: '我们内部用来做版本区分及技术部绩效管理的专用字段。客人有时候哪怕不换款号，我们也需要重新做一个初样，并用不同款号进行标注。初样代表对于技术部来说是一个全新的版子，一般发生于客人修改原料、修改款式、修改组织、全身加丝等情况。修改样是在已有的版子上进行修改，属于局部的改动，例如改动附件。大货样用于客人已经确认样衣并准备下大货时，不管是否在工厂制作，都可以要求技术部按照样衣推全码。这个字段还需要结合用途判断客人的真实需求，修改样时提出全身加丝时版类型应为初样，版用途应为修改样。',
        shape: 'POINT',
        region: { x: 0.4, y: 0.25 },
      }, {
        id: 'annotation-delivery-date',
        order: 7,
        title: '希望日期及紧急度',
        body: '希望日期应按客户确认的交样时间填写；如需加急，需同步确认物料与工序的可交付时间。',
        shape: 'POINT',
        region: { x: 0.6, y: 0.72 },
      }],
    },
  });
  return document;
}

function flowDocument(middleLabel: string): CanvasDocument {
  const document: CanvasDocument = {
    schemaVersion: 1,
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
      { id: 'middle', type: 'process', position: { x: 240, y: 0 }, zIndex: 1, data: { label: middleLabel, shape: 'process' } },
      { id: 'end', type: 'end', position: { x: 480, y: 0 }, zIndex: 2, data: { label: '结束', shape: 'end' } },
    ],
    edges: [
      { id: 'edge-start-middle', source: 'start', target: 'middle' },
      { id: 'edge-middle-end', source: 'middle', target: 'end' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [
      { id: 'step-start', order: 0, title: '开始', nodeId: 'start' },
      { id: 'step-middle', order: 1, title: middleLabel, nodeId: 'middle' },
      { id: 'step-end', order: 2, title: '结束', nodeId: 'end' },
    ],
    entryNodeId: 'start',
    exitNodeIds: ['end'],
  };
  return document;
}

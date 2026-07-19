import type {
  BridgeEventV1,
  BridgeRunRequestV1,
  FlowKnowledgeSnapshotV2,
  GuideDigestDraftV1,
} from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import {
  GUIDE_DIGEST_BUNDLE,
  GuideDigestInputTooLargeError,
  assertGuideDigestRuntimeRequestBudget,
  buildGuideDigestPrompt,
  buildGuideDigestValidationRepairNote,
} from '../agents/bundles/guide-digest';
import type { AgentRuntimeClient } from '../agents/runtime-client';
import { syncGuideFlowSnapshot } from '../knowledge/flow-indexer';
import { addTestWorkspaceMember, sampleDocument, seedTestWorkspace } from '../../test/test-app';
import { addCollaborator, createGuide, getGuide, updateGuide } from './repository';
import {
  createGuideDigestProposal,
  getGuideDigestProposal,
  listGuideDigestAuditEvents,
  listGuideDigestProposals,
  regenerateGuideDigestProposal,
} from './digest-repository';
import { buildGuideDigestSnapshotDiff } from './digest-continuity';
import { DIGEST_RENDERER_VERSION } from './digest-renderer';
import { GuideDigestService } from './digest-service';

describe('GuideDigestService access and snapshot gates', () => {
  let database: DatabaseSync;
  let runtime: RecordingRuntime;
  let service: GuideDigestService;
  let guideId: string;

  const owner = { id: 'digest-owner', role: 'AUTHOR' };
  const collaborator = { id: 'digest-collaborator', role: 'EDITOR' };
  const workspaceEditor = { id: 'digest-workspace-editor', role: 'EDITOR' };
  const outsider = { id: 'digest-outsider', role: 'AUTHOR' };

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedUsers(database);
    seedTestWorkspace(database, owner.id, {
      id: 'digest-workspace', slug: 'digest-workspace', name: '摘要工作区',
    });
    addTestWorkspaceMember(database, 'digest-workspace', workspaceEditor.id, 'EDIT');

    const created = createGuide(database, owner.id, 'digest-workspace', {
      title: '订单审批流程', summary: '现有摘要', tags: ['订单'],
    });
    const guide = updateGuide(database, created.id, owner.id, 0, {
      document: sampleDocument('# 订单审批\n提交订单并完成审批。'),
    });
    guideId = guide.id;
    addCollaborator(database, guideId, owner.id, collaborator.id);
    syncGuideFlowSnapshot(database, flowContext(guide));

    runtime = new RecordingRuntime();
    service = new GuideDigestService(database, runtime);
  });

  afterEach(() => database.close());

  it('allows the guide owner and collaborator to read current READY V2 snapshot metadata', () => {
    const ownerStatus = service.getFlowSnapshotStatus(owner, guideId);
    const collaboratorStatus = service.getFlowSnapshotStatus(collaborator, guideId);

    expect(ownerStatus).toEqual({
      guideRevision: 1,
      sourceStatus: 'READY',
      snapshotId: expect.any(String),
      snapshotRevision: 1,
      snapshotSchemaVersion: 2,
      failureCode: null,
    });
    expect(collaboratorStatus).toEqual(ownerStatus);
  });

  it('returns 403 to a metadata-visible workspace editor and 404 to a hidden user', () => {
    expect(() => service.getFlowSnapshotStatus(workspaceEditor, guideId)).toThrow(expect.objectContaining({
      statusCode: 403, code: 'FORBIDDEN',
    }));
    expect(() => service.getFlowSnapshotStatus(outsider, guideId)).toThrow(expect.objectContaining({
      statusCode: 404, code: 'GUIDE_NOT_FOUND',
    }));
  });

  it('blocks generation before runtime when the current snapshot is missing', async () => {
    database.prepare('DELETE FROM flow_knowledge_snapshots WHERE guide_id = ?').run(guideId);

    await expect(service.createProposal(owner, guideId, {})).rejects.toMatchObject({
      statusCode: 409, code: 'FLOW_SNAPSHOT_NOT_READY',
    });
    expect(runtime.requests).toHaveLength(0);
  });

  it('blocks generation before runtime when the flow source failed', async () => {
    database.prepare(
      `UPDATE knowledge_sources
       SET status = 'FAILED', config_json = json_set(config_json, '$.lastFailureCode', 'FLOW_COMPILE_FAILED')
       WHERE kind = 'WORKSPACE_FLOW'`,
    ).run();

    await expect(service.createProposal(owner, guideId, {})).rejects.toMatchObject({
      statusCode: 409, code: 'FLOW_SNAPSHOT_NOT_READY',
    });
    expect(service.getFlowSnapshotStatus(owner, guideId)).toMatchObject({
      sourceStatus: 'FAILED', failureCode: 'FLOW_COMPILE_FAILED',
    });
    expect(runtime.requests).toHaveLength(0);

    expect(service.reconcileFlowSnapshot(owner, guideId)).toMatchObject({
      sourceStatus: 'READY', failureCode: null,
      guideRevision: 1, snapshotRevision: 1, snapshotSchemaVersion: 2,
    });
    expect(runtime.requests).toHaveLength(0);
  });

  it('blocks generation before runtime when the READY snapshot revision is stale', async () => {
    updateGuide(database, guideId, owner.id, 1, { summary: '人工更新后的摘要' });

    await expect(service.createProposal(owner, guideId, {})).rejects.toMatchObject({
      statusCode: 409, code: 'FLOW_SNAPSHOT_NOT_READY',
    });
    expect(service.getFlowSnapshotStatus(owner, guideId)).toMatchObject({
      guideRevision: 2, sourceStatus: 'READY', snapshotRevision: 1,
    });
    expect(runtime.requests).toHaveLength(0);
  });

  it.each([
    ['duplicate annotations across resources', duplicateAnnotationIds],
    ['duplicate keypoints across resources', duplicateKeypointIds],
    ['an ID reused across source kinds', duplicateCrossKindId],
  ])('blocks generation before runtime for %s', async (_label, mutate) => {
    mutatePersistedSnapshot(database, guideId, mutate);

    await expect(service.createProposal(owner, guideId, {})).rejects.toMatchObject({
      statusCode: 409, code: 'FLOW_SNAPSHOT_NOT_READY',
    });
    expect(runtime.requests).toHaveLength(0);
  });

  it('uses source READY state without confusing its latest-origin revision with draft readiness', async () => {
    database.prepare(
      `UPDATE knowledge_sources SET revision = 'published-version-one'
       WHERE kind = 'WORKSPACE_FLOW'`,
    ).run();
    runtime.enqueueDigest(digest());

    const generated = await service.createProposal(owner, guideId, {});

    expect(generated.proposal).toMatchObject({ status: 'DRAFT', baseRevision: 1 });
    expect(runtime.requests).toHaveLength(1);
  });

  it('reconciles the current draft deterministically without invoking runtime', () => {
    database.prepare('DELETE FROM flow_knowledge_snapshots WHERE guide_id = ?').run(guideId);

    const status = service.reconcileFlowSnapshot(collaborator, guideId);

    expect(status).toEqual({
      guideRevision: 1,
      sourceStatus: 'READY',
      snapshotId: expect.any(String),
      snapshotRevision: 1,
      snapshotSchemaVersion: 2,
      failureCode: null,
    });
    expect(runtime.requests).toHaveLength(0);
  });

  it('generates once for a collaborator and idempotently reuses the current DRAFT for the owner', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '基于当前快照的结构化摘要' }));

    const generated = await service.createProposal(collaborator, guideId, {});
    const reused = await service.createProposal(owner, guideId, {});

    expect(generated).toMatchObject({ created: true, proposal: {
      status: 'DRAFT', baseRevision: 1, bundleRevision: GUIDE_DIGEST_BUNDLE.revision,
      draft: { shortSummary: '基于当前快照的结构化摘要' },
      markdown: expect.stringContaining('## 流程摘要'),
    } });
    expect(reused).toEqual({ created: false, proposal: generated.proposal });
    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]).toMatchObject({
      type: 'RUN', planVersion: GUIDE_DIGEST_BUNDLE.revision, role: 'FOCUSED_WORKER',
      reasoningEffort: 'MEDIUM', outputKind: 'GUIDE_DIGEST', allowedRoots: [],
    });
    expect(runtime.requests[0]!.prompt).toContain('"schemaVersion":2');
  });

  it('preserves unchanged tag suggestions through a direct revision diff and one continuity repair', async () => {
    const sourceId = snapshotSourceId(database, guideId);
    const initialTags = [
      { label: '原料', category: 'OBJECT' as const, sourceIds: [sourceId] },
      { label: '打样', category: 'PROCESS' as const, sourceIds: [sourceId] },
    ];
    runtime.enqueueDigest(digest({ shortSummary: '第一版连续摘要', tagSuggestions: initialTags }));
    const first = (await service.createProposal(owner, guideId, {})).proposal;
    service.applyProposal(owner, guideId, first.id, {
      applySummary: false,
      acceptedTagLabels: ['原料', '打样'],
      acceptMarkdown: false,
    });

    runtime.enqueueDigest(digest({
      shortSummary: '不稳定摘要',
      tagSuggestions: [{ label: '无变化依据的新标签', category: 'RISK', sourceIds: [sourceId] }],
    }));
    runtime.enqueueDigest(digest({ shortSummary: '稳定摘要', tagSuggestions: [] }));
    const second = await service.createProposal(owner, guideId, {});

    const secondEnvelope = promptEnvelope(runtime.requests[1]!.prompt);
    expect(secondEnvelope).toMatchObject({
      continuity: {
        baselineProposalId: first.id,
        baselineRevision: first.baseRevision,
        previousDigest: { tagSuggestions: initialTags },
        snapshotDiff: {
          fromRevision: first.baseRevision,
          toRevision: first.baseRevision + 1,
          affectedSourceIds: [],
        },
      },
      snapshot: { tags: ['订单', '原料', '打样'] },
    });
    expect(runtime.requests[2]!.prompt).toContain('缺乏变化证据');
    expect(promptEnvelope(runtime.requests[2]!.prompt).continuity).toEqual(secondEnvelope.continuity);
    expect(second.proposal).toMatchObject({
      status: 'DRAFT',
      draft: { shortSummary: '稳定摘要', tagSuggestions: [] },
      generationMetadata: {
        continuityMode: 'RESIDUAL_CONTEXT',
        baselineProposalId: first.id,
        baselineRevision: first.baseRevision,
        changedSourceCount: 0,
        attemptCount: 2,
        repairAttempted: true,
      },
    });
    expect(listGuideDigestProposals(database, guideId).filter(({ status }) => status === 'DRAFT'))
      .toEqual([second.proposal]);
    const persistedMetadata = JSON.stringify(second.proposal.generationMetadata);
    expect(persistedMetadata).not.toContain('第一版连续摘要');
    expect(persistedMetadata).not.toContain('snapshotDiff');
    expect(persistedMetadata).not.toContain('previousDigest');
    expect(persistedMetadata).not.toContain(runtime.requests[1]!.requestId);
  });

  it('skips a latest REJECTED proposal and uses the earlier trusted proposal', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '可信基线摘要' }));
    const trusted = (await service.createProposal(owner, guideId, {})).proposal;
    const rejected = createGuideDigestProposal(database, {
      ...currentProposalIdentity(database, guideId),
      bundleRevision: GUIDE_DIGEST_BUNDLE.revision + 1,
      draft: digest({ shortSummary: '不可信拒绝摘要' }),
      markdown: '# 不可信拒绝摘要',
      createdBy: owner.id,
    });
    service.rejectProposal(owner, guideId, rejected.id);
    advanceGuide(database, guideId, owner.id, { summary: '第二版人工摘要' });
    runtime.enqueueDigest(digest({ shortSummary: '基于可信基线' }));

    await service.createProposal(owner, guideId, {});

    expect(promptEnvelope(runtime.requests[1]!.prompt).continuity).toMatchObject({
      baselineProposalId: trusted.id,
      baselineRevision: trusted.baseRevision,
      previousDigest: { shortSummary: '可信基线摘要' },
    });
    expect(runtime.requests[1]!.prompt).not.toContain('不可信拒绝摘要');
  });

  it('uses a STALE proposal as the direct baseline across multiple revision endpoints', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '跨版本基线摘要' }));
    const baseline = (await service.createProposal(owner, guideId, {})).proposal;
    advanceGuide(database, guideId, owner.id, { summary: '第二版人工摘要' });
    expect(() => service.applyProposal(owner, guideId, baseline.id, {
      applySummary: true, acceptedTagLabels: [], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({ code: 'GUIDE_DIGEST_PROPOSAL_STALE' }));
    advanceGuide(database, guideId, owner.id, { summary: '第三版人工摘要' });
    runtime.enqueueDigest(digest({ shortSummary: '跨版本连续摘要' }));

    await service.createProposal(owner, guideId, {});

    expect(promptEnvelope(runtime.requests[1]!.prompt).continuity).toMatchObject({
      baselineProposalId: baseline.id,
      baselineRevision: 1,
      snapshotDiff: { fromRevision: 1, toRevision: 3 },
    });
  });

  it('rejects a valid late residual result when its historical DRAFT baseline is rejected during runtime', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '旧 revision 连续性基线' }));
    const baseline = (await service.createProposal(owner, guideId, {})).proposal;
    advanceGuide(database, guideId, owner.id, { summary: '新 revision 当前摘要' });
    runtime.enqueueDigest(digest({ shortSummary: '不得迟到落库的有效输出' }), () => {
      service.rejectProposal(owner, guideId, baseline.id);
    });

    await expect(service.createProposal(owner, guideId, {})).rejects.toMatchObject({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_CHANGED',
    });

    expect(getGuideDigestProposal(database, guideId, baseline.id)?.status).toBe('REJECTED');
    expect(listGuideDigestProposals(database, guideId)).toEqual([
      expect.objectContaining({ id: baseline.id, status: 'REJECTED' }),
    ]);
  });

  it('rejects a late residual validation failure when its historical DRAFT baseline is rejected during repair', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '失败路径旧 revision 基线' }));
    const baseline = (await service.createProposal(owner, guideId, {})).proposal;
    advanceGuide(database, guideId, owner.id, { summary: '失败路径新 revision 摘要' });
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT', () => {
      service.rejectProposal(owner, guideId, baseline.id);
    });
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT');

    await expect(service.createProposal(owner, guideId, {})).rejects.toMatchObject({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_CHANGED',
    });

    expect(runtime.requests).toHaveLength(3);
    expect(promptEnvelope(runtime.requests[1]!.prompt)).toHaveProperty('continuity');
    expect(promptEnvelope(runtime.requests[2]!.prompt)).toHaveProperty('continuity');
    expect(getGuideDigestProposal(database, guideId, baseline.id)?.status).toBe('REJECTED');
    expect(listGuideDigestProposals(database, guideId)).toEqual([
      expect.objectContaining({ id: baseline.id, status: 'REJECTED' }),
    ]);
  });

  it('uses a full prompt and safe baseline-unavailable metadata when no trusted baseline exists', async () => {
    runtime.enqueueDigest(digest());

    const generated = await service.createProposal(owner, guideId, {});

    expect(promptEnvelope(runtime.requests[0]!.prompt)).not.toHaveProperty('continuity');
    expect(generated.proposal.generationMetadata).toMatchObject({
      continuityMode: 'FULL',
      continuityFallbackReason: 'BASELINE_UNAVAILABLE',
    });
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineProposalId');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineRevision');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('changedSourceCount');
  });

  it('regenerates only after valid output and atomically links a successor to the stale prior DRAFT', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '第一次摘要' }));
    const prior = (await service.createProposal(owner, guideId, {})).proposal;
    runtime.enqueueDigest(digest({ shortSummary: '第二次摘要' }));

    const successor = await service.createProposal(owner, guideId, { regenerate: true });

    expect(successor).toMatchObject({ created: true, proposal: {
      status: 'DRAFT', supersedesProposalId: prior.id,
      draft: { shortSummary: '第二次摘要' },
    } });
    expect(getGuideDigestProposal(database, guideId, prior.id)?.status).toBe('STALE');
    expect(runtime.requests).toHaveLength(2);
    expect(promptEnvelope(runtime.requests[1]!.prompt).continuity).toMatchObject({
      baselineProposalId: prior.id,
      baselineRevision: prior.baseRevision,
      previousDigest: { shortSummary: '第一次摘要' },
    });
    expect(successor.proposal.generationMetadata).toMatchObject({
      continuityMode: 'RESIDUAL_CONTEXT', baselineProposalId: prior.id,
    });
  });

  it('rejects an explicit regenerate when concurrent DRAFT B replaces observed baseline A', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '观察到的基线 A' }));
    const baselineA = (await service.createProposal(owner, guideId, {})).proposal;
    let concurrentB: ReturnType<typeof regenerateGuideDigestProposal> | undefined;
    runtime.enqueueDigest(digest({ shortSummary: '迟到的生成结果' }), () => {
      concurrentB = regenerateGuideDigestProposal(database, baselineA.id, {
        ...currentProposalIdentity(database, guideId),
        draft: digest({ shortSummary: '并发 DRAFT B' }),
        markdown: '# 并发 DRAFT B',
        createdBy: owner.id,
      });
    });

    await expect(service.createProposal(owner, guideId, { regenerate: true })).rejects.toMatchObject({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_CHANGED',
    });

    expect(concurrentB).toBeDefined();
    expect(getGuideDigestProposal(database, guideId, baselineA.id)?.status).toBe('STALE');
    expect(getGuideDigestProposal(database, guideId, concurrentB!.id)).toMatchObject({
      status: 'DRAFT', draft: { shortSummary: '并发 DRAFT B' }, supersedesProposalId: baselineA.id,
    });
    expect(listGuideDigestProposals(database, guideId)).toHaveLength(2);
    expect(listGuideDigestProposals(database, guideId)
      .filter(({ supersedesProposalId }) => supersedesProposalId === concurrentB!.id)).toEqual([]);
  });

  it('rejects a late explicit-regenerate failure when no initial DRAFT became concurrent DRAFT B', async () => {
    let concurrentB: ReturnType<typeof createGuideDigestProposal> | undefined;
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT', () => {
      concurrentB = createGuideDigestProposal(database, {
        ...currentProposalIdentity(database, guideId),
        draft: digest({ shortSummary: '无初始基线时的并发 DRAFT B' }),
        markdown: '# 无初始基线时的并发 DRAFT B',
        createdBy: owner.id,
      });
    });
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT');

    await expect(service.createProposal(owner, guideId, { regenerate: true })).rejects.toMatchObject({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_CHANGED',
    });

    expect(concurrentB).toBeDefined();
    expect(getGuideDigestProposal(database, guideId, concurrentB!.id)).toMatchObject({
      status: 'DRAFT', draft: { shortSummary: '无初始基线时的并发 DRAFT B' },
    });
    expect(listGuideDigestProposals(database, guideId)).toEqual([
      expect.objectContaining({ id: concurrentB!.id, status: 'DRAFT' }),
    ]);
  });

  it('falls back only the oversized continuity request to a full prompt that fits', async () => {
    const sourceId = snapshotSourceId(database, guideId);
    createGuideDigestProposal(database, {
      ...currentProposalIdentity(database, guideId),
      draft: oversizedDigest(sourceId),
      markdown: '# 大型历史摘要',
      createdBy: owner.id,
    });
    advanceGuide(database, guideId, owner.id, { summary: '适合完整提示的当前摘要' });
    runtime.enqueueDigest(digest({ shortSummary: '完整回退摘要' }));

    const generated = await service.createProposal(owner, guideId, {});

    expect(runtime.requests).toHaveLength(1);
    expect(promptEnvelope(runtime.requests[0]!.prompt)).not.toHaveProperty('continuity');
    expect(generated.proposal.generationMetadata).toMatchObject({
      continuityMode: 'FULL',
      continuityFallbackReason: 'CONTINUITY_INPUT_TOO_LARGE',
    });
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineProposalId');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineRevision');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('changedSourceCount');
  });

  it('falls back only a residual repair request that overflows and persists the repaired FULL output', async () => {
    const previousRow = currentSnapshotRow(database, guideId);
    const previousSnapshot = JSON.parse(previousRow.snapshot_json) as FlowKnowledgeSnapshotV2;
    advanceGuide(database, guideId, owner.id, { summary: '修复请求预算边界' });
    const currentSnapshot = JSON.parse(
      currentSnapshotRow(database, guideId).snapshot_json,
    ) as FlowKnowledgeSnapshotV2;
    const sourceId = currentSnapshot.nodes[0]!.id;
    const previousDigest = residualRepairOverflowDigest({
      sourceId,
      previousSnapshot,
      currentSnapshot,
    });
    const baseline = createGuideDigestProposal(database, {
      guideId,
      workspaceId: previousRow.workspace_id,
      baseSnapshotId: previousRow.id,
      baseRevision: previousRow.revision,
      bundleRevision: GUIDE_DIGEST_BUNDLE.revision,
      rendererVersion: `guide-digest-markdown-v${DIGEST_RENDERER_VERSION}`,
      generationMetadata: { attemptCount: 1 },
      draft: previousDigest,
      markdown: '# 修复请求预算边界基线',
      createdBy: owner.id,
    });
    runtime.enqueueDigest(digest({
      shortSummary: '应被修复的重复标签输出',
      tagSuggestions: [{ label: '订单', category: 'PROCESS', sourceIds: [sourceId] }],
    }), () => {
      service.rejectProposal(owner, guideId, baseline.id);
    });
    runtime.enqueueDigest(digest({ shortSummary: '修复后的完整输出' }));

    const generated = await service.createProposal(owner, guideId, {});

    expect(runtime.requests).toHaveLength(2);
    expect(promptEnvelope(runtime.requests[0]!.prompt).continuity).toMatchObject({
      baselineProposalId: baseline.id,
    });
    expect(promptEnvelope(runtime.requests[0]!.prompt)).not.toHaveProperty('schemaRepairNote');
    expect(promptEnvelope(runtime.requests[1]!.prompt)).not.toHaveProperty('continuity');
    expect(promptEnvelope(runtime.requests[1]!.prompt)).toMatchObject({
      schemaRepairNote: buildGuideDigestValidationRepairNote('DUPLICATE_TAG'),
    });
    expect(generated.proposal).toMatchObject({
      status: 'DRAFT',
      draft: { shortSummary: '修复后的完整输出' },
      generationMetadata: {
        continuityMode: 'FULL',
        continuityFallbackReason: 'CONTINUITY_INPUT_TOO_LARGE',
        attemptCount: 2,
        repairAttempted: true,
      },
    });
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineProposalId');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineRevision');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('changedSourceCount');
    expect(getGuideDigestProposal(database, guideId, baseline.id)?.status).toBe('REJECTED');
    expect(listGuideDigestProposals(database, guideId)
      .filter(({ draft }) => draft?.shortSummary === '应被修复的重复标签输出')).toEqual([]);
    expect(listGuideDigestProposals(database, guideId)
      .filter(({ draft }) => draft?.shortSummary === '修复后的完整输出')).toHaveLength(1);
  });

  it('keeps fallback repair in FULL mode and persists only the repaired output', async () => {
    const sourceId = snapshotSourceId(database, guideId);
    createGuideDigestProposal(database, {
      ...currentProposalIdentity(database, guideId),
      draft: oversizedDigest(sourceId),
      markdown: '# 大型历史摘要',
      createdBy: owner.id,
    });
    advanceGuide(database, guideId, owner.id, { summary: '触发完整回退修复' });
    runtime.enqueueDigest(digest({
      shortSummary: '无效完整输出',
      tagSuggestions: [{ label: '订单', category: 'PROCESS', sourceIds: [sourceId] }],
    }));
    runtime.enqueueDigest(digest({
      shortSummary: '修复后的完整输出',
      tagSuggestions: [{ label: '审批', category: 'PROCESS', sourceIds: [sourceId] }],
    }));

    const generated = await service.createProposal(owner, guideId, {});

    expect(runtime.requests).toHaveLength(2);
    expect(promptEnvelope(runtime.requests[0]!.prompt)).not.toHaveProperty('continuity');
    expect(promptEnvelope(runtime.requests[1]!.prompt)).not.toHaveProperty('continuity');
    expect(runtime.requests[1]!.prompt).toContain('snapshot.tags');
    expect(runtime.requests[1]!.prompt).toContain('tagSuggestions');
    expect(generated.proposal).toMatchObject({
      status: 'DRAFT',
      draft: { shortSummary: '修复后的完整输出', tagSuggestions: [{ label: '审批' }] },
      generationMetadata: {
        continuityMode: 'FULL',
        continuityFallbackReason: 'CONTINUITY_INPUT_TOO_LARGE',
        attemptCount: 2,
        repairAttempted: true,
      },
    });
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineProposalId');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineRevision');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('changedSourceCount');
    expect(listGuideDigestProposals(database, guideId)
      .filter(({ draft }) => draft?.shortSummary === '无效完整输出')).toEqual([]);
  });

  it('keeps GUIDE_DIGEST_INPUT_TOO_LARGE when continuity and the full prompt both overflow', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '历史摘要' }));
    await service.createProposal(owner, guideId, {});
    advanceGuide(database, guideId, owner.id, { summary: '第二版摘要' });
    const row = database.prepare(
      `SELECT id, snapshot_json FROM flow_knowledge_snapshots
       WHERE guide_id = ? AND origin_type = 'DRAFT' ORDER BY revision DESC LIMIT 1`,
    ).get(guideId) as { id: string; snapshot_json: string };
    const oversized = JSON.parse(row.snapshot_json) as FlowKnowledgeSnapshotV2;
    oversized.title = `当前超限标记-${'大'.repeat(300_000)}`;
    database.exec('DROP TRIGGER flow_knowledge_snapshots_immutable');
    database.prepare('UPDATE flow_knowledge_snapshots SET snapshot_json = ? WHERE id = ?')
      .run(JSON.stringify(oversized), row.id);

    const failed = await service.createProposal(owner, guideId, {});

    expect(failed.proposal).toMatchObject({
      status: 'FAILED',
      failureCode: 'GUIDE_DIGEST_INPUT_TOO_LARGE',
      generationMetadata: {
        continuityMode: 'FULL',
        continuityFallbackReason: 'CONTINUITY_INPUT_TOO_LARGE',
      },
    });
    expect(failed.proposal.generationMetadata).not.toHaveProperty('baselineProposalId');
    expect(failed.proposal.generationMetadata).not.toHaveProperty('baselineRevision');
    expect(failed.proposal.generationMetadata).not.toHaveProperty('changedSourceCount');
    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]!.prompt).not.toContain('当前超限标记');
    expect(JSON.stringify(failed.proposal.generationMetadata)).not.toContain('当前超限标记');
  });

  it('rejects a structurally valid baseline snapshot whose embedded identity mismatches its row', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '身份错误的历史摘要' }));
    const baseline = (await service.createProposal(owner, guideId, {})).proposal;
    database.exec('DROP TRIGGER flow_knowledge_snapshots_immutable');
    const row = database.prepare('SELECT snapshot_json FROM flow_knowledge_snapshots WHERE id = ?')
      .get(baseline.baseSnapshotId) as { snapshot_json: string };
    const mismatched = JSON.parse(row.snapshot_json) as FlowKnowledgeSnapshotV2;
    mismatched.workspaceId = 'other-workspace';
    database.prepare('UPDATE flow_knowledge_snapshots SET snapshot_json = ? WHERE id = ?')
      .run(JSON.stringify(mismatched), baseline.baseSnapshotId);
    advanceGuide(database, guideId, owner.id, { summary: '第二版当前摘要' });
    runtime.enqueueDigest(digest({ shortSummary: '不使用错误身份基线' }));

    const generated = await service.createProposal(owner, guideId, {});

    expect(promptEnvelope(runtime.requests[1]!.prompt)).not.toHaveProperty('continuity');
    expect(generated.proposal.generationMetadata).toMatchObject({
      continuityMode: 'FULL', continuityFallbackReason: 'BASELINE_UNAVAILABLE',
    });
  });

  it.each([
    ['overlong', 'p'.repeat(201)],
    ['empty', ''],
  ])('falls back to FULL for a schema-valid history row with an %s proposal ID', async (
    _label,
    proposalId,
  ) => {
    const baselineIdentity = currentProposalIdentity(database, guideId);
    advanceGuide(database, guideId, owner.id, { summary: '不兼容历史 ID 后的当前摘要' });
    insertHistoricalProposalWithId(database, proposalId, baselineIdentity);
    runtime.enqueueDigest(digest({ shortSummary: '不兼容历史 ID 的安全完整生成' }));

    const generated = await service.createProposal(owner, guideId, {});

    expect(runtime.requests).toHaveLength(1);
    expect(promptEnvelope(runtime.requests[0]!.prompt)).not.toHaveProperty('continuity');
    expect(generated.proposal).toMatchObject({
      status: 'DRAFT',
      draft: { shortSummary: '不兼容历史 ID 的安全完整生成' },
      generationMetadata: {
        continuityMode: 'FULL', continuityFallbackReason: 'BASELINE_UNAVAILABLE',
      },
    });
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineProposalId');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('baselineRevision');
    expect(generated.proposal.generationMetadata).not.toHaveProperty('changedSourceCount');
    expect(listGuideDigestProposals(database, guideId)
      .filter(({ status }) => status === 'FAILED')).toEqual([]);
  });

  it('repairs invalid structured output exactly once, then persists only a safe FAILED proposal', async () => {
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT');
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT');

    const failed = await service.createProposal(owner, guideId, {});

    expect(failed).toMatchObject({ created: true, proposal: {
      status: 'FAILED', failureCode: 'INVALID_GUIDE_DIGEST_OUTPUT',
      draft: null, markdown: null,
      generationMetadata: {
        modelRole: 'FOCUSED_WORKER', reasoningEffort: 'MEDIUM',
        outputSchemaVersion: 1, attemptCount: 2, repairAttempted: true,
        truncatedResourceCount: 0,
      },
    } });
    expect(runtime.requests).toHaveLength(2);
    expect(runtime.requests[1]!.requestId).not.toBe(runtime.requests[0]!.requestId);
    expect(runtime.requests[1]!.runId).not.toBe(runtime.requests[0]!.runId);
    expect(runtime.requests[1]!.prompt).toContain('"schemaRepairNote"');
    expect(listGuideDigestAuditEvents(database, guideId, failed.proposal.id)).toEqual([
      expect.objectContaining({
        event: 'VALIDATION_FAILED',
        metadata: expect.objectContaining({
          failureCode: 'INVALID_GUIDE_DIGEST_OUTPUT', attemptCount: 2,
        }),
      }),
    ]);
    expect(JSON.stringify(failed.proposal.generationMetadata)).not.toContain(runtime.requests[0]!.requestId);
  });

  it('repairs source validation once and never persists invalid content as a DRAFT', async () => {
    const invalid = digest({
      tagSuggestions: [{ label: '虚构标签', category: 'PROCESS', sourceIds: ['invented-source'] }],
    });
    runtime.enqueueDigest(invalid);
    runtime.enqueueDigest(invalid);

    const failed = await service.createProposal(owner, guideId, {});

    expect(failed.proposal).toMatchObject({
      status: 'FAILED', failureCode: 'UNKNOWN_SOURCE_ID', draft: null, markdown: null,
    });
    expect(runtime.requests).toHaveLength(2);
    expect(runtime.requests[1]!.prompt).toContain('逐字复制');
    expect(runtime.requests[1]!.prompt).toContain('不得改写或杜撰');
    expect(runtime.requests[1]!.prompt).toContain('"idManifest"');
    expect(listGuideDigestProposals(database, guideId).filter(({ status }) => status === 'DRAFT')).toEqual([]);
  });

  it('repairs a duplicate existing tag with its targeted rule and persists only the valid retry', async () => {
    const sourceId = snapshotSourceId(database, guideId);
    runtime.enqueueDigest(digest({ tagSuggestions: [{ label: '订单', category: 'PROCESS', sourceIds: [sourceId] }] }));
    runtime.enqueueDigest(digest({ tagSuggestions: [{ label: '审批', category: 'PROCESS', sourceIds: [sourceId] }] }));

    const generated = await service.createProposal(owner, guideId, {});

    expect(generated.proposal).toMatchObject({ status: 'DRAFT', draft: { tagSuggestions: [{ label: '审批' }] } });
    expect(runtime.requests).toHaveLength(2);
    expect(runtime.requests[1]!.prompt).toContain('tagSuggestions');
    expect(runtime.requests[1]!.prompt).toContain('snapshot.tags');
  });

  it('repairs an unanchored gap with its targeted rule', async () => {
    runtime.enqueueDigest(digest({ gaps: [{ code: 'INCOMPLETE_DESCRIPTION', message: '缺少依据。', sourceIds: [] }] }));
    const sourceId = snapshotSourceId(database, guideId);
    runtime.enqueueDigest(digest({ gaps: [{ code: 'INCOMPLETE_DESCRIPTION', message: '缺少依据。', sourceIds: [sourceId] }] }));

    const generated = await service.createProposal(owner, guideId, {});

    expect(generated.proposal.status).toBe('DRAFT');
    expect(generated.proposal.draft?.gaps).toContainEqual({
      code: 'INCOMPLETE_DESCRIPTION', message: '缺少依据。', sourceIds: [sourceId],
    });
    expect(runtime.requests[1]!.prompt).toContain('gaps');
    expect(runtime.requests[1]!.prompt).toContain('sourceIds');
  });

  it('persists only a safe duplicate-tag failure code after the repair also fails', async () => {
    const sourceId = snapshotSourceId(database, guideId);
    const invalid = digest({ tagSuggestions: [{ label: '订单', category: 'PROCESS', sourceIds: [sourceId] }] });
    runtime.enqueueDigest(invalid);
    runtime.enqueueDigest(invalid);

    const failed = await service.createProposal(owner, guideId, {});

    expect(failed.proposal).toMatchObject({ status: 'FAILED', failureCode: 'DUPLICATE_TAG', draft: null, markdown: null });
    expect(JSON.stringify(failed.proposal)).not.toContain('订单');
  });

  it('repairs a missing digest output once and persists the valid repaired result', async () => {
    runtime.enqueueFailure('BRIDGE_OUTPUT_MISSING');
    runtime.enqueueDigest(digest({ shortSummary: '修复后的有效摘要' }));

    const generated = await service.createProposal(owner, guideId, {});

    expect(generated.proposal).toMatchObject({
      status: 'DRAFT', draft: { shortSummary: '修复后的有效摘要' },
      generationMetadata: { attemptCount: 2, repairAttempted: true },
    });
    expect(runtime.requests).toHaveLength(2);
  });

  it('repairs the production missing-digest code once and persists only a safe FAILED proposal', async () => {
    runtime.enqueueFailure('GUIDE_DIGEST_MISSING');
    runtime.enqueueFailure('GUIDE_DIGEST_MISSING');

    const failed = await service.createProposal(owner, guideId, {});

    expect(failed.proposal).toMatchObject({
      status: 'FAILED',
      failureCode: 'GUIDE_DIGEST_MISSING',
      draft: null,
      markdown: null,
      generationMetadata: { attemptCount: 2, repairAttempted: true },
    });
    expect(runtime.requests).toHaveLength(2);
    expect(JSON.stringify(failed.proposal.generationMetadata)).not.toContain('unsafe runtime detail');
  });

  it('does not retry or persist auth/runtime failures', async () => {
    runtime.enqueueFailure('RUNTIME_AUTH_FAILED');

    await expect(service.createProposal(owner, guideId, {})).rejects.toMatchObject({
      statusCode: 503, code: 'RUNTIME_AUTH_FAILED',
    });
    expect(runtime.requests).toHaveLength(1);
    expect(listGuideDigestProposals(database, guideId)).toEqual([]);
  });

  it('persists one safe local input-too-large failure without invoking runtime or repair', async () => {
    const row = database.prepare(
      `SELECT id, snapshot_json FROM flow_knowledge_snapshots
       WHERE guide_id = ? AND origin_type = 'DRAFT' ORDER BY revision DESC LIMIT 1`,
    ).get(guideId) as { id: string; snapshot_json: string };
    const oversized = JSON.parse(row.snapshot_json) as FlowKnowledgeSnapshotV2;
    oversized.title = `超限标记-${'大'.repeat(300_000)}`;
    database.exec('DROP TRIGGER flow_knowledge_snapshots_immutable');
    database.prepare('UPDATE flow_knowledge_snapshots SET snapshot_json = ? WHERE id = ?')
      .run(JSON.stringify(oversized), row.id);

    const failed = await service.createProposal(owner, guideId, {});

    expect(failed.proposal).toMatchObject({
      status: 'FAILED',
      failureCode: 'GUIDE_DIGEST_INPUT_TOO_LARGE',
      draft: null,
      markdown: null,
      generationMetadata: {
        attemptCount: 0,
        repairAttempted: false,
      },
    });
    expect(runtime.requests).toEqual([]);
    expect(JSON.stringify(failed.proposal)).not.toContain('超限标记');
  });

  it('atomically stales and links a prior DRAFT when explicit regeneration fails validation', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '仍然有效的旧摘要' }));
    const prior = (await service.createProposal(owner, guideId, {})).proposal;
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT');
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT');

    const failed = await service.createProposal(owner, guideId, { regenerate: true });

    expect(failed.proposal).toMatchObject({ status: 'FAILED', supersedesProposalId: prior.id });
    expect(getGuideDigestProposal(database, guideId, prior.id)?.status).toBe('STALE');
    expect(listGuideDigestAuditEvents(database, guideId, prior.id)).toEqual([
      expect.objectContaining({ event: 'GENERATED' }),
      expect.objectContaining({ event: 'MARKED_STALE', metadata: { reasonCode: 'REGENERATED' } }),
    ]);
  });

  it('returns a concurrently-created DRAFT instead of persisting a later failed duplicate generation', async () => {
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT', () => {
      const snapshot = database.prepare(
        `SELECT id, revision FROM flow_knowledge_snapshots
         WHERE guide_id = ? AND origin_type = 'DRAFT' ORDER BY revision DESC LIMIT 1`,
      ).get(guideId) as { id: string; revision: number };
      createGuideDigestProposal(database, {
        guideId,
        workspaceId: 'digest-workspace',
        baseSnapshotId: snapshot.id,
        baseRevision: snapshot.revision,
        bundleRevision: GUIDE_DIGEST_BUNDLE.revision,
        rendererVersion: `guide-digest-markdown-v${DIGEST_RENDERER_VERSION}`,
        generationMetadata: { attemptCount: 1 },
        draft: digest({ shortSummary: '并发成功摘要' }),
        markdown: '# 并发成功摘要',
        createdBy: owner.id,
      });
    });
    runtime.enqueueFailure('INVALID_GUIDE_DIGEST_OUTPUT');

    const result = await service.createProposal(owner, guideId, {});

    expect(result).toMatchObject({
      created: false,
      proposal: { status: 'DRAFT', draft: { shortSummary: '并发成功摘要' } },
    });
    expect(listGuideDigestProposals(database, guideId)).toHaveLength(1);
  });

  it('rechecks guide access for list, read, and reject and writes one rejection audit', async () => {
    runtime.enqueueDigest(digest());
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;

    expect(service.listProposals(collaborator, guideId)).toEqual([proposal]);
    expect(service.getProposal(collaborator, guideId, proposal.id)).toEqual(proposal);
    expect(() => service.listProposals(workspaceEditor, guideId)).toThrow(expect.objectContaining({
      statusCode: 403, code: 'FORBIDDEN',
    }));
    expect(() => service.getProposal(outsider, guideId, proposal.id)).toThrow(expect.objectContaining({
      statusCode: 404, code: 'GUIDE_NOT_FOUND',
    }));

    const rejected = service.rejectProposal(collaborator, guideId, proposal.id);
    expect(rejected.status).toBe('REJECTED');
    expect(listGuideDigestAuditEvents(database, guideId, proposal.id).map(({ event }) => event))
      .toEqual(['GENERATED', 'REJECTED']);
  });

  it('applies a selected summary and individual proposed tags in one guide revision and one audit', async () => {
    const documentBefore = database.prepare('SELECT draft_document FROM guides WHERE id = ?').get(guideId);
    const historyBefore = count(database, 'guide_draft_revisions', 'guide_id', guideId);
    const sourceId = snapshotSourceId(database, guideId);
    runtime.enqueueDigest(digest({
      shortSummary: '新的审核摘要',
      tagSuggestions: [
        { label: '审批', category: 'PROCESS', sourceIds: [sourceId] },
        { label: '风险', category: 'RISK', sourceIds: [sourceId] },
      ],
    }));
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;

    const applied = service.applyProposal(owner, guideId, proposal.id, {
      applySummary: true,
      acceptedTagLabels: ['审批'],
      acceptMarkdown: false,
    });

    expect(applied.guide).toMatchObject({
      revision: 2, summary: '新的审核摘要', tags: ['订单', '审批'],
    });
    expect(applied.proposal).toMatchObject({
      status: 'APPLIED', appliedRevision: 2, selectedSummary: true,
      acceptedTags: ['审批'], acceptedMarkdown: false,
    });
    expect(count(database, 'guide_draft_revisions', 'guide_id', guideId)).toBe(historyBefore + 1);
    expect(listGuideDigestAuditEvents(database, guideId, proposal.id).map(({ event }) => event))
      .toEqual(['GENERATED', 'APPLIED']);
    const documentAfter = database.prepare('SELECT draft_document FROM guides WHERE id = ?').get(guideId) as {
      draft_document: string;
    };
    expect(JSON.parse(documentAfter.draft_document)).toEqual(JSON.parse(
      (documentBefore as { draft_document: string }).draft_document,
    ));
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_fragments WHERE content = ?`,
    ).get(proposal.markdown)).toEqual({ count: 0 });
    expect(service.getFlowSnapshotStatus(owner, guideId)).toMatchObject({
      guideRevision: 2, sourceStatus: 'READY', snapshotRevision: 2, snapshotSchemaVersion: 2,
    });
  });

  it('accepts Markdown only without changing the guide revision, history, document, or fragments', async () => {
    const duplicateTags = ['ERP', 'ｅｒｐ'];
    const updated = updateGuide(database, guideId, owner.id, 1, { tags: duplicateTags });
    syncGuideFlowSnapshot(database, flowContext(updated));
    runtime.enqueueDigest(digest({ shortSummary: '仅接受不可变 Markdown 的摘要' }));
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;
    const guideBefore = database.prepare(
      'SELECT revision, summary, tags_json, draft_document FROM guides WHERE id = ?',
    ).get(guideId);
    const historyBefore = count(database, 'guide_draft_revisions', 'guide_id', guideId);

    const applied = service.applyProposal(collaborator, guideId, proposal.id, {
      applySummary: false,
      acceptedTagLabels: [],
      acceptMarkdown: true,
    });

    expect(applied.guide).toMatchObject({ revision: 2, tags: duplicateTags });
    expect(applied.proposal).toMatchObject({
      status: 'APPLIED', appliedRevision: 2, selectedSummary: false,
      acceptedTags: [], acceptedMarkdown: true,
    });
    expect(database.prepare(
      'SELECT revision, summary, tags_json, draft_document FROM guides WHERE id = ?',
    ).get(guideId)).toEqual(guideBefore);
    expect(count(database, 'guide_draft_revisions', 'guide_id', guideId)).toBe(historyBefore);
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_fragments WHERE content = ?`,
    ).get(proposal.markdown)).toEqual({ count: 0 });
  });

  it('atomically marks a revision-drifted proposal STALE and returns 409', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '即将过期的摘要' }));
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;
    updateGuide(database, guideId, owner.id, 1, { summary: '并发人工修改' });

    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: true, acceptedTagLabels: [], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_STALE',
    }));
    expect(getGuideDigestProposal(database, guideId, proposal.id)?.status).toBe('STALE');
    expect(listGuideDigestAuditEvents(database, guideId, proposal.id).map(({ event }) => event))
      .toEqual(['GENERATED', 'MARKED_STALE']);
  });

  it('atomically stales a proposal generated by an older bundle revision', () => {
    const proposal = createGuideDigestProposal(database, {
      ...currentProposalIdentity(database, guideId),
      bundleRevision: GUIDE_DIGEST_BUNDLE.revision - 1,
      draft: digest({ shortSummary: '旧 bundle 摘要' }),
      markdown: '# 旧 bundle 摘要',
      createdBy: owner.id,
    });

    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: true, acceptedTagLabels: [], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_STALE',
    }));
    expect(getGuideDigestProposal(database, guideId, proposal.id)?.status).toBe('STALE');
    expect(listGuideDigestAuditEvents(database, guideId, proposal.id).at(-1)).toMatchObject({
      event: 'MARKED_STALE', metadata: { reasonCode: 'BUNDLE_REVISION_CHANGED' },
    });
    expect(getGuide(database, guideId)).toMatchObject({ revision: 1, summary: '现有摘要' });
  });

  it('atomically stales a proposal generated by an older renderer version', () => {
    const proposal = createGuideDigestProposal(database, {
      ...currentProposalIdentity(database, guideId),
      rendererVersion: `guide-digest-markdown-v${DIGEST_RENDERER_VERSION - 1}`,
      draft: digest({ shortSummary: '旧 renderer 摘要' }),
      markdown: '# 旧 renderer 摘要',
      createdBy: owner.id,
    });

    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: true, acceptedTagLabels: [], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_STALE',
    }));
    expect(getGuideDigestProposal(database, guideId, proposal.id)?.status).toBe('STALE');
    expect(listGuideDigestAuditEvents(database, guideId, proposal.id).at(-1)).toMatchObject({
      event: 'MARKED_STALE', metadata: { reasonCode: 'RENDERER_VERSION_CHANGED' },
    });
    expect(getGuide(database, guideId)).toMatchObject({ revision: 1, summary: '现有摘要' });
  });

  it('atomically marks a proposal STALE when the current READY snapshot identity changed', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '依赖原快照身份的摘要' }));
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;
    replaceCurrentSnapshotIdentity(database, guideId, proposal.baseSnapshotId);

    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: true, acceptedTagLabels: [], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_STALE',
    }));
    expect(getGuideDigestProposal(database, guideId, proposal.id)?.status).toBe('STALE');
    expect(listGuideDigestAuditEvents(database, guideId, proposal.id).at(-1)).toMatchObject({
      event: 'MARKED_STALE', metadata: { reasonCode: 'BASE_SNAPSHOT_CHANGED' },
    });
    expect(getGuide(database, guideId)).toMatchObject({ revision: 1, summary: '现有摘要' });
  });

  it('atomically marks a proposal STALE when its current flow source is FAILED', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '依赖 READY 来源的摘要' }));
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;
    database.prepare(
      `UPDATE knowledge_sources SET status = 'FAILED'
       WHERE kind = 'WORKSPACE_FLOW' AND json_extract(config_json, '$.guideId') = ?`,
    ).run(guideId);

    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: true, acceptedTagLabels: [], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_STALE',
    }));
    expect(getGuideDigestProposal(database, guideId, proposal.id)?.status).toBe('STALE');
    expect(listGuideDigestAuditEvents(database, guideId, proposal.id).at(-1)).toMatchObject({
      event: 'MARKED_STALE', metadata: { reasonCode: 'BASE_SNAPSHOT_NOT_READY' },
    });
    expect(getGuide(database, guideId)).toMatchObject({ revision: 1, summary: '现有摘要' });
  });

  it('atomically marks a proposal STALE when its snapshot materialization is missing', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '依赖已物化快照的摘要' }));
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;
    database.prepare('DELETE FROM knowledge_documents WHERE flow_snapshot_id = ?')
      .run(proposal.baseSnapshotId);

    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: true, acceptedTagLabels: [], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({
      statusCode: 409, code: 'GUIDE_DIGEST_PROPOSAL_STALE',
    }));
    expect(getGuideDigestProposal(database, guideId, proposal.id)?.status).toBe('STALE');
    expect(listGuideDigestAuditEvents(database, guideId, proposal.id).at(-1)).toMatchObject({
      event: 'MARKED_STALE', metadata: { reasonCode: 'BASE_SNAPSHOT_NOT_READY' },
    });
    expect(getGuide(database, guideId)).toMatchObject({ revision: 1, summary: '现有摘要' });
  });

  it('rejects unproposed labels and selections with no effective change without applying', async () => {
    runtime.enqueueDigest(digest({ shortSummary: '现有摘要' }));
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;

    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: false, acceptedTagLabels: ['未提议'], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({ statusCode: 400, code: 'GUIDE_DIGEST_TAG_NOT_PROPOSED' }));
    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: true, acceptedTagLabels: [], acceptMarkdown: false,
    })).toThrow(expect.objectContaining({ statusCode: 409, code: 'NO_EFFECTIVE_CHANGE' }));
    expect(getGuideDigestProposal(database, guideId, proposal.id)?.status).toBe('DRAFT');
  });

  it('preserves every existing tag and rejects an accepted set that would exceed 20 normalized tags', async () => {
    const existingTags = Array.from({ length: 19 }, (_, index) => `现有标签${index + 1}`);
    const updated = updateGuide(database, guideId, owner.id, 1, { tags: existingTags });
    syncGuideFlowSnapshot(database, flowContext(updated));
    const sourceId = snapshotSourceId(database, guideId);
    runtime.enqueueDigest(digest({
      tagSuggestions: [
        { label: '新增甲', category: 'PROCESS', sourceIds: [sourceId] },
        { label: '新增乙', category: 'RISK', sourceIds: [sourceId] },
      ],
    }));
    const proposal = (await service.createProposal(owner, guideId, {})).proposal;

    expect(() => service.applyProposal(owner, guideId, proposal.id, {
      applySummary: false,
      acceptedTagLabels: ['新增甲', '新增乙'],
      acceptMarkdown: false,
    })).toThrow(expect.objectContaining({ statusCode: 400, code: 'GUIDE_TAG_LIMIT_EXCEEDED' }));
    expect(database.prepare('SELECT tags_json FROM guides WHERE id = ?').get(guideId))
      .toEqual({ tags_json: JSON.stringify(existingTags) });
    expect(getGuideDigestProposal(database, guideId, proposal.id)?.status).toBe('DRAFT');
  });
});

class RecordingRuntime implements AgentRuntimeClient {
  readonly requests: BridgeRunRequestV1[] = [];
  readonly #steps: Array<
    | { kind: 'DIGEST'; digest: GuideDigestDraftV1; before?: () => void }
    | { kind: 'FAILURE'; code: string; before?: () => void }
  > = [];

  enqueueDigest(digest: GuideDigestDraftV1, before?: () => void): void {
    this.#steps.push({ kind: 'DIGEST', digest, ...(before ? { before } : {}) });
  }

  enqueueFailure(code: string, before?: () => void): void {
    this.#steps.push({ kind: 'FAILURE', code, ...(before ? { before } : {}) });
  }

  async *run(request: BridgeRunRequestV1): AsyncIterable<BridgeEventV1> {
    this.requests.push(request);
    const step = this.#steps.shift();
    if (!step) throw new Error('runtime must not be invoked without a scripted result');
    if (step.kind === 'FAILURE') {
      step.before?.();
      yield {
        requestId: request.requestId,
        runId: request.runId,
        sequence: 1,
        type: 'FAILED',
        payload: { code: step.code, message: 'unsafe runtime detail', retryable: false },
      };
      return;
    }
    step.before?.();
    yield {
      requestId: request.requestId,
      runId: request.runId,
      sequence: 1,
      type: 'GUIDE_DIGEST',
      payload: { digest: step.digest },
    };
    yield {
      requestId: request.requestId,
      runId: request.runId,
      sequence: 2,
      type: 'COMPLETED',
      payload: {},
    };
  }

  async cancel(): Promise<void> {}
  async steer(): Promise<void> {}
}

function seedUsers(database: DatabaseSync): void {
  const insert = database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, 'hash', ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  insert.run('digest-owner', 'digest-owner@example.com', '摘要所有者', 'AUTHOR', now);
  insert.run('digest-collaborator', 'digest-collaborator@example.com', '摘要协作者', 'EDITOR', now);
  insert.run('digest-workspace-editor', 'digest-editor@example.com', '工作区编辑者', 'EDITOR', now);
  insert.run('digest-outsider', 'digest-outsider@example.com', '隐藏用户', 'AUTHOR', now);
}

function flowContext(guide: ReturnType<typeof updateGuide>) {
  return {
    workspaceId: guide.workspaceId,
    workspaceItemId: guide.workspaceItemId,
    guideId: guide.id,
    ownerId: guide.ownerId,
    title: guide.title,
    summary: guide.summary,
    tags: guide.tags,
    origin: { kind: 'DRAFT' as const, revision: guide.revision },
    document: guide.document,
  };
}

function digest(overrides: Partial<GuideDigestDraftV1> = {}): GuideDigestDraftV1 {
  return {
    schemaVersion: 1,
    shortSummary: '订单从提交到审批完成的流程。',
    scope: { audiences: [], businessObjects: [], systems: [] },
    stageSections: [],
    keyRules: [],
    tagSuggestions: [],
    gaps: [],
    ...overrides,
  };
}

function oversizedDigest(sourceId: string): GuideDigestDraftV1 {
  return digest({
    shortSummary: '只用于连续性预算回退的历史摘要',
    keyRules: Array.from({ length: 200 }, () => ({
      statement: '规'.repeat(2_000),
      sourceIds: [sourceId],
    })),
  });
}

function residualRepairOverflowDigest(input: {
  sourceId: string;
  previousSnapshot: FlowKnowledgeSnapshotV2;
  currentSnapshot: FlowKnowledgeSnapshotV2;
}): GuideDigestDraftV1 {
  if (input.previousSnapshot.origin.kind !== 'DRAFT') {
    throw new Error('test baseline must be a DRAFT snapshot');
  }
  const baselineRevision = input.previousSnapshot.origin.revision;
  const snapshotDiff = buildGuideDigestSnapshotDiff(input.previousSnapshot, input.currentSnapshot);
  const repairNote = buildGuideDigestValidationRepairNote('DUPLICATE_TAG');
  if (!repairNote) throw new Error('DUPLICATE_TAG repair note must exist');
  const buildPrompt = (paddingCharacters: number, includeRepair: boolean): string => (
    buildGuideDigestPrompt(input.currentSnapshot, {
      continuity: {
        baselineProposalId: '00000000-0000-0000-0000-000000000000',
        baselineRevision,
        previousDigest: paddedDigest(input.sourceId, paddingCharacters),
        snapshotDiff,
      },
      ...(includeRepair ? { schemaRepairNote: repairNote } : {}),
    })
  );
  const fits = (paddingCharacters: number, includeRepair: boolean): boolean => {
    try {
      assertGuideDigestRuntimeRequestBudget(
        guideDigestBudgetRequest(buildPrompt(paddingCharacters, includeRepair)),
      );
      return true;
    } catch (error) {
      if (error instanceof GuideDigestInputTooLargeError) return false;
      throw error;
    }
  };

  let lower = 0;
  let upper = 400_000;
  if (!fits(lower, false) || fits(upper, false)) {
    throw new Error('test prompt-size search does not straddle the request budget');
  }
  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (fits(middle, false)) lower = middle;
    else upper = middle;
  }
  if (fits(lower, true)) {
    throw new Error('repair note did not cross the residual request budget');
  }
  assertGuideDigestRuntimeRequestBudget(guideDigestBudgetRequest(
    buildGuideDigestPrompt(input.currentSnapshot, { schemaRepairNote: repairNote }),
  ));
  return paddedDigest(input.sourceId, lower);
}

function paddedDigest(sourceId: string, paddingCharacters: number): GuideDigestDraftV1 {
  let remaining = paddingCharacters;
  const keyRules: GuideDigestDraftV1['keyRules'] = [];
  while (remaining > 0) {
    const length = Math.min(2_000, remaining);
    keyRules.push({ statement: '规'.repeat(length), sourceIds: [sourceId] });
    remaining -= length;
  }
  return digest({ shortSummary: '修复请求预算边界历史摘要', keyRules });
}

function guideDigestBudgetRequest(prompt: string): BridgeRunRequestV1 {
  return {
    type: 'RUN',
    requestId: '00000000-0000-0000-0000-000000000000',
    runId: '11111111-1111-1111-1111-111111111111',
    planVersion: GUIDE_DIGEST_BUNDLE.revision,
    role: GUIDE_DIGEST_BUNDLE.role,
    reasoningEffort: GUIDE_DIGEST_BUNDLE.reasoningEffort,
    outputKind: GUIDE_DIGEST_BUNDLE.outputKind,
    prompt,
    allowedRoots: [],
  };
}

function promptEnvelope(prompt: string): Record<string, unknown> {
  const marker = '<UNTRUSTED_SNAPSHOT_JSON>\n';
  const markerIndex = prompt.indexOf(marker);
  if (markerIndex < 0) throw new Error('guide digest prompt is missing its untrusted envelope marker');
  return JSON.parse(prompt.slice(markerIndex + marker.length)) as Record<string, unknown>;
}

function advanceGuide(
  database: DatabaseSync,
  guideId: string,
  userId: string,
  patch: Parameters<typeof updateGuide>[4],
): ReturnType<typeof updateGuide> {
  const current = getGuide(database, guideId)!;
  const updated = updateGuide(database, guideId, userId, current.revision, patch);
  syncGuideFlowSnapshot(database, flowContext(updated));
  return updated;
}

function snapshotSourceId(database: DatabaseSync, guideId: string): string {
  const row = database.prepare(
    `SELECT snapshot_json FROM flow_knowledge_snapshots
     WHERE guide_id = ? AND origin_type = 'DRAFT'
     ORDER BY revision DESC LIMIT 1`,
  ).get(guideId) as { snapshot_json: string };
  const snapshot = JSON.parse(row.snapshot_json) as { nodes: Array<{ id: string }> };
  return snapshot.nodes[0]!.id;
}

type SnapshotMutator = (snapshot: FlowKnowledgeSnapshotV2) => void;

function mutatePersistedSnapshot(
  database: DatabaseSync,
  guideId: string,
  mutate: SnapshotMutator,
): void {
  const row = database.prepare(
    `SELECT id, snapshot_json FROM flow_knowledge_snapshots
     WHERE guide_id = ? AND origin_type = 'DRAFT'`,
  ).get(guideId) as { id: string; snapshot_json: string };
  const snapshot = JSON.parse(row.snapshot_json) as FlowKnowledgeSnapshotV2;
  mutate(snapshot);
  database.exec('DROP TRIGGER flow_knowledge_snapshots_immutable');
  database.prepare('UPDATE flow_knowledge_snapshots SET snapshot_json = ? WHERE id = ?')
    .run(JSON.stringify(snapshot), row.id);
}

function duplicateAnnotationIds(snapshot: FlowKnowledgeSnapshotV2): void {
  snapshot.resources.push(
    testImageResource(snapshot, 'duplicate-image-1', 'duplicate-annotation', 100),
    testImageResource(snapshot, 'duplicate-image-2', 'duplicate-annotation', 101),
  );
}

function duplicateKeypointIds(snapshot: FlowKnowledgeSnapshotV2): void {
  snapshot.resources.push(
    testVideoResource(snapshot, 'duplicate-video-1', 'duplicate-keypoint', 100),
    testVideoResource(snapshot, 'duplicate-video-2', 'duplicate-keypoint', 101),
  );
}

function duplicateCrossKindId(snapshot: FlowKnowledgeSnapshotV2): void {
  snapshot.learningPath.push({
    id: snapshot.nodes[0]!.id,
    order: Math.max(-1, ...snapshot.learningPath.map(({ order }) => order)) + 1,
    targetNodeId: snapshot.nodes[0]!.id,
  });
}

function testImageResource(
  snapshot: FlowKnowledgeSnapshotV2,
  id: string,
  annotationId: string,
  order: number,
): Extract<FlowKnowledgeSnapshotV2['resources'][number], { kind: 'IMAGE' }> {
  return {
    id,
    locator: { guideId: snapshot.guideId, snapshotId: snapshot.snapshotId, nodeId: id },
    kind: 'IMAGE',
    order,
    alt: id,
    annotations: [{
      id: annotationId, order: 0, title: annotationId,
      shape: 'POINT', region: { x: 0.1, y: 0.1 },
    }],
  };
}

function testVideoResource(
  snapshot: FlowKnowledgeSnapshotV2,
  id: string,
  keypointId: string,
  order: number,
): Extract<FlowKnowledgeSnapshotV2['resources'][number], { kind: 'VIDEO' }> {
  return {
    id,
    locator: { guideId: snapshot.guideId, snapshotId: snapshot.snapshotId, nodeId: id },
    kind: 'VIDEO',
    order,
    caption: id,
    keypoints: [{ id: keypointId, title: keypointId, timeSeconds: 1 }],
  };
}

function currentProposalIdentity(database: DatabaseSync, guideId: string) {
  const snapshot = currentSnapshotRow(database, guideId);
  return {
    guideId,
    workspaceId: snapshot.workspace_id,
    baseSnapshotId: snapshot.id,
    baseRevision: snapshot.revision,
    bundleRevision: GUIDE_DIGEST_BUNDLE.revision,
    rendererVersion: `guide-digest-markdown-v${DIGEST_RENDERER_VERSION}`,
    generationMetadata: { attemptCount: 1 },
  };
}

function currentSnapshotRow(database: DatabaseSync, guideId: string): {
  id: string;
  revision: number;
  workspace_id: string;
  snapshot_json: string;
} {
  return database.prepare(
    `SELECT id, revision, workspace_id, snapshot_json FROM flow_knowledge_snapshots
     WHERE guide_id = ? AND origin_type = 'DRAFT'
     ORDER BY revision DESC, created_at DESC, id DESC LIMIT 1`,
  ).get(guideId) as {
    id: string;
    revision: number;
    workspace_id: string;
    snapshot_json: string;
  };
}

function insertHistoricalProposalWithId(
  database: DatabaseSync,
  proposalId: string,
  identity: ReturnType<typeof currentProposalIdentity>,
): void {
  const createdAt = new Date().toISOString();
  database.prepare(
    `INSERT INTO guide_digest_proposals (
      id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
      renderer_version, generation_metadata_json, status, draft_json, markdown,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, '# 历史摘要', 'digest-owner', ?, ?)`,
  ).run(
    proposalId,
    identity.guideId,
    identity.workspaceId,
    identity.baseSnapshotId,
    identity.baseRevision,
    identity.bundleRevision,
    identity.rendererVersion,
    JSON.stringify(identity.generationMetadata),
    JSON.stringify(digest({ shortSummary: '不兼容 ID 的历史摘要' })),
    createdAt,
    createdAt,
  );
}

function replaceCurrentSnapshotIdentity(
  database: DatabaseSync,
  guideId: string,
  priorSnapshotId: string,
): void {
  // The schema normally makes same-revision snapshots immutable and unique. Temporarily
  // disabling FK enforcement models a restored/corrupt datastore at this trust boundary.
  database.exec('PRAGMA foreign_keys = OFF');
  try {
    database.prepare('DELETE FROM knowledge_documents WHERE flow_snapshot_id = ?')
      .run(priorSnapshotId);
    database.prepare('DELETE FROM flow_knowledge_snapshots WHERE id = ?').run(priorSnapshotId);
    const guide = getGuide(database, guideId)!;
    syncGuideFlowSnapshot(database, flowContext(guide));
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
  expect(database.prepare(
    `SELECT id FROM flow_knowledge_snapshots
     WHERE guide_id = ? AND origin_type = 'DRAFT' AND revision = 1`,
  ).get(guideId)).toEqual({ id: expect.not.stringMatching(priorSnapshotId) });
}

function count(database: DatabaseSync, table: string, field: string, value: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${field} = ?`).get(value) as {
    count: number;
  };
  return row.count;
}

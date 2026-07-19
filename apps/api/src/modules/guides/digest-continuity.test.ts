import {
  FlowKnowledgeSnapshotV2Schema,
  type GuideDigestDraftV1,
  type FlowKnowledgeSnapshotV2,
} from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildGuideDigestSnapshotDiff,
  hasGuideDigestBusinessChanges,
  validateGuideDigestTagContinuity,
} from './digest-continuity';

describe('guide digest snapshot continuity', () => {
  it('diffs distant endpoint revisions without intermediate snapshots', () => {
    const previous = snapshot({ snapshotId: 'snapshot-181', revision: 181 });
    const current = snapshot({ snapshotId: 'snapshot-186', revision: 186 });
    current.nodes[0] = { ...current.nodes[0]!, title: '确认新原料' };
    current.relations.push({
      kind: 'FLOW', id: 'relation-new', sourceNodeId: 'node-1', targetNodeId: 'node-2',
    });

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff).toMatchObject({
      schemaVersion: 1,
      fromSnapshotId: 'snapshot-181', fromRevision: 181,
      toSnapshotId: 'snapshot-186', toRevision: 186,
      nodes: { updated: [{ id: 'node-1' }] },
      relations: { added: [expect.objectContaining({ id: 'relation-new' })] },
    });
    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining([
      'node-1', 'node-2', 'relation-new',
    ]));
    expect(hasGuideDigestBusinessChanges(diff)).toBe(true);
  });

  it('treats accepted tag metadata as non-business change', () => {
    const previous = snapshot({ snapshotId: 'snapshot-181', revision: 181, tags: ['ERP'] });
    const current = snapshot({ snapshotId: 'snapshot-182', revision: 182, tags: ['ERP', '原料'] });

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.metadata.tags).toEqual({ before: ['ERP'], after: ['ERP', '原料'] });
    expect(diff.nodes.updated).toEqual([]);
    expect(diff.resources.updated).toEqual([]);
    expect(diff.affectedSourceIds).toEqual([]);
    expect(hasGuideDigestBusinessChanges(diff)).toBe(false);
  });

  it('ignores only locator snapshot identity while retaining locator node changes', () => {
    const previous = snapshot({ snapshotId: 'snapshot-181', revision: 181 });
    const current = snapshot({ snapshotId: 'snapshot-186', revision: 186 });
    const image = current.resources.find((resource) => resource.kind === 'IMAGE')!;
    image.annotations[0] = {
      ...image.annotations[0]!,
      targetNodeId: 'node-2',
      targetLocator: { guideId: 'guide-1', snapshotId: 'snapshot-186', nodeId: 'node-2' },
    };

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.nodes.updated).toEqual([]);
    expect(diff.resources.updated).toEqual([expect.objectContaining({ id: 'resource-image' })]);
  });

  it('adds changed image annotations and their parent resource to affected sources', () => {
    const previous = snapshot();
    const current = snapshot();
    const image = current.resources.find((resource) => resource.kind === 'IMAGE')!;
    image.annotations[0] = { ...image.annotations[0]!, title: '更新后的客户字段' };

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.resources.updated).toEqual([expect.objectContaining({ id: 'resource-image' })]);
    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining(['annotation-1', 'resource-image']));
  });

  it('adds changed video keypoints and their parent resource to affected sources', () => {
    const previous = snapshot();
    const current = snapshot();
    const video = current.resources.find((resource) => resource.kind === 'VIDEO')!;
    video.keypoints[0] = { ...video.keypoints[0]!, title: '更新后的提交节点' };

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.resources.updated).toEqual([expect.objectContaining({ id: 'resource-video' })]);
    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining(['keypoint-1', 'resource-video']));
  });

  it('adds members when a stage or lane changes', () => {
    const previous = snapshot();
    const current = snapshot();
    const stage = { ...current.stages[0]!, title: '已更新阶段' };
    const lane = { ...current.lanes[0]!, title: '已更新责任' };
    current.stages[0] = stage;
    current.lanes[0] = lane;
    current.nodes = current.nodes.map((node) => ({
      ...node,
      stage: node.stage?.id === stage.id ? stage : node.stage,
      responsibility: node.responsibility?.id === lane.id ? lane : node.responsibility,
    }));

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.stages.updated).toEqual([expect.objectContaining({ id: 'stage-1' })]);
    expect(diff.lanes.updated).toEqual([expect.objectContaining({ id: 'lane-1' })]);
    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining([
      'node-1', 'node-2', 'stage-1', 'lane-1',
    ]));
  });

  it('keeps both learning-path targets in the affected-source closure', () => {
    const previous = snapshot();
    const current = snapshot();
    current.learningPath[0] = { ...current.learningPath[0]!, targetNodeId: 'node-2' };

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.learningPath.updated).toEqual([expect.objectContaining({ id: 'learning-1' })]);
    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining(['node-1', 'node-2']));
    expect(hasGuideDigestBusinessChanges(diff)).toBe(true);
  });

  it.each([
    ['relation', (current: FlowKnowledgeSnapshotV2) => {
      current.relations = current.relations.filter(({ id }) => id !== 'relation-flow');
    }, ['relation-flow', 'node-1', 'node-2']],
    ['resource', (current: FlowKnowledgeSnapshotV2) => {
      current.resources = current.resources.filter(({ id }) => id !== 'resource-image');
    }, ['resource-image', 'annotation-1']],
    ['stage', (current: FlowKnowledgeSnapshotV2) => {
      const replacement = { id: 'stage-2', title: '替代阶段', order: 0 };
      current.stages = [replacement];
      current.nodes = current.nodes.map((node) => ({ ...node, stage: replacement }));
    }, ['stage-1', 'node-1', 'node-2']],
    ['lane', (current: FlowKnowledgeSnapshotV2) => {
      const replacement = { id: 'lane-2', title: '替代责任', kind: 'ROLE' as const, order: 0 };
      current.lanes = [replacement];
      current.nodes = current.nodes.map((node) => ({ ...node, responsibility: replacement }));
    }, ['lane-1', 'node-1', 'node-2']],
    ['learning step', (current: FlowKnowledgeSnapshotV2) => {
      current.learningPath = current.learningPath.filter(({ id }) => id !== 'learning-1');
    }, ['learning-1', 'node-1']],
  ] as const)('keeps removed %s closure members affected', (_label, remove, affectedIds) => {
    const previous = snapshot();
    const current = snapshot();
    remove(current);

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining([...affectedIds]));
  });

  it('keeps a removed resource-targeted learning step and its resource affected', () => {
    const previous = snapshot();
    previous.learningPath.push({
      id: 'learning-resource', order: 1, targetResourceId: 'resource-note',
    });
    const current = snapshot();

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.learningPath.removed).toEqual([
      expect.objectContaining({ id: 'learning-resource', targetResourceId: 'resource-note' }),
    ]);
    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining([
      'learning-resource', 'resource-note',
    ]));
  });

  it.each([
    ['added', undefined, { assetId: 'supplement-new', alt: '新增补充图' }],
    [
      'updated',
      { assetId: 'supplement-existing', alt: '原补充图' },
      { assetId: 'supplement-existing', alt: '更新补充图' },
    ],
    ['removed', { assetId: 'supplement-existing', alt: '原补充图' }, undefined],
  ] as const)('keeps %s supplemental-image parent and child IDs affected', (
    _label,
    beforeSupplement,
    afterSupplement,
  ) => {
    const previous = snapshot();
    const current = snapshot();
    const previousImage = previous.resources.find((resource) => resource.kind === 'IMAGE')!;
    const currentImage = current.resources.find((resource) => resource.kind === 'IMAGE')!;
    previousImage.annotations[0] = {
      ...previousImage.annotations[0]!,
      ...(beforeSupplement === undefined ? {} : { supplementalImages: [beforeSupplement] }),
    };
    currentImage.annotations[0] = {
      ...currentImage.annotations[0]!,
      ...(afterSupplement === undefined ? {} : { supplementalImages: [afterSupplement] }),
    };

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining([
      'resource-image',
      'annotation-1',
      (afterSupplement ?? beforeSupplement)!.assetId,
    ]));
  });

  it('sorts affected source IDs by Unicode code point rather than UTF-16 code unit', () => {
    const previous = snapshot();
    const current = snapshot();
    const bmpPrivateUseId = '\uE000';
    const astralId = '\u{10000}';
    current.resources.push(
      {
        kind: 'MARKDOWN', id: bmpPrivateUseId,
        locator: { guideId: current.guideId, snapshotId: current.snapshotId, nodeId: bmpPrivateUseId },
        order: 3, markdown: 'BMP private-use resource',
      },
      {
        kind: 'MARKDOWN', id: astralId,
        locator: { guideId: current.guideId, snapshotId: current.snapshotId, nodeId: astralId },
        order: 4, markdown: 'Astral resource',
      },
    );

    const affected = buildGuideDigestSnapshotDiff(previous, current).affectedSourceIds;

    expect(affected.indexOf(bmpPrivateUseId)).toBeLessThan(affected.indexOf(astralId));
  });

  it.each([
    [{ kind: 'FLOW', id: 'relation-flow-new', sourceNodeId: 'node-1', targetNodeId: 'node-2' }, ['node-1', 'node-2']],
    [{ kind: 'USES_RESOURCE', id: 'relation-resource-new', sourceNodeId: 'node-1', resourceId: 'resource-note' }, ['node-1', 'resource-note']],
    [{ kind: 'RESOURCE_REFERENCE', id: 'relation-reference-new', sourceResourceId: 'resource-note', targetNodeId: 'node-2' }, ['resource-note', 'node-2']],
  ] as const)('adds endpoints for a changed %s relation', (relation, endpoints) => {
    const previous = snapshot();
    const current = snapshot();
    current.relations.push(relation);

    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(diff.affectedSourceIds).toEqual(expect.arrayContaining([relation.id, ...endpoints]));
  });

  it('rejects snapshots from different guides or workspaces', () => {
    const previous = snapshot();
    const differentGuide = snapshot({ guideId: 'other-guide' });
    const differentWorkspace = snapshot({ workspaceId: 'other-workspace' });

    expect(() => buildGuideDigestSnapshotDiff(previous, differentGuide)).toThrow('guideId');
    expect(() => buildGuideDigestSnapshotDiff(previous, differentWorkspace)).toThrow('workspaceId');
  });

  it('rejects replacement labels that cite unchanged nodes or annotations after accepting previous suggestions', () => {
    const previousSnapshot = snapshot({ tags: ['ERP'] });
    const current = snapshot({ tags: ['ERP', '原料', '打样'] });
    const previousDigest = draft({
      tagSuggestions: [
        { label: '原料', category: 'OBJECT', sourceIds: ['node-material'] },
        { label: '打样', category: 'PROCESS', sourceIds: ['stage-sampling'] },
      ],
    });
    const metadataOnlyDiff = buildGuideDigestSnapshotDiff(previousSnapshot, current);
    const churned = draft({
      tagSuggestions: [
        { label: '供应商', category: 'ROLE', sourceIds: ['node-material'] },
        { label: '机型', category: 'OBJECT', sourceIds: ['annotation-machine'] },
      ],
    });

    expect(() => validateGuideDigestTagContinuity(
      current, previousDigest, metadataOnlyDiff, churned,
    )).toThrow(expect.objectContaining({
      code: 'UNJUSTIFIED_TAG_CHURN',
    }));
  });

  it('allows accepted prior suggestions to leave the candidate draft', () => {
    const previousSnapshot = snapshot({ tags: ['ERP'] });
    const current = snapshot({ tags: ['ERP', '原料', '打样'] });
    const previousDigest = draft({
      tagSuggestions: [
        { label: '原料', category: 'OBJECT', sourceIds: ['node-1'] },
        { label: '打样', category: 'PROCESS', sourceIds: ['annotation-1'] },
      ],
    });

    expect(() => validateGuideDigestTagContinuity(
      current,
      previousDigest,
      buildGuideDigestSnapshotDiff(previousSnapshot, current),
      draft(),
    )).not.toThrow();
  });

  it('requires an unchanged prior suggestion to retain its category and source-ID set', () => {
    const previous = snapshot();
    const current = snapshot();
    const previousDigest = draft({
      tagSuggestions: [{ label: '原料', category: 'OBJECT', sourceIds: ['node-1', 'annotation-1'] }],
    });
    const changedCategory = draft({
      tagSuggestions: [{ label: '原料', category: 'PROCESS', sourceIds: ['annotation-1', 'node-1'] }],
    });
    const changedSources = draft({
      tagSuggestions: [{ label: '原料', category: 'OBJECT', sourceIds: ['node-1'] }],
    });
    const diff = buildGuideDigestSnapshotDiff(previous, current);

    expect(() => validateGuideDigestTagContinuity(current, previousDigest, diff, changedCategory))
      .toThrow(expect.objectContaining({ code: 'MISSING_UNCHANGED_TAG' }));
    expect(() => validateGuideDigestTagContinuity(current, previousDigest, diff, changedSources))
      .toThrow(expect.objectContaining({ code: 'MISSING_UNCHANGED_TAG' }));
  });

  it('allows a new suggestion when it cites affected evidence', () => {
    const previous = snapshot();
    const current = snapshot();
    current.nodes[0] = { ...current.nodes[0]!, title: '更新后的原料确认' };

    expect(() => validateGuideDigestTagContinuity(
      current,
      draft(),
      buildGuideDigestSnapshotDiff(previous, current),
      draft({ tagSuggestions: [{ label: '供应商', category: 'ROLE', sourceIds: ['node-1'] }] }),
    )).not.toThrow();
  });

  it('allows affected or deleted prior suggestions to disappear', () => {
    const previous = snapshot();
    const affectedCurrent = snapshot();
    affectedCurrent.nodes[0] = { ...affectedCurrent.nodes[0]!, title: '更新后的原料确认' };
    const deletedCurrent = snapshot();
    deletedCurrent.nodes = deletedCurrent.nodes.filter((node) => node.id !== 'node-1');
    deletedCurrent.relations = [];
    deletedCurrent.learningPath = [];
    const previousDigest = draft({
      tagSuggestions: [{ label: '原料', category: 'OBJECT', sourceIds: ['node-1'] }],
    });

    for (const current of [affectedCurrent, deletedCurrent]) {
      expect(() => validateGuideDigestTagContinuity(
        current,
        previousDigest,
        buildGuideDigestSnapshotDiff(previous, current),
        draft(),
      )).not.toThrow();
    }
  });

  it('allows a prior multi-source suggestion to disappear when any cited source is affected', () => {
    const previous = snapshot();
    const current = snapshot();
    current.nodes[0] = { ...current.nodes[0]!, title: '更新后的原料确认' };
    const previousDigest = draft({
      tagSuggestions: [{ label: '原料', category: 'OBJECT', sourceIds: ['node-1', 'annotation-1'] }],
    });

    expect(() => validateGuideDigestTagContinuity(
      current,
      previousDigest,
      buildGuideDigestSnapshotDiff(previous, current),
      draft(),
    )).not.toThrow();
  });

  it('reports a missing unchanged tag before an unsupported new label', () => {
    const previous = snapshot();
    const current = snapshot();
    const previousDigest = draft({
      tagSuggestions: [{ label: '原料', category: 'OBJECT', sourceIds: ['node-1'] }],
    });
    const candidate = draft({
      tagSuggestions: [{ label: '供应商', category: 'ROLE', sourceIds: ['annotation-1'] }],
    });

    expect(() => validateGuideDigestTagContinuity(
      current,
      previousDigest,
      buildGuideDigestSnapshotDiff(previous, current),
      candidate,
    )).toThrow(expect.objectContaining({ code: 'MISSING_UNCHANGED_TAG' }));
  });

  it('matches stable candidates with NFKC, trimmed, case-insensitive labels and source-ID sets', () => {
    const previous = snapshot();
    const current = snapshot();
    const previousDigest = draft({
      tagSuggestions: [{ label: 'MiXeD Label', category: 'OBJECT', sourceIds: ['node-1', 'annotation-1'] }],
    });
    const normalizedCandidate = draft({
      tagSuggestions: [{ label: '　ｍｉｘｅｄ　ｌａｂｅｌ　', category: 'OBJECT', sourceIds: ['annotation-1', 'node-1'] }],
    });

    expect(() => validateGuideDigestTagContinuity(
      current,
      previousDigest,
      buildGuideDigestSnapshotDiff(previous, current),
      normalizedCandidate,
    )).not.toThrow();
  });
});

function draft(overrides: Partial<GuideDigestDraftV1> = {}): GuideDigestDraftV1 {
  return {
    schemaVersion: 1,
    shortSummary: '当前流程摘要',
    scope: { audiences: [], businessObjects: [], systems: [] },
    stageSections: [],
    keyRules: [],
    tagSuggestions: [],
    gaps: [],
    ...overrides,
  };
}

function snapshot(overrides: {
  snapshotId?: string;
  revision?: number;
  guideId?: string;
  workspaceId?: string;
  tags?: string[];
} = {}): FlowKnowledgeSnapshotV2 {
  const snapshotId = overrides.snapshotId ?? 'snapshot-181';
  const guideId = overrides.guideId ?? 'guide-1';
  const workspaceId = overrides.workspaceId ?? 'workspace-1';
  const stage = { id: 'stage-1', title: '准备', order: 0 };
  const lane = { id: 'lane-1', title: '版师', kind: 'ROLE' as const, order: 0 };
  const locator = (nodeId: string) => ({ guideId, snapshotId, nodeId });

  return FlowKnowledgeSnapshotV2Schema.parse({
    schemaVersion: 2,
    snapshotId,
    workspaceId,
    workspaceItemId: 'workspace-item-1',
    guideId,
    title: '打样流程',
    summary: '从确认原料到提交样衣。',
    tags: overrides.tags ?? ['ERP'],
    origin: { kind: 'DRAFT', revision: overrides.revision ?? 181 },
    stages: [stage],
    lanes: [lane],
    nodes: [
      {
        id: 'node-1', locator: locator('node-1'), kind: 'start', title: '确认原料',
        stage, responsibility: lane, isEntry: true, isExit: false,
      },
      {
        id: 'node-2', locator: locator('node-2'), kind: 'end', title: '提交样衣',
        stage, responsibility: lane, isEntry: false, isExit: true,
      },
    ],
    resources: [
      { kind: 'MARKDOWN', id: 'resource-note', locator: locator('resource-note'), order: 0, markdown: '核对原料规格。' },
      {
        kind: 'IMAGE', id: 'resource-image', locator: locator('resource-image'), order: 1,
        alt: '原料字段页面', annotations: [{
          id: 'annotation-1', order: 0, title: '客户字段', shape: 'POINT', region: { x: 0.2, y: 0.4 },
        }],
      },
      {
        kind: 'VIDEO', id: 'resource-video', locator: locator('resource-video'), order: 2,
        keypoints: [{ id: 'keypoint-1', title: '提交样衣', timeSeconds: 12 }],
      },
    ],
    relations: [{ kind: 'FLOW', id: 'relation-flow', sourceNodeId: 'node-1', targetNodeId: 'node-2' }],
    learningPath: [{ id: 'learning-1', order: 0, targetNodeId: 'node-1' }],
    diagnostics: {
      danglingFlowEdgeIds: [], invalidResourceRelationIds: [], unreferencedResourceIds: [],
      invalidLearningTargetIds: [], excludedDerivedNodeIds: [],
    },
  });
}

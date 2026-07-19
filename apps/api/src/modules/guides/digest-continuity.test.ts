import {
  FlowKnowledgeSnapshotV2Schema,
  type FlowKnowledgeSnapshotV2,
} from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildGuideDigestSnapshotDiff,
  hasGuideDigestBusinessChanges,
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
});

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

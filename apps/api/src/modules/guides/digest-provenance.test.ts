import type { FlowKnowledgeSnapshotV2, GuideDigestDraftV1 } from '@guideanything/contracts';
import { describeGuideDigestSources } from './digest-provenance';

import { describe, expect, it } from 'vitest';

describe('describeGuideDigestSources', () => {
  it('uses authoritative snapshot labels for every model-addressable source kind', () => {
    const descriptors = describeGuideDigestSources(snapshot(), draft());

    expect(descriptors).toEqual([
      { id: 'stage-1', kind: 'STAGE', label: '阶段：权威阶段' },
      { id: 'lane-1', kind: 'LANE', label: '角色：采购员' },
      { id: 'node-1', kind: 'NODE', label: '步骤：权威节点' },
      { id: 'node-2', kind: 'NODE', label: '步骤：权威结束' },
      { id: 'image-1', kind: 'RESOURCE', label: '图片：权威截图' },
      { id: 'video-1', kind: 'RESOURCE', label: '视频：权威演示' },
      { id: 'relation-1', kind: 'RELATION', label: '流程关系：权威节点 → 权威结束' },
      { id: 'learning-1', kind: 'LEARNING_STEP', label: '教学步骤 1：权威节点' },
      { id: 'annotation-1', kind: 'ANNOTATION', label: '图片标注：权威标注' },
      { id: 'keypoint-1', kind: 'KEYPOINT', label: '视频关键点：权威关键点（10 秒）' },
    ]);
    expect(descriptors.map(({ label }) => label)).not.toContain('阶段：模型伪造阶段');
    expect(descriptors.map(({ label }) => label)).not.toContain('步骤：模型伪造步骤');
  });

  it('rejects an ambiguous cross-kind ID before constructing descriptors', () => {
    const ambiguous = snapshot();
    const image = ambiguous.resources.find((resource) => resource.kind === 'IMAGE')!;
    const video = ambiguous.resources.find((resource) => resource.kind === 'VIDEO')!;
    video.keypoints[0]!.id = image.annotations[0]!.id;

    expect(() => describeGuideDigestSources(ambiguous, draft())).toThrow();
  });
});

function snapshot(): FlowKnowledgeSnapshotV2 {
  return {
    schemaVersion: 2,
    snapshotId: 'snapshot-1',
    workspaceId: 'workspace-1',
    workspaceItemId: 'item-1',
    guideId: 'guide-1',
    title: '权威指南',
    summary: '',
    tags: [],
    origin: { kind: 'DRAFT', revision: 1 },
    stages: [{ id: 'stage-1', title: '权威阶段', order: 0 }],
    lanes: [{ id: 'lane-1', title: '采购员', kind: 'ROLE', order: 0 }],
    nodes: [
      {
        id: 'node-1', locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'node-1' },
        kind: 'process', title: '权威节点', stage: { id: 'stage-1', title: '权威阶段', order: 0 },
        responsibility: { id: 'lane-1', title: '采购员', kind: 'ROLE', order: 0 },
        isEntry: true, isExit: false,
      },
      {
        id: 'node-2', locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'node-2' },
        kind: 'end', title: '权威结束', stage: { id: 'stage-1', title: '权威阶段', order: 0 },
        responsibility: null, isEntry: false, isExit: true,
      },
    ],
    resources: [
      {
        id: 'image-1', locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'image-1' },
        kind: 'IMAGE', order: 0, alt: '权威截图', annotations: [{
          id: 'annotation-1', order: 0, title: '权威标注', shape: 'POINT', region: { x: 0.1, y: 0.2 },
        }],
      },
      {
        id: 'video-1', locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'video-1' },
        kind: 'VIDEO', order: 1, caption: '权威演示', keypoints: [{
          id: 'keypoint-1', title: '权威关键点', timeSeconds: 10,
        }],
      },
    ],
    relations: [{ kind: 'FLOW', id: 'relation-1', sourceNodeId: 'node-1', targetNodeId: 'node-2' }],
    learningPath: [{ id: 'learning-1', order: 0, targetNodeId: 'node-1' }],
    diagnostics: {
      danglingFlowEdgeIds: [], invalidResourceRelationIds: [], unreferencedResourceIds: [],
      invalidLearningTargetIds: [], excludedDerivedNodeIds: [],
    },
  };
}

function draft(): GuideDigestDraftV1 {
  return {
    schemaVersion: 1,
    shortSummary: '摘要',
    scope: { audiences: [], businessObjects: [], systems: [] },
    stageSections: [{
      stageId: 'stage-1', title: '模型伪造阶段', overview: '概览',
      steps: [{
        targetId: 'node-1', title: '模型伪造步骤', description: '说明',
        inputs: [], actions: [], outputs: [], resourceIds: ['image-1', 'video-1'],
      }],
    }],
    keyRules: [{ statement: '规则', sourceIds: ['lane-1', 'node-2', 'relation-1', 'learning-1', 'annotation-1', 'keypoint-1'] }],
    tagSuggestions: [{ label: '建议', category: 'PROCESS', sourceIds: ['stage-1', 'node-1'] }],
    gaps: [],
  };
}

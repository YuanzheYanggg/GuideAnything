import {
  FlowKnowledgeSnapshotV2Schema,
  GuideDigestDraftV1Schema,
  type FlowKnowledgeResourceV2,
  type FlowKnowledgeSnapshotV2,
  type GuideDigestDraftV1,
} from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import type { GuideDigestProposal } from './digest-repository';

export type GuideDigestSourceKind =
  | 'STAGE'
  | 'LANE'
  | 'NODE'
  | 'RESOURCE'
  | 'RELATION'
  | 'LEARNING_STEP'
  | 'ANNOTATION'
  | 'KEYPOINT';

export interface GuideDigestSourceDescriptor {
  id: string;
  kind: GuideDigestSourceKind;
  label: string;
}

export type GuideDigestProposalView = GuideDigestProposal & {
  sourceDescriptors: GuideDigestSourceDescriptor[];
};

export function withGuideDigestSourceDescriptors(
  database: DatabaseSync,
  proposal: GuideDigestProposal,
): GuideDigestProposalView {
  if (!proposal.draft) return { ...proposal, sourceDescriptors: [] };
  const row = database.prepare(
    `SELECT snapshot_json
     FROM flow_knowledge_snapshots
     WHERE id = ? AND guide_id = ? AND workspace_id = ?`,
  ).get(proposal.baseSnapshotId, proposal.guideId, proposal.workspaceId) as {
    snapshot_json: string;
  } | undefined;
  if (!row) throw new Error('指南摘要提案缺少不可变来源快照');
  const snapshot = FlowKnowledgeSnapshotV2Schema.parse(JSON.parse(row.snapshot_json));
  return {
    ...proposal,
    sourceDescriptors: describeGuideDigestSources(snapshot, proposal.draft),
  };
}

export function describeGuideDigestSources(
  untrustedSnapshot: FlowKnowledgeSnapshotV2,
  untrustedDraft: GuideDigestDraftV1,
): GuideDigestSourceDescriptor[] {
  const snapshot = FlowKnowledgeSnapshotV2Schema.parse(untrustedSnapshot);
  const draft = GuideDigestDraftV1Schema.parse(untrustedDraft);
  const usedIds = collectUsedSourceIds(draft);
  const descriptors = buildDescriptorIndex(snapshot);

  return [...descriptors.values()].filter(({ id }) => usedIds.has(id));
}

function collectUsedSourceIds(draft: GuideDigestDraftV1): Set<string> {
  return new Set([
    ...draft.stageSections.flatMap((section) => [
      section.stageId,
      ...section.steps.flatMap((step) => [step.targetId, ...step.resourceIds]),
    ]),
    ...draft.keyRules.flatMap((rule) => rule.sourceIds),
    ...draft.tagSuggestions.flatMap((tag) => tag.sourceIds),
    ...draft.gaps.flatMap((gap) => gap.sourceIds),
  ]);
}

function buildDescriptorIndex(snapshot: FlowKnowledgeSnapshotV2): Map<string, GuideDigestSourceDescriptor> {
  const descriptors = new Map<string, GuideDigestSourceDescriptor>();
  const targetLabels = new Map<string, string>();
  const add = (descriptor: GuideDigestSourceDescriptor) => descriptors.set(descriptor.id, descriptor);

  for (const stage of snapshot.stages) {
    targetLabels.set(stage.id, stage.title);
    add({ id: stage.id, kind: 'STAGE', label: `阶段：${stage.title}` });
  }
  for (const lane of snapshot.lanes) {
    targetLabels.set(lane.id, lane.title);
    add({
      id: lane.id,
      kind: 'LANE',
      label: `${lane.kind === 'ROLE' ? '角色' : '系统'}：${lane.title}`,
    });
  }
  for (const node of snapshot.nodes) {
    targetLabels.set(node.id, node.title);
    add({ id: node.id, kind: 'NODE', label: `步骤：${node.title}` });
  }
  for (const resource of snapshot.resources) {
    const label = resourceLabel(resource);
    targetLabels.set(resource.id, label.title);
    add({ id: resource.id, kind: 'RESOURCE', label: `${label.kind}：${label.title}` });
  }
  for (const relation of snapshot.relations) {
    if (relation.kind === 'FLOW') {
      add({
        id: relation.id,
        kind: 'RELATION',
        label: `流程关系：${requiredLabel(targetLabels, relation.sourceNodeId)} → ${requiredLabel(targetLabels, relation.targetNodeId)}`,
      });
    } else if (relation.kind === 'USES_RESOURCE') {
      add({
        id: relation.id,
        kind: 'RELATION',
        label: `资料关联：${requiredLabel(targetLabels, relation.sourceNodeId)} → ${requiredLabel(targetLabels, relation.resourceId)}`,
      });
    } else {
      const targetId = relation.targetNodeId ?? relation.targetResourceId!;
      add({
        id: relation.id,
        kind: 'RELATION',
        label: `资料引用：${requiredLabel(targetLabels, relation.sourceResourceId)} → ${requiredLabel(targetLabels, targetId)}`,
      });
    }
  }
  for (const step of snapshot.learningPath) {
    const targetId = step.targetNodeId ?? step.targetResourceId!;
    add({
      id: step.id,
      kind: 'LEARNING_STEP',
      label: `教学步骤 ${step.order + 1}：${requiredLabel(targetLabels, targetId)}`,
    });
  }
  for (const resource of snapshot.resources) {
    if (resource.kind === 'IMAGE') {
      for (const annotation of resource.annotations) {
        add({ id: annotation.id, kind: 'ANNOTATION', label: `图片标注：${annotation.title}` });
      }
    } else if (resource.kind === 'VIDEO') {
      for (const keypoint of resource.keypoints) {
        add({
          id: keypoint.id,
          kind: 'KEYPOINT',
          label: `视频关键点：${keypoint.title}（${formatSeconds(keypoint.timeSeconds)} 秒）`,
        });
      }
    }
  }

  return descriptors;
}

function resourceLabel(resource: FlowKnowledgeResourceV2): { kind: string; title: string } {
  if (resource.kind === 'MARKDOWN') return { kind: 'Markdown', title: '操作说明' };
  if (resource.kind === 'IMAGE') return { kind: '图片', title: resource.alt };
  return { kind: '视频', title: resource.caption?.trim() || '视频资料' };
}

function requiredLabel(labels: ReadonlyMap<string, string>, id: string): string {
  const label = labels.get(id);
  if (!label) throw new Error('指南摘要来源描述缺少快照目标');
  return label;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

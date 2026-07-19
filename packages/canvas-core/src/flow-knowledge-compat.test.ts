import {
  FlowKnowledgeSnapshotV1Schema,
  FlowKnowledgeSnapshotV2Schema,
  type FlowKnowledgeSnapshotV1,
} from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { normalizeFlowKnowledgeSnapshot } from './flow-knowledge-compat';

describe('normalizeFlowKnowledgeSnapshot', () => {
  it('returns a validated semantic copy of an existing V2 snapshot', () => {
    const v2 = v2Snapshot();

    const normalized = normalizeFlowKnowledgeSnapshot(v2);

    expect(normalized).toEqual(FlowKnowledgeSnapshotV2Schema.parse(v2));
    expect(normalized).not.toBe(v2);
    expect(normalized.nodes).not.toBe(v2.nodes);
  });

  it('normalizes V1 attachments, deduplicated flow edges, and loose resources without mutation', () => {
    const v1 = v1Snapshot();
    const before = JSON.parse(JSON.stringify(v1));

    const normalized = normalizeFlowKnowledgeSnapshot(v1);

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.resources.map((resource) => resource.id)).toEqual(['loose-note', 'note']);
    expect(normalized.relations).toEqual([
      { kind: 'FLOW', id: 'edge-1', sourceNodeId: 'start', targetNodeId: 'finish', label: '继续' },
      { kind: 'USES_RESOURCE', id: 'uses:start:note', sourceNodeId: 'start', resourceId: 'note' },
    ]);
    expect(normalized.diagnostics.unreferencedResourceIds).toEqual(['loose-note']);
    expect(v1).toEqual(before);
  });

  it('keeps a flow edge when its ID collides with a synthesized resource relation ID', () => {
    const v1 = v1Snapshot();
    const colliding = FlowKnowledgeSnapshotV1Schema.parse({
      ...v1,
      nodes: v1.nodes.map((current) => current.id === 'start'
        ? { ...current, outgoing: [{ edgeId: 'uses:start:note', nodeId: 'finish' }] }
        : { ...current, incoming: [{ edgeId: 'uses:start:note', nodeId: 'start' }] }),
    });

    const normalized = normalizeFlowKnowledgeSnapshot(colliding);

    expect(normalized.relations.map((relation) => relation.id)).toEqual([
      'uses:start:note',
      'uses:start:note:2',
    ]);
  });
});

function v1Snapshot(): FlowKnowledgeSnapshotV1 {
  return FlowKnowledgeSnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    workspaceId: 'workspace-1',
    workspaceItemId: 'item-1',
    guideId: 'guide-1',
    title: '订单处理',
    summary: '从接单到完成。',
    tags: ['订单'],
    origin: { kind: 'DRAFT', revision: 7 },
    stages: [],
    lanes: [],
    entryNodeId: 'start',
    exitNodeIds: ['finish'],
    nodes: [
      node('start', true, false, [], [{ edgeId: 'edge-1', nodeId: 'finish', label: '继续' }], [attachment('note')]),
      node('finish', false, true, [{ edgeId: 'edge-1', nodeId: 'start', label: '继续' }], [], []),
    ],
    unattachedResources: [attachment('loose-note')],
    diagnostics: {
      danglingEdgeIds: [],
      danglingAttachmentParentIds: [],
      danglingTargetNodeIds: [],
      danglingStageIds: [],
      danglingLaneIds: [],
      danglingEntryNodeIds: [],
      danglingExitNodeIds: [],
    },
  });
}

function v2Snapshot() {
  return {
    schemaVersion: 2,
    snapshotId: 'snapshot-1',
    workspaceId: 'workspace-1',
    workspaceItemId: 'item-1',
    guideId: 'guide-1',
    title: '订单处理',
    summary: '从接单到完成。',
    tags: ['订单'],
    origin: { kind: 'DRAFT', revision: 7 },
    stages: [],
    lanes: [],
    nodes: [{
      id: 'start',
      locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'start' },
      kind: 'start',
      title: '开始',
      stage: null,
      responsibility: null,
      isEntry: true,
      isExit: true,
    }],
    resources: [],
    relations: [],
    learningPath: [{ id: 'step-1', order: 0, targetNodeId: 'start' }],
    diagnostics: {
      danglingFlowEdgeIds: [],
      invalidResourceRelationIds: [],
      unreferencedResourceIds: [],
      invalidLearningTargetIds: [],
      excludedDerivedNodeIds: [],
    },
  };
}

function node(
  id: string,
  isEntry: boolean,
  isExit: boolean,
  incoming: Array<{ edgeId: string; nodeId: string; label?: string }>,
  outgoing: Array<{ edgeId: string; nodeId: string; label?: string }>,
  attachments: Array<ReturnType<typeof attachment>>,
) {
  return {
    id,
    locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: id },
    kind: isEntry ? 'start' : 'end',
    title: isEntry ? '开始' : '完成',
    stage: null,
    responsibility: null,
    isEntry,
    isExit,
    incoming,
    outgoing,
    neighborhood: { oneHopNodeIds: incoming.map((edge) => edge.nodeId), twoHopNodeIds: [] },
    attachments,
  };
}

function attachment(id: string) {
  return {
    kind: 'MARKDOWN' as const,
    nodeId: id,
    locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: id },
    order: id === 'note' ? 0 : 1,
    markdown: id === 'note' ? '核对订单字段。' : '独立资料。',
  };
}

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
      { kind: 'USES_RESOURCE', id: 'uses:7h91gq', sourceNodeId: 'start', resourceId: 'note' },
    ]);
    expect(normalized.diagnostics.unreferencedResourceIds).toEqual(['loose-note']);
    expect(v1).toEqual(before);
  });

  it('keeps a flow edge when its ID collides with a synthesized resource relation ID', () => {
    const v1 = v1Snapshot();
    const colliding = FlowKnowledgeSnapshotV1Schema.parse({
      ...v1,
      nodes: v1.nodes.map((current) => current.id === 'start'
        ? { ...current, outgoing: [{ edgeId: 'uses:7h91gq', nodeId: 'finish' }] }
        : { ...current, incoming: [{ edgeId: 'uses:7h91gq', nodeId: 'start' }] }),
    });

    const normalized = normalizeFlowKnowledgeSnapshot(colliding);

    expect(normalized.relations.map((relation) => relation.id)).toEqual([
      'uses:7h91gq',
      'uses:7h91gq:2',
    ]);
  });

  it('normalizes maximum-length V1 endpoint IDs into bounded synthesized relation IDs', () => {
    const parentNodeId = 'p'.repeat(200);
    const resourceId = 'r'.repeat(200);
    const annotationId = 'a'.repeat(200);
    const v1 = v1Snapshot();
    const longIds = FlowKnowledgeSnapshotV1Schema.parse({
      ...v1,
      entryNodeId: parentNodeId,
      nodes: [
        {
          ...v1.nodes[0],
          id: parentNodeId,
          locator: locator(parentNodeId),
          outgoing: [{ edgeId: 'edge-1', nodeId: 'finish', label: '继续' }],
          attachments: [{
            kind: 'IMAGE',
            nodeId: resourceId,
            locator: locator(resourceId),
            order: 0,
            alt: '订单页面',
            annotations: [{
              id: annotationId,
              order: 0,
              title: '完成订单',
              shape: 'POINT',
              region: { x: 0.5, y: 0.5 },
              targetNodeId: 'finish',
              targetLocator: locator('finish'),
            }],
          }],
        },
        {
          ...v1.nodes[1],
          incoming: [{ edgeId: 'edge-1', nodeId: parentNodeId, label: '继续' }],
          neighborhood: { oneHopNodeIds: [parentNodeId], twoHopNodeIds: [] },
        },
      ],
      unattachedResources: [],
    });

    const normalized = normalizeFlowKnowledgeSnapshot(longIds);

    expect(normalized.relations.every((relation) => relation.id.length <= 200)).toBe(true);
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

function locator(nodeId: string) {
  return { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId };
}

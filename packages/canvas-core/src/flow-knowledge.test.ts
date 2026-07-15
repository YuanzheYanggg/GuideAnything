import type { CanvasDocument, CanvasNode } from '@guideanything/contracts';
import { FlowKnowledgeSnapshotV1Schema } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { compileFlowKnowledgeSnapshotV1, type CompileFlowKnowledgeSnapshotInputV1 } from './flow-knowledge';

describe('compileFlowKnowledgeSnapshotV1', () => {
  it('is deterministic and ignores presentation-only movement', () => {
    const document = flowDocument();
    const first = compileFlowKnowledgeSnapshotV1(input(document));
    const repeated = compileFlowKnowledgeSnapshotV1(input(document));
    const moved = compileFlowKnowledgeSnapshotV1(input({
      ...document,
      viewport: { x: 900, y: -200, zoom: 0.6 },
      nodes: document.nodes.map((node) => ({
        ...node,
        position: { x: node.position.x + 500, y: node.position.y + 100 },
        zIndex: node.zIndex + 10,
      })),
    }));

    expect(repeated).toEqual(first);
    expect(moved).toEqual(first);
  });

  it('maps stages, lanes, entry, exits, and branch labels without coordinates', () => {
    const snapshot = compileFlowKnowledgeSnapshotV1(input(flowDocument()));
    const decision = snapshot.nodes.find((node) => node.id === 'decision');

    expect(snapshot.stages.map((stage) => stage.id)).toEqual(['prepare-a', 'prepare-b', 'delivery']);
    expect(snapshot.lanes.map((lane) => lane.id)).toEqual(['operator-a', 'operator-b', 'system']);
    expect(snapshot.entryNodeId).toBe('start');
    expect(snapshot.exitNodeIds).toEqual(['done']);
    expect(snapshot.nodes.find((node) => node.id === 'start')).toEqual(expect.objectContaining({
      isEntry: true,
      isExit: false,
      stage: expect.objectContaining({ id: 'prepare-a', title: '准备 A' }),
      responsibility: expect.objectContaining({ id: 'operator-a', kind: 'ROLE' }),
    }));
    expect(snapshot.nodes.find((node) => node.id === 'done')).toEqual(expect.objectContaining({
      isEntry: false,
      isExit: true,
    }));
    expect(decision?.outgoing).toEqual(expect.arrayContaining([
      { edgeId: 'edge-yes', nodeId: 'approve', branchLabel: '通过' },
      { edgeId: 'edge-no', nodeId: 'revise', label: '补充资料', branchLabel: '补充资料' },
    ]));
  });

  it('keeps parallel edges while producing stable one-hop and two-hop neighborhoods', () => {
    const snapshot = compileFlowKnowledgeSnapshotV1(input(flowDocument()));
    const decision = snapshot.nodes.find((node) => node.id === 'decision');
    const start = snapshot.nodes.find((node) => node.id === 'start');

    expect(decision?.outgoing.filter((edge) => edge.nodeId === 'approve').map((edge) => edge.edgeId)).toEqual([
      'edge-parallel',
      'edge-yes',
    ]);
    expect(decision?.neighborhood).toEqual({
      oneHopNodeIds: ['approve', 'revise', 'start'],
      twoHopNodeIds: ['done'],
    });
    expect(start?.neighborhood).toEqual({
      oneHopNodeIds: ['decision'],
      twoHopNodeIds: ['approve', 'revise'],
    });
  });

  it('keeps self-loop relations without treating the node as its own neighbor', () => {
    const document = flowDocument();
    const snapshot = compileFlowKnowledgeSnapshotV1(input({
      ...document,
      edges: [...document.edges, { id: 'edge-self', source: 'revise', target: 'revise' }],
    }));
    const revise = snapshot.nodes.find((node) => node.id === 'revise');

    expect(revise?.outgoing).toContainEqual({ edgeId: 'edge-self', nodeId: 'revise' });
    expect(revise?.neighborhood.oneHopNodeIds).not.toContain('revise');
    expect(revise?.neighborhood.twoHopNodeIds).not.toContain('revise');
  });

  it('attaches semantic resources, preserves their own locators, and keeps loose resources', () => {
    const snapshot = compileFlowKnowledgeSnapshotV1(input(flowDocument()));
    const decision = snapshot.nodes.find((node) => node.id === 'decision');
    const image = decision?.attachments.find((attachment) => attachment.kind === 'IMAGE');
    const approve = snapshot.nodes.find((node) => node.id === 'approve');
    const video = approve?.attachments.find((attachment) => attachment.kind === 'VIDEO');

    expect(decision?.attachments.map((attachment) => attachment.nodeId)).toEqual(['note', 'image']);
    expect(image).toEqual(expect.objectContaining({
      locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'image' },
      alt: '订单页面',
    }));
    if (image?.kind !== 'IMAGE') throw new Error('expected image attachment');
    expect(image.annotations[0]).toEqual(expect.objectContaining({
      targetNodeId: 'approve',
      targetLocator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'approve' },
    }));
    if (video?.kind !== 'VIDEO') throw new Error('expected video attachment');
    expect(video.keypoints[0]).toEqual(expect.objectContaining({
      targetLocator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'done' },
    }));
    expect(snapshot.unattachedResources.map((attachment) => attachment.nodeId)).toEqual(['loose-note']);
    expect(snapshot.diagnostics.danglingTargetNodeIds).toEqual(['missing-target']);
  });

  it('excludes derived nodes and source-traced presentation edges', () => {
    const snapshot = compileFlowKnowledgeSnapshotV1(input(flowDocument()));

    expect(snapshot.nodes.some((node) => node.id === 'derived-process')).toBe(false);
    expect(snapshot.nodes.flatMap((node) => [...node.incoming, ...node.outgoing]).some((edge) => edge.edgeId === 'edge-derived')).toBe(false);
  });

  it('recovers a hidden subguide continuation from persisted continuation metadata', () => {
    const snapshot = compileFlowKnowledgeSnapshotV1(input(expandedSubguideDocument()));
    const reference = snapshot.nodes.find((node) => node.id === 'reference');

    expect(reference?.outgoing).toEqual([
      { edgeId: 'continuation', nodeId: 'after', label: '继续' },
    ]);
    expect(reference?.neighborhood.oneHopNodeIds).toEqual(['after']);
    expect(snapshot.nodes.some((node) => node.id === 'ref:reference:source-step')).toBe(false);
    expect(reference?.outgoing.some((edge) => edge.edgeId === 'hidden-unrelated')).toBe(false);
  });

  it('honors a continuation original hidden state and diagnoses missing continuation edges', () => {
    const document = expandedSubguideDocument();
    const snapshot = compileFlowKnowledgeSnapshotV1(input({
      ...document,
      nodes: document.nodes.map((node) => node.id === 'reference' && node.type === 'subguide'
        ? {
          ...node,
          data: {
            ...node.data,
            expandedContinuationEdges: [
              { id: 'continuation', hidden: false },
              { id: 'originally-hidden', hidden: true },
              { id: 'missing-continuation', hidden: false },
            ],
          },
        }
        : node),
      edges: [
        ...document.edges,
        { id: 'originally-hidden', source: 'reference', target: 'ignored', hidden: true },
      ],
    }));
    const reference = snapshot.nodes.find((node) => node.id === 'reference');

    expect(reference?.outgoing.map((edge) => edge.edgeId)).toEqual(['continuation']);
    expect(snapshot.diagnostics.danglingEdgeIds).toEqual(['missing-continuation']);
  });

  it('diagnoses an originally visible continuation whose endpoint is excluded', () => {
    const document = expandedSubguideDocument();
    const snapshot = compileFlowKnowledgeSnapshotV1(input({
      ...document,
      edges: document.edges.map((edge) => edge.id === 'continuation'
        ? { ...edge, target: 'ref:reference:source-step' }
        : edge),
    }));
    const reference = snapshot.nodes.find((node) => node.id === 'reference');

    expect(reference?.outgoing).toEqual([]);
    expect(snapshot.diagnostics.danglingEdgeIds).toEqual(['continuation']);
  });

  it('records non-semantic and dangling relations as diagnostics instead of throwing', () => {
    const snapshot = compileFlowKnowledgeSnapshotV1(input(flowDocument()));

    expect(snapshot.diagnostics.danglingEdgeIds).toEqual(['edge-resource']);
    expect(snapshot.diagnostics.danglingTargetNodeIds).toEqual(['missing-target']);
  });

  it('emits a JSON-safe snapshot accepted by the shared schema', () => {
    const snapshot = compileFlowKnowledgeSnapshotV1(input(flowDocument()));
    const roundTrip = JSON.parse(JSON.stringify(snapshot));

    expect(FlowKnowledgeSnapshotV1Schema.parse(roundTrip)).toEqual(snapshot);
  });
});

function input(document: CanvasDocument): CompileFlowKnowledgeSnapshotInputV1 {
  return {
    snapshotId: 'snapshot-1',
    workspaceId: 'workspace-1',
    workspaceItemId: 'workspace-item-1',
    guideId: 'guide-1',
    title: '订单处理',
    summary: '订单从接收到交付的流程。',
    tags: ['订单', 'ERP'],
    origin: { kind: 'DRAFT', revision: 4 },
    document,
  };
}

function flowDocument(): CanvasDocument {
  return {
    schemaVersion: 1,
    stages: [
      { id: 'delivery', title: '交付', order: 1 },
      { id: 'prepare-b', title: '准备 B', order: 0 },
      { id: 'prepare-a', title: '准备 A', order: 0 },
    ],
    lanes: [
      { id: 'system', title: 'ERP', kind: 'SYSTEM', order: 1 },
      { id: 'operator-b', title: '复核员', kind: 'ROLE', order: 0 },
      { id: 'operator-a', title: '订单员', kind: 'ROLE', order: 0 },
    ],
    nodes: [
      flowNode('start', 'start', '开始', 'prepare-a', 'operator-a'),
      {
        ...flowNode('decision', 'decision', '资料是否完整', 'prepare-a', 'operator-a'),
        data: { label: '资料是否完整', shape: 'decision', branchLabels: ['通过', '退回'] },
      },
      flowNode('approve', 'process', '审核订单', 'delivery', 'system'),
      flowNode('revise', 'process', '补充资料', 'prepare-b', 'operator-b'),
      flowNode('done', 'end', '完成', 'delivery', 'system'),
      {
        id: 'note',
        type: 'markdown',
        position: { x: 200, y: 300 },
        zIndex: 6,
        contentParentId: 'decision',
        data: { markdown: '检查客户、交期与物料字段。' },
      },
      {
        id: 'image',
        type: 'image',
        position: { x: 400, y: 300 },
        zIndex: 7,
        contentParentId: 'decision',
        data: {
          assetId: 'asset-image',
          url: '/api/media/asset-image',
          alt: '订单页面',
          caption: '订单录入界面',
          annotations: [
            {
              id: 'annotation-valid',
              order: 0,
              title: '审核入口',
              shape: 'POINT',
              region: { x: 0.2, y: 0.4 },
              targetNodeId: 'approve',
            },
            {
              id: 'annotation-dangling',
              order: 1,
              title: '旧入口',
              shape: 'POINT',
              region: { x: 0.7, y: 0.4 },
              targetNodeId: 'missing-target',
            },
          ],
        },
      },
      {
        id: 'video',
        type: 'video',
        position: { x: 600, y: 300 },
        zIndex: 8,
        contentParentId: 'approve',
        data: {
          assetId: 'asset-video',
          url: '/api/media/asset-video',
          caption: '审核演示',
          keypoints: [{ id: 'keypoint-1', title: '完成审核', timeSeconds: 12, targetNodeId: 'done' }],
        },
      },
      {
        id: 'loose-note',
        type: 'markdown',
        position: { x: 800, y: 300 },
        zIndex: 9,
        data: { markdown: '未挂靠资料。' },
      },
      {
        ...flowNode('derived-process', 'process', '派生步骤'),
        source: {
          referenceNodeId: 'reference',
          sourceGuideId: 'source-guide',
          sourceVersionId: 'source-version',
          sourceElementId: 'source-process',
        },
      },
    ],
    edges: [
      { id: 'edge-start', source: 'start', target: 'decision' },
      { id: 'edge-yes', source: 'decision', sourceHandle: 'yes', target: 'approve' },
      { id: 'edge-parallel', source: 'decision', target: 'approve', label: '备用路径' },
      { id: 'edge-no', source: 'decision', sourceHandle: 'no', target: 'revise', label: '补充资料' },
      { id: 'edge-approve', source: 'approve', target: 'done' },
      { id: 'edge-revise', source: 'revise', target: 'decision' },
      { id: 'edge-resource', source: 'decision', target: 'loose-note' },
      {
        id: 'edge-derived',
        source: 'decision',
        target: 'derived-process',
        sourceTrace: {
          referenceNodeId: 'reference',
          sourceGuideId: 'source-guide',
          sourceVersionId: 'source-version',
          sourceElementId: 'source-edge',
        },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [],
    entryNodeId: 'start',
    exitNodeIds: ['done'],
  };
}

function expandedSubguideDocument(): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'reference',
        type: 'subguide',
        position: { x: 0, y: 0 },
        zIndex: 0,
        data: {
          guideId: 'source-guide',
          guideVersionId: 'source-version',
          title: '物料检查',
          version: 2,
          expanded: true,
          sourceEntryNodeId: 'source-step',
          sourceExitNodeIds: ['source-step'],
          expandedContinuationEdges: [{ id: 'continuation', hidden: false }],
        },
      },
      flowNode('after', 'end', '宿主后续'),
      flowNode('ignored', 'process', '隐藏但非接续'),
      {
        ...flowNode('ref:reference:source-step', 'process', '派生步骤'),
        source: {
          referenceNodeId: 'reference',
          sourceGuideId: 'source-guide',
          sourceVersionId: 'source-version',
          sourceElementId: 'source-step',
        },
      },
    ],
    edges: [
      { id: 'continuation', source: 'reference', target: 'after', label: '继续', hidden: true },
      { id: 'hidden-unrelated', source: 'reference', target: 'ignored', hidden: true },
      {
        id: 'derived-edge',
        source: 'reference',
        target: 'ref:reference:source-step',
        sourceTrace: {
          referenceNodeId: 'reference',
          sourceGuideId: 'source-guide',
          sourceVersionId: 'source-version',
          sourceElementId: '__entry__',
        },
      },
      {
        id: 'derived-bridge',
        source: 'ref:reference:source-step',
        target: 'after',
        sourceTrace: {
          referenceNodeId: 'reference',
          sourceGuideId: 'source-guide',
          sourceVersionId: 'source-version',
          sourceElementId: '__exit__:source-step:to:continuation',
        },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [],
    entryNodeId: 'reference',
    exitNodeIds: ['after'],
  };
}

function flowNode<TType extends 'start' | 'end' | 'process' | 'decision' | 'data'>(
  id: string,
  type: TType,
  label: string,
  stageId?: string,
  laneId?: string,
): CanvasNode<TType> {
  return {
    id,
    type,
    position: { x: id.length * 20, y: id.length * 10 },
    zIndex: id.length,
    ...(stageId ? { stageId } : {}),
    ...(laneId ? { laneId } : {}),
    data: { label, shape: type },
  } as CanvasNode<TType>;
}

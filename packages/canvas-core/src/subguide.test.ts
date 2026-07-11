import { describe, expect, it } from 'vitest';
import type { CanvasDocument, CanvasEdge, CanvasNode, GuideVersionSnapshot } from '@guideanything/contracts';

import { expandSubguide, reconcileSubguideEdges, setSubguideExpanded } from './subguide';

const host: CanvasDocument = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'ref-1',
      type: 'subguide',
      position: { x: 100, y: 100 },
      zIndex: 1,
      data: {
        guideId: 'guide-source',
        guideVersionId: 'version-1',
        title: '物料主数据检查',
        version: 1,
        expanded: false,
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  exitNodeIds: [],
};

const hostWithContinuation: CanvasDocument = {
  ...host,
  nodes: [
    { id: 'host-in', type: 'start', position: { x: -180, y: 100 }, zIndex: 0, data: { label: '宿主入口', shape: 'start' } },
    host.nodes[0] as CanvasNode<'subguide'>,
    { id: 'host-out', type: 'end', position: { x: 820, y: 100 }, zIndex: 0, data: { label: '宿主后续', shape: 'end' } },
  ],
  edges: [
    { id: 'host-in-reference', source: 'host-in', target: 'ref-1' },
    { id: 'reference-host-out', source: 'ref-1', target: 'host-out', label: '继续' },
  ],
};

const snapshot: GuideVersionSnapshot = {
  id: 'version-1',
  guideId: 'guide-source',
  version: 1,
  title: '物料主数据检查',
  summary: '检查物料是否可销售',
  tags: ['ERP', '物料'],
  document: {
    schemaVersion: 1,
    nodes: [
      { id: 'source-start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
      { id: 'source-end', type: 'end', position: { x: 240, y: 0 }, zIndex: 0, data: { label: '完成', shape: 'end' } },
    ],
    edges: [{ id: 'source-edge', source: 'source-start', target: 'source-end' }],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [{ id: 'source-step', order: 1, title: '检查', nodeId: 'source-start' }],
    entryNodeId: 'source-start',
    exitNodeIds: ['source-end'],
  },
};

describe('expandSubguide', () => {
  it('namespaces source IDs, offsets coordinates, and records origin', () => {
    const reference = host.nodes[0] as CanvasNode<'subguide'>;
    const expanded = expandSubguide(host, reference, snapshot);
    const derived = expanded.nodes.find((node) => node.id === 'ref:ref-1:source-start');

    expect(derived?.position).toEqual({ x: 420, y: 100 });
    expect(derived?.source).toEqual({
      referenceNodeId: 'ref-1',
      sourceGuideId: 'guide-source',
      sourceVersionId: 'version-1',
      sourceElementId: 'source-start',
    });
    expect((expanded.nodes.find((node) => node.id === 'ref-1') as CanvasNode<'subguide'>).data).toEqual(expect.objectContaining({
      sourceEntryNodeId: 'source-start',
      sourceExitNodeIds: ['source-end'],
    }));
    expect(expanded.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ref:ref-1:source-edge',
        source: 'ref:ref-1:source-start',
        target: 'ref:ref-1:source-end',
      }),
      expect.objectContaining({ source: 'ref-1', target: 'ref:ref-1:source-start' }),
    ]));
    expect(expanded.steps[0]?.nodeId).toBe('ref:ref-1:source-start');
  });

  it('is idempotent and can hide and reveal only derived elements', () => {
    const reference = host.nodes[0] as CanvasNode<'subguide'>;
    const once = expandSubguide(host, reference, snapshot);
    expect(expandSubguide(once, reference, snapshot)).toEqual(once);

    const collapsed = setSubguideExpanded(once, 'ref-1', false);
    expect(collapsed.nodes.find(isDerived)?.hidden).toBe(true);
    expect(collapsed.nodes.find((node) => node.id === 'ref-1')?.hidden).not.toBe(true);

    const reopened = setSubguideExpanded(collapsed, 'ref-1', true);
    expect(reopened.nodes.find(isDerived)?.hidden).toBe(false);
  });

  it('hides and reveals a manual cross-edge that touches a derived node', () => {
    const reference = host.nodes[0] as CanvasNode<'subguide'>;
    const expanded = expandSubguide(host, reference, snapshot);
    const withManualCrossEdge = addEdge(expanded, {
      id: 'cross',
      source: 'ref:ref-1:source-end',
      sourceHandle: 'out',
      target: 'ref-1',
      targetHandle: 'in',
      hidden: false,
    });

    const collapsed = setSubguideExpanded(withManualCrossEdge, 'ref-1', false);
    expect(collapsed.edges.find((edge) => edge.id === 'cross')?.hidden).toBe(true);

    const reopened = setSubguideExpanded(collapsed, 'ref-1', true);
    expect(reopened.edges.find((edge) => edge.id === 'cross')?.hidden).toBe(false);
  });

  it('splices each subguide exit into host continuation edges without creating a reference loop', () => {
    const reference = hostWithContinuation.nodes.find((node) => node.id === 'ref-1') as CanvasNode<'subguide'>;
    const expanded = expandSubguide(hostWithContinuation, reference, snapshot);
    const bridgeId = 'ref:ref-1:__exit__:source-end:to:reference-host-out';

    expect(expanded.edges.find((edge) => edge.id === 'reference-host-out')).toEqual(expect.objectContaining({ hidden: true }));
    expect((expanded.nodes.find((node) => node.id === 'ref-1') as CanvasNode<'subguide'>).data.expandedContinuationEdges).toEqual([
      { id: 'reference-host-out', hidden: false },
    ]);
    expect(expanded.edges).toContainEqual(expect.objectContaining({
      id: bridgeId,
      source: 'ref:ref-1:source-end',
      target: 'host-out',
      label: '继续',
    }));
    expect(expanded.edges).not.toContainEqual(expect.objectContaining({
      source: 'ref:ref-1:source-end',
      target: 'ref-1',
    }));

    const collapsed = setSubguideExpanded(expanded, 'ref-1', false);
    expect(collapsed.edges.find((edge) => edge.id === 'reference-host-out')).toEqual(expect.objectContaining({ hidden: false }));
    expect(collapsed.edges.find((edge) => edge.id === bridgeId)).toEqual(expect.objectContaining({ hidden: true }));

    const reopened = setSubguideExpanded(collapsed, 'ref-1', true);
    expect(reopened.edges.find((edge) => edge.id === 'reference-host-out')).toEqual(expect.objectContaining({ hidden: true }));
    expect(reopened.edges.find((edge) => edge.id === bridgeId)).toEqual(expect.objectContaining({ hidden: false }));
  });

  it('removes an obsolete exit proxy when its host continuation is deleted', () => {
    const reference = hostWithContinuation.nodes.find((node) => node.id === 'ref-1') as CanvasNode<'subguide'>;
    const expanded = expandSubguide(hostWithContinuation, reference, snapshot);
    const bridgeId = 'ref:ref-1:__exit__:source-end:to:reference-host-out';
    const collapsed = setSubguideExpanded(expanded, 'ref-1', false);
    const withoutContinuation = {
      ...collapsed,
      edges: collapsed.edges.filter((edge) => edge.id !== 'reference-host-out'),
    };

    const reopened = setSubguideExpanded(withoutContinuation, 'ref-1', true);
    expect(reopened.edges.find((edge) => edge.id === bridgeId)).toBeUndefined();
  });

  it('repairs missing provenance and stale visibility from a derived endpoint', () => {
    const reference = host.nodes[0] as CanvasNode<'subguide'>;
    const expanded = expandSubguide(host, reference, snapshot);
    const corrupted = addEdge(expanded, {
      id: 'cross',
      source: 'ref:ref-1:source-end',
      sourceHandle: 'out',
      target: 'ref-1',
      targetHandle: 'in',
      hidden: true,
    });

    const reconciled = setSubguideExpanded(corrupted, 'ref-1', true);
    expect(reconciled.edges.find((edge) => edge.id === 'cross')).toEqual(expect.objectContaining({
      hidden: false,
      sourceTrace: {
        referenceNodeId: 'ref-1',
        sourceGuideId: 'guide-source',
        sourceVersionId: 'version-1',
        sourceElementId: 'source-end',
      },
    }));
  });

  it('repairs a missing exit bridge for an already-expanded legacy reference', () => {
    const reference = hostWithContinuation.nodes.find((node) => node.id === 'ref-1') as CanvasNode<'subguide'>;
    const expanded = expandSubguide(hostWithContinuation, reference, snapshot);
    const legacy = {
      ...expanded,
      nodes: expanded.nodes.map((node) => node.id === 'ref-1' && node.type === 'subguide'
        ? { ...node, data: { ...node.data, expandedContinuationEdges: undefined } }
        : node),
      edges: expanded.edges
        .filter((edge) => edge.id !== 'ref:ref-1:__exit__:source-end:to:reference-host-out')
        .map((edge) => edge.id === 'reference-host-out' ? { ...edge, hidden: false } : edge)
        .concat({
          id: 'ref:ref-1:__exit__:source-end',
          source: 'ref:ref-1:source-end',
          sourceHandle: 'out',
          target: 'ref-1',
          targetHandle: 'in',
          hidden: false,
          sourceTrace: {
            referenceNodeId: 'ref-1',
            sourceGuideId: 'guide-source',
            sourceVersionId: 'version-1',
            sourceElementId: '__exit__:source-end',
          },
        }),
    };

    const repaired = reconcileSubguideEdges(legacy);
    expect(repaired.edges).toContainEqual(expect.objectContaining({
      id: 'ref:ref-1:__exit__:source-end:to:reference-host-out',
      source: 'ref:ref-1:source-end',
      target: 'host-out',
      sourceTrace: expect.objectContaining({ referenceNodeId: 'ref-1', sourceElementId: '__exit__:source-end:to:reference-host-out' }),
    }));
    expect(repaired.edges.find((edge) => edge.id === 'reference-host-out')).toEqual(expect.objectContaining({ hidden: true }));
    expect(repaired.edges).not.toContainEqual(expect.objectContaining({
      id: 'ref:ref-1:__exit__:source-end',
      target: 'ref-1',
    }));
  });

  it('normalizes stale derived visibility from a collapsed reference', () => {
    const reference = host.nodes[0] as CanvasNode<'subguide'>;
    const expanded = expandSubguide(host, reference, snapshot);
    const staleCollapsed = {
      ...expanded,
      nodes: expanded.nodes.map((node) => node.id === 'ref-1' && node.type === 'subguide'
        ? { ...node, data: { ...node.data, expanded: false } }
        : node.source ? { ...node, hidden: false } : node),
      edges: expanded.edges.map((edge) => ({ ...edge, hidden: false })),
    };

    const normalized = reconcileSubguideEdges(staleCollapsed);
    expect(normalized.nodes.filter(isDerived).every((node) => node.hidden === true)).toBe(true);
    expect(normalized.edges.filter((edge) => edge.source.startsWith('ref:ref-1:')).every((edge) => edge.hidden === true)).toBe(true);
  });

  it('keeps an expanded nested subguide hidden while its parent reference is collapsed', () => {
    const reference = host.nodes[0] as CanvasNode<'subguide'>;
    const expanded = expandSubguide(host, reference, snapshot);
    const nestedReference: CanvasNode<'subguide'> = {
      id: 'ref:ref-1:nested-reference',
      type: 'subguide',
      position: { x: 600, y: 100 },
      zIndex: 1,
      data: { guideId: 'nested-guide', guideVersionId: 'nested-version', title: '嵌套指南', version: 1, expanded: true },
      source: { referenceNodeId: 'ref-1', sourceGuideId: 'guide-source', sourceVersionId: 'version-1', sourceElementId: 'nested-reference' },
    };
    const nestedDerived: CanvasNode<'process'> = {
      id: 'ref:ref-1:nested-derived',
      type: 'process',
      position: { x: 860, y: 100 },
      zIndex: 1,
      data: { label: '嵌套步骤', shape: 'process' },
      source: { referenceNodeId: nestedReference.id, sourceGuideId: 'nested-guide', sourceVersionId: 'nested-version', sourceElementId: 'nested-step' },
    };
    const withNested = { ...expanded, nodes: [...expanded.nodes, nestedReference, nestedDerived] };

    const collapsed = setSubguideExpanded(withNested, 'ref-1', false);
    expect(collapsed.nodes.find((node) => node.id === nestedReference.id)?.hidden).toBe(true);
    expect(collapsed.nodes.find((node) => node.id === nestedDerived.id)?.hidden).toBe(true);

    const reopened = setSubguideExpanded(collapsed, 'ref-1', true);
    expect(reopened.nodes.find((node) => node.id === nestedDerived.id)?.hidden).toBe(false);
  });
});

function addEdge(document: CanvasDocument, edge: CanvasEdge): CanvasDocument {
  return { ...document, edges: [...document.edges, edge] };
}

function isDerived(node: CanvasDocument['nodes'][number]): boolean {
  return node.source?.referenceNodeId === 'ref-1';
}

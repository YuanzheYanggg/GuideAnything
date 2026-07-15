import type { CanvasDocument, GuideVersionSnapshot } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { expandSubguide, setSubguideExpanded } from './subguide';
import { layoutFlowHierarchy } from './hierarchy';
import { routeCanvasEdges } from './routing';

describe('large guide transformations', () => {
  it('expands and collapses a 1000-node pinned snapshot within 500ms', () => {
    const sourceNodes: CanvasDocument['nodes'] = Array.from({ length: 1_000 }, (_, index) => ({
      id: `source-${index}`,
      type: 'process' as const,
      position: { x: (index % 20) * 260, y: Math.floor(index / 20) * 180 },
      zIndex: index,
      data: { label: `步骤 ${index}`, shape: 'process' as const },
    }));
    const snapshot: GuideVersionSnapshot = {
      id: 'large-version', guideId: 'large-guide', version: 1, title: '大型流程', summary: '', tags: [],
      document: {
        schemaVersion: 1,
        nodes: sourceNodes,
        edges: sourceNodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: sourceNodes[index]!.id, target: node.id })),
        viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'source-0', exitNodeIds: ['source-999'],
      },
    };
    const reference: CanvasDocument['nodes'][number] = {
      id: 'reference', type: 'subguide', position: { x: 0, y: 0 }, zIndex: 1,
      data: { guideId: snapshot.guideId, guideVersionId: snapshot.id, title: snapshot.title, version: 1, expanded: false },
    };
    const host: CanvasDocument = {
      schemaVersion: 1, nodes: [reference], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };

    const started = performance.now();
    const expanded = expandSubguide(host, reference, snapshot);
    const collapsed = setSubguideExpanded(expanded, reference.id, false);
    const elapsed = performance.now() - started;

    expect(new Set(expanded.nodes.map((node) => node.id)).size).toBe(1_001);
    expect(collapsed.nodes.filter((node) => node.source).every((node) => node.hidden)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it('lays out a 1000-node hierarchy within the local budget', () => {
    const hierarchyNodes: CanvasDocument['nodes'] = Array.from({ length: 1_000 }, (_, index) => ({
      id: `node-${index}`, type: 'process' as const, position: { x: index * 20, y: 0 }, zIndex: index,
      data: { label: `步骤 ${index}`, shape: 'process' as const },
    }));
    const thousandNodeDocument: CanvasDocument = {
      schemaVersion: 1,
      nodes: hierarchyNodes,
      edges: hierarchyNodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: hierarchyNodes[index]!.id, target: node.id })),
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      entryNodeId: 'node-0',
      exitNodeIds: ['node-999'],
    };

    const started = performance.now();
    expect(layoutFlowHierarchy(thousandNodeDocument).document.nodes).toHaveLength(1_000);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('routes a 1000-node arranged guide within the local budget', () => {
    const nodes: CanvasDocument['nodes'] = Array.from({ length: 1_000 }, (_, index) => ({
      id: `route-${index}`, type: 'process' as const, position: { x: index * 312, y: 0 }, size: { width: 240, height: 104 }, zIndex: index,
      data: { label: `步骤 ${index}`, shape: 'process' as const },
    }));
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes,
      edges: nodes.slice(1).map((node, index) => ({ id: `route-edge-${index}`, source: nodes[index]!.id, target: node.id })),
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'route-0', exitNodeIds: ['route-999'],
    };

    const started = performance.now();
    const result = routeCanvasEdges(document);

    expect(result.routesByEdgeId.size).toBe(999);
    expect(result.report.collisionEdgeIds).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

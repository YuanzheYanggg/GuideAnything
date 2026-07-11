import type { CanvasDocument, GuideVersionSnapshot } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { expandSubguide, setSubguideExpanded } from './subguide';

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
});

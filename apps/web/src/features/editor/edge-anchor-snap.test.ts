import type { CanvasDocument, CanvasNode, EdgeAnchor } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import type { OrthogonalRoute } from '@guideanything/canvas-core';
import { findNearestEndpointSnap, pointForEndpointAnchor } from './edge-anchor-snap';

const process = (id: string, x: number, y: number): CanvasNode => ({
  id,
  type: 'process',
  position: { x, y },
  size: { width: 200, height: 100 },
  zIndex: 0,
  data: { label: id, shape: 'process' },
});

const route = (edgeId: string, sourceAnchor: EdgeAnchor): OrthogonalRoute => ({
  edgeId,
  points: [{ x: 200, y: 50 }, { x: 400, y: 50 }],
  routing: 'elbow',
  kind: 'FORWARD',
  sourceSide: sourceAnchor.side,
  targetSide: 'LEFT',
  sourceAnchor,
  targetAnchor: { side: 'LEFT', offset: 0.5 },
  collision: false,
});

const document = (nodes: CanvasNode[]): CanvasDocument => ({
  schemaVersion: 1,
  nodes,
  edges: [
    { id: 'existing-a', source: 'parent', target: 'child-a' },
    { id: 'existing-b', source: 'parent', target: 'child-b' },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  exitNodeIds: [],
});

describe('edge endpoint snapping', () => {
  it('finds the nearest same-kind endpoint and all peers at that displayed point', () => {
    const canvasDocument = document([
      process('parent', 0, 0),
      process('child-a', 400, 0),
      process('child-b', 400, 180),
    ]);
    const routes = new Map([
      ['existing-a', route('existing-a', { side: 'RIGHT', offset: 0.5 })],
      ['existing-b', route('existing-b', { side: 'RIGHT', offset: 0.5 })],
    ]);

    const result = findNearestEndpointSnap(canvasDocument, routes, 'editing', 'source', 'parent', { x: 202, y: 51 });

    expect(result).toEqual({
      anchor: { side: 'RIGHT', offset: 0.5 },
      peerEdgeIds: ['existing-a', 'existing-b'],
    });
  });

  it('does not snap a pointer outside the endpoint threshold', () => {
    const canvasDocument = document([process('parent', 0, 0), process('child-a', 400, 0), process('child-b', 400, 180)]);
    const routes = new Map([['existing-a', route('existing-a', { side: 'RIGHT', offset: 0.5 })]]);

    expect(findNearestEndpointSnap(canvasDocument, routes, 'editing', 'source', 'parent', { x: 200, y: 12 })).toBeUndefined();
  });

  it('converts a persisted anchor into a flow-space point', () => {
    expect(pointForEndpointAnchor(process('parent', 20, 30), { side: 'BOTTOM', offset: 0.25 })).toEqual({ x: 70, y: 130 });
  });
});

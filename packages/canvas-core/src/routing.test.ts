import type { CanvasDocument, CanvasEdge, CanvasNode } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { routeCanvasEdges, snapNodeForStraightRoute, type OrthogonalRoute, type Point } from './routing';
import { layoutFlowHierarchy } from './hierarchy';
import { createComplexSemanticFlowDocument } from './complex-semantic-flow-fixture';

const process = (id: string, x: number, y: number, stageId?: string): CanvasNode => ({
  id, type: 'process', position: { x, y }, size: { width: 200, height: 100 }, zIndex: 0,
  ...(stageId ? { stageId } : {}), data: { label: id, shape: 'process' },
});
const edge = (id: string, source: string, target: string, extra: Partial<CanvasEdge> = {}): CanvasEdge => ({ id, source, target, ...extra });

describe('orthogonal edge routing', () => {
  it('routes the complex semantic flow after child-tree layout and omits the resource reference', () => {
    const result = routeCanvasEdges(layoutFlowHierarchy(createComplexSemanticFlowDocument()).document);

    ['flow-confirm-approve', 'branch-approved-schedule', 'exception-rejected-collect', 'retry-ship-approve'].forEach((edgeId) => {
      const route = result.routesByEdgeId.get(edgeId);
      expect(route, edgeId).toBeDefined();
      expect(route!.points.length, edgeId).toBeGreaterThanOrEqual(2);
      route!.points.forEach((point) => {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y), edgeId).toBe(true);
      });
    });
    expect(result.routesByEdgeId.has('resource-reference-revise-collect-spec')).toBe(false);
  });

  it('uses semantic edge intent for branches and excludes resource references from canvas routes', () => {
    const result = routeCanvasEdges(document(
      [process('decision', 0, 0), process('pass', 400, 0), process('resource', 400, 220)],
      [
        edge('pass-edge', 'decision', 'pass', { semantic: { kind: 'BRANCH', order: 0 } }),
        edge('resource-reference', 'pass', 'resource', { semantic: { kind: 'RESOURCE_REFERENCE' } }),
      ],
    ));

    expect(result.routesByEdgeId.get('pass-edge')?.kind).toBe('BRANCH');
    expect(result.routesByEdgeId.has('resource-reference')).toBe(false);
  });

  it('routes semantic retry and exception links through the outer feedback channel', () => {
    const result = routeCanvasEdges(document(
      [process('start', 0, 0), process('retry', 400, 0)],
      [edge('retry-link', 'retry', 'start', { semantic: { kind: 'RETRY' } })],
    ));

    expect(result.routesByEdgeId.get('retry-link')?.kind).toBe('BACK');
    expect(result.report.backEdgeIds).toEqual(['retry-link']);
  });

  it('routes a forward edge using only orthogonal segments', () => {
    const result = routeCanvasEdges(document([process('a', 0, 0), process('b', 400, 0)], [edge('ab', 'a', 'b')]));
    const route = result.routesByEdgeId.get('ab')!;

    expect(route.kind).toBe('FORWARD');
    expect(route.sourceSide).toBe('RIGHT');
    expect(route.targetSide).toBe('LEFT');
    expectOrthogonal(route.points);
  });

  it('keeps a nearly aligned forward edge on the main row', () => {
    const result = routeCanvasEdges(document([process('source', 0, 0), process('target', 400, -4)], [edge('aligned', 'source', 'target')]));
    const route = result.routesByEdgeId.get('aligned')!;

    expect(route.kind).toBe('FORWARD');
    expect(route.sourceSide).toBe('RIGHT');
    expect(route.targetSide).toBe('LEFT');
  });

  it('routes a downward decision branch from the bottom', () => {
    const result = routeCanvasEdges(document([process('decision', 0, 0), process('no', 320, 260)], [edge('no-edge', 'decision', 'no', { sourceHandle: 'no', presentation: { routing: 'elbow' } })]));
    const route = result.routesByEdgeId.get('no-edge')!;

    expect(route.kind).toBe('BRANCH');
    expect(route.sourceSide).toBe('BOTTOM');
    expectOrthogonal(route.points);
  });

  it('keeps the yes branch on the left-to-right main line when its target shares the row', () => {
    const result = routeCanvasEdges(document([process('decision', 0, 0), process('yes', 320, 0)], [edge('yes-edge', 'decision', 'yes', { sourceHandle: 'yes' })]));
    const route = result.routesByEdgeId.get('yes-edge')!;

    expect(route.kind).toBe('FORWARD');
    expect(route.sourceSide).toBe('RIGHT');
    expect(route.targetSide).toBe('LEFT');
  });

  it('uses a vertical channel between stages that restart at the left', () => {
    const result = routeCanvasEdges(document(
      [process('stage-a', 0, 0, 'a'), process('stage-b', 0, 320, 'b')],
      [edge('cross-stage', 'stage-a', 'stage-b')],
    ));
    const route = result.routesByEdgeId.get('cross-stage')!;

    expect(route.kind).toBe('CROSS_STAGE');
    expect(route.sourceSide).toBe('BOTTOM');
    expect(route.targetSide).toBe('TOP');
    expectOrthogonal(route.points);
  });

  it('uses the gap between rows when a forward flow wraps back to the left', () => {
    const result = routeCanvasEdges(document(
      [process('row-end', 1_200, 0), process('next-row', 0, 320)],
      [edge('wrapped', 'row-end', 'next-row', { presentation: { routing: 'elbow' } })],
    ));
    const route = result.routesByEdgeId.get('wrapped')!;

    expect(route.kind).toBe('WRAP');
    expect(route.sourceSide).toBe('BOTTOM');
    expect(route.targetSide).toBe('TOP');
    expect(result.report.backEdgeIds).toEqual([]);
    expectOrthogonal(route.points);
  });

  it('routes backward edges through the outer right gutter', () => {
    const nodes = [process('first', 0, 0), process('last', 640, 0), process('middle', 320, 0)];
    const result = routeCanvasEdges(document(nodes, [edge('back', 'last', 'first')]));
    const route = result.routesByEdgeId.get('back')!;

    expect(route.kind).toBe('BACK');
    expect(Math.max(...route.points.map((point) => point.x))).toBeGreaterThan(840);
    expect(result.report.backEdgeIds).toEqual(['back']);
    expectNoNonEndpointIntersection(route, nodes, ['last', 'first']);
  });

  it('returns through the gap above the target when a tall node blocks a top-down back route', () => {
    const blocker = { ...process('blocker', 600, 180), size: { width: 500, height: 500 } };
    const nodes = [blocker, process('target', 700, 800), process('source', 1_000, 1_100)];
    const result = routeCanvasEdges(document(nodes, [edge('feedback', 'source', 'target')]));
    const route = result.routesByEdgeId.get('feedback')!;

    expect(route.kind).toBe('BACK');
    expect(result.report.collisionEdgeIds).toEqual([]);
    expectNoNonEndpointIntersection(route, nodes, ['source', 'target']);
  });

  it('uses stable parallel offsets instead of completely overlapping shared channels', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('one', 400, 220), process('two', 400, 440)],
      [edge('one-edge', 'source', 'one', { sourceHandle: 'no' }), edge('two-edge', 'source', 'two', { sourceHandle: 'no' })],
    ));

    expect(result.routesByEdgeId.get('one-edge')!.points).not.toEqual(result.routesByEdgeId.get('two-edge')!.points);
    expect(routeCanvasEdges(document(
      [process('source', 0, 0), process('one', 400, 220), process('two', 400, 440)],
      [edge('one-edge', 'source', 'one', { sourceHandle: 'no' }), edge('two-edge', 'source', 'two', { sourceHandle: 'no' })],
    )).routesByEdgeId).toEqual(result.routesByEdgeId);
  });

  it('uses persisted exact edge anchors as route endpoints', () => {
    const result = routeCanvasEdges(document(
      [process('source', 100, 80), process('target', 500, 300)],
      [edge('anchored', 'source', 'target', {
        presentation: {
          routing: 'elbow',
          sourceAnchor: { side: 'BOTTOM', offset: 0.25 },
          targetAnchor: { side: 'LEFT', offset: 0.6 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('anchored')!;

    expect(route.sourceSide).toBe('BOTTOM');
    expect(route.targetSide).toBe('LEFT');
    expect(route.points[0]).toEqual({ x: 150, y: 180 });
    expect(route.points.at(-1)).toEqual({ x: 500, y: 360 });
    expectOrthogonal(route.points);
  });

  it('routes around a target node when persisted side anchors cross its interior', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 0, 240)],
      [edge('blocked-anchor', 'source', 'target', {
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: 0.45 },
          targetAnchor: { side: 'LEFT', offset: 0.5 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('blocked-anchor')!;

    expect(result.report.avoidedEdgeIds).toEqual(['blocked-anchor']);
    expect(result.report.collisionEdgeIds).toEqual([]);
    expect(Math.min(...route.points.map((point) => point.y))).toBeLessThan(0);
  });

  it('uses manual waypoints while preserving the persisted endpoint ports', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 500, 0), process('blocker', 240, -100)],
      [edge('manual', 'source', 'target', {
        presentation: {
          routeMode: 'manual',
          sourceAnchor: { side: 'RIGHT', offset: 0.25 },
          targetAnchor: { side: 'LEFT', offset: 0.75 },
          waypoints: [{ x: 224, y: 25 }, { x: 224, y: 160 }, { x: 476, y: 160 }, { x: 476, y: 75 }],
        },
      })],
    ));
    const route = result.routesByEdgeId.get('manual')!;

    expect(route.points[0]).toEqual({ x: 200, y: 25 });
    expect(route.points.at(-1)).toEqual({ x: 500, y: 75 });
    expect(route.points).toContainEqual({ x: 224, y: 160 });
    expect(result.report.manualConflictEdgeIds).toEqual([]);
    expect(route.collision).toBe(false);
  });

  it('falls back to a safe automatic route and reports a manual conflict', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 500, 0), { ...process('blocker', 240, 80), size: { width: 240, height: 220 } }],
      [edge('conflict', 'source', 'target', {
        presentation: { routeMode: 'manual', waypoints: [{ x: 224, y: 130 }, { x: 476, y: 130 }] },
      })],
    ));

    expect(result.report.manualConflictEdgeIds).toEqual(['conflict']);
    expect(result.report.collisionEdgeIds).toEqual([]);
    expect(result.routesByEdgeId.get('conflict')!.collision).toBe(false);
  });

  it('prefers the shortest clear route when a backward edge has facing anchors', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 100), process('target', 400, 0)],
      [edge('short-back', 'source', 'target', {
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: 0.45 },
          targetAnchor: { side: 'LEFT', offset: 0.5 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('short-back')!;

    expect(route.kind).toBe('BACK');
    expect(Math.max(...route.points.map((point) => point.x))).toBeLessThan(500);
  });

  it('uses a single direct segment for an explicit straight route even when its anchored endpoints do not align', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 400, 0)],
      [edge('straight', 'source', 'target', {
        presentation: {
          routing: 'straight',
          sourceAnchor: { side: 'RIGHT', offset: 0.2 },
          targetAnchor: { side: 'LEFT', offset: 0.75 },
        },
      })],
    ));

    expect(result.routesByEdgeId.get('straight')!.points).toEqual([{ x: 200, y: 20 }, { x: 400, y: 75 }]);
  });

  it('uses a direct path in smart mode when the endpoints have a clear line of sight', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 400, 0)],
      [edge('legacy', 'source', 'target', {
        presentation: {
          routing: 'smart',
          sourceAnchor: { side: 'RIGHT', offset: 0.2 },
          targetAnchor: { side: 'LEFT', offset: 0.75 },
        },
      })],
    ));

    expect(result.routesByEdgeId.get('legacy')!.points).toEqual([{ x: 200, y: 20 }, { x: 400, y: 75 }]);
  });

  it('uses elbow routing by default while collapsing aligned opposing ports to a straight segment', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 400, 0)],
      [edge('default-elbow', 'source', 'target')],
    ));
    const route = result.routesByEdgeId.get('default-elbow')!;

    expect(route.routing).toBe('elbow');
    expect(route.points).toEqual([{ x: 200, y: 50 }, { x: 400, y: 50 }]);
  });

  it('fans out shared forward endpoints so the routes and their drag targets stay distinct', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('first', 400, 220), process('second', 400, 440)],
      [
        edge('first-edge', 'source', 'first'),
        edge('second-edge', 'source', 'second'),
      ],
    ));
    const first = result.routesByEdgeId.get('first-edge')!;
    const second = result.routesByEdgeId.get('second-edge')!;

    expect(first.sourceAnchor).not.toEqual(second.sourceAnchor);
    expect(first.points[0]).not.toEqual(second.points[0]);
    expect(first.points[1]).not.toEqual(second.points[1]);
  });

  it('snaps a moved node to a clear, opposing horizontal connection when it is close to alignment', () => {
    const result = snapNodeForStraightRoute(
      document([process('source', 0, 0), process('target', 400, 0)], [edge('aligned', 'source', 'target')]),
      'target',
      { x: 400, y: 9 },
    );

    expect(result).toEqual({
      edgeId: 'aligned',
      axis: 'y',
      coordinate: 50,
      position: { x: 400, y: 0 },
    });
  });

  it('does not snap a moved node when another node blocks the direct corridor', () => {
    const result = snapNodeForStraightRoute(
      document(
        [process('source', 0, 0), process('blocker', 280, 0), process('target', 560, 0)],
        [edge('blocked', 'source', 'target')],
      ),
      'target',
      { x: 560, y: 8 },
    );

    expect(result).toBeUndefined();
  });

  it('keeps an explicit elbow route orthogonal for authors who need a channel', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 400, 0)],
      [edge('elbow', 'source', 'target', {
        presentation: {
          routing: 'elbow',
          sourceAnchor: { side: 'RIGHT', offset: 0.2 },
          targetAnchor: { side: 'LEFT', offset: 0.75 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('elbow')!;

    expect(route.points.length).toBeGreaterThan(2);
    expectOrthogonal(route.points);
  });

  it('keeps a backward edge classified as BACK when endpoints are anchored', () => {
    const result = routeCanvasEdges(document(
      [process('first', 0, 0), process('last', 640, 0)],
      [edge('feedback', 'last', 'first', {
        presentation: {
          routing: 'elbow',
          sourceAnchor: { side: 'TOP', offset: 0.75 },
          targetAnchor: { side: 'BOTTOM', offset: 0.2 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('feedback')!;

    expect(route.kind).toBe('BACK');
    expect(route.points[0]).toEqual({ x: 790, y: 0 });
    expect(route.points.at(-1)).toEqual({ x: 40, y: 100 });
    expectOrthogonal(route.points);
  });

  it('avoids a node blocking the direct channel and excludes hidden or derived edges', () => {
    const nodes = [process('source', 0, 0), process('blocker', 280, 0), process('target', 560, 0)];
    const result = routeCanvasEdges(document(nodes, [
      edge('blocked', 'source', 'target'),
      edge('hidden', 'source', 'target', { hidden: true }),
      edge('derived', 'source', 'target', { sourceTrace: { referenceNodeId: 'ref', sourceGuideId: 'guide', sourceVersionId: 'version', sourceElementId: 'edge' } }),
    ]));
    const route = result.routesByEdgeId.get('blocked')!;

    expect(result.report.avoidedEdgeIds).toEqual(['blocked']);
    expect(result.routesByEdgeId.has('hidden')).toBe(false);
    expect(result.routesByEdgeId.has('derived')).toBe(false);
    expectNoNonEndpointIntersection(route, nodes, ['source', 'target']);
  });
});

function document(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasDocument {
  return { schemaVersion: 1, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [] };
}

function expectOrthogonal(points: Point[]) {
  points.slice(1).forEach((point, index) => {
    const previous = points[index]!;
    expect(point.x === previous.x || point.y === previous.y).toBe(true);
  });
}

function expectNoNonEndpointIntersection(route: OrthogonalRoute, nodes: CanvasNode[], endpointIds: string[]) {
  nodes.filter((node) => !endpointIds.includes(node.id)).forEach((node) => {
    const width = node.size?.width ?? 240;
    const height = node.size?.height ?? 104;
    route.points.slice(1).forEach((point, index) => {
      const previous = route.points[index]!;
      const horizontal = previous.y === point.y
        && previous.y >= node.position.y && previous.y <= node.position.y + height
        && Math.max(previous.x, point.x) >= node.position.x && Math.min(previous.x, point.x) <= node.position.x + width;
      const vertical = previous.x === point.x
        && previous.x >= node.position.x && previous.x <= node.position.x + width
        && Math.max(previous.y, point.y) >= node.position.y && Math.min(previous.y, point.y) <= node.position.y + height;
      expect(horizontal || vertical).toBe(false);
    });
  });
}

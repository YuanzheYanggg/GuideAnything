import type { CanvasDocument, CanvasEdge, CanvasNode } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { routeCanvasEdges, snapNodeForStraightRoute, type OrthogonalRoute, type Point } from './routing';
import { layoutFlowHierarchy } from './hierarchy';
import { createComplexSemanticFlowDocument } from './complex-semantic-flow-fixture';

const process = (id: string, x: number, y: number, stageId?: string, laneId?: string): CanvasNode => ({
  id, type: 'process', position: { x, y }, size: { width: 200, height: 100 }, zIndex: 0,
  ...(stageId ? { stageId } : {}), ...(laneId ? { laneId } : {}), data: { label: id, shape: 'process' },
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

  it('aligns an automatic same-row flow to one horizontal segment when card heights differ', () => {
    const source = { ...process('source', 0, 0), size: { width: 200, height: 133 } };
    const target = { ...process('target', 400, 0), size: { width: 200, height: 100 } };
    const result = routeCanvasEdges(document([source, target], [edge('aligned-height', 'source', 'target')]));

    expect(result.routesByEdgeId.get('aligned-height')!.points).toEqual([
      { x: 200, y: 66.5 },
      { x: 400, y: 66.5 },
    ]);
  });

  it('lets the automatic endpoint follow a single manually dragged forward anchor', () => {
    const source = { ...process('source', 0, 0), size: { width: 200, height: 133 } };
    const target = { ...process('target', 400, 0), size: { width: 200, height: 100 } };
    const result = routeCanvasEdges(document([source, target], [edge('single-manual-anchor', 'source', 'target', {
      presentation: {
        sourceAnchor: { side: 'RIGHT', offset: 0.7 },
        sourceAnchorMode: 'manual',
      },
    })]));
    const route = result.routesByEdgeId.get('single-manual-anchor')!;

    expect(route.points).toEqual([
      { x: 200, y: 93.1 },
      { x: 400, y: 93.1 },
    ]);
    expect(route.sourceAnchor).toEqual({ side: 'RIGHT', offset: 0.7 });
    expect(route.targetAnchor.side).toBe('LEFT');
    expect(route.targetAnchor.offset).toBeCloseTo(0.931, 10);
  });

  it('snaps nearly aligned manual forward anchors onto one horizontal segment', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 400, 0)],
      [edge('near-aligned-manual', 'source', 'target', {
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: 0.5 },
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: 0.54 },
          targetAnchorMode: 'manual',
        },
      })],
    ));
    const route = result.routesByEdgeId.get('near-aligned-manual')!;

    expect(route.points).toEqual([
      { x: 200, y: 52 },
      { x: 400, y: 52 },
    ]);
    expect(route.sourceAnchor.offset).toBeCloseTo(0.52, 10);
    expect(route.targetAnchor.offset).toBeCloseTo(0.52, 10);
  });

  it('removes a visually small manual forward bend instead of preserving a tiny elbow', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 400, 0)],
      [edge('tiny-manual-bend', 'source', 'target', {
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: 0.5 },
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: 0.68 },
          targetAnchorMode: 'manual',
        },
      })],
    ));
    const route = result.routesByEdgeId.get('tiny-manual-bend')!;

    expect(route.points).toEqual([
      { x: 200, y: 59 },
      { x: 400, y: 59 },
    ]);
    expect(route.sourceAnchor.offset).toBeCloseTo(0.59, 10);
    expect(route.targetAnchor.offset).toBeCloseTo(0.59, 10);
  });

  it('collapses floating-point noise after aligning uneven manual forward anchors', () => {
    const result = routeCanvasEdges(document(
      [
        { ...process('source', 0, 0), size: { width: 240, height: 129 } },
        { ...process('target', 360, 0), size: { width: 200, height: 104 } },
      ],
      [edge('fractional-manual-bend', 'source', 'target', {
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: 0.523702219266312 },
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: 0.46233041792458973 },
          targetAnchorMode: 'manual',
        },
      })],
    ));
    const route = result.routesByEdgeId.get('fractional-manual-bend')!;

    expect(route.points).toHaveLength(2);
    expect(route.points[0]!.y).toBe(route.points[1]!.y);
  });

  it('rejects a manual route that leaves a bottom endpoint through the source card', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 0, 300)],
      [edge('manual-source-interior', 'source', 'target', {
        presentation: {
          routeMode: 'manual',
          waypoints: [{ x: 100, y: 20 }, { x: 220, y: 20 }, { x: 220, y: 200 }],
        },
      })],
    ));
    const route = result.routesByEdgeId.get('manual-source-interior')!;

    expect(result.report.manualConflictEdgeIds).toEqual(['manual-source-interior']);
    expect(route.points).not.toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 20 },
      { x: 220, y: 20 },
      { x: 220, y: 200 },
      { x: 100, y: 300 },
    ]);
    expect(route.collision).toBe(false);
  });

  it('rejects a manual route that approaches a top endpoint from below through the target card', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 0, 300)],
      [edge('manual-target-interior', 'source', 'target', {
        presentation: {
          routeMode: 'manual',
          waypoints: [{ x: 100, y: 200 }, { x: 220, y: 200 }, { x: 220, y: 400 }, { x: 100, y: 400 }],
        },
      })],
    ));
    const route = result.routesByEdgeId.get('manual-target-interior')!;

    expect(result.report.manualConflictEdgeIds).toEqual(['manual-target-interior']);
    expect(route.points).not.toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 220, y: 200 },
      { x: 220, y: 400 },
      { x: 100, y: 400 },
      { x: 100, y: 300 },
    ]);
    expect(route.collision).toBe(false);
  });

  it('routes a downstream continuation around the nearest side of a blocking card', () => {
    const result = routeCanvasEdges(document(
      [
        process('source', 0, 0, 'stage', 'lane'),
        process('target', 0, 300, 'stage', 'lane'),
        { ...process('blocker', 100, 150), size: { width: 100, height: 100 } },
      ],
      [edge('local-downstream', 'source', 'target', { sourceHandle: 'out', targetHandle: 'in' })],
    ));
    const route = result.routesByEdgeId.get('local-downstream')!;

    expect(route.kind).toBe('DOWNSTREAM');
    expect(result.report.avoidedEdgeIds).toEqual([]);
    expect(result.report.collisionEdgeIds).toEqual([]);
    expect(Math.min(...route.points.map((point) => point.y))).toBeGreaterThanOrEqual(100);
    expect(Math.min(...route.points.map((point) => point.x))).toBeLessThan(100);
    expectOrthogonal(route.points);
  });

  it('routes a branch around a nearby card without escaping to the canvas gutter', () => {
    const result = routeCanvasEdges(document(
      [
        process('source', 0, 0),
        process('target', 400, 250),
        { ...process('blocker', 100, 120), size: { width: 200, height: 120 } },
      ],
      [edge('local-branch', 'source', 'target', { sourceHandle: 'no' })],
    ));
    const route = result.routesByEdgeId.get('local-branch')!;

    expect(route.kind).toBe('BRANCH');
    expect(result.report.avoidedEdgeIds).toEqual([]);
    expect(result.report.collisionEdgeIds).toEqual([]);
    expect(Math.min(...route.points.map((point) => point.y))).toBeGreaterThanOrEqual(100);
    expect(Math.max(...route.points.map((point) => point.x))).toBeLessThan(640);
    expectOrthogonal(route.points);
  });

  it('marks a horizontal route as the bridge owner when two routes cross', () => {
    const nodes = [
      { ...process('horizontal-source', 0, 0), size: { width: 100, height: 100 } },
      { ...process('horizontal-target', 400, 0), size: { width: 100, height: 100 } },
      { ...process('vertical-source', 250, -200, 'stage', 'lane'), size: { width: 100, height: 100 } },
      { ...process('vertical-target', 250, 300, 'stage', 'lane'), size: { width: 100, height: 100 } },
    ];
    const result = routeCanvasEdges(document(nodes, [
      edge('horizontal', 'horizontal-source', 'horizontal-target'),
      edge('vertical', 'vertical-source', 'vertical-target', { sourceHandle: 'out', targetHandle: 'in' }),
    ]));

    expect(result.routesByEdgeId.get('horizontal')!.points).toEqual([{ x: 100, y: 50 }, { x: 400, y: 50 }]);
    expect(result.routesByEdgeId.get('horizontal')!.bridges).toEqual([{ x: 300, y: 50 }]);
    expect(result.routesByEdgeId.get('vertical')!.bridges).toEqual([]);
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

  it('keeps an explicitly automatic same-stage continuation on the vertical semantic route', () => {
    const result = routeCanvasEdges(document(
      [process('first', 0, 0, 'intake', 'sales'), process('second', 0, 180, 'intake', 'sales')],
      [edge('downstream', 'first', 'second', {
        semantic: { kind: 'FLOW' },
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: 0.5 },
          sourceAnchorMode: 'auto',
          targetAnchor: { side: 'LEFT', offset: 0.5 },
          targetAnchorMode: 'auto',
        },
      })],
    ));
    const route = result.routesByEdgeId.get('downstream')!;

    expect(route.kind).toBe('DOWNSTREAM');
    expect(route.sourceSide).toBe('BOTTOM');
    expect(route.targetSide).toBe('TOP');
    expectOrthogonal(route.points);
  });

  it('uses endpoint anchors from documents that predate anchor modes', () => {
    const result = routeCanvasEdges(document(
      [process('first', 0, 0), process('second', 400, 0)],
      [edge('legacy-anchors', 'first', 'second', {
        presentation: {
          sourceAnchor: { side: 'BOTTOM', offset: 0.25 },
          targetAnchor: { side: 'TOP', offset: 0.75 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('legacy-anchors')!;

    expect(route.sourceSide).toBe('BOTTOM');
    expect(route.targetSide).toBe('TOP');
    expect(route.points[0]).toEqual({ x: 50, y: 100 });
    expect(route.points.at(-1)).toEqual({ x: 550, y: 0 });
  });

  it('treats a close legacy ordinary out-to-in edge in the same stage and lane as a local downstream continuation', () => {
    const first = {
      ...process('first', 0, 0, 'intake', 'sales'),
      type: 'start' as const,
      size: { width: 240, height: 104 },
      data: { label: 'first', shape: 'start' as const },
    };
    const second = { ...process('second', 0, 136, 'intake', 'sales'), size: { width: 240, height: 104 } };
    const result = routeCanvasEdges(document(
      [first, second],
      [edge('legacy-downstream', 'first', 'second', {
        sourceHandle: 'out',
        targetHandle: 'in',
        presentation: {
          sourceAnchor: { side: 'BOTTOM', offset: 0.5 },
          targetAnchor: { side: 'TOP', offset: 0.5 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('legacy-downstream')!;

    expect(route.kind).toBe('DOWNSTREAM');
    expect(route.sourceSide).toBe('BOTTOM');
    expect(route.targetSide).toBe('TOP');
    expect(result.report.backEdgeIds).toEqual([]);
    expect(result.report.avoidedEdgeIds).toEqual([]);
    expect(route.points).toEqual([{ x: 120, y: 104 }, { x: 120, y: 136 }]);
    expectOrthogonal(route.points);
  });

  it('keeps near-centered legacy downstream anchors inside a narrow vertical gap', () => {
    const first = {
      ...process('first', 0, 0, 'intake', 'sales'),
      type: 'start' as const,
      size: { width: 240, height: 129 },
      data: { label: '收到客人提案需求，可以是邮件或者微信', shape: 'start' as const },
    };
    const second = { ...process('second', 0, 136, 'intake', 'sales'), size: { width: 240, height: 104 } };
    const result = routeCanvasEdges(document(
      [first, second],
      [edge('narrow-legacy-downstream', 'first', 'second', {
        sourceHandle: 'out',
        targetHandle: 'in',
        presentation: {
          sourceAnchor: { side: 'BOTTOM', offset: 0.5110637014010254 },
          targetAnchor: { side: 'TOP', offset: 0.4924150004198662 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('narrow-legacy-downstream')!;

    expect(result.report.avoidedEdgeIds).toEqual([]);
    expect(result.report.collisionEdgeIds).toEqual([]);
    expect(Math.min(...route.points.map((point) => point.y))).toBeGreaterThanOrEqual(129);
    expect(Math.max(...route.points.map((point) => point.y))).toBeLessThanOrEqual(136);
    expectOrthogonal(route.points);
  });

  it('keeps a newly taller same-lane card directly connected through its remaining vertical gap', () => {
    const first = {
      ...process('first', 0, 0, 'intake', 'sales'),
      type: 'start' as const,
      size: { width: 240, height: 129 },
      data: { label: '收到客人提案需求，可以是邮件或者微信', shape: 'start' as const },
    };
    const second = { ...process('second', 0, 136, 'intake', 'sales'), size: { width: 240, height: 104 } };
    const result = routeCanvasEdges(document(
      [first, second],
      [edge('grown-downstream', 'first', 'second', { sourceHandle: 'out', targetHandle: 'in' })],
    ));
    const route = result.routesByEdgeId.get('grown-downstream')!;

    expect(route.kind).toBe('DOWNSTREAM');
    expect(result.report.avoidedEdgeIds).toEqual([]);
    expect(route.points).toEqual([{ x: 120, y: 129 }, { x: 120, y: 136 }]);
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

  it('orders sibling source ports and shared forward channels by semantic child order', () => {
    const parent = { ...process('parent', 0, 0), outline: { order: 0, kind: 'STEP' as const } };
    const first = { ...process('child-1', 400, 200), outline: { parentId: 'parent', order: 0, kind: 'STEP' as const } };
    const second = { ...process('child-2', 700, 200), outline: { parentId: 'parent', order: 1, kind: 'STEP' as const } };
    const third = { ...process('child-3', 1_000, 200), outline: { parentId: 'parent', order: 2, kind: 'STEP' as const } };
    const result = routeCanvasEdges(document([parent, first, second, third], [
      edge('a-child-3', 'parent', 'child-3', { sourceHandle: 'no', semantic: { kind: 'BRANCH', order: 2 } }),
      edge('m-child-1', 'parent', 'child-1', { sourceHandle: 'no', semantic: { kind: 'BRANCH', order: 0 } }),
      edge('z-child-2', 'parent', 'child-2', { sourceHandle: 'no', semantic: { kind: 'BRANCH', order: 1 } }),
    ]));

    const routes = ['m-child-1', 'z-child-2', 'a-child-3'].map((edgeId) => result.routesByEdgeId.get(edgeId)!);
    expect(routes.map((route) => route.sourceAnchor.offset)).toEqual([
      expect.closeTo(0.41, 5),
      expect.closeTo(0.5, 5),
      expect.closeTo(0.59, 5),
    ]);
  });

  it('preserves intentionally shared manual source anchors while fanning out unpinned siblings', () => {
    const parent = { ...process('parent', 0, 0), outline: { order: 0, kind: 'STEP' as const } };
    const first = { ...process('child-1', 400, 200), outline: { parentId: 'parent', order: 0, kind: 'STEP' as const } };
    const second = { ...process('child-2', 700, 200), outline: { parentId: 'parent', order: 1, kind: 'STEP' as const } };
    const third = { ...process('child-3', 1_000, 200), outline: { parentId: 'parent', order: 2, kind: 'STEP' as const } };
    const sharedSourceAnchor = { side: 'BOTTOM' as const, offset: 0.5 };
    const result = routeCanvasEdges(document([parent, first, second, third], [
      edge('first', 'parent', 'child-1', { sourceHandle: 'no', semantic: { kind: 'BRANCH', order: 0 }, presentation: { sourceAnchor: sharedSourceAnchor, sourceAnchorMode: 'manual' } }),
      edge('second', 'parent', 'child-2', { sourceHandle: 'no', semantic: { kind: 'BRANCH', order: 1 }, presentation: { sourceAnchor: sharedSourceAnchor, sourceAnchorMode: 'manual' } }),
      edge('third', 'parent', 'child-3', { sourceHandle: 'no', semantic: { kind: 'BRANCH', order: 2 } }),
    ]));

    expect(result.routesByEdgeId.get('first')!.sourceAnchor).toEqual(sharedSourceAnchor);
    expect(result.routesByEdgeId.get('second')!.sourceAnchor).toEqual(sharedSourceAnchor);
    expect(result.routesByEdgeId.get('third')!.sourceAnchor.offset).not.toBeCloseTo(sharedSourceAnchor.offset, 5);
  });

  it('uses persisted exact edge anchors as route endpoints', () => {
    const result = routeCanvasEdges(document(
      [process('source', 100, 80), process('target', 500, 300)],
      [edge('anchored', 'source', 'target', {
        presentation: {
          routing: 'elbow',
          sourceAnchor: { side: 'BOTTOM', offset: 0.25 },
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: 0.6 },
          targetAnchorMode: 'manual',
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

  it('keeps manually bottom-pinned vertical endpoints in their local gap instead of routing around the canvas', () => {
    const result = routeCanvasEdges(document(
      [process('first', 0, 0, 'intake', 'sales'), process('second', 16, 132, 'intake', 'sales')],
      [edge('manual-downstream', 'first', 'second', {
        semantic: { kind: 'FLOW' },
        presentation: {
          routeMode: 'manual',
          sourceAnchor: { side: 'BOTTOM', offset: 0.5 },
          targetAnchor: { side: 'TOP', offset: 0.5 },
        },
      })],
    ));
    const route = result.routesByEdgeId.get('manual-downstream')!;

    expect(route.kind).toBe('DOWNSTREAM');
    expect(route.sourceSide).toBe('BOTTOM');
    expect(route.targetSide).toBe('TOP');
    expect(result.report.avoidedEdgeIds).toEqual([]);
    expect(result.report.collisionEdgeIds).toEqual([]);
    expect(Math.min(...route.points.map((point) => point.y))).toBeGreaterThanOrEqual(0);
    expectOrthogonal(route.points);
  });

  it('routes around a target node when persisted side anchors cross its interior', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 0, 240)],
      [edge('blocked-anchor', 'source', 'target', {
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: 0.45 },
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: 0.5 },
          targetAnchorMode: 'manual',
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
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: 0.5 },
          targetAnchorMode: 'manual',
        },
      })],
    ));
    const route = result.routesByEdgeId.get('short-back')!;

    expect(route.kind).toBe('BACK');
    expect(Math.max(...route.points.map((point) => point.x))).toBeLessThan(500);
  });

  it.each(['straight', 'smart'] as const)('keeps legacy %s automatic geometry orthogonal', (routing) => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 420, 180)],
      [edge('legacy', 'source', 'target', { presentation: { routing } })],
    ));
    const route = result.routesByEdgeId.get('legacy')!;

    expect(route.routing).toBe(routing);
    expectOrthogonal(route.points);
  });

  it('collapses aligned automatic endpoints to one real horizontal segment', () => {
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 420, 0)],
      [edge('aligned', 'source', 'target')],
    ));
    const route = result.routesByEdgeId.get('aligned')!;

    expect(route.points).toHaveLength(2);
    expect(route.points[0]!.y).toBe(route.points[1]!.y);
  });

  it.each(['straight', 'smart'] as const)('keeps valid manual waypoints authoritative with legacy %s', (routing) => {
    const waypoints = [{ x: 224, y: 50 }, { x: 224, y: 180 }, { x: 376, y: 180 }, { x: 376, y: 50 }];
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 400, 0)],
      [edge('manual', 'source', 'target', {
        presentation: { routing, routeMode: 'manual', waypoints },
      })],
    ));
    const route = result.routesByEdgeId.get('manual')!;

    expect(route.points.slice(1, -1)).toEqual(waypoints);
    expectOrthogonal(route.points);
    expect(result.report.manualConflictEdgeIds).toEqual([]);
  });

  it('keeps manual waypoints authoritative after selecting smooth style', () => {
    const waypoints = [{ x: 100, y: 160 }, { x: 500, y: 160 }, { x: 500, y: 350 }];
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 600, 300)],
      [edge('manual-smooth', 'source', 'target', {
        presentation: { pathStyle: 'smooth', routeMode: 'manual', waypoints },
      })],
    ));
    const route = result.routesByEdgeId.get('manual-smooth')!;

    expect(route.pathStyle).toBe('smooth');
    expect(route.points.slice(1, -1)).toEqual(waypoints);
    expectOrthogonal(route.points);
  });

  it('marks a diagonal visual preference unsafe when its direct path crosses a node', () => {
    const result = routeCanvasEdges(document(
      [
        process('source', 0, 0),
        process('target', 600, 300),
        { ...process('blocker', 260, 180), size: { width: 120, height: 100 } },
      ],
      [edge('blocked-diagonal', 'source', 'target', { presentation: { pathStyle: 'diagonal' } })],
    ));
    const route = result.routesByEdgeId.get('blocked-diagonal')!;

    expect(route.directPathSafe).toBe(false);
    expectOrthogonal(route.points);
  });

  it('builds a safe cubic curve along a clear orthogonal route', () => {
    const blocker = { ...process('blocker', 260, 180), size: { width: 120, height: 100 } };
    const result = routeCanvasEdges(document(
      [process('source', 0, 0), process('target', 600, 300), blocker],
      [edge('smooth', 'source', 'target', { presentation: { pathStyle: 'smooth' } })],
    ));
    const route = result.routesByEdgeId.get('smooth')!;
    const firstSegment = route.smoothSegments[0]!;
    const sampledPoints = sampleCubicSegments(route.smoothSegments);

    expect(route.smoothPathSafe).toBe(true);
    expect(route.smoothSegments).not.toHaveLength(0);
    expect(firstSegment.control1.x).toBe(firstSegment.start.x);
    expect(firstSegment.control1.y).toBeGreaterThan(firstSegment.start.y);
    expect(sampledPoints.every((point) => point.x < blocker.position.x
      || point.x > blocker.position.x + blocker.size!.width
      || point.y < blocker.position.y
      || point.y > blocker.position.y + blocker.size!.height)).toBe(true);
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

  it('keeps fanned forward routes horizontal when their target row is only slightly different', () => {
    const result = routeCanvasEdges(document(
      [{ ...process('source', 0, 0), size: { width: 200, height: 300 } }, process('first', 400, 0), process('second', 400, 104)],
      [edge('first-edge', 'source', 'first'), edge('second-edge', 'source', 'second')],
    ));

    const points = result.routesByEdgeId.get('second-edge')!.points;
    expect(points).toHaveLength(2);
    expect(points[0]!.y).toBe(points[1]!.y);
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

  it('snaps a center-aligned horizontal edge when the target top edge sits slightly above the source', () => {
    const source = { ...process('source', 0, 0), size: { width: 240, height: 129 } };
    const target = { ...process('target', 320, -20), size: { width: 240, height: 133 } };
    const result = snapNodeForStraightRoute(
      document([source, target], [edge('aligned-center', 'source', 'target')]),
      'target',
      { x: 320, y: -20 },
    );

    expect(result).toEqual({
      edgeId: 'aligned-center',
      axis: 'y',
      coordinate: 64.5,
      position: { x: 320, y: -2 },
    });
  });

  it('snaps a center-aligned vertical edge when the target left edge is slightly offset', () => {
    const source = { ...process('source', 0, 0), size: { width: 240, height: 104 } };
    const target = { ...process('target', 20, 220), size: { width: 240, height: 104 } };
    const result = snapNodeForStraightRoute(
      document([source, target], [edge('aligned-vertical', 'source', 'target')]),
      'target',
      { x: 20, y: 220 },
    );

    expect(result).toEqual({
      edgeId: 'aligned-vertical',
      axis: 'x',
      coordinate: 120,
      position: { x: 0, y: 220 },
    });
  });

  it('snaps a manually anchored forward node within the route alignment tolerance', () => {
    const result = snapNodeForStraightRoute(
      document(
        [
          { ...process('source', 0, 0), size: { width: 240, height: 129 } },
          { ...process('target', 320, 0), size: { width: 240, height: 108 } },
        ],
        [edge('aligned-manual', 'source', 'target', {
          presentation: {
            sourceAnchor: { side: 'RIGHT', offset: 0.523702219266312 },
            sourceAnchorMode: 'manual',
            targetAnchor: { side: 'LEFT', offset: 0.46233041792458973 },
            targetAnchorMode: 'manual',
          },
        })],
      ),
      'target',
      { x: 320, y: 0 },
    );

    expect(result?.axis).toBe('y');
    expect(result?.position.x).toBe(320);
    expect(result?.position.y).toBeCloseTo(17.6259011495, 8);
  });

  it('uses current measured node sizes when snapping a manually anchored edge', () => {
    const source = { ...process('source', 0, 0), size: { width: 240, height: 115 } };
    const target = { ...process('target', 320, -20), size: { width: 240, height: 140 } };
    const sourceOffset = 0.523702219266312;
    const targetOffset = 0.46233041792458973;
    const result = snapNodeForStraightRoute(
      document(
        [source, target],
        [edge('aligned-measured', 'source', 'target', {
          presentation: {
            sourceAnchor: { side: 'RIGHT', offset: sourceOffset },
            sourceAnchorMode: 'manual',
            targetAnchor: { side: 'LEFT', offset: targetOffset },
            targetAnchorMode: 'manual',
          },
        })],
      ),
      'target',
      { x: 320, y: -20 },
    );

    expect(result?.axis).toBe('y');
    expect(result?.position).toEqual({
      x: 320,
      y: 115 * sourceOffset - 140 * targetOffset,
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
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: 0.75 },
          targetAnchorMode: 'manual',
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
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'BOTTOM', offset: 0.2 },
          targetAnchorMode: 'manual',
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

function sampleCubicSegments(segments: Array<{
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}>): Point[] {
  return segments.flatMap((segment, segmentIndex) => Array.from({ length: 12 }, (_, step) => {
    const t = (step + 1) / 12;
    const inverse = 1 - t;
    const point = {
      x: inverse ** 3 * segment.start.x
        + 3 * inverse ** 2 * t * segment.control1.x
        + 3 * inverse * t ** 2 * segment.control2.x
        + t ** 3 * segment.end.x,
      y: inverse ** 3 * segment.start.y
        + 3 * inverse ** 2 * t * segment.control1.y
        + 3 * inverse * t ** 2 * segment.control2.y
        + t ** 3 * segment.end.y,
    };
    return segmentIndex === 0 && step === 0 ? [segment.start, point] : [point];
  }).flat());
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

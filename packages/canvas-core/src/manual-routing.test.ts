import { describe, expect, it } from 'vitest';

import { editableRouteSegments, moveRouteSegment, seedManualRoute, snapRouteCoordinate } from './manual-routing';

describe('manual route geometry', () => {
  it('exposes only interior orthogonal segments as editable handles', () => {
    expect(editableRouteSegments([
      { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 120 },
    ])).toEqual([
      expect.objectContaining({ index: 1, orientation: 'vertical' }),
      expect.objectContaining({ index: 2, orientation: 'horizontal' }),
    ]);
  });

  it('moves a horizontal segment without changing either endpoint', () => {
    const points = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 120 }];
    expect(moveRouteSegment(points, 2, 160)).toEqual([
      { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 160 }, { x: 200, y: 160 }, { x: 200, y: 120 },
    ]);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 200, y: 120 });
  });

  it('seeds an editable detour when an aligned route only has endpoints', () => {
    expect(seedManualRoute([{ x: 240, y: 52 }, { x: 360, y: 52 }])).toEqual([
      { x: 240, y: 52 },
      { x: 264, y: 52 },
      { x: 264, y: 132 },
      { x: 336, y: 132 },
      { x: 336, y: 52 },
      { x: 360, y: 52 },
    ]);
  });

  it('keeps a direct route shortest until its virtual segment is moved', () => {
    const points = [{ x: 240, y: 52 }, { x: 360, y: 52 }];

    expect(moveRouteSegment(points, 0, 52)).toEqual(points);
    expect(moveRouteSegment(points, 0, 132)).toEqual([
      { x: 240, y: 52 },
      { x: 264, y: 52 },
      { x: 264, y: 132 },
      { x: 336, y: 132 },
      { x: 336, y: 52 },
      { x: 360, y: 52 },
    ]);
  });

  it('snaps a manual segment back to an endpoint row before applying the grid', () => {
    const points = [
      { x: 0, y: 52 }, { x: 24, y: 52 }, { x: 24, y: 132 },
      { x: 200, y: 132 }, { x: 200, y: 52 }, { x: 240, y: 52 },
    ];

    expect(snapRouteCoordinate(points, 'horizontal', 60)).toBe(52);
    expect(snapRouteCoordinate(points, 'horizontal', 173)).toBe(180);
  });
});

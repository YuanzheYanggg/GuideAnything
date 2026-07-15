import { describe, expect, it } from 'vitest';

import { orthogonalPath, routeLabelPoint } from './OrthogonalEdge';

describe('OrthogonalEdge path helpers', () => {
  it('builds a rounded orthogonal path through every route point', () => {
    expect(orthogonalPath([
      { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 160 }, { x: 240, y: 160 },
    ])).toBe('M 0 50 L 88 50 Q 100 50 100 62 L 100 148 Q 100 160 112 160 L 240 160');
  });

  it('places the label at the midpoint of the longest segment', () => {
    expect(routeLabelPoint([
      { x: 0, y: 50 }, { x: 40, y: 50 }, { x: 40, y: 250 }, { x: 100, y: 250 },
    ])).toEqual({ x: 40, y: 150 });
  });
});

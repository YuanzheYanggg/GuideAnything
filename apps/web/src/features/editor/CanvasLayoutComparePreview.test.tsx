import { describe, expect, it } from 'vitest';

import { relativeViewport } from './CanvasLayoutComparePreview';

describe('CanvasLayoutComparePreview', () => {
  it('maps a camera change relative to each pane’s own fitted baseline', () => {
    expect(relativeViewport(
      { x: 100, y: 200, zoom: 0.5 },
      { x: 50, y: 60, zoom: 0.25 },
      { x: 130, y: 160, zoom: 0.75 },
    )).toEqual({ x: 80, y: 20, zoom: 0.375 });
  });
});

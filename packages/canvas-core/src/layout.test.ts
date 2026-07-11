import type { CanvasDocument } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { layoutGrid } from './layout';

describe('layoutGrid', () => {
  it('places wide multimodal nodes without overlap', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'a', type: 'markdown', position: { x: 0, y: 0 }, zIndex: 0, data: { markdown: 'A' } },
        { id: 'b', type: 'image', position: { x: 20, y: 0 }, zIndex: 1, data: { url: 'https://example.com/a.png', alt: 'A' } },
        { id: 'c', type: 'video', position: { x: 40, y: 0 }, zIndex: 2, data: { url: 'https://example.com/a.mp4', keypoints: [] } },
      ], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const laidOut = layoutGrid(document, 3);
    expect(laidOut.nodes.map((node) => node.position)).toEqual([
      { x: 80, y: 80 }, { x: 460, y: 80 }, { x: 840, y: 80 },
    ]);
  });
});

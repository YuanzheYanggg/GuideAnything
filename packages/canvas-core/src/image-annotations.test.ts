import type { CanvasDocument, ImageAnnotation } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { cameraForAnnotation, normalizeAnnotationOrder, resolveAnnotationTarget } from './image-annotations';

const point = (overrides: Partial<ImageAnnotation> = {}): ImageAnnotation => ({
  id: 'point', order: 4, title: '客户字段', shape: 'POINT', region: { x: 0.25, y: 0.4 }, ...overrides,
});

describe('image annotation utilities', () => {
  it('normalizes order stably without mutating input', () => {
    const input = [point({ id: 'late', order: 8 }), point({ id: 'first', order: 2 }), point({ id: 'same', order: 2 })];

    const result = normalizeAnnotationOrder(input);

    expect(result.map(({ id, order }) => [id, order])).toEqual([['first', 0], ['same', 1], ['late', 2]]);
    expect(input.map((item) => item.order)).toEqual([8, 2, 2]);
  });

  it('resolves valid targets but not missing or self targets', () => {
    const document = imageDocument();

    expect(resolveAnnotationTarget(document, 'image', 'note')?.id).toBe('note');
    expect(resolveAnnotationTarget(document, 'image', 'missing')).toBeNull();
    expect(resolveAnnotationTarget(document, 'image', 'image')).toBeNull();
    expect(resolveAnnotationTarget(document, 'image')).toBeNull();
  });

  it('preserves a saved camera', () => {
    expect(cameraForAnnotation(point({ camera: { centerX: 0.7, centerY: 0.2, zoom: 6 } }))).toEqual({ centerX: 0.7, centerY: 0.2, zoom: 6 });
  });

  it('creates a useful fallback camera for points and rectangles', () => {
    expect(cameraForAnnotation(point())).toEqual({ centerX: 0.25, centerY: 0.4, zoom: 2.5 });
    expect(cameraForAnnotation(point({ shape: 'RECT', region: { x: 0.2, y: 0.3, width: 0.25, height: 0.5 } }))).toEqual({ centerX: 0.325, centerY: 0.55, zoom: 1.5 });
    expect(cameraForAnnotation(point({ shape: 'RECT', region: { x: 0.49, y: 0.49, width: 0.01, height: 0.01 } })).zoom).toBe(8);
  });
});

function imageDocument(): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0, data: { url: 'https://example.com/a.png', alt: 'A' } },
      { id: 'note', type: 'markdown', position: { x: 400, y: 0 }, zIndex: 1, data: { markdown: '说明' } },
    ],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
  };
}

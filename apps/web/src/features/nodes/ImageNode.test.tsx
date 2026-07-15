import type { CanvasNode } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { imageAnnotationSummary } from './ImageNode';

describe('imageAnnotationSummary', () => {
  it('counts annotations and valid linked resources', () => {
    const data: CanvasNode<'image'>['data'] = {
      url: 'https://example.com/a.png', alt: 'A',
      annotations: [
        { id: 'a', order: 0, title: 'A', shape: 'POINT', region: { x: 0.2, y: 0.2 }, targetNodeId: 'note' },
        { id: 'b', order: 1, title: 'B', shape: 'POINT', region: { x: 0.4, y: 0.4 } },
      ],
    };

    expect(imageAnnotationSummary(data)).toBe('2 个标注 · 1 个关联资料');
    expect(imageAnnotationSummary({ url: data.url, alt: data.alt })).toBe('');
  });
});

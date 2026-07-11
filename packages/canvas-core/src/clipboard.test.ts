import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '@guideanything/contracts';

import { duplicateSelection } from './clipboard';

describe('duplicateSelection', () => {
  it('rewrites node and internal edge IDs while preserving external edges', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'a', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'b', type: 'process', position: { x: 200, y: 0 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
        { id: 'c', type: 'end', position: { x: 400, y: 0 }, zIndex: 2, data: { label: '结束', shape: 'end' } },
      ],
      edges: [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'bc', source: 'b', target: 'c' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: ['c'],
    };

    const result = duplicateSelection(document, ['a', 'b'], 'paste-1', { x: 40, y: 30 });

    expect(result.newNodeIds).toEqual(['copy:paste-1:a', 'copy:paste-1:b']);
    expect(result.document.nodes.find((node) => node.id === 'copy:paste-1:a')?.position).toEqual({ x: 40, y: 30 });
    expect(result.document.edges).toEqual(expect.arrayContaining([
      { id: 'copy:paste-1:ab', source: 'copy:paste-1:a', target: 'copy:paste-1:b' },
      { id: 'bc', source: 'b', target: 'c' },
    ]));
    expect(result.document.edges.some((edge) => edge.id === 'copy:paste-1:bc')).toBe(false);
  });
});

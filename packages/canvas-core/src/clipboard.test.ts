import { describe, expect, it } from 'vitest';
import { CanvasDocumentSchema, type CanvasDocument } from '@guideanything/contracts';

import { duplicateSelection } from './clipboard';
import { compileFlowKnowledgeSnapshotV2 } from './flow-knowledge';

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

  it('gives copied image annotations unique IDs and rewrites only selected targets', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
        { id: 'external', type: 'end', position: { x: 400, y: 0 }, zIndex: 1, data: { label: '结束', shape: 'end' } },
        {
          id: 'image', type: 'image', position: { x: 200, y: 160 }, zIndex: 2,
          data: {
            url: 'https://example.test/image.png', alt: '流程截图',
            annotations: [
              {
                id: 'annotation-internal', order: 0, title: '内部步骤', shape: 'POINT',
                region: { x: 0.2, y: 0.3 }, targetNodeId: 'step',
              },
              {
                id: 'annotation-external', order: 1, title: '外部步骤', shape: 'POINT',
                region: { x: 0.6, y: 0.7 }, targetNodeId: 'external',
              },
            ],
          },
        },
      ],
      edges: [{ id: 'step-image', source: 'step', target: 'image' }],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      entryNodeId: 'step',
      exitNodeIds: ['external'],
    };

    const result = duplicateSelection(document, ['step', 'image'], 'paste-image');
    const copiedImage = result.document.nodes.find((node) => node.id === 'copy:paste-image:image');
    if (copiedImage?.type !== 'image') throw new Error('missing copied image');

    expect(copiedImage.data.annotations).toEqual([
      expect.objectContaining({
        id: 'copy:paste-image:annotation-internal',
        targetNodeId: 'copy:paste-image:step',
      }),
      expect.objectContaining({
        id: 'copy:paste-image:annotation-external',
        targetNodeId: 'external',
      }),
    ]);
    const parsedDocument = CanvasDocumentSchema.parse(result.document);
    const snapshot = compileFlowKnowledgeSnapshotV2({
      snapshotId: 'snapshot-copy',
      workspaceId: 'workspace-copy',
      workspaceItemId: 'item-copy',
      guideId: 'guide-copy',
      title: '复制图片标注',
      summary: '',
      tags: [],
      origin: { kind: 'DRAFT', revision: 1 },
      document: parsedDocument,
    });
    const annotationIds = snapshot.resources.flatMap((resource) => (
      resource.kind === 'IMAGE' ? resource.annotations.map((annotation) => annotation.id) : []
    ));

    expect(new Set(annotationIds).size).toBe(annotationIds.length);
    expect(annotationIds).toEqual(expect.arrayContaining([
      'annotation-internal',
      'annotation-external',
      'copy:paste-image:annotation-internal',
      'copy:paste-image:annotation-external',
    ]));
  });
});

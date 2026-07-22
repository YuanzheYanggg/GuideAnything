import { compileFlowKnowledgeSnapshotV2 } from '@guideanything/canvas-core';
import type { CanvasDocument } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { resolveFlowAnnotationTarget } from './targets';

describe('flow annotation targets', () => {
  it('resolves an annotation only within its image resource and retains owner context', () => {
    const snapshot = annotatedSnapshot();

    expect(resolveFlowAnnotationTarget(snapshot, 'image-resource', 'version-type')).toMatchObject({
      resourceNodeId: 'image-resource',
      annotation: { id: 'version-type', title: '版类型' },
      ownerNodeIds: ['confirm-material'],
    });
    expect(() => resolveFlowAnnotationTarget(snapshot, 'image-resource', 'delivery-date'))
      .toThrow(/标注/u);
    expect(() => resolveFlowAnnotationTarget(snapshot, 'missing-image', 'version-type'))
      .toThrow(/图片资料/u);
  });
});

function annotatedSnapshot() {
  return compileFlowKnowledgeSnapshotV2({
    snapshotId: 'snapshot-1',
    workspaceId: 'workspace-1',
    workspaceItemId: 'item-1',
    guideId: 'guide-1',
    title: '打样流程',
    summary: '',
    tags: [],
    origin: { kind: 'DRAFT', revision: 0 },
    document: annotatedDocument(),
  });
}

function annotatedDocument(): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'confirm-material', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '确认原料', shape: 'process' } },
      {
        id: 'image-resource',
        type: 'image',
        position: { x: 240, y: 0 },
        zIndex: 1,
        attachment: { ownerNodeId: 'confirm-material', order: 0 },
        data: {
          url: 'https://example.com/sample.png',
          alt: '打样系统截图',
          annotations: [{
            id: 'version-type', order: 0, title: '版类型', shape: 'POINT', region: { x: 0.3, y: 0.4 },
          }],
        },
      },
      {
        id: 'other-image',
        type: 'image',
        position: { x: 480, y: 0 },
        zIndex: 2,
        data: {
          url: 'https://example.com/other.png',
          alt: '其他截图',
          annotations: [{
            id: 'delivery-date', order: 0, title: '希望日期', shape: 'POINT', region: { x: 0.5, y: 0.5 },
          }],
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [],
    exitNodeIds: [],
  };
}

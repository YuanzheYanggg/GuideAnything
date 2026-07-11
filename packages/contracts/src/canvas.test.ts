import { describe, expect, it } from 'vitest';

import { CanvasDocumentSchema } from './canvas';

describe('CanvasDocumentSchema', () => {
  it('accepts a valid multimodal canvas', () => {
    const result = CanvasDocumentSchema.safeParse({
      schemaVersion: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          position: { x: 0, y: 0 },
          zIndex: 0,
          data: { label: '开始', shape: 'start' },
        },
        {
          id: 'video',
          type: 'video',
          position: { x: 240, y: 0 },
          zIndex: 1,
          data: {
            url: 'https://example.com/demo.mp4',
            caption: '演示',
            keypoints: [{ id: 'kp-1', title: '填写客户', timeSeconds: 12 }],
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'video' }],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [{ id: 'step-1', order: 1, title: '打开页面', nodeId: 'start' }],
      entryNodeId: 'start',
      exitNodeIds: ['video'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects unsafe video URLs and dangling lesson nodes', () => {
    const result = CanvasDocumentSchema.safeParse({
      schemaVersion: 1,
      nodes: [
        {
          id: 'video',
          type: 'video',
          position: { x: 0, y: 0 },
          zIndex: 0,
          data: { url: 'javascript:alert(1)', keypoints: [] },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [{ id: 'step-1', order: 1, title: '坏步骤', nodeId: 'missing' }],
      exitNodeIds: [],
    });

    expect(result.success).toBe(false);
  });

  it('accepts persisted subguide continuation metadata', () => {
    const result = CanvasDocumentSchema.safeParse({
      schemaVersion: 1,
      nodes: [{
        id: 'reference',
        type: 'subguide',
        position: { x: 0, y: 0 },
        zIndex: 0,
        data: {
          guideId: 'source-guide',
          guideVersionId: 'source-version',
          title: '物料主数据检查',
          version: 1,
          expanded: true,
          expandedContinuationEdges: [{ id: 'continue-to-host', hidden: false }],
        },
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      exitNodeIds: [],
    });

    expect(result.success).toBe(true);
  });
});

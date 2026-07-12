import { describe, expect, it } from 'vitest';

import { CanvasDocumentSchema } from './canvas';

describe('CanvasDocumentSchema', () => {
  function hierarchyDocument(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      stages: [{ id: 'prepare', title: '准备', order: 0 }],
      nodes: [
        {
          id: 'start',
          type: 'start',
          position: { x: 0, y: 0 },
          zIndex: 0,
          stageId: 'prepare',
          data: { label: '开始', shape: 'start' },
        },
        {
          id: 'note',
          type: 'markdown',
          position: { x: 0, y: 160 },
          zIndex: 1,
          contentParentId: 'start',
          data: { markdown: '核对前置条件' },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      entryNodeId: 'start',
      exitNodeIds: ['start'],
      ...overrides,
    };
  }

  it('accepts stages and a resource attached to a primary flow node', () => {
    expect(CanvasDocumentSchema.safeParse(hierarchyDocument()).success).toBe(true);
  });

  it('rejects invalid hierarchy references', () => {
    const nested = hierarchyDocument({
      nodes: [
        ...hierarchyDocument().nodes.slice(0, 2),
        {
          id: 'image',
          type: 'image',
          position: { x: 0, y: 280 },
          zIndex: 2,
          contentParentId: 'note',
          data: { url: 'https://example.com/a.png', alt: 'A' },
        },
      ],
    });
    const unknownStage = hierarchyDocument({
      nodes: [{ ...hierarchyDocument().nodes[0], stageId: 'missing' }],
    });
    const duplicateStage = hierarchyDocument({
      stages: [
        { id: 'prepare', title: '准备', order: 0 },
        { id: 'prepare', title: '复核', order: 1 },
      ],
    });

    expect(CanvasDocumentSchema.safeParse(nested).success).toBe(false);
    expect(CanvasDocumentSchema.safeParse(unknownStage).success).toBe(false);
    expect(CanvasDocumentSchema.safeParse(duplicateStage).success).toBe(false);
  });

  it('rejects a resource attached to a derived process node', () => {
    const result = CanvasDocumentSchema.safeParse(hierarchyDocument({
      nodes: [
        ...hierarchyDocument().nodes.slice(0, 2),
        {
          id: 'derived-process',
          type: 'process',
          position: { x: 0, y: 280 },
          zIndex: 2,
          source: {
            referenceNodeId: 'source-process',
            sourceGuideId: 'source-guide',
            sourceVersionId: 'source-version',
            sourceElementId: 'source-element',
          },
          data: { label: '派生流程', shape: 'process' },
        },
        {
          id: 'derived-note',
          type: 'markdown',
          position: { x: 0, y: 440 },
          zIndex: 3,
          contentParentId: 'derived-process',
          data: { markdown: '派生资料' },
        },
      ],
    }));

    expect(result.success).toBe(false);
  });

  it('accepts a resource attached to a primary flow node from the same reference', () => {
    const result = CanvasDocumentSchema.safeParse(hierarchyDocument({
      nodes: [
        {
          id: 'derived-process',
          type: 'process',
          position: { x: 0, y: 0 },
          zIndex: 0,
          source: sourceTrace('reference-1', 'source-process'),
          data: { label: '派生流程', shape: 'process' },
        },
        {
          id: 'derived-note',
          type: 'markdown',
          position: { x: 0, y: 160 },
          zIndex: 1,
          contentParentId: 'derived-process',
          source: sourceTrace('reference-1', 'source-note'),
          data: { markdown: '派生资料' },
        },
      ],
      entryNodeId: 'derived-process',
      exitNodeIds: ['derived-process'],
    }));

    expect(result.success).toBe(true);
  });

  it('rejects a resource attached to a primary flow node from another reference', () => {
    const result = CanvasDocumentSchema.safeParse(hierarchyDocument({
      nodes: [
        {
          id: 'derived-process',
          type: 'process',
          position: { x: 0, y: 0 },
          zIndex: 0,
          source: sourceTrace('reference-1', 'source-process'),
          data: { label: '派生流程', shape: 'process' },
        },
        {
          id: 'derived-note',
          type: 'markdown',
          position: { x: 0, y: 160 },
          zIndex: 1,
          contentParentId: 'derived-process',
          source: sourceTrace('reference-2', 'source-note'),
          data: { markdown: '跨引用资料' },
        },
      ],
      entryNodeId: 'derived-process',
      exitNodeIds: ['derived-process'],
    }));

    expect(result.success).toBe(false);
  });

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

function sourceTrace(referenceNodeId: string, sourceElementId: string) {
  return {
    referenceNodeId,
    sourceGuideId: 'source-guide',
    sourceVersionId: 'source-version',
    sourceElementId,
  };
}

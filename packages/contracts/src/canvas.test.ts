import { describe, expect, it } from 'vitest';

import { CanvasDocumentSchema, EdgePresentationSchema } from './canvas';

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

  it('accepts mixed role and system lanes on a source-free primary', () => {
    const result = CanvasDocumentSchema.safeParse(hierarchyDocument({
      lanes: [
        { id: 'sales', title: '销售人员', kind: 'ROLE', order: 0 },
        { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
      ],
      nodes: [{ ...hierarchyDocument().nodes[0], laneId: 'sales' }, hierarchyDocument().nodes[1]],
    }));

    expect(result.success).toBe(true);
  });

  it('rejects duplicate, missing, resource, and derived lane assignments', () => {
    const lane = { id: 'sales', title: '销售人员', kind: 'ROLE', order: 0 };

    expect(CanvasDocumentSchema.safeParse(hierarchyDocument({
      lanes: [lane, { ...lane, title: '重复', order: 1 }],
    })).success).toBe(false);
    expect(CanvasDocumentSchema.safeParse(hierarchyDocument({
      lanes: [lane],
      nodes: [{ ...hierarchyDocument().nodes[0], laneId: 'missing' }],
    })).success).toBe(false);
    expect(CanvasDocumentSchema.safeParse(hierarchyDocument({
      lanes: [lane],
      nodes: [{ ...hierarchyDocument().nodes[0], laneId: 'sales' }, { ...hierarchyDocument().nodes[1], laneId: 'sales' }],
    })).success).toBe(false);
    expect(CanvasDocumentSchema.safeParse(hierarchyDocument({
      lanes: [lane],
      nodes: [
        { ...hierarchyDocument().nodes[0], laneId: 'sales' },
        {
          ...hierarchyDocument().nodes[0],
          id: 'derived',
          stageId: undefined,
          laneId: 'sales',
          source: sourceTrace('reference-1', 'derived-flow'),
        },
      ],
    })).success).toBe(false);
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

  it('rejects a derived resource attached to a host primary flow node', () => {
    const result = CanvasDocumentSchema.safeParse(hierarchyDocument({
      nodes: [
        hierarchyDocument().nodes[0],
        {
          id: 'derived-note',
          type: 'markdown',
          position: { x: 0, y: 160 },
          zIndex: 1,
          contentParentId: 'start',
          source: sourceTrace('reference-1', 'source-note'),
          data: { markdown: '派生资料不能挂靠宿主流程' },
        },
      ],
    }));

    expect(result.success).toBe(false);
  });

  it('rejects a resource attached to a primary flow node from the same reference', () => {
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

    expect(result.success).toBe(false);
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

  it('accepts legacy edges and preserves custom edge presentation colors', () => {
    const legacy = hierarchyDocument({
      edges: [{ id: 'legacy', source: 'start', target: 'start' }],
    });
    const presentation = {
      color: '#1020ff',
      width: 7,
      pattern: 'dotted',
      arrows: 'both',
      routing: 'straight',
      sourceAnchor: { side: 'BOTTOM', offset: 0.2 },
      targetAnchor: { side: 'LEFT', offset: 0.8 },
    };
    const styled = hierarchyDocument({
      edges: [{
        id: 'styled',
        source: 'start',
        target: 'start',
        presentation,
      }],
    });

    expect(CanvasDocumentSchema.safeParse(legacy).success).toBe(true);
    expect(CanvasDocumentSchema.safeParse(styled).data?.edges[0]?.presentation)
      .toEqual(presentation);
  });

  it('rejects unsafe edge presentation values', () => {
    const invalidOffset = hierarchyDocument({
      edges: [{
        id: 'bad-offset',
        source: 'start',
        target: 'start',
        presentation: { sourceAnchor: { side: 'TOP', offset: 1.01 } },
      }],
    });
    const invalidStyle = hierarchyDocument({
      edges: [{
        id: 'bad-style',
        source: 'start',
        target: 'start',
        presentation: { color: 'url(javascript:alert(1))', width: 25, routing: 'curved' },
      }],
    });

    expect(CanvasDocumentSchema.safeParse(invalidOffset).success).toBe(false);
    expect(CanvasDocumentSchema.safeParse(invalidStyle).success).toBe(false);
  });

  it('accepts backward-compatible automatic edges and manual waypoints', () => {
    expect(EdgePresentationSchema.parse({ routing: 'elbow' })).toEqual({ routing: 'elbow' });
    expect(EdgePresentationSchema.parse({ routeMode: 'manual', waypoints: [{ x: 120, y: 240 }] })).toEqual({
      routeMode: 'manual',
      waypoints: [{ x: 120, y: 240 }],
    });
  });

  it('rejects invalid manual waypoint data', () => {
    expect(() => EdgePresentationSchema.parse({ routeMode: 'manual', waypoints: [{ x: Number.NaN, y: 0 }] })).toThrow();
    expect(() => EdgePresentationSchema.parse({ routeMode: 'manual', waypoints: Array.from({ length: 33 }, (_, index) => ({ x: index, y: index })) })).toThrow();
  });

  it('accepts legacy images and normalized point and rectangle annotations', () => {
    expect(CanvasDocumentSchema.safeParse(imageDocument()).success).toBe(true);

    const result = CanvasDocumentSchema.safeParse(imageDocument([
      {
        id: 'annotation-point', order: 0, title: '客户字段', body: '在这里填写售达方', shape: 'POINT',
        region: { x: 0.25, y: 0.4 }, camera: { centerX: 0.25, centerY: 0.4, zoom: 3 }, targetNodeId: 'note',
      },
      {
        id: 'annotation-rect', order: 1, title: '订单区域', shape: 'RECT',
        region: { x: 0.5, y: 0.2, width: 0.3, height: 0.25 },
      },
    ]));

    expect(result.success).toBe(true);
  });

  it('rejects invalid image annotation geometry and camera zoom', () => {
    const invalidAnnotations = [
      { id: 'outside', order: 0, title: '越界', shape: 'POINT', region: { x: 1.1, y: 0.4 } },
      { id: 'zero-rect', order: 0, title: '空区域', shape: 'RECT', region: { x: 0.2, y: 0.2, width: 0, height: 0.2 } },
      { id: 'overflow-rect', order: 0, title: '超出图片', shape: 'RECT', region: { x: 0.8, y: 0.2, width: 0.3, height: 0.2 } },
      { id: 'zoom', order: 0, title: '非法镜头', shape: 'POINT', region: { x: 0.2, y: 0.2 }, camera: { centerX: 0.2, centerY: 0.2, zoom: 9 } },
    ];

    invalidAnnotations.forEach((annotation) => {
      expect(CanvasDocumentSchema.safeParse(imageDocument([annotation])).success).toBe(false);
    });
  });

  it('rejects duplicate annotation ids, duplicate orders, and self targets', () => {
    const base = { id: 'same', order: 0, title: '标注', shape: 'POINT', region: { x: 0.2, y: 0.2 } };

    expect(CanvasDocumentSchema.safeParse(imageDocument([base, { ...base, order: 1 }])).success).toBe(false);
    expect(CanvasDocumentSchema.safeParse(imageDocument([base, { ...base, id: 'other' }])).success).toBe(false);
    expect(CanvasDocumentSchema.safeParse(imageDocument([{ ...base, targetNodeId: 'image' }])).success).toBe(false);
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

function imageDocument(annotations?: unknown[]) {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0,
        data: { url: 'https://example.com/screen.png', alt: 'ERP 页面', ...(annotations ? { annotations } : {}) },
      },
      { id: 'note', type: 'markdown', position: { x: 360, y: 0 }, zIndex: 1, data: { markdown: '字段说明' } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [],
    entryNodeId: 'image',
    exitNodeIds: ['image'],
  };
}

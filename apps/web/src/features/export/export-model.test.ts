import type { CanvasDocument, CanvasNode, ImageAnnotation } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import type { GuideDraftDetail } from '../editor/GuideEditor';
import { buildGuidePdfExportModel } from './export-model';

const pointAnnotation: ImageAnnotation = {
  id: 'annotation-1',
  order: 0,
  title: '客户编号',
  body: '这里是完整标注说明。',
  shape: 'POINT',
  region: { x: 0.25, y: 0.35 },
};

const documentWithResources: CanvasDocument = {
  schemaVersion: 1,
  stages: [{ id: 'stage-sales', title: '销售阶段', order: 0 }],
  lanes: [{ id: 'lane-sales', title: '销售责任', kind: 'ROLE', order: 0 }],
  nodes: [
    {
      id: 'start',
      type: 'start',
      position: { x: 0, y: 0 },
      zIndex: 0,
      stageId: 'stage-sales',
      laneId: 'lane-sales',
      outline: { order: 0, kind: 'STEP' },
      data: { label: '开始', shape: 'start' },
    },
    {
      id: 'decision',
      type: 'decision',
      position: { x: 360, y: 0 },
      zIndex: 1,
      stageId: 'stage-sales',
      laneId: 'lane-sales',
      outline: { order: 1, kind: 'STEP' },
      data: {
        label: '检查订单',
        description: '完整详情第一行\n完整详情第二行',
        shape: 'decision',
        branchLabels: ['通过'],
      },
    },
    {
      id: 'process-branch',
      type: 'process',
      position: { x: 720, y: 0 },
      zIndex: 2,
      stageId: 'stage-sales',
      laneId: 'lane-sales',
      outline: { parentId: 'decision', order: 0, kind: 'BRANCH' },
      data: { label: '继续处理', description: '分支处理详情', shape: 'process' },
    },
    {
      id: 'image-resource',
      type: 'image',
      position: { x: 360, y: 240 },
      zIndex: 3,
      attachment: { ownerNodeId: 'decision', order: 0 },
      data: {
        url: 'https://cdn.example.com/order-screen.png',
        alt: '订单界面',
        caption: '订单界面截图',
        annotations: [pointAnnotation],
      },
    },
    {
      id: 'video-resource',
      type: 'video',
      position: { x: 720, y: 240 },
      zIndex: 4,
      attachment: { ownerNodeId: 'decision', order: 1 },
      data: {
        url: 'https://cdn.example.com/order-demo.mp4',
        caption: '订单操作演示',
        keypoints: [{ id: 'keypoint-1', title: '填写客户', timeSeconds: 12 }],
      },
    },
    {
      id: 'hidden-markdown',
      type: 'markdown',
      position: { x: 1080, y: 240 },
      zIndex: 5,
      visibility: 'HIDDEN',
      attachment: { ownerNodeId: 'decision', order: 2 },
      data: { markdown: '# 内部资料' },
    },
    {
      id: 'expanded-source-copy',
      type: 'process',
      position: { x: 1080, y: 0 },
      zIndex: 6,
      source: {
        referenceNodeId: 'subguide-reference',
        sourceGuideId: 'source-guide',
        sourceVersionId: 'source-version',
        sourceElementId: 'source-process',
      },
      data: { label: '被展开的来源节点', shape: 'process' },
    },
  ],
  edges: [
    { id: 'flow-start-decision', source: 'start', target: 'decision', semantic: { kind: 'FLOW' } },
    { id: 'branch-decision-process', source: 'decision', target: 'process-branch', label: '通过', semantic: { kind: 'BRANCH', order: 0 } },
    { id: 'resource-reference', source: 'decision', target: 'image-resource', semantic: { kind: 'RESOURCE_REFERENCE' } },
    {
      id: 'source-trace-edge',
      source: 'decision',
      target: 'expanded-source-copy',
      sourceTrace: {
        referenceNodeId: 'subguide-reference',
        sourceGuideId: 'source-guide',
        sourceVersionId: 'source-version',
        sourceElementId: 'source-process',
      },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  entryNodeId: 'start',
  exitNodeIds: ['process-branch'],
};

const guide = {
  id: 'guide-1',
  workspaceId: 'workspace-1',
  workspaceItemId: 'item-1',
  ownerId: 'owner-1',
  authorName: '作者',
  title: '订单流程',
  summary: '从接单到完成的操作流程。',
  tags: ['订单', 'ERP'],
  status: 'DRAFT',
  revision: 7,
  document: documentWithResources,
  publishedVersionId: null,
  publishedVersion: null,
  updatedAt: '2026-07-22T00:00:00.000Z',
} satisfies GuideDraftDetail;

function input(overrides: Partial<GuideDraftDetail> = {}) {
  return {
    title: guide.title,
    summary: guide.summary,
    tags: guide.tags,
    status: guide.status,
    revision: guide.revision,
    publishedVersion: guide.publishedVersion,
    document: guide.document,
    generatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildGuidePdfExportModel', () => {
  it('projects semantic steps, visible resources, annotations, and a filtered routed overview', () => {
    const model = buildGuidePdfExportModel(input());

    expect(model.steps.map((step) => step.code)).toEqual(['1', '2', '2.B1']);
    expect(model.steps.find((step) => step.code === '2')?.description).toContain('完整详情');
    expect(model.steps.find((step) => step.code === '2')?.resources.map((resource) => resource.kind)).toEqual(['image', 'video']);
    expect(model.steps.flatMap((step) => step.resources).map((resource) => resource.id)).not.toContain('hidden-markdown');
    expect(model.steps.find((step) => step.code === '2')?.resources[0]).toMatchObject({
      kind: 'image',
      annotations: [pointAnnotation],
    });
    expect(model.overview.nodes.map((node) => node.id)).not.toContain('expanded-source-copy');
    expect(model.overview.edges.every((edge) => edge.source !== 'image-resource' && edge.target !== 'image-resource')).toBe(true);
    expect(model.overview.edges.find((edge) => edge.id === 'branch-decision-process')).toMatchObject({ label: '通过' });
    expect(model.cover.counts).toEqual({ steps: 3, markdown: 0, images: 1, videos: 1 });
    expect(model.steps.find((step) => step.code === '2')?.stageTitle).toBe('销售阶段');
    expect(model.steps.find((step) => step.code === '2')?.laneTitle).toBe('销售责任');
  });

  it('reports an empty-flow warning without preventing cover generation', () => {
    const emptyDocument: CanvasDocument = {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      exitNodeIds: [],
    };

    const model = buildGuidePdfExportModel(input({ document: emptyDocument }));

    expect(model.overview.hasFlow).toBe(false);
    expect(model.warnings).toContainEqual(expect.objectContaining({ code: 'NO_FLOW_NODES' }));
    expect(model.cover.title).toBe('订单流程');
  });

  it('warns when a visible video points to a local protected media path', () => {
    const privateVideo: CanvasNode<'video'> = {
      id: 'private-video',
      type: 'video',
      position: { x: 0, y: 200 },
      zIndex: 2,
      attachment: { ownerNodeId: 'decision', order: 0 },
      data: { url: '/api/media/video-1', keypoints: [] },
    };
    const document: CanvasDocument = {
      ...documentWithResources,
      nodes: [...documentWithResources.nodes, privateVideo],
    };

    const model = buildGuidePdfExportModel(input({ document }));

    expect(model.warnings).toContainEqual(expect.objectContaining({ code: 'VIDEO_URL_NOT_PUBLIC', nodeId: 'private-video' }));
  });
});

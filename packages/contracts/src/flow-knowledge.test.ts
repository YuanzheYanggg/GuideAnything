import { describe, expect, it } from 'vitest';

import {
  FlowKnowledgeAttachmentV1Schema,
  FlowKnowledgeSnapshotV1Schema,
  FlowLocatorV1Schema,
  FlowSnapshotOriginV1Schema,
} from './flow-knowledge';

describe('flow knowledge contracts', () => {
  it('parses draft and published snapshot origins as distinct variants', () => {
    expect(FlowSnapshotOriginV1Schema.parse({ kind: 'DRAFT', revision: 7 })).toEqual({
      kind: 'DRAFT',
      revision: 7,
    });
    expect(FlowSnapshotOriginV1Schema.parse({
      kind: 'PUBLISHED',
      versionId: 'version-3',
      version: 3,
    })).toEqual({
      kind: 'PUBLISHED',
      versionId: 'version-3',
      version: 3,
    });
    expect(FlowSnapshotOriginV1Schema.safeParse({
      kind: 'DRAFT',
      revision: 7,
      versionId: 'version-3',
    }).success).toBe(false);
  });

  it('keeps flow locators strict and JSON-safe', () => {
    const locator = FlowLocatorV1Schema.parse({
      guideId: 'guide-1',
      snapshotId: 'snapshot-1',
      nodeId: 'process-1',
    });

    expect(JSON.parse(JSON.stringify(locator))).toEqual(locator);
    expect(FlowLocatorV1Schema.safeParse({ ...locator, versionId: 'not-part-of-a-locator' }).success).toBe(false);
  });

  it('rejects locator and snapshot identity mismatches', () => {
    expect(FlowKnowledgeSnapshotV1Schema.safeParse(snapshot()).success).toBe(true);
    expect(FlowKnowledgeSnapshotV1Schema.safeParse(snapshot({
      nodes: [{
        ...snapshot().nodes[0],
        locator: { guideId: 'guide-1', snapshotId: 'another-snapshot', nodeId: 'start' },
      }],
    })).success).toBe(false);
    expect(FlowKnowledgeSnapshotV1Schema.safeParse(snapshot({
      nodes: [{
        ...snapshot().nodes[0],
        locator: { guideId: 'another-guide', snapshotId: 'snapshot-1', nodeId: 'start' },
      }],
    })).success).toBe(false);
  });

  it('rejects duplicate nodes and relations to nodes outside the snapshot', () => {
    const start = snapshot().nodes[0];

    expect(FlowKnowledgeSnapshotV1Schema.safeParse(snapshot({
      nodes: [start, { ...start }],
    })).success).toBe(false);
    expect(FlowKnowledgeSnapshotV1Schema.safeParse(snapshot({
      nodes: [{
        ...start,
        outgoing: [{ edgeId: 'edge-missing', nodeId: 'missing' }],
        neighborhood: { oneHopNodeIds: ['missing'], twoHopNodeIds: [] },
      }],
    })).success).toBe(false);
  });

  it('rejects entry and exit flags that contradict snapshot endpoints', () => {
    expect(FlowKnowledgeSnapshotV1Schema.safeParse(snapshot({
      nodes: [{ ...snapshot().nodes[0], isEntry: false }],
    })).success).toBe(false);
    expect(FlowKnowledgeSnapshotV1Schema.safeParse(snapshot({
      nodes: [{ ...snapshot().nodes[0], isExit: false }],
    })).success).toBe(false);
    expect(FlowKnowledgeSnapshotV1Schema.safeParse(snapshot({
      exitNodeIds: ['start', 'start'],
    })).success).toBe(false);
  });

  it('discriminates markdown, image, and video attachments', () => {
    const markdown = FlowKnowledgeAttachmentV1Schema.parse({
      kind: 'MARKDOWN',
      nodeId: 'note',
      locator: locator('note'),
      order: 0,
      markdown: '核对订单字段。',
    });
    const image = FlowKnowledgeAttachmentV1Schema.parse({
      kind: 'IMAGE',
      nodeId: 'screen',
      locator: locator('screen'),
      order: 1,
      assetId: 'asset-image',
      alt: '订单页面',
      annotations: [{
        id: 'annotation-1',
        order: 0,
        title: '客户字段',
        shape: 'POINT',
        region: { x: 0.2, y: 0.4 },
        targetNodeId: 'start',
        targetLocator: locator('start'),
        supplementalImages: [{
          assetId: 'asset-menu',
          alt: '成衣类型菜单',
          caption: '点击字段后显示的选项',
        }],
      }],
    });
    const video = FlowKnowledgeAttachmentV1Schema.parse({
      kind: 'VIDEO',
      nodeId: 'demo',
      locator: locator('demo'),
      order: 2,
      assetId: 'asset-video',
      keypoints: [{
        id: 'keypoint-1',
        title: '提交订单',
        timeSeconds: 12,
        targetNodeId: 'start',
        targetLocator: locator('start'),
      }],
    });

    expect([markdown.kind, image.kind, video.kind]).toEqual(['MARKDOWN', 'IMAGE', 'VIDEO']);
    if (image.kind !== 'IMAGE') throw new Error('expected image attachment');
    expect(image.annotations[0]?.supplementalImages).toEqual([{
      assetId: 'asset-menu',
      alt: '成衣类型菜单',
      caption: '点击字段后显示的选项',
    }]);
    expect(FlowKnowledgeAttachmentV1Schema.safeParse({
      ...image,
      annotations: [{
        ...image.annotations[0],
        supplementalImages: [{ assetId: 'asset-menu', alt: '成衣类型菜单', url: '/api/media/asset-menu' }],
      }],
    }).success).toBe(false);
    expect(FlowKnowledgeAttachmentV1Schema.safeParse({
      kind: 'IMAGE',
      nodeId: 'screen',
      locator: locator('screen'),
      order: 1,
      markdown: 'wrong payload',
      alt: '订单页面',
      annotations: [],
    }).success).toBe(false);
  });
});

function locator(nodeId: string) {
  return { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    workspaceId: 'workspace-1',
    workspaceItemId: 'item-1',
    guideId: 'guide-1',
    title: '订单处理',
    summary: '从接单到完成。',
    tags: ['订单'],
    origin: { kind: 'DRAFT', revision: 7 },
    stages: [],
    lanes: [],
    entryNodeId: 'start',
    exitNodeIds: ['start'],
    nodes: [{
      id: 'start',
      locator: locator('start'),
      kind: 'start',
      title: '开始',
      stage: null,
      responsibility: null,
      isEntry: true,
      isExit: true,
      incoming: [],
      outgoing: [],
      neighborhood: { oneHopNodeIds: [], twoHopNodeIds: [] },
      attachments: [],
    }],
    unattachedResources: [],
    diagnostics: {
      danglingEdgeIds: [],
      danglingAttachmentParentIds: [],
      danglingTargetNodeIds: [],
      danglingStageIds: [],
      danglingLaneIds: [],
      danglingEntryNodeIds: [],
      danglingExitNodeIds: [],
    },
    ...overrides,
  };
}

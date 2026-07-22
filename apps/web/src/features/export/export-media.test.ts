import type { CanvasNode, ImageAnnotation } from '@guideanything/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { GuidePdfExportModel } from './export-model';
import { isPublicVideoUrl, prepareGuidePdfMedia, releaseGuidePdfMedia } from './export-media';

const processNode: CanvasNode<'process'> = {
  id: 'process-1',
  type: 'process',
  position: { x: 0, y: 0 },
  zIndex: 0,
  data: { label: '处理', shape: 'process' },
};

const annotation: ImageAnnotation = {
  id: 'annotation-1',
  order: 0,
  title: '区域',
  shape: 'POINT',
  region: { x: 0.2, y: 0.3 },
  supplementalImages: [{
    id: 'supplement-1',
    order: 0,
    assetId: 'asset-supplement-1',
    url: '/api/media/supplement-1',
    alt: '补充图片',
  }],
};

const model: GuidePdfExportModel = {
  cover: {
    title: '导出测试',
    summary: '',
    tags: [],
    status: 'DRAFT',
    revision: 1,
    publishedVersion: null,
    generatedAt: '2026-07-22T00:00:00.000Z',
    counts: { steps: 1, markdown: 0, images: 2, videos: 2 },
  },
  overview: { nodes: [], edges: [], stageBounds: [], hasFlow: true },
  steps: [{
    code: '1',
    node: processNode,
    title: '处理',
    description: '',
    resources: [
      {
        kind: 'image',
        id: 'image-1',
        code: '1.R1',
        url: '/api/media/image-1',
        alt: '截图',
        annotations: [annotation],
      },
      {
        kind: 'image',
        id: 'image-duplicate',
        code: '1.R2',
        url: '/api/media/image-1',
        alt: '同一截图',
        annotations: [],
      },
      {
        kind: 'video',
        id: 'video-1',
        code: '1.R3',
        url: 'https://cdn.example.com/demo.mp4',
        keypoints: [],
      },
      {
        kind: 'video',
        id: 'local-video',
        code: '1.R4',
        url: '/api/media/demo',
        keypoints: [],
      },
    ],
    relatedEdgeLabels: [],
  }],
  warnings: [],
};

describe('export media preparation', () => {
  it('recognizes only external HTTP(S) video URLs and prepares protected images plus local QR data', async () => {
    expect(isPublicVideoUrl('https://cdn.example.com/demo.mp4')).toBe(true);
    expect(isPublicVideoUrl('/api/media/demo')).toBe(false);
    expect(isPublicVideoUrl('javascript:alert(1)')).toBe(false);

    const loadProtectedMedia = vi.fn(async (path: string) => `blob:${path}`);
    const makeQrDataUrl = vi.fn(async () => 'data:image/png;base64,qr');

    const media = await prepareGuidePdfMedia(model, loadProtectedMedia, makeQrDataUrl);

    expect(loadProtectedMedia).toHaveBeenCalledWith('/api/media/image-1');
    expect(loadProtectedMedia).toHaveBeenCalledWith('/api/media/supplement-1');
    expect(loadProtectedMedia).toHaveBeenCalledTimes(2);
    expect(makeQrDataUrl).toHaveBeenCalledWith('https://cdn.example.com/demo.mp4');
    expect(makeQrDataUrl).toHaveBeenCalledTimes(1);
    expect(media.imageSourceByUrl.get('/api/media/image-1')).toBe('blob:/api/media/image-1');
    expect(media.imageSourceByUrl.get('https://cdn.example.com/external.png')).toBeUndefined();
    expect(media.qrDataUrlByVideoId.get('video-1')).toBe('data:image/png;base64,qr');
    expect(media.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VIDEO_URL_NOT_PUBLIC', nodeId: 'local-video' }),
    ]));
  });

  it('releases each protected object URL once and leaves external URLs untouched', async () => {
    const loadProtectedMedia = vi.fn(async (path: string) => `blob:${path}`);
    const media = await prepareGuidePdfMedia(model, loadProtectedMedia, vi.fn(async () => 'qr'));
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    releaseGuidePdfMedia(media);
    releaseGuidePdfMedia(media);

    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, 'blob:/api/media/image-1');
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, 'blob:/api/media/supplement-1');
    revokeObjectURL.mockRestore();
  });

  it('generates the public video QR locally when no external factory is supplied', async () => {
    const publicOnlyModel: GuidePdfExportModel = {
      ...model,
      steps: [{
        ...model.steps[0]!,
        resources: [model.steps[0]!.resources[2]!],
      }],
    };

    const media = await prepareGuidePdfMedia(publicOnlyModel, vi.fn(async () => 'unused'));

    expect(media.qrDataUrlByVideoId.get('video-1')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });
});

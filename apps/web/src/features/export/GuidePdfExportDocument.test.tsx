import type { CanvasNode } from '@guideanything/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PreparedGuidePdfMedia } from './export-media';
import type { GuidePdfExportModel } from './export-model';
import { GuidePdfExportDocument } from './GuidePdfExportDocument';

const processNode: CanvasNode<'process'> = {
  id: 'process-1',
  type: 'process',
  position: { x: 0, y: 0 },
  zIndex: 0,
  data: { label: '创建订单', description: '填写订单完整详情。', shape: 'process' },
};

const model: GuidePdfExportModel = {
  cover: {
    title: 'ERP 销售订单创建',
    summary: '从客户信息到订单保存。',
    tags: ['ERP', '销售'],
    status: 'DRAFT',
    revision: 3,
    publishedVersion: null,
    generatedAt: '2026-07-22T00:00:00.000Z',
    counts: { steps: 1, markdown: 0, images: 1, videos: 1 },
  },
  overview: {
    nodes: [{
      id: processNode.id,
      type: processNode.type,
      code: '1',
      title: '创建订单',
      summary: '填写订单完整详情。',
      position: processNode.position,
      size: { width: 240, height: 104 },
    }],
    edges: [],
    stageBounds: [],
    hasFlow: true,
  },
  steps: [{
    code: '1',
    node: processNode,
    title: '创建订单',
    description: '填写订单完整详情。',
    resources: [
      {
        kind: 'image',
        id: 'image-1',
        code: '1.R1',
        url: 'https://cdn.example.com/order.png',
        alt: '订单界面',
        caption: '订单页面',
        annotations: [{
          id: 'annotation-1',
          order: 0,
          title: '客户字段',
          body: '填写客户编码。',
          shape: 'POINT',
          region: { x: 0.2, y: 0.3 },
        }],
      },
      {
        kind: 'video',
        id: 'video-1',
        code: '1.R2',
        url: 'https://cdn.example.com/demo.mp4',
        caption: '订单操作演示',
        keypoints: [{ id: 'kp-1', title: '保存订单', timeSeconds: 12 }],
      },
    ],
    relatedEdgeLabels: [],
  }],
  warnings: [{ code: 'VIDEO_URL_NOT_PUBLIC', message: '视频地址不是公开链接。', nodeId: 'local-video' }],
};

const media: PreparedGuidePdfMedia = {
  imageSourceByUrl: new Map([['https://cdn.example.com/order.png', 'https://cdn.example.com/order.png']]),
  qrDataUrlByVideoId: new Map([['video-1', 'data:image/png;base64,qr']]),
  warnings: model.warnings,
  objectUrls: [],
};

describe('GuidePdfExportDocument', () => {
  it('renders the cover, routed overview, annotated image, public video QR, and warnings', () => {
    render(<GuidePdfExportDocument model={model} media={media} />);

    expect(screen.getByTestId('pdf-export-cover')).toHaveTextContent('ERP 销售订单创建');
    expect(screen.getByTestId('pdf-export-overview')).toBeInTheDocument();
    expect(screen.getByTestId('pdf-export-image-image-1')).toHaveTextContent('客户字段');
    expect(screen.getByTestId('pdf-export-video-video-1').querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,qr');
    expect(screen.getByTestId('pdf-export-video-video-1').querySelector('a')).toHaveAttribute('href', 'https://cdn.example.com/demo.mp4');
    expect(screen.getByTestId('pdf-export-warning')).toHaveTextContent('视频地址');
    expect(screen.getByTestId('pdf-export-overview').querySelector('.pdf-export-edge path')).toBeNull();
    expect(screen.getByRole('img', { name: '流程连线总览' })).toHaveAttribute('preserveAspectRatio', 'none');
  });

  it('renders a static SVG path when the overview has a route edge', () => {
    const routedModel: GuidePdfExportModel = {
      ...model,
      overview: {
        ...model.overview,
        nodes: [
          ...model.overview.nodes,
          { id: 'finish', type: 'end', code: '2', title: '完成', summary: '', position: { x: 420, y: 0 }, size: { width: 240, height: 104 } },
        ],
        edges: [{ id: 'flow', source: 'process-1', target: 'finish', label: '下一步' }],
      },
    };

    render(<GuidePdfExportDocument model={routedModel} media={media} />);

    expect(screen.getByTestId('pdf-export-overview').querySelector('.pdf-export-edge path')).toBeInTheDocument();
  });
});

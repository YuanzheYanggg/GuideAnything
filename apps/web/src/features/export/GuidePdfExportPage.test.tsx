import type { CanvasDocument } from '@guideanything/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuideDraftDetail } from '../editor/GuideEditor';
import { GuidePdfExportPage, type GuidePdfExportApi } from './GuidePdfExportPage';

const document: CanvasDocument = {
  schemaVersion: 1,
  nodes: [
    { id: 'step-1', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, outline: { order: 0, kind: 'STEP' }, data: { label: '创建订单', description: '填写订单详情。', shape: 'process' } },
    { id: 'image-1', type: 'image', position: { x: 300, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'step-1', order: 0 }, data: { url: 'https://cdn.example.com/order.png', alt: '订单页面', annotations: [] } },
    { id: 'video-1', type: 'video', position: { x: 600, y: 0 }, zIndex: 2, attachment: { ownerNodeId: 'step-1', order: 1 }, data: { url: 'https://cdn.example.com/demo.mp4', keypoints: [] } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  exitNodeIds: ['step-1'],
};

const guide: GuideDraftDetail = {
  id: 'guide-1',
  workspaceId: 'workspace-1',
  workspaceItemId: 'item-1',
  ownerId: 'owner-1',
  authorName: '作者',
  title: 'ERP 销售订单创建',
  summary: '销售订单操作流程。',
  tags: ['ERP'],
  status: 'DRAFT',
  revision: 3,
  document,
  publishedVersionId: null,
  publishedVersion: null,
  updatedAt: '2026-07-22T00:00:00.000Z',
};

function createApi(overrides: Partial<GuidePdfExportApi> = {}): GuidePdfExportApi {
  return {
    getGuide: vi.fn().mockResolvedValue(guide),
    mediaObjectUrl: vi.fn().mockResolvedValue('blob:image-1'),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GuidePdfExportPage', () => {
  it('loads the saved guide and renders a printable document', async () => {
    render(<GuidePdfExportPage guideId="guide-1" api={createApi()} onBack={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'ERP 销售订单创建' })).toBeVisible();
    expect(screen.getByRole('button', { name: '打印 / 保存为 PDF' })).toBeEnabled();
    expect(screen.getByTestId('pdf-export-document')).toBeInTheDocument();
  });

  it('keeps printing disabled while protected media is pending', async () => {
    const mediaPending = new Promise<string>(() => undefined);
    const protectedGuide: GuideDraftDetail = {
      ...guide,
      document: {
        ...guide.document,
        nodes: guide.document.nodes.map((node) => node.id === 'image-1' && node.type === 'image'
          ? { ...node, data: { ...node.data, url: '/api/media/image-1' } }
          : node),
      },
    };
    render(<GuidePdfExportPage guideId="guide-1" api={createApi({
      getGuide: vi.fn().mockResolvedValue(protectedGuide),
      mediaObjectUrl: vi.fn().mockReturnValue(mediaPending),
    })} onBack={vi.fn()} />);

    expect(await screen.findByRole('button', { name: '打印 / 保存为 PDF' })).toBeDisabled();
    expect(screen.getByText('正在准备 PDF 导出…')).toBeVisible();
  });

  it('shows a load error and provides a return action', async () => {
    const onBack = vi.fn();
    render(<GuidePdfExportPage guideId="guide-1" api={createApi({ getGuide: vi.fn().mockRejectedValue(new Error('没有权限')) })} onBack={onBack} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('没有权限');
    await userEvent.setup().click(screen.getByRole('button', { name: '返回编辑器' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('calls browser print only after media preparation is ready', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<GuidePdfExportPage guideId="guide-1" api={createApi()} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '打印 / 保存为 PDF' }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });
});

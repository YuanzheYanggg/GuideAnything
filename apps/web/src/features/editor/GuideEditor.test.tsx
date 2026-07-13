import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Edge, NodeChange } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasEdge, GuideVersionSnapshot } from '@guideanything/contracts';

import { GuideEditor, persistableNodeChanges, toCanvasEdge, toFlowNodes, type EditorApi } from './GuideEditor';
import { createPersonalApiMock } from '../../test/workspace-api-mocks';

const emptyGuide = {
  id: 'guide-host', workspaceId: 'workspace-sales', workspaceItemId: 'item-guide-1', ownerId: 'author', authorName: '王作者', title: '订单教学', summary: '', tags: ['ERP'],
  status: 'DRAFT', revision: 0, publishedVersionId: null, publishedVersion: null, updatedAt: new Date().toISOString(),
  document: { schemaVersion: 1 as const, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [] },
};

const sourceVersion: GuideVersionSnapshot = {
  id: 'version-source', guideId: 'guide-source', workspaceItemId: 'item-guide-source', version: 1, title: '物料主数据检查', summary: '', tags: ['物料'],
  document: {
    schemaVersion: 1,
    nodes: [{ id: 'source-start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '检查开始', shape: 'start' } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'source-start', exitNodeIds: ['source-start'],
  },
};

const otherSearchItem = {
  versionId: 'version-other', guideId: 'guide-other', workspaceId: 'workspace-stock', workspaceItemId: 'item-guide-other', workspaceName: '库存管理', favorite: false, title: '库存盘点流程', summary: '盘点前的准备工作', tags: ['库存'], version: 1, authorName: '李作者',
};

describe('GuideEditor', () => {
  it('records the guide as recent only after a successful load', async () => {
    const personalApi = createPersonalApiMock();
    render(<GuideEditor guideId="guide-host" api={createApi()} personalApi={personalApi} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    expect(personalApi.recordRecent).toHaveBeenCalledWith(
      'item-guide-1',
      expect.objectContaining({ mode: 'edit', guideId: 'guide-host' }),
    );
  });
  it('keeps in-progress drag positions out of the persistent change batch', () => {
    const dragging: NodeChange = { id: 'sales-start', type: 'position', position: { x: 120, y: 80 }, dragging: true };
    const finished: NodeChange = { id: 'sales-start', type: 'position', position: { x: 160, y: 80 }, dragging: false };
    const selection: NodeChange = { id: 'sales-start', type: 'select', selected: true };
    const dimensions: NodeChange = { id: 'sales-start', type: 'dimensions', dimensions: { width: 240, height: 104 }, resizing: false };

    expect(persistableNodeChanges([dragging, selection, finished, dimensions])).toEqual([finished, dimensions]);
  });

  it('passes persisted node measurements back to React Flow after a controlled update', () => {
    const [node] = toFlowNodes([{
      id: 'sales-start', type: 'start', position: { x: 80, y: 80 }, zIndex: 1,
      data: { label: '收到订单', shape: 'start' }, size: { width: 240, height: 104 },
    }]);

    expect(node).toBeDefined();
    expect(node!.measured).toEqual({ width: 240, height: 104 });
  });

  it('preserves expanded-edge provenance when React Flow reports an edge update', () => {
    const sourceTrace = {
      referenceNodeId: 'subguide-version-source', sourceGuideId: 'guide-source', sourceVersionId: 'version-source', sourceElementId: 'source-edge',
    };
    const edge = {
      id: 'ref:subguide-version-source:source-edge', source: 'ref:subguide-version-source:source-start', sourceHandle: 'out',
      target: 'ref:subguide-version-source:source-end', targetHandle: 'in', sourceTrace,
    } as Edge & CanvasEdge;

    expect(toCanvasEdge(edge)).toEqual(expect.objectContaining({ sourceTrace }));
  });

  it('does not autosave an untouched guide after loading', async () => {
    vi.useFakeTimers();
    try {
      const api = createApi();
      render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByDisplayValue('订单教学')).toBeVisible();
      await act(async () => { vi.advanceTimersByTime(1_600); });
      expect(api.saveGuide).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows all reusable guides on open and filters them while typing', async () => {
    const user = userEvent.setup();
    const sourceItem = { versionId: 'version-source', guideId: 'guide-source', workspaceId: 'workspace-materials', workspaceItemId: 'item-guide-source', workspaceName: '物料管理', favorite: false, title: '物料主数据检查', summary: '', tags: ['物料'], version: 1, authorName: '王作者' };
    const search = vi.fn<EditorApi['search']>().mockImplementation(async (query, offset = 0) => {
      if (query) return { items: [sourceItem], nextOffset: null };
      return offset === 0 ? { items: [otherSearchItem], nextOffset: 1 } : { items: [sourceItem], nextOffset: null };
    });
    const api = { ...createApi(), search };
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    await user.click(screen.getByRole('button', { name: '插入子指南' }));
    expect(await screen.findByText('库存盘点流程')).toBeVisible();
    expect(await screen.findByText('物料主数据检查')).toBeVisible();
    expect(search).toHaveBeenNthCalledWith(1, '', 0);
    expect(search).toHaveBeenNthCalledWith(2, '', 1);

    await user.type(screen.getByRole('searchbox', { name: '搜索可复用指南' }), '物料');
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('物料', 0));
    expect(screen.queryByText('库存盘点流程')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '插入 物料主数据检查' })).toBeVisible();
  });

  it('adds, saves, undoes, and publishes a guide', async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    expect(await screen.findByDisplayValue('订单教学')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '添加 Markdown 节点' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: [expect.objectContaining({ type: 'markdown' })] }),
    }));

    await user.click(screen.getByRole('button', { name: '撤销' }));
    await user.click(screen.getByRole('button', { name: '发布指南' }));
    expect(api.publishGuide).toHaveBeenCalledWith('guide-host');
  });

  it('inserts a pinned subguide and expands its immutable snapshot', async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    await user.click(screen.getByRole('button', { name: '插入子指南' }));
    await user.click(await screen.findByRole('button', { name: '插入 物料主数据检查' }));
    await user.click(screen.getByRole('button', { name: '展开子指南' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'ref:subguide-version-source:source-start' }),
      ]) }),
    })));
  });
});

function createApi(): EditorApi & Record<string, ReturnType<typeof vi.fn>> {
  return {
    getGuide: vi.fn().mockResolvedValue(structuredClone(emptyGuide)),
    saveGuide: vi.fn().mockResolvedValue({ ...structuredClone(emptyGuide), revision: 1 }),
    publishGuide: vi.fn().mockResolvedValue(sourceVersion),
    search: vi.fn().mockResolvedValue({ items: [{ versionId: 'version-source', guideId: 'guide-source', workspaceId: 'workspace-materials', workspaceItemId: 'item-guide-source', workspaceName: '物料管理', favorite: false, title: '物料主数据检查', summary: '', tags: ['物料'], version: 1, authorName: '王作者' }], nextOffset: null }),
    getVersion: vi.fn().mockResolvedValue(sourceVersion),
    uploadMedia: vi.fn(),
  };
}

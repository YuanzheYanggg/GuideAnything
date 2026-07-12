import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Edge, NodeChange } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasDocument, CanvasEdge, GuideVersionSnapshot } from '@guideanything/contracts';

import { GuideEditor, persistableNodeChanges, toCanvasEdge, toFlowNodes, type EditorApi } from './GuideEditor';

const { fitView, reactFlowCallbacks } = vi.hoisted(() => ({
  fitView: vi.fn(),
  reactFlowCallbacks: { onMoveEnd: undefined as undefined | ((event: unknown, viewport: { x: number; y: number; zoom: number }) => void) },
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  const React = await import('react');
  return {
    ...actual,
    ReactFlow: ({ children, nodes = [], onInit, onMoveEnd, nodesDraggable = true }: { children?: React.ReactNode; nodes?: Array<{ id: string }>; onInit?: (instance: { fitView: typeof fitView }) => void; onMoveEnd?: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void; nodesDraggable?: boolean }) => {
      reactFlowCallbacks.onMoveEnd = onMoveEnd;
      React.useEffect(() => { onInit?.({ fitView }); }, [onInit]);
      return <div className="react-flow">{nodes.map((node) => <div className={`react-flow__node${nodesDraggable ? ' draggable' : ''}`} data-id={node.id} key={node.id} />)}{children}</div>;
    },
    ViewportPortal: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Background: () => null,
    MiniMap: () => null,
    Controls: () => null,
  };
});

const emptyGuide = {
  id: 'guide-host', ownerId: 'author', authorName: '王作者', title: '订单教学', summary: '', tags: ['ERP'],
  status: 'DRAFT', revision: 0, publishedVersionId: null, publishedVersion: null, updatedAt: new Date().toISOString(),
  document: { schemaVersion: 1 as const, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [] },
};

const sourceVersion: GuideVersionSnapshot = {
  id: 'version-source', guideId: 'guide-source', version: 1, title: '物料主数据检查', summary: '', tags: ['物料'],
  document: {
    schemaVersion: 1,
    nodes: [{ id: 'source-start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '检查开始', shape: 'start' } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'source-start', exitNodeIds: ['source-start'],
  },
};

const otherSearchItem = {
  versionId: 'version-other', guideId: 'guide-other', title: '库存盘点流程', summary: '盘点前的准备工作', tags: ['库存'], version: 1, authorName: '李作者',
};

describe('GuideEditor', () => {
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
    const sourceItem = { versionId: 'version-source', guideId: 'guide-source', title: '物料主数据检查', summary: '', tags: ['物料'], version: 1, authorName: '王作者' };
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

  it('attaches new resources to the selected flow, previews hierarchy, and applies it as one undoable change', async () => {
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    fireEvent.click(screen.getByRole('button', { name: '添加阶段' }));
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    const stageId = (screen.getByRole('option', { name: '业务阶段 1' }) as HTMLOptionElement).value;
    fireEvent.change(screen.getByLabelText('所属业务阶段'), { target: { value: stageId } });
    fireEvent.click(screen.getByRole('button', { name: '添加 Markdown 节点' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: expect.arrayContaining([
        expect.objectContaining({ type: 'markdown', contentParentId: expect.any(String) }),
      ]) }),
    }));

    const savesBeforePreview = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '预览自动整理' }));
    expect(screen.getByText('已按入口从左到右整理')).toBeVisible();
    expect(api.saveGuide).toHaveBeenCalledTimes(savesBeforePreview);
    fireEvent.click(screen.getByRole('button', { name: '应用自动整理' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  });

  it('explains the hierarchy preview and focuses an offscreen node selected from the structure tree', async () => {
    const user = userEvent.setup();
    fitView.mockClear();
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'prepare', title: '准备', order: 0 }],
      nodes: [
        { id: 'start', type: 'start', stageId: 'prepare', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'offscreen', type: 'process', stageId: 'prepare', position: { x: 12_000, y: 8_000 }, zIndex: 1, data: { label: '离屏流程', shape: 'process' } },
        { id: 'attached', type: 'markdown', contentParentId: 'start', position: { x: 320, y: 0 }, zIndex: 2, data: { markdown: '已挂靠资料' } },
        { id: 'loose', type: 'markdown', position: { x: 320, y: 220 }, zIndex: 3, data: { markdown: '未挂靠资料' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    await user.click(screen.getByRole('button', { name: '预览自动整理' }));
    expect(screen.getByText('主流程 2')).toBeVisible();
    expect(screen.getByText('阶段 1')).toBeVisible();
    expect(screen.getByText('已挂靠资料 1')).toBeVisible();
    expect(screen.getByText('未挂靠资料 1')).toBeVisible();
    expect(screen.getByText('孤立节点 1')).toBeVisible();
    expect(screen.getByText('循环 0')).toBeVisible();
    expect(screen.getByText('入口 → 阶段泳道 → 资料')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '选择流程节点 离屏流程' }));
    expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ nodes: [{ id: 'offscreen' }] }));
  });

  it('persists named stages and responsibility lanes without leaking presentation data', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'entry', title: '订单录入', order: 0 }],
      nodes: [
        { id: 'start', type: 'start', stageId: 'entry', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'enter-order', type: 'process', stageId: 'entry', position: { x: 320, y: 0 }, zIndex: 1, data: { label: '录入订单', shape: 'process' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    fireEvent.change(screen.getByRole('textbox', { name: '业务阶段 订单录入' }), { target: { value: '订单处理' } });
    fireEvent.click(screen.getByRole('button', { name: '添加系统泳道' }));
    fireEvent.change(screen.getByRole('textbox', { name: '责任泳道 新系统' }), { target: { value: 'ERP' } });
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 录入订单' }));
    const erpLaneId = (screen.getByRole('option', { name: 'ERP' }) as HTMLOptionElement).value;
    fireEvent.change(screen.getByLabelText('责任泳道'), { target: { value: erpLaneId } });

    expect(screen.getByText('ERP', { selector: '.swimlane-column *' })).toBeVisible();
    expect(screen.getByText('系统', { selector: '.swimlane-column *' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({
        stages: [expect.objectContaining({ id: 'entry', title: '订单处理' })],
        lanes: [expect.objectContaining({ id: erpLaneId, title: 'ERP', kind: 'SYSTEM' })],
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'enter-order', laneId: erpLaneId, data: expect.not.objectContaining({ responsibility: expect.anything() }) })]),
      }),
    }));

    fireEvent.click(screen.getByRole('button', { name: '预览自动整理' }));
    expect(screen.getByText('泳道 1')).toBeVisible();
  });

  it('keeps preview navigation and guide metadata transient until cancellation', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'offscreen', type: 'process', position: { x: 12_000, y: 8_000 }, zIndex: 1, data: { label: '离屏流程', shape: 'process' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    await user.click(screen.getByRole('button', { name: '预览自动整理' }));
    expect(screen.getByLabelText('指南标题')).toBeDisabled();
    expect(screen.getByLabelText('摘要')).toBeDisabled();
    expect(screen.getByLabelText('标签')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '选择流程节点 离屏流程' }));
    act(() => reactFlowCallbacks.onMoveEnd?.(null, { x: 480, y: 220, zoom: 0.8 }));
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(api.saveGuide).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '取消自动整理' }));
    expect(api.saveGuide).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledTimes(1));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      title: '订单教学', summary: '', tags: ['ERP'], document: expect.objectContaining({ viewport: { x: 0, y: 0, zoom: 1 } }),
    }));
  });

  it('keeps a layout preview intact when a canvas node drag is attempted', async () => {
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 Markdown 节点' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const savesBeforePreview = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '预览自动整理' }));
    const processNode = document.querySelector<HTMLElement>('.react-flow__node[data-id^="process-"]');
    expect(processNode).toBeTruthy();
    expect(processNode).not.toHaveClass('draggable');
    fireEvent.pointerDown(processNode!, { clientX: 80, clientY: 80, pointerId: 1, button: 0 });
    fireEvent.pointerMove(document, { clientX: 220, clientY: 80, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(document, { clientX: 220, clientY: 80, pointerId: 1, button: 0 });

    expect(screen.getByText('已按入口从左到右整理')).toBeVisible();
    expect(api.saveGuide).toHaveBeenCalledTimes(savesBeforePreview);

    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    expect(screen.getByText('已按入口从左到右整理')).toBeVisible();
    expect(api.saveGuide).toHaveBeenCalledTimes(savesBeforePreview);
  });

  it('detaches attached resources when deleting their primary flow node', async () => {
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 Markdown 节点' }));
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    fireEvent.click(screen.getByRole('button', { name: '删除选中项' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());

    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: [expect.objectContaining({ type: 'markdown', contentParentId: undefined })] }),
    }));
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

function createApi(overrides: { document?: CanvasDocument } = {}): EditorApi & Record<string, ReturnType<typeof vi.fn>> {
  const guide = { ...structuredClone(emptyGuide), document: overrides.document ?? structuredClone(emptyGuide.document) };
  return {
    getGuide: vi.fn().mockResolvedValue(guide),
    saveGuide: vi.fn().mockResolvedValue({ ...guide, revision: 1 }),
    publishGuide: vi.fn().mockResolvedValue(sourceVersion),
    search: vi.fn().mockResolvedValue({ items: [{ versionId: 'version-source', guideId: 'guide-source', title: '物料主数据检查', summary: '', tags: ['物料'], version: 1, authorName: '王作者' }], nextOffset: null }),
    getVersion: vi.fn().mockResolvedValue(sourceVersion),
    uploadMedia: vi.fn(),
  };
}

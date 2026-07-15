import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Edge, NodeChange } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasDocument, CanvasEdge, GuideVersionSnapshot } from '@guideanything/contracts';

import { GuideEditor, persistableNodeChanges, toCanvasEdge, toFlowNodes, updateInlineNodeText, type EditorApi, type GuideDraftDetail } from './GuideEditor';
import { createPersonalApiMock } from '../../test/workspace-api-mocks';

const { fitView, screenToFlowPosition, reactFlowCallbacks } = vi.hoisted(() => ({
  fitView: vi.fn(),
  screenToFlowPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
  reactFlowCallbacks: {
    onNodesChange: undefined as undefined | ((changes: NodeChange[]) => void),
    onMoveEnd: undefined as undefined | ((event: unknown, viewport: { x: number; y: number; zoom: number }) => void),
    onConnectStart: undefined as undefined | ((event: unknown, connection: { nodeId: string | null; handleId: string | null; handleType: string | null }) => void),
    onConnectEnd: undefined as undefined | ((event: unknown) => void),
    onEdgeDoubleClick: undefined as undefined | ((event: unknown, edge: Edge) => void),
    edges: [] as Edge[],
    edgeTypes: undefined as unknown,
    inlineEditing: undefined as undefined | { enabled: boolean; updateText: (nodeId: string, field: 'label' | 'description' | 'markdown' | 'imageCaption' | 'videoCaption', value: string) => void },
  },
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  const React = await import('react');
  const { useInlineNodeEditing } = await import('../nodes/InlineNodeTextEditor');
  return {
    ...actual,
    ReactFlow: ({ children, nodes = [], edges = [], edgeTypes, onInit, onNodesChange, onMoveEnd, onConnectStart, onConnectEnd, onEdgeDoubleClick, nodesDraggable = true }: { children?: React.ReactNode; nodes?: Array<{ id: string; data?: { description?: string } }>; edges?: Edge[]; edgeTypes?: unknown; onInit?: (instance: { fitView: typeof fitView; screenToFlowPosition: typeof screenToFlowPosition }) => void; onNodesChange?: (changes: NodeChange[]) => void; onMoveEnd?: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void; onConnectStart?: (event: unknown, connection: { nodeId: string | null; handleId: string | null; handleType: string | null }) => void; onConnectEnd?: (event: unknown) => void; onEdgeDoubleClick?: (event: unknown, edge: Edge) => void; nodesDraggable?: boolean }) => {
      reactFlowCallbacks.inlineEditing = useInlineNodeEditing();
      reactFlowCallbacks.onNodesChange = onNodesChange;
      reactFlowCallbacks.onMoveEnd = onMoveEnd;
      reactFlowCallbacks.onConnectStart = onConnectStart;
      reactFlowCallbacks.onConnectEnd = onConnectEnd;
      reactFlowCallbacks.onEdgeDoubleClick = onEdgeDoubleClick;
      reactFlowCallbacks.edges = edges;
      reactFlowCallbacks.edgeTypes = edgeTypes;
      React.useEffect(() => { onInit?.({ fitView, screenToFlowPosition }); }, [onInit]);
      return <div className="react-flow"><div className="react-flow__pane" data-testid="flow-pane" />{nodes.map((node) => <div className={`react-flow__node${nodesDraggable ? ' draggable' : ''}`} data-id={node.id} key={node.id}>{node.data?.description ? <p className="flow-description" data-testid={`flow-description-${node.id}`}>{node.data.description}</p> : null}</div>)}{children}</div>;
    },
    ViewportPortal: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Background: () => null,
    MiniMap: () => null,
    Controls: () => null,
  };
});

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
  versionId: 'version-other', guideId: 'guide-other', workspaceId: 'workspace-stock', workspaceItemId: 'item-guide-other', workspaceName: '库存管理', favorite: false, canManageLifecycle: false, title: '库存盘点流程', summary: '盘点前的准备工作', tags: ['库存'], version: 1, authorName: '李作者',
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

  it('gives unmeasured nodes the same default size used by layout and routing', () => {
    const [imageNode, processNode] = toFlowNodes([
      { id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0, data: { url: 'https://example.com/a.png', alt: '示意图' } },
      { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
    ]);

    expect(imageNode!.style).toEqual({ width: 320, height: 260 });
    expect(processNode!.style).toEqual({ width: 240, height: 104 });
  });

  it('updates only type-compatible inline text fields without mutating the source document', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '旧标题', shape: 'process', description: '旧明细' } },
        { id: 'image', type: 'image', position: { x: 320, y: 0 }, zIndex: 1, data: { url: 'https://example.com/a.png', alt: '示意图', caption: '旧说明' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'process', exitNodeIds: ['process'],
    };

    const renamed = updateInlineNodeText(document, 'process', 'label', '新标题');
    const clearedCaption = updateInlineNodeText(renamed, 'image', 'imageCaption', '');
    const mismatch = updateInlineNodeText(clearedCaption, 'image', 'label', '不应写入');

    expect(renamed.nodes[0]).toMatchObject({ data: { label: '新标题', description: '旧明细' } });
    expect(clearedCaption.nodes[1]!.data).not.toHaveProperty('caption');
    expect(mismatch).toBe(clearedCaption);
    expect(document.nodes[0]).toMatchObject({ data: { label: '旧标题' } });
  });

  it('persists inline edits through the editor commit path and restores them with undo', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '旧标题', shape: 'process' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'process', exitNodeIds: ['process'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    expect(reactFlowCallbacks.inlineEditing?.enabled).toBe(true);
    act(() => reactFlowCallbacks.inlineEditing?.updateText('process', 'label', '节点内新标题'));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const firstSaved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(firstSaved.nodes[0]).toMatchObject({ data: { label: '节点内新标题' } });
    expect(JSON.parse(JSON.stringify(firstSaved))).toEqual(firstSaved);

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledTimes(2));
    expect((api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document.nodes[0]).toMatchObject({ data: { label: '旧标题' } });
  });

  it('keeps a resized image node size when automatic layout is previewed and saved', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'image', type: 'image', position: { x: 320, y: 0 }, zIndex: 1, size: { width: 760, height: 520 }, data: { url: 'https://example.com/a.png', alt: '示意图' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onNodesChange?.([{
      id: 'image', type: 'dimensions', resizing: false, dimensions: { width: 380, height: 260 },
    }]));
    fireEvent.click(screen.getByRole('button', { name: '预览自动整理' }));
    fireEvent.click(screen.getByRole('button', { name: '应用自动整理' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'image', size: { width: 380, height: 260 } })]),
      }),
    }));
  });

  it('does not issue a second save while automatic layout is still being saved', async () => {
    let resolveSave: ((value: GuideDraftDetail) => void) | undefined;
    const api = {
      ...createApi(),
      saveGuide: vi.fn().mockImplementation(() => new Promise<GuideDraftDetail>((resolve) => { resolveSave = resolve; })),
    };
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    fireEvent.click(screen.getByRole('button', { name: '添加开始节点' }));
    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    fireEvent.click(screen.getByRole('button', { name: '预览自动整理' }));
    fireEvent.click(screen.getByRole('button', { name: '应用自动整理' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(api.saveGuide).toHaveBeenCalledTimes(1);
    resolveSave?.({ ...emptyGuide, revision: 1 });
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeVisible());
  });

  it('requeues the latest automatic layout after an earlier save finishes', async () => {
    const pending: Array<(value: GuideDraftDetail) => void> = [];
    const api = {
      ...createApi(),
      saveGuide: vi.fn().mockImplementation(() => new Promise<GuideDraftDetail>((resolve) => { pending.push(resolve); })),
    };
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    fireEvent.click(screen.getByRole('button', { name: '添加开始节点' }));
    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '预览自动整理' }));
    fireEvent.click(screen.getByRole('button', { name: '应用自动整理' }));
    pending[0]?.({ ...emptyGuide, revision: 1 });

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledTimes(2));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 1, expect.objectContaining({
      document: expect.objectContaining({ nodes: expect.any(Array) }),
    }));
    pending[1]?.({ ...emptyGuide, revision: 2 });
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeVisible());
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
    const sourceItem = { versionId: 'version-source', guideId: 'guide-source', workspaceId: 'workspace-materials', workspaceItemId: 'item-guide-source', workspaceName: '物料管理', favorite: false, canManageLifecycle: false, title: '物料主数据检查', summary: '', tags: ['物料'], version: 1, authorName: '王作者' };
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
    expect(screen.getByText('阶段从上到下 · 阶段内从左到右')).toBeVisible();
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
    expect(screen.getByText('入口 → 阶段 → 分支与回流 → 资料')).toBeVisible();
    await waitFor(() => expect(fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: 0.16,
      minZoom: document.viewport.zoom,
      maxZoom: document.viewport.zoom,
    })));

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

    expect(screen.getByRole('textbox', { name: '责任泳道 ERP' })).toHaveValue('ERP');
    expect(screen.getByText('系统', { selector: '.lane-kind-system' })).toBeVisible();
    expect(screen.getByText('订单处理', { selector: '.stage-lane span' })).toHaveClass('stage-lane-label');
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

    expect(screen.getByText('阶段从上到下 · 阶段内从左到右')).toBeVisible();
    expect(api.saveGuide).toHaveBeenCalledTimes(savesBeforePreview);

    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    expect(screen.getByText('阶段从上到下 · 阶段内从左到右')).toBeVisible();
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

  it('creates and connects a primary flow node when a connection ends on the empty canvas', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    await act(async () => { await Promise.resolve(); });

    act(() => reactFlowCallbacks.onConnectStart?.({} as MouseEvent, { nodeId: 'start', handleId: 'out', handleType: 'source' }));
    act(() => reactFlowCallbacks.onConnectEnd?.({ target: screen.getByTestId('flow-pane'), clientX: 480, clientY: 240 } as unknown as MouseEvent));

    expect(await screen.findByRole('menu', { name: '创建下一项' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: '创建流程节点' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ type: 'process', position: { x: 480, y: 240 } })]),
        edges: expect.arrayContaining([expect.objectContaining({ source: 'start', sourceHandle: 'out', target: expect.stringMatching(/^process-/) })]),
      }),
    }));
  });

  it('creates resources as attachments without creating a real edge', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'process-a', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '操作步骤', shape: 'process' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    await act(async () => { await Promise.resolve(); });

    act(() => reactFlowCallbacks.onConnectStart?.({} as MouseEvent, { nodeId: 'process-a', handleId: 'out', handleType: 'source' }));
    act(() => reactFlowCallbacks.onConnectEnd?.({ target: screen.getByTestId('flow-pane'), clientX: 480, clientY: 240 } as unknown as MouseEvent));
    await user.click(await screen.findByRole('menuitem', { name: '创建说明资料' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document;
    const markdown = saved.nodes.find((node: CanvasDocument['nodes'][number]) => node.type === 'markdown');
    expect(markdown).toEqual(expect.objectContaining({ contentParentId: 'process-a' }));
    expect(saved.edges.some((edge: CanvasDocument['edges'][number]) => edge.target === markdown?.id)).toBe(false);
  });

  it('edits labels only for persisted host edges', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 320, y: 0 }, zIndex: 1, data: { label: '操作步骤', shape: 'process' } },
      ],
      edges: [{ id: 'flow-edge', source: 'start', sourceHandle: 'out', target: 'process-a' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeDoubleClick?.({ clientX: 480, clientY: 240 } as MouseEvent, { id: 'flow-edge', source: 'start', target: 'process-a' } as Edge));
    await user.type(await screen.findByRole('textbox', { name: '连线标注' }), '提交审核');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({ document: expect.objectContaining({ edges: [expect.objectContaining({ id: 'flow-edge', label: '提交审核' })] }) }));

    act(() => reactFlowCallbacks.onEdgeDoubleClick?.({ clientX: 480, clientY: 240 } as MouseEvent, { id: 'hierarchy:note', source: 'start', target: 'process-a' } as Edge));
    expect(screen.queryByRole('dialog', { name: '编辑连线标注' })).not.toBeInTheDocument();
  });

  it('derives orthogonal route data for real business edges', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, size: { width: 240, height: 104 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, size: { width: 240, height: 104 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'flow-edge', source: 'start', target: 'process-a', label: '继续' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-a'],
    };

    render(<GuideEditor guideId="guide-host" api={createApi({ document })} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    expect(reactFlowCallbacks.edgeTypes).toEqual(expect.objectContaining({ orthogonal: expect.anything() }));
    expect(reactFlowCallbacks.edges).toContainEqual(expect.objectContaining({
      id: 'flow-edge', sourceHandle: 'out', targetHandle: 'in', type: 'orthogonal', label: '继续', data: expect.objectContaining({ route: expect.objectContaining({ kind: 'FORWARD' }) }),
    }));
  });

  it('opens the image annotation editor and records annotation edits in undo history', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0, data: { url: 'https://example.com/erp.png', alt: 'ERP 页面' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    await user.click(screen.getByRole('button', { name: '选择资料 ERP 页面' }));
    await user.click(screen.getByRole('button', { name: '编辑图片标注' }));
    const surface = screen.getByTestId('annotation-surface');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) });
    fireEvent.click(surface, { clientX: 200, clientY: 100 });
    await user.click(screen.getByRole('button', { name: '关闭图片标注编辑器' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: [expect.objectContaining({ data: expect.objectContaining({ annotations: [expect.objectContaining({ title: '新标注' })] }) })] }),
    }));

    await user.click(screen.getByRole('button', { name: '撤销' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 1, expect.objectContaining({
      document: expect.objectContaining({ nodes: [expect.objectContaining({ data: expect.not.objectContaining({ annotations: expect.anything() }) })] }),
    }));
  });

  it('persists a flow-node detail and renders the short canvas description', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'process-a', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '操作步骤', shape: 'process' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    await user.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    await user.type(screen.getByRole('textbox', { name: '节点明细' }), '填写售达方、物料和交货日期。');
    expect(await screen.findByTestId('flow-description-process-a')).toHaveClass('flow-description');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({ document: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'process-a', data: expect.objectContaining({ description: '填写售达方、物料和交货日期。' }) })] }) }));
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
    search: vi.fn().mockResolvedValue({ items: [{ versionId: 'version-source', guideId: 'guide-source', workspaceId: 'workspace-materials', workspaceItemId: 'item-guide-source', workspaceName: '物料管理', favorite: false, canManageLifecycle: false, title: '物料主数据检查', summary: '', tags: ['物料'], version: 1, authorName: '王作者' }], nextOffset: null }),
    getVersion: vi.fn().mockResolvedValue(sourceVersion),
    uploadMedia: vi.fn(),
  };
}

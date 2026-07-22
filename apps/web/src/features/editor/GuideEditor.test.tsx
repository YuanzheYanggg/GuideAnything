import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Connection, Edge, Node, NodeChange } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CanvasDocument, CanvasEdge, CanvasNode, GuideVersionSnapshot } from '@guideanything/contracts';

import * as GuideEditorModule from './GuideEditor';
import { GuideEditor, hierarchyPresentationEdges, persistableNodeChanges, removeHierarchyItem, removeNodesFromDocument, resourceAppendixAnchorNodes, resourceAppendixGroups, setResourceVisibilityInDocument, toggleResourceVisibilityInDocument, toCanvasEdge, toFlowNodes, updateInlineNodeText, type EditorApi, type GuideDraftDetail } from './GuideEditor';
import { routeCanvasEdges } from '@guideanything/canvas-core';
import type { GuideDigestProposal, GuideFlowSnapshotStatus } from './GuideDigestDialog';
import { createPersonalApiMock } from '../../test/workspace-api-mocks';

const { fitView, screenToFlowPosition, reactFlowCallbacks } = vi.hoisted(() => ({
  fitView: vi.fn(),
  screenToFlowPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
  reactFlowCallbacks: {
    onNodesChange: undefined as undefined | ((changes: NodeChange[]) => void),
    onMove: undefined as undefined | ((event: unknown, viewport: { x: number; y: number; zoom: number }) => void),
    onMoveEnd: undefined as undefined | ((event: unknown, viewport: { x: number; y: number; zoom: number }) => void),
    onConnect: undefined as undefined | ((connection: Connection) => void),
    onConnectStart: undefined as undefined | ((event: unknown, connection: { nodeId: string | null; handleId: string | null; handleType: string | null }) => void),
    onConnectEnd: undefined as undefined | ((event: unknown, connectionState?: unknown) => void),
    onNodeDoubleClick: undefined as undefined | ((event: { target: EventTarget | null; currentTarget: EventTarget | null }, node: { id: string }) => void),
    onSelectionChange: undefined as undefined | ((selection: { nodes: Array<{ id: string }> }) => void),
    onEdgeClick: undefined as undefined | ((event: unknown, edge: Edge) => void),
    onEdgeDoubleClick: undefined as undefined | ((event: unknown, edge: Edge) => void),
    onReconnect: undefined as undefined | ((oldEdge: Edge, connection: { source: string | null; sourceHandle?: string | null; target: string | null; targetHandle?: string | null }) => void),
    onReconnectStart: undefined as undefined | ((event: unknown, edge: Edge, handleType: 'source' | 'target') => void),
    onReconnectEnd: undefined as undefined | ((event: unknown, edge: Edge, handleType: 'source' | 'target', connectionState: { toNode?: { id: string } | null }) => void),
    onPointerDownCapture: undefined as undefined | ((event: ReactPointerEvent<HTMLDivElement>) => void),
    onPointerMoveCapture: undefined as undefined | ((event: ReactPointerEvent<HTMLDivElement>) => void),
    onPointerUpCapture: undefined as undefined | ((event: ReactPointerEvent<HTMLDivElement>) => void),
    edges: [] as Edge[],
    edgesReconnectable: undefined as boolean | undefined,
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
    ReactFlow: ({ children, nodes = [], edges = [], edgeTypes, onInit, onNodesChange, onMove, onMoveEnd, onConnect, onConnectStart, onConnectEnd, onNodeDoubleClick, onSelectionChange, onEdgeClick, onEdgeDoubleClick, onReconnect, onReconnectStart, onReconnectEnd, onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture, nodesDraggable = true, edgesReconnectable }: { children?: React.ReactNode; nodes?: Array<{ id: string; data?: { description?: string } }>; edges?: Edge[]; edgeTypes?: unknown; onInit?: (instance: { fitView: typeof fitView; screenToFlowPosition: typeof screenToFlowPosition }) => void; onNodesChange?: (changes: NodeChange[]) => void; onMove?: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void; onMoveEnd?: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void; onConnect?: (connection: Connection) => void; onConnectStart?: (event: unknown, connection: { nodeId: string | null; handleId: string | null; handleType: string | null }) => void; onConnectEnd?: (event: unknown, connectionState?: unknown) => void; onNodeDoubleClick?: (event: { target: EventTarget | null; currentTarget: EventTarget | null }, node: { id: string }) => void; onSelectionChange?: (selection: { nodes: Array<{ id: string }> }) => void; onEdgeClick?: (event: unknown, edge: Edge) => void; onEdgeDoubleClick?: (event: unknown, edge: Edge) => void; onReconnect?: (oldEdge: Edge, connection: { source: string | null; sourceHandle?: string | null; target: string | null; targetHandle?: string | null }) => void; onReconnectStart?: (event: unknown, edge: Edge, handleType: 'source' | 'target') => void; onReconnectEnd?: (event: unknown, edge: Edge, handleType: 'source' | 'target', connectionState: { toNode?: { id: string } | null }) => void; onPointerDownCapture?: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerMoveCapture?: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerUpCapture?: (event: ReactPointerEvent<HTMLDivElement>) => void; nodesDraggable?: boolean; edgesReconnectable?: boolean }) => {
      reactFlowCallbacks.inlineEditing = useInlineNodeEditing();
      reactFlowCallbacks.onNodesChange = onNodesChange;
      reactFlowCallbacks.onMove = onMove;
      reactFlowCallbacks.onMoveEnd = onMoveEnd;
      reactFlowCallbacks.onConnect = onConnect;
      reactFlowCallbacks.onConnectStart = onConnectStart;
      reactFlowCallbacks.onConnectEnd = onConnectEnd;
      reactFlowCallbacks.onNodeDoubleClick = onNodeDoubleClick;
      reactFlowCallbacks.onSelectionChange = onSelectionChange;
      reactFlowCallbacks.onEdgeClick = onEdgeClick;
      reactFlowCallbacks.onEdgeDoubleClick = onEdgeDoubleClick;
      reactFlowCallbacks.onReconnect = onReconnect;
      reactFlowCallbacks.onReconnectStart = onReconnectStart;
      reactFlowCallbacks.onReconnectEnd = onReconnectEnd;
      reactFlowCallbacks.onPointerDownCapture = onPointerDownCapture;
      reactFlowCallbacks.onPointerMoveCapture = onPointerMoveCapture;
      reactFlowCallbacks.onPointerUpCapture = onPointerUpCapture;
      reactFlowCallbacks.edges = edges;
      reactFlowCallbacks.edgesReconnectable = edgesReconnectable;
      reactFlowCallbacks.edgeTypes = edgeTypes;
      React.useEffect(() => { onInit?.({ fitView, screenToFlowPosition }); }, [onInit]);
      return <div className="react-flow" onPointerDownCapture={onPointerDownCapture} onPointerMoveCapture={onPointerMoveCapture} onPointerUpCapture={onPointerUpCapture}><div className="react-flow__pane" data-testid="flow-pane" />{nodes.map((node) => <div className={`react-flow__node${nodesDraggable ? ' draggable' : ''}`} data-id={node.id} key={node.id}>{node.data?.description ? <p className="flow-description" data-testid={`flow-description-${node.id}`}>{node.data.description}</p> : null}</div>)}{children}</div>;
    },
    ViewportPortal: ({ children }: { children?: React.ReactNode }) => <div data-testid="viewport-portal">{children}</div>,
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

type TestRouteData = {
  route?: {
    routing?: string;
    points?: Array<{ x: number; y: number }>;
  };
};

function testRouteData(edge: Edge | undefined): TestRouteData | undefined {
  return edge?.data as TestRouteData | undefined;
}

function openHierarchyPanel() {
  const trigger = screen.queryByRole('button', { name: '展开业务流程' });
  if (trigger) fireEvent.click(trigger);
}

function openStageManager() {
  openHierarchyPanel();
  fireEvent.click(screen.getByRole('button', { name: '管理业务阶段' }));
}

function openLaneManager() {
  openHierarchyPanel();
  fireEvent.click(screen.getByRole('button', { name: '管理责任泳道' }));
}

async function openSummaryEditor() {
  const editor = screen.queryByLabelText('摘要');
  if (editor) return editor;
  const summaryDialog = screen.queryByRole('dialog', { name: '指南摘要', hidden: true });
  if (!summaryDialog) {
    const viewButton = await screen.findByRole('button', { name: '查看摘要', hidden: true });
    fireEvent.click(viewButton);
  }
  const editButton = within(await screen.findByRole('dialog', { name: '指南摘要', hidden: true })).getByRole('button', { name: '编辑摘要', hidden: true });
  fireEvent.click(editButton);
  return screen.findByLabelText('摘要');
}

async function openTagsEditor() {
  const editor = screen.queryByLabelText('标签');
  if (editor) return editor;
  const editButton = await screen.findByRole('button', { name: '编辑标签', hidden: true });
  fireEvent.click(editButton);
  return screen.findByLabelText('标签');
}

describe('GuideEditor', () => {
  it('places guide-wide details in the header instead of the node inspector', async () => {
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);

    const guideDetails = await screen.findByRole('region', { name: '指南信息' });
    expect(guideDetails.closest('.editor-header')).not.toBeNull();
    expect(within(guideDetails).getByRole('button', { name: '查看摘要' })).toBeVisible();
    expect(within(guideDetails).getByText('ERP')).toBeVisible();
    expect(within(guideDetails).getByRole('button', { name: '生成指南总览' })).toBeVisible();
    fireEvent.click(within(guideDetails).getByRole('button', { name: '查看摘要' }));
    const summaryDialog = screen.getByRole('dialog', { name: '指南摘要' });
    expect(summaryDialog.closest('.editor-header')).toBeNull();
    expect(summaryDialog).toBeVisible();
    fireEvent.click(within(summaryDialog).getByRole('button', { name: '编辑摘要' }));
    expect(within(summaryDialog).getByLabelText('摘要')).toHaveValue('');
    expect(screen.getByLabelText('摘要').closest('.inspector')).toBeNull();
    fireEvent.click(within(summaryDialog).getByRole('button', { name: '关闭摘要' }));
    fireEvent.click(within(guideDetails).getByRole('button', { name: '编辑标签' }));
    expect(within(guideDetails).getByLabelText('标签')).toHaveValue('ERP');
    expect(screen.getByRole('group', { name: '状态与诊断' })).toBeVisible();
    expect(within(screen.getByRole('group', { name: '外观' })).getAllByRole('button', { name: /当前为|切换到/ })).toHaveLength(3);
    expect(screen.getByRole('group', { name: '版本操作' })).toContainElement(screen.getByRole('button', { name: '草稿历史' }));
    expect(screen.getByRole('group', { name: '版本操作' })).toContainElement(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByRole('group', { name: '主操作' })).toContainElement(screen.getByRole('button', { name: '发布指南' }));
  });

  it('keeps compact regression controls in the editor header instead of a standalone QA page', async () => {
    const user = userEvent.setup();
    const api = createApi({ document: imageDocumentWithAnnotation() });
    (api.listFlowRegressionCases as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'case-image',
      guideId: 'guide-host',
      resourceNodeId: 'image',
      annotationId: 'annotation-1',
      question: '客户字段需要如何填写？',
      expectedAgentStatus: 'SUPPORTED',
      status: 'ACTIVE',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      lastVerifiedSnapshotId: 'snapshot-0',
      lastRetrievalVerification: 'PASS',
      lastAgentVerification: null,
    }]);
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);

    const summary = await screen.findByText('回归题（1）');
    expect(summary.closest('.editor-header')).not.toBeNull();
    await user.click(summary);
    expect(await screen.findByText('客户字段')).toBeVisible();
    expect(screen.getByRole('button', { name: '确定性复跑' })).toBeVisible();
  });

  it('groups one-owner resources into a single appendix frame', () => {
    const groups = resourceAppendixGroups({
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
        { id: 'one', type: 'markdown', position: { x: 320, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'step', order: 1 }, data: { markdown: '资料一' } },
        { id: 'two', type: 'image', position: { x: 320, y: 210 }, zIndex: 2, attachment: { ownerNodeId: 'step', order: 0 }, data: { url: 'https://example.com/a.png', alt: '资料二' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    });

    expect(groups).toEqual([expect.objectContaining({ ownerId: 'step', ownerTitle: '处理', resourceIds: ['two', 'one'], allHidden: false })]);
  });

  it('derives an all-hidden state for an appendix group and restores every resource together', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
        { id: 'one', type: 'markdown', position: { x: 320, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'step', order: 1 }, data: { markdown: '资料一' } },
        { id: 'two', type: 'image', position: { x: 320, y: 210 }, zIndex: 2, attachment: { ownerNodeId: 'step', order: 0 }, data: { url: 'https://example.com/a.png', alt: '资料二' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };

    const hidden = setResourceVisibilityInDocument(document, ['one', 'two'], true);
    expect(resourceAppendixGroups(hidden)).toEqual([expect.objectContaining({ ownerId: 'step', ownerTitle: '处理', resourceIds: ['two', 'one'], allHidden: true, height: 58 })]);
    expect(hidden.nodes.filter((node) => node.type === 'markdown' || node.type === 'image')).toEqual([
      expect.objectContaining({ id: 'one', visibility: 'HIDDEN' }),
      expect.objectContaining({ id: 'two', visibility: 'HIDDEN' }),
    ]);

    const restored = setResourceVisibilityInDocument(hidden, ['one', 'two'], false);
    expect(resourceAppendixGroups(restored)).toEqual([expect.objectContaining({ ownerId: 'step', resourceIds: ['two', 'one'], allHidden: false })]);
    expect(restored.nodes.filter((node) => node.type === 'markdown' || node.type === 'image').every((node) => node.visibility === undefined)).toBe(true);
  });

  it('collapses an all-hidden appendix to its owner title and restores it on click', async () => {
    const user = userEvent.setup();
    const api = createApi({
      document: {
        schemaVersion: 1,
        nodes: [
          { id: 'step', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
          { id: 'one', type: 'markdown', position: { x: 320, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'step', order: 1 }, data: { markdown: '资料一' } },
          { id: 'two', type: 'image', position: { x: 320, y: 210 }, zIndex: 2, attachment: { ownerNodeId: 'step', order: 0 }, data: { url: 'https://example.com/a.png', alt: '资料二' } },
        ],
        edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
      },
    });
    const { container } = render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);

    await waitFor(() => expect(container.querySelector('.resource-appendix')).not.toBeNull());
    const appendix = container.querySelector<HTMLElement>('.resource-appendix')!;
    expect(appendix.textContent).toContain('资料附录 · 2');
    const hideAll = within(appendix).getByRole('button', { name: '隐藏全部资料' });
    await user.click(hideAll);
    expect(within(appendix).getByRole('button', { name: '展开处理节点资料' })).toBeVisible();
    expect(appendix.textContent).toContain('处理 · 节点资料 ×2');
    expect(within(appendix).queryByRole('button', { name: '显示全部资料' })).toBeNull();
    expect(screen.queryByText('已全部隐藏')).toBeNull();

    await user.click(within(appendix).getByRole('button', { name: '展开处理节点资料' }));
    expect(within(appendix).getByRole('button', { name: '隐藏全部资料' })).toBeVisible();
    expect(within(appendix).queryByRole('button', { name: '展开处理节点资料' })).toBeNull();
    expect(screen.queryByText('已全部隐藏')).toBeNull();
  });

  it('marks hierarchy presentation edges as non-interactive decorations', () => {
    const [edge] = hierarchyPresentationEdges({
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
        { id: 'resource', type: 'markdown', position: { x: 320, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'step', order: 0 }, data: { markdown: '资料' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    });

    expect(edge).toMatchObject({
      id: 'hierarchy:step',
      selectable: false,
      reconnectable: false,
      className: 'hierarchy-presentation-edge',
    });
  });

  it('connects resource presentation edges with a straight line using the nearest current boundaries', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 900, y: 0 }, zIndex: 0, data: { label: '确认原料', shape: 'process' } },
        { id: 'resource', type: 'markdown', position: { x: 320, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'step', order: 0 }, data: { markdown: '资料' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };

    expect(hierarchyPresentationEdges(document)[0]).toMatchObject({
      type: 'straight',
      sourceHandle: 'anchor-source-LEFT',
      targetHandle: 'anchor-target-RIGHT',
    });

    const hidden = setResourceVisibilityInDocument(document, ['resource'], true);
    expect(hierarchyPresentationEdges(hidden)[0]).toMatchObject({
      type: 'straight',
      sourceHandle: 'anchor-source-LEFT',
      targetHandle: 'appendix-in-right',
    });
  });

  it('routes a fully hidden appendix edge to the collapsed title boundary', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 900, y: 0 }, zIndex: 0, data: { label: '确认原料', shape: 'process' } },
        { id: 'one', type: 'markdown', visibility: 'HIDDEN', position: { x: 320, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'step', order: 1 }, data: { markdown: '资料一' } },
        { id: 'two', type: 'image', visibility: 'HIDDEN', position: { x: 320, y: 210 }, zIndex: 2, attachment: { ownerNodeId: 'step', order: 0 }, data: { url: 'https://example.com/a.png', alt: '资料二' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };

    const [edge] = hierarchyPresentationEdges(document);
    const anchors = resourceAppendixAnchorNodes(document);

    expect(edge).toMatchObject({
      source: 'step',
      target: 'resource-appendix-anchor:step',
      sourceHandle: 'anchor-source-LEFT',
      targetHandle: 'appendix-in-right',
      type: 'straight',
    });
    expect(anchors[0]).toMatchObject({
      id: 'resource-appendix-anchor:step',
      type: 'resource-appendix-anchor',
      position: { x: 302, y: -30 },
      width: 220,
      height: 58,
      handles: expect.arrayContaining([
        expect.objectContaining({ id: 'appendix-in-right', type: 'target', position: 'right', x: 219, y: 28.5, width: 1, height: 1 }),
      ]),
      style: expect.objectContaining({ width: 220, height: 58 }),
      data: { targetSide: 'RIGHT' },
    });

    const restored = setResourceVisibilityInDocument(document, ['one', 'two'], false);
    expect(hierarchyPresentationEdges(restored)[0]).toMatchObject({ target: 'two', targetHandle: 'anchor-target-RIGHT', type: 'straight' });
    expect(resourceAppendixAnchorNodes(restored)).toEqual([]);
  });

  it('sizes an appendix frame around a resource’s persisted dimensions', () => {
    const groups = resourceAppendixGroups({
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
        { id: 'wide', type: 'image', position: { x: 320, y: 0 }, zIndex: 1, size: { width: 640, height: 420 }, attachment: { ownerNodeId: 'step', order: 0 }, data: { url: 'https://example.com/a.png', alt: '宽图片' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    });

    expect(groups[0]).toMatchObject({ width: 676, height: 468 });
  });

  it('does not retry an in-flight real save after a programmatic move and generates from its revision', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['start'],
    };
    const api = createApi({ document });
    let resolveSave: ((guide: GuideDraftDetail) => void) | undefined;
    (api.saveGuide as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<GuideDraftDetail>((resolve) => { resolveSave = resolve; }));
    (api.getFlowSnapshotStatus as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotStatus(1));
    (api.createGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue(digestProposal());
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    const summary = await openSummaryEditor();

    fireEvent.change(summary, { target: { value: '已保存的真实编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledWith('guide-host', 0, expect.objectContaining({ summary: '已保存的真实编辑' })));
    act(() => reactFlowCallbacks.onMoveEnd?.(null, { x: -184, y: 36, zoom: 0.72 }));
    resolveSave?.({ ...emptyGuide, revision: 1, summary: '已保存的真实编辑', document });

    await waitFor(() => expect(screen.getByText(/已保存/)).toBeVisible());
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(api.saveGuide).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));
    await waitFor(() => expect(api.createGuideDigestProposal).toHaveBeenCalledWith('guide-host', { regenerate: false }));
    expect(api.saveGuide).toHaveBeenCalledTimes(1);

    act(() => reactFlowCallbacks.onMoveEnd?.({} as MouseEvent, { x: -220, y: 48, zoom: 0.68 }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿', hidden: true }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledWith('guide-host', 1, expect.objectContaining({
      document: expect.objectContaining({ viewport: { x: -220, y: 48, zoom: 0.68 } }),
    })));
  });

  it('does not save after a programmatic React Flow move before generating from the loaded revision', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['start'],
    };
    const api = createApi({ document });
    (api.createGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue(digestProposal());
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await openSummaryEditor();

    act(() => reactFlowCallbacks.onMoveEnd?.(null, { x: -184, y: 36, zoom: 0.72 }));
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));

    await waitFor(() => expect(api.createGuideDigestProposal).toHaveBeenCalledWith('guide-host', { regenerate: false }));
    expect(api.saveGuide).not.toHaveBeenCalled();
    expect(api.getFlowSnapshotStatus).toHaveBeenLastCalledWith('guide-host');
  });

  it('still saves a real editor change after a programmatic React Flow move', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['start'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    const summary = await openSummaryEditor();

    act(() => reactFlowCallbacks.onMoveEnd?.(null, { x: -184, y: 36, zoom: 0.72 }));
    fireEvent.change(summary, { target: { value: '真实编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledWith('guide-host', 0, expect.objectContaining({ summary: '真实编辑' })));
  });

  it('saves pending guide fields before explicitly generating a digest and uses the saved revision', async () => {
    const api = createApi();
    (api.saveGuide as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...emptyGuide, revision: 7, summary: '待保存摘要', document: emptyGuide.document });
    (api.getFlowSnapshotStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ guideRevision: 0, sourceStatus: 'READY', snapshotId: 'snapshot-0', snapshotRevision: 0, snapshotSchemaVersion: 2, failureCode: null })
      .mockResolvedValueOnce({ guideRevision: 7, sourceStatus: 'READY', snapshotId: 'snapshot-7', snapshotRevision: 7, snapshotSchemaVersion: 2, failureCode: null });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    const summary = await openSummaryEditor();
    fireEvent.change(summary, { target: { value: '待保存摘要' } });
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    expect(api.createGuideDigestProposal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledWith('guide-host', 0, expect.objectContaining({ summary: '待保存摘要' })));
    await waitFor(() => expect(api.createGuideDigestProposal).toHaveBeenCalledWith('guide-host', { regenerate: false }));
    expect(api.getFlowSnapshotStatus).toHaveBeenCalledTimes(2);
  });

  it('drains an in-flight save plus a later edit before generating from the final revision', async () => {
    const api = createApi();
    let resolveFirstSave: ((guide: GuideDraftDetail) => void) | undefined;
    (api.saveGuide as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => new Promise<GuideDraftDetail>((resolve) => { resolveFirstSave = resolve; }))
      .mockResolvedValueOnce({ ...emptyGuide, revision: 2, summary: '第二次编辑', document: emptyGuide.document });
    (api.getFlowSnapshotStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(snapshotStatus(0))
      .mockResolvedValueOnce(snapshotStatus(2));
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    const summary = await openSummaryEditor();
    fireEvent.change(summary, { target: { value: '第一次编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledTimes(1));
    fireEvent.change(summary, { target: { value: '第二次编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));
    resolveFirstSave?.({ ...emptyGuide, revision: 1, summary: '第一次编辑', document: emptyGuide.document });

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledWith('guide-host', 1, expect.objectContaining({ summary: '第二次编辑' })));
    await waitFor(() => expect(api.createGuideDigestProposal).toHaveBeenCalledWith('guide-host', { regenerate: false }));
  });

  it('does not generate when the pending save fails', async () => {
    const api = createApi();
    (api.saveGuide as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('保存被拒绝'));
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    fireEvent.change(await openSummaryEditor(), { target: { value: '未保存摘要' } });
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));

    await waitFor(() => expect(screen.getAllByText('保存被拒绝')).toHaveLength(2));
    expect(api.createGuideDigestProposal).not.toHaveBeenCalled();
  });

  it('blocks apply while dirty in-flight edits advance the proposal base revision without losing the local edit', async () => {
    const api = createApi();
    let resolveSave: ((guide: GuideDraftDetail) => void) | undefined;
    (api.createGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue(digestProposal());
    (api.saveGuide as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<GuideDraftDetail>((resolve) => { resolveSave = resolve; }));
    (api.getFlowSnapshotStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(snapshotStatus(0))
      .mockResolvedValueOnce(snapshotStatus(0))
      .mockResolvedValueOnce(snapshotStatus(1));
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await openSummaryEditor();
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));
    await screen.findByText('建议的流程摘要');
    fireEvent.change(await openSummaryEditor(), { target: { value: '本地改动' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿', hidden: true }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('采用建议摘要'));
    fireEvent.click(screen.getByRole('button', { name: '接受并应用到草稿' }));
    resolveSave?.({ ...emptyGuide, revision: 1, summary: '本地改动', document: emptyGuide.document });

    await screen.findByText('提案基于旧 revision，无法应用。请重新生成。');
    expect(api.applyGuideDigestProposal).not.toHaveBeenCalled();
    expect(await openSummaryEditor()).toHaveValue('本地改动');
  });

  it('three-way merges tags and preserves an explicitly reported summary conflict while apply is in flight', async () => {
    const api = createApi();
    let resolveApply: ((result: { guide: GuideDraftDetail; proposal: GuideDigestProposal }) => void) | undefined;
    (api.createGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue(digestProposal());
    (api.applyGuideDigestProposal as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => { resolveApply = resolve; }));
    (api.getFlowSnapshotStatus as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotStatus(0));
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await openSummaryEditor();
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));
    await screen.findByText('建议的流程摘要');
    fireEvent.click(screen.getByLabelText('采用建议摘要'));
    fireEvent.click(screen.getByRole('button', { name: '接受并应用到草稿' }));
    await waitFor(() => expect(api.applyGuideDigestProposal).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('指南标题'), { target: { value: '本地编辑的标题' } });
    fireEvent.change(await openSummaryEditor(), { target: { value: '应用期间的本地摘要' } });
    fireEvent.change(await openTagsEditor(), { target: { value: ' erp ，本地新增' } });
    resolveApply?.({
      guide: { ...emptyGuide, revision: 1, summary: '服务端已应用的摘要', tags: ['ERP', '服务端标签', ' erp '] },
      proposal: { ...digestProposal(), status: 'APPLIED', appliedRevision: 1 },
    });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '生成指南总览' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('指南标题')).toHaveValue('本地编辑的标题');
    expect(await openSummaryEditor()).toHaveValue('应用期间的本地摘要');
    expect(await openTagsEditor()).toHaveValue('ERP，服务端标签，本地新增');
    expect(screen.getByRole('alert')).toHaveTextContent('摘要应用期间检测到本地修改');
    await waitFor(() => expect(screen.getByRole('button', { name: '生成指南总览' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 1, expect.objectContaining({
      title: '本地编辑的标题', summary: '应用期间的本地摘要', tags: ['ERP', '服务端标签', '本地新增'],
    })));
  });

  it('restores focus after a successful digest rejection removes the inert editor state', async () => {
    const user = userEvent.setup();
    const api = createApi();
    (api.createGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue(digestProposal());
    (api.rejectGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue({ ...digestProposal(), status: 'REJECTED' });
    (api.getFlowSnapshotStatus as ReturnType<typeof vi.fn>).mockResolvedValue(snapshotStatus(0));
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    const opener = await screen.findByRole('button', { name: '生成指南总览' });
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: '生成结构化摘要' }));
    await screen.findByText('建议的流程摘要');

    await user.click(screen.getByRole('button', { name: '拒绝提案' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '生成指南总览' })).not.toBeInTheDocument());
    expect(document.querySelector('.editor-page-content')).not.toHaveAttribute('inert');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it.each([
    ['关闭按钮', 'button'],
    ['Escape', 'escape'],
  ] as const)('restores focus after %s removes the inert editor state', async (_label, closePath) => {
    const user = userEvent.setup();
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    const opener = await screen.findByRole('button', { name: '生成指南总览' });
    await user.click(opener);
    await screen.findByRole('dialog', { name: '生成指南总览' });

    if (closePath === 'button') await user.click(screen.getByRole('button', { name: '关闭指南总览' }));
    else await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '生成指南总览' })).not.toBeInTheDocument());
    expect(document.querySelector('.editor-page-content')).not.toHaveAttribute('inert');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('suspends editor shortcuts while the digest review modal is open', async () => {
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await openSummaryEditor();
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('dialog', { name: '生成指南总览' });

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(api.saveGuide).not.toHaveBeenCalled();
  });

  it('refreshes a 409 apply conflict into stale review without hiding the original error', async () => {
    const api = createApi();
    const draft = digestProposal();
    (api.createGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue(draft);
    (api.applyGuideDigestProposal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('草稿已被其他编辑更新'));
    (api.getGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue({ ...draft, status: 'STALE' });
    (api.getFlowSnapshotStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(snapshotStatus(0))
      .mockResolvedValueOnce(snapshotStatus(0))
      .mockResolvedValueOnce(snapshotStatus(0))
      .mockResolvedValueOnce(snapshotStatus(1));
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await openSummaryEditor();
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));
    await screen.findByText('建议的流程摘要');
    fireEvent.click(screen.getByLabelText('采用建议摘要'));
    fireEvent.click(screen.getByRole('button', { name: '接受并应用到草稿' }));

    await screen.findByText('草稿已被其他编辑更新');
    await screen.findByText('提案基于旧 revision，无法应用。请重新生成。');
    expect(api.getGuideDigestProposal).toHaveBeenCalledWith('guide-host', 'proposal-1');
  });

  it('stales instead of applying when edits arrive after drain while the final snapshot check is pending', async () => {
    const api = createApi();
    const draft = digestProposal();
    let resolveStatus: ((status: GuideFlowSnapshotStatus) => void) | undefined;
    (api.createGuideDigestProposal as ReturnType<typeof vi.fn>).mockResolvedValue(draft);
    (api.getFlowSnapshotStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(snapshotStatus(0))
      .mockResolvedValueOnce(snapshotStatus(0))
      .mockImplementationOnce(() => new Promise<GuideFlowSnapshotStatus>((resolve) => { resolveStatus = resolve; }));
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await openSummaryEditor();
    fireEvent.click(screen.getByRole('button', { name: '生成指南总览' }));
    await screen.findByRole('button', { name: '生成结构化摘要' });
    fireEvent.click(screen.getByRole('button', { name: '生成结构化摘要' }));
    await screen.findByText('建议的流程摘要');
    fireEvent.click(screen.getByLabelText('采用建议摘要'));
    fireEvent.click(screen.getByRole('button', { name: '接受并应用到草稿' }));
    await waitFor(() => expect(api.getFlowSnapshotStatus).toHaveBeenCalledTimes(3));
    fireEvent.change(await openSummaryEditor(), { target: { value: '等待期间的新摘要' } });
    fireEvent.change(screen.getByLabelText('指南标题'), { target: { value: '等待期间的新标题' } });
    fireEvent.click(screen.getByRole('button', { name: '添加流程节点', hidden: true }));
    resolveStatus?.(snapshotStatus(0));

    await screen.findByText('提案基于旧 revision，无法应用。请重新生成。');
    expect(api.applyGuideDigestProposal).not.toHaveBeenCalled();
    expect(api.saveGuide).not.toHaveBeenCalled();
    expect(await openSummaryEditor()).toHaveValue('等待期间的新摘要');
    expect(screen.getByLabelText('指南标题')).toHaveValue('等待期间的新标题');
    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(1);
  });

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

  it('removes a node while cleaning edges, steps, exits, and attached content references', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
        { id: 'markdown', type: 'markdown', contentParentId: 'process', position: { x: 320, y: 0 }, zIndex: 1, data: { markdown: '说明' } },
      ],
      edges: [{ id: 'edge', source: 'process', target: 'process' }],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [{ id: 'step', order: 0, title: '处理', nodeId: 'process' }],
      entryNodeId: 'process',
      exitNodeIds: ['process'],
    };

    const next = removeNodesFromDocument(document, ['process']);

    expect(next.nodes).toEqual([expect.objectContaining({ id: 'markdown', contentParentId: undefined })]);
    expect(next.edges).toEqual([]);
    expect(next.steps).toEqual([]);
    expect(next.entryNodeId).toBeUndefined();
    expect(next.exitNodeIds).toEqual([]);
  });

  it('removes an expanded subguide together with its derived snapshot artifacts', () => {
    const sourceTrace = {
      referenceNodeId: 'reference',
      sourceGuideId: 'source-guide',
      sourceVersionId: 'source-version',
      sourceElementId: 'source-step',
    };
    const derivedId = 'ref:reference:source-step';
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'reference', type: 'subguide', position: { x: 0, y: 0 }, zIndex: 0,
          data: { guideId: 'source-guide', guideVersionId: 'source-version', title: '子指南', version: 1, expanded: true },
        },
        { id: derivedId, type: 'process', position: { x: 320, y: 0 }, zIndex: 1, source: sourceTrace, data: { label: '派生步骤', shape: 'process' } },
        { id: 'host-out', type: 'end', position: { x: 640, y: 0 }, zIndex: 2, data: { label: '宿主结束', shape: 'end' } },
      ],
      edges: [
        { id: 'derived-entry', source: 'reference', target: derivedId, sourceTrace },
        { id: 'derived-bridge', source: derivedId, target: 'host-out', sourceTrace },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [{ id: 'derived-step', order: 0, title: '派生步骤', nodeId: derivedId, source: sourceTrace }],
      entryNodeId: 'reference',
      exitNodeIds: ['reference'],
    };

    const next = removeNodesFromDocument(document, ['reference']);

    expect(next.nodes).toEqual([expect.objectContaining({ id: 'host-out' })]);
    expect(next.edges).toEqual([]);
    expect(next.steps).toEqual([]);
    expect(next.entryNodeId).toBeUndefined();
    expect(next.exitNodeIds).toEqual([]);
  });

  it('toggles only a source-free resource visibility and preserves the resource on restore', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '流程', shape: 'process' } },
        { id: 'note', type: 'markdown', position: { x: 200, y: 0 }, zIndex: 1, data: { markdown: '说明' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const hidden = toggleResourceVisibilityInDocument(document, 'note');
    const restored = toggleResourceVisibilityInDocument(hidden, 'note');

    expect(hidden.nodes.find((node) => node.id === 'note')).toMatchObject({ visibility: 'HIDDEN' });
    expect(restored.nodes.find((node) => node.id === 'note')).not.toHaveProperty('visibility');
    expect(restored.nodes.find((node) => node.id === 'note')?.data).toEqual({ markdown: '说明' });
  });

  it('removes a hierarchy item while preserving nodes, edges, and lesson steps', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'prepare', title: '准备', order: 0 }, { id: 'review', title: '复核', order: 1 }],
      lanes: [{ id: 'sales', title: '销售', kind: 'ROLE', order: 0 }, { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 }],
      nodes: [
        { id: 'process-a', type: 'process', stageId: 'prepare', laneId: 'sales', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '创建订单', shape: 'process' } },
        { id: 'process-b', type: 'process', stageId: 'review', laneId: 'erp', position: { x: 320, y: 0 }, zIndex: 1, data: { label: '复核订单', shape: 'process' } },
      ],
      edges: [{ id: 'a-to-b', source: 'process-a', target: 'process-b' }],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [{ id: 'step-a', order: 0, title: '创建订单', nodeId: 'process-a' }],
      entryNodeId: 'process-a',
      exitNodeIds: ['process-b'],
    };

    const withoutStage = removeHierarchyItem(document, 'stage', 'prepare');
    const withoutLane = removeHierarchyItem(withoutStage, 'lane', 'sales');

    expect(withoutStage.stages).toEqual([{ id: 'review', title: '复核', order: 0 }]);
    expect(withoutStage.nodes).toHaveLength(document.nodes.length);
    expect(withoutStage.nodes.find((node) => node.id === 'process-a')).not.toHaveProperty('stageId');
    expect(withoutStage.edges).toEqual(document.edges);
    expect(withoutStage.steps).toEqual(document.steps);
    expect(withoutLane.lanes).toEqual([{ id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 0 }]);
    expect(withoutLane.nodes.find((node) => node.id === 'process-a')).not.toHaveProperty('laneId');
  });

  it('passes persisted node measurements back to React Flow after a controlled update', () => {
    const [node] = toFlowNodes([{
      id: 'sales-start', type: 'start', position: { x: 80, y: 80 }, zIndex: 1,
      data: { label: '收到订单', shape: 'start' }, size: { width: 240, height: 104 },
    }]);

    expect(node).toBeDefined();
    expect(node!.measured).toEqual({ width: 240, height: 104 });
  });

  it('uses saved node heights as a minimum so long primary-node content can grow inside its card', () => {
    const [imageNode, processNode] = toFlowNodes([
      { id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0, data: { url: 'https://example.com/a.png', alt: '示意图' } },
      {
        id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 1,
        size: { width: 240, height: 104 },
        data: { label: '收到客人提案需求，可以是邮件或者微信，且需要补充完整说明', shape: 'process' },
      },
    ]);

    expect(imageNode!.style).toEqual({ width: 320, height: 260 });
    expect(processNode!.style).toEqual({ width: 240, minHeight: 104 });
  });

  it('passes resource visibility as presentation data without structurally hiding the React Flow node', () => {
    const [visible, hidden, process] = toFlowNodes([
      { id: 'visible', type: 'markdown', position: { x: 0, y: 0 }, zIndex: 0, data: { markdown: '可见' } },
      { id: 'hidden', type: 'image', visibility: 'HIDDEN', position: { x: 0, y: 0 }, zIndex: 1, data: { url: 'https://example.com/a.png', alt: '隐藏图' } },
      { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 2, data: { label: '流程', shape: 'process' } },
    ]);

    expect(visible!.data).toMatchObject({ resourceVisibility: 'VISIBLE' });
    expect(hidden!.data).toMatchObject({ resourceVisibility: 'HIDDEN' });
    expect(visible).not.toHaveProperty('hidden');
    expect(hidden).not.toHaveProperty('hidden');
    expect(process!.data).not.toHaveProperty('resourceVisibility');
  });

  it('hides attached resource cards from the flow presentation when their appendix is fully hidden', () => {
    const [process, hiddenMarkdown, hiddenImage] = toFlowNodes([
      { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
      { id: 'hidden-markdown', type: 'markdown', visibility: 'HIDDEN', position: { x: 320, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'process', order: 0 }, data: { markdown: '隐藏说明' } },
      { id: 'hidden-image', type: 'image', visibility: 'HIDDEN', position: { x: 320, y: 210 }, zIndex: 2, attachment: { ownerNodeId: 'process', order: 1 }, data: { url: 'https://example.com/a.png', alt: '隐藏图' } },
    ]);

    expect(hiddenMarkdown!.style).toEqual(expect.objectContaining({ display: 'none' }));
    expect(hiddenImage!.style).toEqual(expect.objectContaining({ display: 'none' }));
    expect(hiddenMarkdown).not.toHaveProperty('hidden');
    expect(hiddenImage).not.toHaveProperty('hidden');
    expect(process!.style).not.toEqual(expect.objectContaining({ display: 'none' }));
  });

  it('routes from a primary node’s latest measured height before that size is saved', () => {
    type MeasuredDocument = (document: CanvasDocument, flowNodes: Node[]) => CanvasDocument;
    const documentWithMeasuredNodeSizes = (GuideEditorModule as unknown as { documentWithMeasuredNodeSizes?: MeasuredDocument }).documentWithMeasuredNodeSizes;
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'intake', title: '需求确认', order: 0 }],
      lanes: [{ id: 'sales', title: '业务', kind: 'ROLE', order: 0 }],
      nodes: [
        { id: 'start', type: 'start', stageId: 'intake', laneId: 'sales', position: { x: 0, y: 0 }, zIndex: 0, size: { width: 240, height: 104 }, data: { label: '收到客人提案需求，可以是邮件或者微信', shape: 'start' } },
        { id: 'confirm', type: 'process', stageId: 'intake', laneId: 'sales', position: { x: 0, y: 220 }, zIndex: 1, size: { width: 240, height: 104 }, data: { label: '确认原料', shape: 'process' } },
      ],
      edges: [{ id: 'continuation', source: 'start', sourceHandle: 'out', target: 'confirm', targetHandle: 'in' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: [],
    };

    expect(documentWithMeasuredNodeSizes).toBeTypeOf('function');
    const measured = documentWithMeasuredNodeSizes!(document, [{ id: 'start', measured: { width: 240, height: 156 } } as Node]);

    expect(measured.nodes.find((node) => node.id === 'start')?.size).toEqual({ width: 240, height: 156 });
    expect(routeCanvasEdges(measured).routesByEdgeId.get('continuation')?.points[0]).toEqual({ x: 120, y: 156 });
  });

  it('does not persist temporary dimensions while a flow detail is expanded', () => {
    const expanded = new Set(['process']);
    const [node] = toFlowNodes([
      { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, size: { width: 260, height: 120 }, data: { label: '处理', description: '第一行\n第二行', shape: 'process' } },
    ], [], [], expanded);
    const dimensions: NodeChange = { id: 'process', type: 'dimensions', dimensions: { width: 260, height: 360 }, resizing: false };

    expect(node!.style).toEqual({ width: 260 });
    expect(node!.data).toMatchObject({ detailExpanded: true });
    expect(persistableNodeChanges([dimensions], expanded)).toEqual([]);
  });

  it('explicitly clears the detail-expanded flag when a flow node is collapsed', () => {
    const node = { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', description: '第一行\n第二行', shape: 'process' } } as CanvasNode;

    const [expanded] = toFlowNodes([node], [], [], new Set(['process']));
    const [collapsed] = toFlowNodes([node], [], [], new Set());

    expect(expanded!.data).toMatchObject({ detailExpanded: true });
    expect(collapsed!.data).toMatchObject({ detailExpanded: false });
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

  it('uses a same-batch measured size when snapping a dragged node onto a straight edge', async () => {
    const sourceOffset = 0.523702219266312;
    const targetOffset = 0.46233041792458973;
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'source', type: 'process', position: { x: 0, y: 0 }, size: { width: 240, height: 115 }, zIndex: 0, data: { label: '开始', shape: 'process' } },
        { id: 'target', type: 'process', position: { x: 320, y: -20 }, size: { width: 240, height: 104 }, zIndex: 1, data: { label: '确认', shape: 'process' } },
      ],
      edges: [{
        id: 'flow', source: 'source', sourceHandle: 'out', target: 'target', targetHandle: 'in',
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: sourceOffset },
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: targetOffset },
          targetAnchorMode: 'manual',
        },
      }],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      entryNodeId: 'source',
      exitNodeIds: ['target'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onNodesChange?.([
      { id: 'target', type: 'dimensions', dimensions: { width: 240, height: 140 }, resizing: false },
      { id: 'target', type: 'position', position: { x: 320, y: -20 }, dragging: true },
    ]));
    expect(globalThis.document.querySelector('.canvas-alignment-guide')).not.toBeNull();
    const previewRoute = testRouteData(reactFlowCallbacks.edges.find((edge) => edge.id === 'flow'))?.route;
    expect(previewRoute?.points).toHaveLength(2);
    expect(previewRoute?.points?.[0]?.y).toBe(previewRoute?.points?.[1]?.y);

    act(() => reactFlowCallbacks.onNodesChange?.([
      { id: 'target', type: 'position', position: { x: 320, y: -20 }, dragging: false },
    ]));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    const target = saved.nodes.find((node) => node.id === 'target')!;
    expect(target.position.y).toBeCloseTo(115 * sourceOffset - 140 * targetOffset, 8);
    const route = routeCanvasEdges(saved).routesByEdgeId.get('flow')!;
    expect(route.points).toHaveLength(2);
    expect(route.points[0]!.y).toBe(route.points[1]!.y);
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

  it('persists an explicitly applied automatic layout after an insertion save is in flight', async () => {
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
    const authoredDocument = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls[0]![2].document as CanvasDocument;
    expect(authoredDocument.nodes.map((node) => node.position)).toEqual([{ x: 80, y: 80 }, { x: 460, y: 80 }]);

    fireEvent.click(screen.getByRole('button', { name: '预览自动整理' }));
    fireEvent.click(screen.getByRole('button', { name: '应用自动整理' }));
    pending[0]?.({ ...emptyGuide, revision: 1, document: authoredDocument });

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalledTimes(2));
    const arrangedDocument = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls[1]![2].document as CanvasDocument;
    expect(arrangedDocument.nodes.map((node) => node.position)).not.toEqual(authoredDocument.nodes.map((node) => node.position));
    pending[1]?.({ ...emptyGuide, revision: 2, document: arrangedDocument });
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

  it('autosaves a loaded repair after removing orphaned subguide artifacts', async () => {
    vi.useFakeTimers();
    try {
      const sourceTrace = {
        referenceNodeId: 'missing-reference',
        sourceGuideId: 'guide-source',
        sourceVersionId: 'version-1',
        sourceElementId: 'source-step',
      };
      const orphanId = 'ref:missing-reference:source-step';
      const api = createApi({
        document: {
          schemaVersion: 1,
          nodes: [{ id: orphanId, type: 'process', position: { x: 0, y: 0 }, zIndex: 0, source: sourceTrace, data: { label: '孤儿步骤', shape: 'process' } }],
          edges: [{ id: 'orphan-edge', source: orphanId, target: orphanId, sourceTrace }],
          viewport: { x: 0, y: 0, zoom: 1 },
          steps: [{ id: 'orphan-step', order: 0, title: '孤儿步骤', nodeId: orphanId, source: sourceTrace }],
          entryNodeId: orphanId,
          exitNodeIds: [orphanId],
        },
      });
      render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);

      await act(async () => { await Promise.resolve(); });
      await act(async () => {
        vi.advanceTimersByTime(1_600);
        await Promise.resolve();
      });

      expect(api.saveGuide).toHaveBeenCalledWith('guide-host', 0, expect.objectContaining({
        document: expect.objectContaining({ nodes: [], edges: [], steps: [], entryNodeId: undefined, exitNodeIds: [] }),
      }));
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

    const nodeGroup = screen.getByRole('group', { name: '添加节点' });
    expect(within(nodeGroup).getByRole('button', { name: '插入子指南' })).toBeVisible();
    expect(screen.queryByRole('group', { name: '引用与整理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '层级与删除' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: '编辑画布' })).getByRole('button', { name: '删除选中项' })).toBeDisabled();

    await user.click(within(nodeGroup).getByRole('button', { name: '插入子指南' }));
    expect(await screen.findByText('库存盘点流程')).toBeVisible();
    expect(await screen.findByText('物料主数据检查')).toBeVisible();
    expect(search).toHaveBeenNthCalledWith(1, '', 0, 'workspace-sales');
    expect(search).toHaveBeenNthCalledWith(2, '', 1, 'workspace-sales');

    await user.type(screen.getByRole('searchbox', { name: '搜索可复用指南' }), '物料');
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('物料', 0, 'workspace-sales'));
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

  it('attaches toolbar-created resources to the selected node, previews hierarchy, and applies it as one undoable change', async () => {
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openStageManager();

    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    fireEvent.click(screen.getByRole('button', { name: '添加阶段' }));
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    const stageId = (screen.getByRole('option', { name: '业务阶段 1' }) as HTMLOptionElement).value;
    fireEvent.change(screen.getByLabelText('所属业务阶段'), { target: { value: stageId } });
    fireEvent.click(screen.getByRole('button', { name: '添加 Markdown 节点' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const savedDocument = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2].document as CanvasDocument;
    const markdown = savedDocument.nodes.find((node) => node.type === 'markdown');
    expect(markdown).toBeDefined();
    expect(markdown).toMatchObject({ attachment: expect.objectContaining({ ownerNodeId: expect.any(String) }) });
    expect(savedDocument.edges).toEqual([]);

    const savesBeforePreview = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '预览自动整理' }));
    const layoutDialog = screen.getByRole('dialog', { name: '自动整理预览' });
    expect(layoutDialog).toBeVisible();
    expect(layoutDialog.closest('.inspector')).not.toBeNull();
    expect(layoutDialog.closest('.canvas-shell')).toBeNull();
    expect(screen.getByText('阶段从上到下')).toBeVisible();
    expect(api.saveGuide).toHaveBeenCalledTimes(savesBeforePreview);
    fireEvent.click(screen.getByRole('button', { name: '应用自动整理' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  });

  it('lets an author move the selected step earlier and persists the renumbered semantic order', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'intake', title: '需求确认', order: 0 }],
      lanes: [{ id: 'sales', title: '业务', kind: 'ROLE', order: 0 }],
      nodes: [
        { id: 'receive', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, stageId: 'intake', laneId: 'sales', outline: { order: 0, kind: 'STEP' }, data: { label: '收到需求', shape: 'start' } },
        { id: 'confirm', type: 'process', position: { x: 0, y: 220 }, zIndex: 1, stageId: 'intake', laneId: 'sales', outline: { order: 1, kind: 'STEP' }, data: { label: '确认原料', shape: 'process' } },
        { id: 'archive', type: 'process', position: { x: 0, y: 440 }, zIndex: 2, stageId: 'intake', laneId: 'sales', outline: { order: 2, kind: 'STEP' }, data: { label: '归档需求', shape: 'process' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'receive', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    openHierarchyPanel();
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 归档需求' }));
    fireEvent.click(await screen.findByRole('button', { name: '前移步骤' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.nodes.find((node) => node.id === 'archive')?.outline?.order).toBe(1);
    expect(saved.nodes.find((node) => node.id === 'confirm')?.outline?.order).toBe(2);
  });

  it('keeps one current-node step action group when the selection changes', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'intake', title: '需求确认', order: 0 }],
      lanes: [{ id: 'sales', title: '业务', kind: 'ROLE', order: 0 }],
      nodes: [
        { id: 'confirm', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, stageId: 'intake', laneId: 'sales', outline: { order: 0, kind: 'STEP' }, data: { label: '确认原料', shape: 'process' } },
        { id: 'archive', type: 'process', position: { x: 0, y: 220 }, zIndex: 1, stageId: 'intake', laneId: 'sales', outline: { order: 1, kind: 'STEP' }, data: { label: '归档需求', shape: 'process' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'confirm', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    openHierarchyPanel();
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 确认原料' }));

    const initialActions = await screen.findByRole('group', { name: '当前步骤操作' });
    expect(within(initialActions).getAllByRole('button')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '前移步骤' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '后移步骤' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '添加子步骤' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 归档需求' }));

    await waitFor(() => expect(screen.getAllByRole('group', { name: '当前步骤操作' })).toHaveLength(1));
    const currentActions = screen.getByRole('group', { name: '当前步骤操作' });
    expect(within(currentActions).getAllByRole('button')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '前移步骤' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '后移步骤' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '添加子步骤' })).toHaveLength(1);
  });

  it('appends a manually reattached resource after its owner\'s existing appendix resources', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'confirm', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, outline: { order: 0, kind: 'STEP' }, data: { label: '确认原料', shape: 'process' } },
        { id: 'first', type: 'markdown', position: { x: 360, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'confirm', order: 0 }, data: { markdown: '## 第一份资料' } },
        { id: 'second', type: 'markdown', position: { x: 360, y: 220 }, zIndex: 2, attachment: { ownerNodeId: 'confirm', order: 1 }, data: { markdown: '## 第二份资料' } },
        { id: 'third', type: 'markdown', position: { x: 0, y: 280 }, zIndex: 3, data: { markdown: '## 第三份资料' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();

    fireEvent.click(screen.getByRole('button', { name: '选择资料 第三份资料' }));
    fireEvent.change(screen.getByLabelText('挂靠主节点'), { target: { value: 'confirm' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.nodes.find((node) => node.id === 'third')?.attachment).toEqual({ ownerNodeId: 'confirm', order: 2 });
  });

  it('moves a node into the selected business stage instead of leaving it at its old canvas position', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'proposal', title: '客人提案阶段', order: 0 }],
      nodes: [{ id: 'start', type: 'start', position: { x: 680, y: 420 }, zIndex: 0, data: { label: '收到需求', shape: 'start' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 收到需求' }));

    fireEvent.change(screen.getByLabelText('所属业务阶段'), { target: { value: 'proposal' } });
    await waitFor(() => expect(screen.getByLabelText('所属业务阶段')).toHaveValue('proposal'));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());

    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.nodes[0]).toMatchObject({ stageId: 'proposal', position: { x: 0, y: 0 } });
  });

  it('moves the whole business stage when its blue frame is dragged', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'proposal', title: '客人提案阶段', order: 0 }],
      nodes: [
        { id: 'start', type: 'start', stageId: 'proposal', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '收到需求', shape: 'start' } },
        { id: 'note', type: 'markdown', contentParentId: 'start', position: { x: 0, y: 128 }, zIndex: 1, data: { markdown: '说明' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    const pane = screen.getByTestId('flow-pane');
    fireEvent.pointerDown(pane, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(pane, { clientX: 220, clientY: 180, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(pane, { clientX: 220, clientY: 180, button: 0, pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());

    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.nodes.find((node) => node.id === 'start')!.position).toEqual({ x: 120, y: 80 });
    expect(saved.nodes.find((node) => node.id === 'note')!.position).toEqual({ x: 120, y: 208 });
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
    openHierarchyPanel();

    await user.click(screen.getByRole('button', { name: '预览自动整理' }));
    const layoutDialog = screen.getByRole('dialog', { name: '自动整理预览' });
    expect(within(layoutDialog).getByText('主流程').parentElement).toHaveTextContent('2');
    expect(within(layoutDialog).getByText('阶段').parentElement).toHaveTextContent('1');
    expect(within(layoutDialog).getByText('资料').parentElement).toHaveTextContent('2');
    expect(within(layoutDialog).getByText('孤立节点 1')).toBeVisible();
    expect(within(layoutDialog).getByText('循环 0')).toBeVisible();
    expect(within(layoutDialog).getByText('阶段从上到下')).toBeVisible();
    await waitFor(() => expect(fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: 0.16,
      minZoom: document.viewport.zoom,
      maxZoom: document.viewport.zoom,
    })));

    await user.click(screen.getByRole('button', { name: '选择流程节点 离屏流程' }));
    expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ nodes: [{ id: 'offscreen' }] }));
  });

  it('lets stage and lane names be cleared before entering a replacement', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [{ id: 'entry', title: '订单录入', order: 0 }],
      lanes: [{ id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 0 }],
      nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openStageManager();
    const stageInput = screen.getByRole('textbox', { name: '业务阶段 订单录入' });
    fireEvent.change(stageInput, { target: { value: '' } });
    expect(stageInput).toHaveValue('');
    fireEvent.change(stageInput, { target: { value: '订单处理' } });
    expect(screen.getByRole('textbox', { name: '业务阶段 订单处理' })).toHaveValue('订单处理');

    openLaneManager();
    const laneInput = screen.getByRole('textbox', { name: '责任泳道 ERP' });
    fireEvent.change(laneInput, { target: { value: '' } });
    expect(laneInput).toHaveValue('');
    fireEvent.change(laneInput, { target: { value: 'ERP系统' } });
    expect(screen.getByRole('textbox', { name: '责任泳道 ERP系统' })).toHaveValue('ERP系统');
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
    openStageManager();
    fireEvent.change(screen.getByRole('textbox', { name: '业务阶段 订单录入' }), { target: { value: '订单处理' } });
    openLaneManager();
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
    const layoutDialog = screen.getByRole('dialog', { name: '自动整理预览' });
    expect(within(layoutDialog).getByText('泳道').parentElement).toHaveTextContent('1');
  });

  it('persists drag-reordered stages while keeping the derived tutorial order in the tree', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      stages: [
        { id: 'entry', title: '需求确认', order: 0 },
        { id: 'sourcing', title: '原料确认', order: 1 },
        { id: 'sampling', title: '打样', order: 2 },
      ],
      nodes: [
        { id: 'receive', type: 'start', stageId: 'entry', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '收到需求', shape: 'start' } },
        { id: 'confirm', type: 'process', stageId: 'sourcing', position: { x: 320, y: 0 }, zIndex: 1, data: { label: '确认原料', shape: 'process' } },
        { id: 'sample', type: 'process', stageId: 'sampling', position: { x: 640, y: 0 }, zIndex: 2, data: { label: '制作样板', shape: 'process' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'receive', exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openStageManager();

    fireEvent.dragStart(screen.getByRole('button', { name: '拖动阶段 打样 排序' }));
    fireEvent.drop(screen.getByRole('listitem', { name: '阶段 需求确认' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const savedDocument = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2].document as CanvasDocument;
    expect([...savedDocument.stages ?? []].sort((left, right) => left.order - right.order).map((stage) => stage.id)).toEqual(['sampling', 'entry', 'sourcing']);
    expect(screen.getByText('3 个教学步骤', { selector: '.hierarchy-heading small' })).toBeVisible();
    expect(screen.queryByText('LESSON PATH')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '节点属性' })).toBeVisible();
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
    openHierarchyPanel();

    await user.click(screen.getByRole('button', { name: '预览自动整理' }));
    expect(screen.getByLabelText('指南标题')).toBeDisabled();
    expect(screen.getByRole('button', { name: '查看摘要' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑标签' })).toBeDisabled();
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
    openHierarchyPanel();

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

    expect(screen.getByRole('dialog', { name: '自动整理预览' })).toBeVisible();
    expect(screen.getByText('阶段从上到下')).toBeVisible();
    expect(api.saveGuide).toHaveBeenCalledTimes(savesBeforePreview);

    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    expect(screen.getByRole('dialog', { name: '自动整理预览' })).toBeVisible();
    expect(api.saveGuide).toHaveBeenCalledTimes(savesBeforePreview);
  });

  it('keeps referenced resources while removing their edge when the source node is deleted', async () => {
    const api = createApi();
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();

    fireEvent.click(screen.getByRole('button', { name: '添加流程节点' }));
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 Markdown 节点' }));
    fireEvent.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    fireEvent.click(screen.getByRole('button', { name: '删除选中项' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());

    const savedDocument = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2].document as CanvasDocument;
    const markdown = savedDocument.nodes.find((node) => node.type === 'markdown');
    expect(markdown).toBeDefined();
    expect(markdown).not.toHaveProperty('contentParentId');
    expect(savedDocument.edges).toEqual([]);
  });

  it('opens the creation menu when a connection ends on an existing edge without a target node', async () => {
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

    const edgeHitArea = globalThis.document.createElementNS('http://www.w3.org/2000/svg', 'path');
    screen.getByTestId('flow-pane').parentElement!.appendChild(edgeHitArea);
    act(() => reactFlowCallbacks.onConnectStart?.({} as MouseEvent, { nodeId: 'start', handleId: 'out', handleType: 'source' }));
    act(() => reactFlowCallbacks.onConnectEnd?.({ target: edgeHitArea, clientX: 480, clientY: 240 } as unknown as MouseEvent, { toNode: null, isValid: false }));

    const creationMenu = await screen.findByRole('menu', { name: '创建下一项' });
    expect(creationMenu.parentElement).toHaveClass('canvas-screen-overlay');
    expect(within(screen.getByTestId('viewport-portal')).queryByRole('menu', { name: '创建下一项' })).not.toBeInTheDocument();
    const beforeMove = creationMenu.getAttribute('style');
    act(() => reactFlowCallbacks.onMove?.(null, { x: 96, y: 72, zoom: 0.5 }));
    expect(creationMenu.getAttribute('style')).not.toBe(beforeMove);
    expect(creationMenu.style.transform).not.toContain('scale');

    await user.click(screen.getByRole('menuitem', { name: '创建流程节点' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ type: 'process', outline: expect.objectContaining({ kind: 'STEP' }) })]),
        edges: expect.arrayContaining([expect.objectContaining({ source: 'start', sourceHandle: 'out', target: expect.stringMatching(/^process-/), semantic: { kind: 'FLOW' } })]),
      }),
    }));
  });

  it('keeps a normal semantic connection automatic even when the pointer lands on exact node sides', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process', type: 'process', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    const start = globalThis.document.querySelector<HTMLElement>('.react-flow__node[data-id="start"]')!;
    const process = globalThis.document.querySelector<HTMLElement>('.react-flow__node[data-id="process"]')!;
    vi.spyOn(start, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 104 } as DOMRect);
    vi.spyOn(process, 'getBoundingClientRect').mockReturnValue({ left: 360, top: 0, width: 240, height: 104 } as DOMRect);

    act(() => reactFlowCallbacks.onConnectStart?.({ clientX: 240, clientY: 52 } as MouseEvent, { nodeId: 'start', handleId: 'out', handleType: 'source' }));
    act(() => reactFlowCallbacks.onConnect?.({ source: 'start', sourceHandle: 'out', target: 'process', targetHandle: 'in' }));
    act(() => reactFlowCallbacks.onConnectEnd?.({ target: process, clientX: 360, clientY: 52 } as unknown as MouseEvent, { toNode: { id: 'process' } }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.edges.find((edge) => edge.source === 'start' && edge.target === 'process')?.presentation).toBeUndefined();
  });

  it('creates resources as one-owner appendix material without a flow edge', async () => {
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
    expect(markdown).toMatchObject({ attachment: { ownerNodeId: 'process-a', order: 0 } });
    expect(saved.edges).toEqual([]);
  });

  it('creates a persistent reference from a flow node to existing Markdown material', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'process-a', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '操作步骤', shape: 'process' } },
        { id: 'note', type: 'markdown', position: { x: 360, y: 0 }, zIndex: 1, data: { markdown: '共享说明资料' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onConnectStart?.({} as MouseEvent, { nodeId: 'process-a', handleId: 'out', handleType: 'source' }));
    act(() => reactFlowCallbacks.onConnect?.({ source: 'process-a', sourceHandle: 'out', target: 'note', targetHandle: 'in' }));
    act(() => reactFlowCallbacks.onConnectEnd?.({ clientX: 360, clientY: 0 } as MouseEvent, { toNode: { id: 'note' }, isValid: true }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ edges: [expect.objectContaining({ source: 'process-a', target: 'note', sourceHandle: 'out', targetHandle: 'in' })] }),
    }));
  });

  it('converts an existing target into a semantic branch when connected from a decision', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'decision', type: 'decision', position: { x: 0, y: 0 }, zIndex: 0, outline: { order: 0, kind: 'STEP' }, data: { label: '原料合格？', shape: 'decision', branchLabels: ['通过', '退回'] } },
        { id: 'continue', type: 'process', position: { x: 360, y: 0 }, zIndex: 1, outline: { order: 1, kind: 'STEP' }, data: { label: '继续打样', shape: 'process' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onConnectStart?.({} as MouseEvent, { nodeId: 'decision', handleId: 'yes', handleType: 'source' }));
    act(() => reactFlowCallbacks.onConnect?.({ source: 'decision', sourceHandle: 'yes', target: 'continue', targetHandle: 'in' }));
    act(() => reactFlowCallbacks.onConnectEnd?.({ clientX: 360, clientY: 0 } as MouseEvent, { toNode: { id: 'continue' }, isValid: true }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.nodes.find((node) => node.id === 'continue')?.outline).toEqual({ parentId: 'decision', order: 0, kind: 'BRANCH' });
    expect(saved.edges).toContainEqual(expect.objectContaining({
      source: 'decision', target: 'continue', semantic: { kind: 'BRANCH', order: 0 }, label: '通过',
    }));
  });

  it('allows Markdown material to create a reference to a flow node', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'note', type: 'markdown', position: { x: 0, y: 0 }, zIndex: 0, data: { markdown: '共享说明资料' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '操作步骤', shape: 'process' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onConnectStart?.({} as MouseEvent, { nodeId: 'note', handleId: 'out', handleType: 'source' }));
    act(() => reactFlowCallbacks.onConnect?.({ source: 'note', sourceHandle: 'out', target: 'process-a', targetHandle: 'in' }));
    act(() => reactFlowCallbacks.onConnectEnd?.({ clientX: 360, clientY: 0 } as MouseEvent, { toNode: { id: 'process-a' }, isValid: true }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ edges: [expect.objectContaining({ source: 'note', target: 'process-a', sourceHandle: 'out', targetHandle: 'in' })] }),
    }));
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

  it('replaces the legacy content-parent selector with one-owner material attachment', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '操作步骤', shape: 'process' } },
        { id: 'video', type: 'video', contentParentId: 'process', position: { x: 360, y: 0 }, zIndex: 1, data: { url: 'https://example.com/demo.mp4', keypoints: [] } },
      ],
      edges: [{ id: 'process-video', source: 'process', target: 'video' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };

    render(<GuideEditor guideId="guide-host" focusNodeId="video" api={createApi({ document })} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    act(() => reactFlowCallbacks.onSelectionChange?.({ nodes: [{ id: 'video' }] }));

    expect(screen.queryByLabelText('旧版层级挂靠（兼容）')).not.toBeInTheDocument();
    expect(screen.getByText('每份资料只挂靠一个主节点；其它节点通过可跳转引用访问它。')).toBeVisible();
    expect(screen.getByLabelText('挂靠主节点')).toHaveValue('process');
    expect(screen.getByLabelText('上传视频')).toHaveAttribute('accept', 'video/mp4,video/webm,video/quicktime,.mov');
  });

  it('opens a deep-linked image annotation in the editor without selecting another marker', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{
        id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0,
        data: {
          url: 'https://example.com/erp.png',
          alt: 'ERP 打样页面',
          annotations: [
            { id: 'customer', order: 0, title: '客户要求', shape: 'POINT', region: { x: 0.2, y: 0.3 } },
            { id: 'version-type', order: 1, title: '版类型', shape: 'POINT', region: { x: 0.7, y: 0.5 } },
          ],
        },
      }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };

    render(<GuideEditor guideId="guide-host" focusNodeId="image" focusAnnotationId="version-type" api={createApi({ document })} onBack={vi.fn()} />);

    expect((await screen.findByRole('dialog', { name: '图片标注编辑器' })).querySelector('[aria-label="标注 2 标题"]')).toBeTruthy();
    expect(screen.queryByLabelText('标注 1 标题')).not.toBeInTheDocument();
  });

  it('allows replacing a video keypoint title after clearing it', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{
        id: 'video', type: 'video', position: { x: 0, y: 0 }, zIndex: 0,
        data: { url: 'https://example.com/demo.mp4', keypoints: [{ id: 'keypoint-1', title: '进入菜单', timeSeconds: 1 }] },
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      exitNodeIds: [],
    };
    const api = createApi({ document });

    render(<GuideEditor guideId="guide-host" focusNodeId="video" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    act(() => reactFlowCallbacks.onSelectionChange?.({ nodes: [{ id: 'video' }] }));

    const titleInput = await screen.findByRole('textbox', { name: '关键点 1 标题' });
    await user.clear(titleInput);
    expect(titleInput).toHaveValue('');
    await user.type(titleInput, '打开菜单');
    expect(titleInput).toHaveValue('打开菜单');

    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const savedDocument = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(savedDocument.nodes.find((node) => node.id === 'video')).toEqual(expect.objectContaining({
      data: expect.objectContaining({ keypoints: [expect.objectContaining({ title: '打开菜单' })] }),
    }));
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
      id: 'flow-edge', sourceHandle: 'edge:flow-edge:source', targetHandle: 'edge:flow-edge:target', type: 'orthogonal', label: '继续', data: expect.objectContaining({ route: expect.objectContaining({ kind: 'FORWARD' }) }),
    }));
  });

  it('activates reconnect controls only for the clicked business edge', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '处理 A', shape: 'process' } },
        { id: 'process-b', type: 'process', position: { x: 720, y: 0 }, zIndex: 2, data: { label: '处理 B', shape: 'process' } },
      ],
      edges: [
        { id: 'edge-a', source: 'start', target: 'process-a' },
        { id: 'edge-b', source: 'process-a', target: 'process-b' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-b'],
    };
    render(<GuideEditor guideId="guide-host" api={createApi({ document })} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    expect(reactFlowCallbacks.edgesReconnectable).toBe(false);
    expect(reactFlowCallbacks.edges.find((edge) => edge.id === 'edge-a')).toMatchObject({
      selected: false, reconnectable: false, data: { endpointMode: 'idle' },
    });
    expect(reactFlowCallbacks.edges.find((edge) => edge.id === 'edge-b')).toMatchObject({
      selected: false, reconnectable: false, data: { endpointMode: 'idle' },
    });

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges.find((edge) => edge.id === 'edge-a')!));

    await waitFor(() => {
      expect(reactFlowCallbacks.edges.find((edge) => edge.id === 'edge-a')).toMatchObject({
        selected: true, reconnectable: false, data: { endpointMode: 'idle' },
      });
      expect(reactFlowCallbacks.edges.find((edge) => edge.id === 'edge-b')).toMatchObject({
        selected: false, reconnectable: false, data: { endpointMode: 'idle' },
      });
    });

    expect(reactFlowCallbacks.edgesReconnectable).toBe(false);
    await user.click(screen.getByRole('button', { name: '编辑走向' }));

    await waitFor(() => {
      expect(reactFlowCallbacks.edgesReconnectable).toBe(true);
      expect(reactFlowCallbacks.edges.find((edge) => edge.id === 'edge-a')).toMatchObject({
        selected: true, reconnectable: true, data: { endpointMode: 'active' },
      });
    });
  });

  it('snaps an edited source endpoint to a shared point and persists the peer anchors', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'parent', type: 'process', position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, zIndex: 0, data: { label: '父节点', shape: 'process' } },
        { id: 'child-a', type: 'process', position: { x: 400, y: 0 }, size: { width: 200, height: 100 }, zIndex: 1, data: { label: '子节点 A', shape: 'process' } },
        { id: 'child-b', type: 'process', position: { x: 400, y: 180 }, size: { width: 200, height: 100 }, zIndex: 2, data: { label: '子节点 B', shape: 'process' } },
      ],
      edges: [
        { id: 'existing', source: 'parent', target: 'child-a', presentation: { sourceAnchor: { side: 'RIGHT', offset: 0.5 }, sourceAnchorMode: 'manual' } },
        { id: 'editing', source: 'parent', target: 'child-b' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'parent', exitNodeIds: ['child-a', 'child-b'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges.find((edge) => edge.id === 'editing')!));
    await user.click(screen.getByRole('button', { name: '编辑走向' }));
    act(() => reactFlowCallbacks.onReconnectStart?.({} as MouseEvent, reactFlowCallbacks.edges.find((edge) => edge.id === 'editing')!, 'target'));
    act(() => reactFlowCallbacks.onReconnectEnd?.({ clientX: 202, clientY: 51 } as MouseEvent, reactFlowCallbacks.edges.find((edge) => edge.id === 'editing')!, 'target', { toNode: { id: 'parent' } }));

    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.edges.find((edge) => edge.id === 'existing')?.presentation).toEqual(expect.objectContaining({
      sourceAnchor: { side: 'RIGHT', offset: 0.5 }, sourceAnchorMode: 'manual',
    }));
    expect(saved.edges.find((edge) => edge.id === 'editing')?.presentation).toEqual(expect.objectContaining({
      sourceAnchor: { side: 'RIGHT', offset: 0.5 }, sourceAnchorMode: 'manual',
    }));
  });

  it('snaps a close node drop onto a clear opposing route before persisting the move', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'source', type: 'start', position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'target', type: 'process', position: { x: 400, y: 0 }, size: { width: 200, height: 100 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'aligned', source: 'source', target: 'target' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'source', exitNodeIds: ['target'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onNodesChange?.([{ id: 'target', type: 'position', position: { x: 400, y: 9 }, dragging: false }]));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.nodes.find((node) => node.id === 'target')!.position).toEqual({ x: 400, y: 0 });
  });

  it('persists toolbar changes only for a selected business edge', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-a' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-a'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
    fireEvent.change(screen.getByLabelText('选择连线颜色'), { target: { value: '#1020ff' } });
    await user.click(screen.getByRole('button', { name: '选择连线粗细' }));
    const widthInput = screen.getByRole('spinbutton', { name: '连线粗细数值' });
    await user.clear(widthInput);
    await user.type(widthInput, '4');
    await user.click(screen.getByRole('button', { name: '选择线型' }));
    await user.click(screen.getByRole('button', { name: '点线' }));
    await user.click(screen.getByRole('button', { name: '选择连线路由' }));
    await user.click(screen.getByRole('button', { name: '直线' }));
    await user.click(screen.getByRole('button', { name: '选择箭头' }));
    await user.click(screen.getByRole('button', { name: '双向箭头' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ edges: [expect.objectContaining({
        id: 'business', presentation: { color: '#1020ff', width: 4, pattern: 'dotted', routing: 'straight', arrows: 'both' },
      })] }),
    }));
  });

  it('switches a manually routed edge to a true straight route and clears stale manual geometry', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, size: { width: 240, height: 104 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, size: { width: 240, height: 104 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-a', presentation: {
        routing: 'elbow',
        routeMode: 'manual',
        waypoints: [{ x: 264, y: 52 }, { x: 264, y: 180 }, { x: 336, y: 180 }, { x: 336, y: 52 }],
        sourceAnchor: { side: 'RIGHT', offset: 0.5 },
        sourceAnchorMode: 'manual',
        targetAnchor: { side: 'LEFT', offset: 0.5 },
        targetAnchorMode: 'manual',
      } }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-a'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
    await user.click(screen.getByRole('button', { name: '选择连线路由' }));
    await user.click(screen.getByRole('button', { name: '直线' }));

    expect(testRouteData(reactFlowCallbacks.edges[0])?.route?.points).toEqual([
      { x: 240, y: 52 },
      { x: 360, y: 52 },
    ]);

    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.edges[0]?.presentation).toEqual({ routing: 'straight' });
  });

  it('makes 恢复智能路线 an explicit smart route reset', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, size: { width: 240, height: 104 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, size: { width: 240, height: 104 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-a', presentation: {
        routing: 'elbow',
        routeMode: 'manual',
        waypoints: [{ x: 264, y: 52 }, { x: 264, y: 180 }, { x: 336, y: 180 }, { x: 336, y: 52 }],
      } }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-a'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
    await user.click(screen.getByRole('button', { name: '选择连线路由' }));
    await user.click(screen.getByRole('button', { name: '智能避让' }));

    expect(testRouteData(reactFlowCallbacks.edges[0])?.route?.routing).toBe('smart');
    expect(testRouteData(reactFlowCallbacks.edges[0])?.route?.points).toEqual([
      { x: 240, y: 52 },
      { x: 360, y: 52 },
    ]);

    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    expect(saved.edges[0]?.presentation).toEqual({ routing: 'smart' });
  });

  it('validates a manual draft created from an automatic straight route', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, size: { width: 240, height: 104 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'obstacle', type: 'process', position: { x: 260, y: 0 }, size: { width: 240, height: 104 }, zIndex: 1, data: { label: '障碍', shape: 'process' } },
        { id: 'process-a', type: 'process', position: { x: 600, y: 0 }, size: { width: 240, height: 104 }, zIndex: 2, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-a', presentation: { routing: 'straight' } }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-a'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
    await user.click(screen.getByRole('button', { name: '编辑走向' }));
    const handle = screen.getByRole('button', { name: '拖动连线节点 1' });
    fireEvent.pointerDown(handle, { clientX: 420, clientY: 52, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 420, clientY: 132, pointerId: 1, buttons: 1 });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('手动路线被节点阻挡'));
  });

  it('keeps edge endpoints fixed while saving a manually dragged route segment', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, size: { width: 240, height: 104 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, size: { width: 240, height: 104 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-a', presentation: {
        sourceAnchor: { side: 'RIGHT', offset: 0.5 },
        targetAnchor: { side: 'LEFT', offset: 0.5 },
      } }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-a'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
    await user.click(screen.getByRole('button', { name: '编辑走向' }));
    expect(screen.queryByRole('toolbar', { name: '连线样式' })).not.toBeInTheDocument();
    expect(reactFlowCallbacks.edges[0]?.data).toMatchObject({
      route: { points: [{ x: 240, y: 52 }, { x: 360, y: 52 }] },
    });
    const segment = await screen.findByRole('button', { name: '拖动连线节点 1' });
    expect(segment.closest('.canvas-screen-overlay')).not.toBeNull();
    fireEvent.pointerDown(segment, { clientX: 300, clientY: 132, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 173, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 173, pointerId: 1, button: 0 });
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    const saved = (api.saveGuide as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2].document as CanvasDocument;
    const savedEdge = saved.edges.find((edge) => edge.id === 'business');
    expect(savedEdge?.presentation).toEqual(expect.objectContaining({
      routing: 'elbow',
      routeMode: 'manual',
      waypoints: expect.arrayContaining([expect.objectContaining({ y: 180 })]),
      sourceAnchor: { side: 'RIGHT', offset: 0.5 },
      targetAnchor: { side: 'LEFT', offset: 0.5 },
    }));
  });

  it('deletes a selected business edge with Delete', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-a' }],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      entryNodeId: 'start',
      exitNodeIds: ['process-a'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
    expect(screen.getByRole('toolbar', { name: '连线样式' })).toBeVisible();
    fireEvent.keyDown(window, { key: 'Delete' });
    await userEvent.setup().click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ edges: [] }),
    }));
  });

  it('keeps selected-edge controls in a screen-sized overlay while the viewport moves', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-a', type: 'process', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-a' }],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      entryNodeId: 'start',
      exitNodeIds: ['process-a'],
    };
    render(<GuideEditor guideId="guide-host" api={createApi({ document })} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
    const toolbar = screen.getByRole('toolbar', { name: '连线样式' });
    expect(toolbar).toHaveAttribute('data-size', 'screen');
    expect(within(screen.getByTestId('viewport-portal')).queryByRole('toolbar', { name: '连线样式' })).not.toBeInTheDocument();

    const overlay = toolbar.parentElement!;
    const beforeMove = overlay.getAttribute('style');
    act(() => reactFlowCallbacks.onMove?.(null, { x: 120, y: 80, zoom: 0.6 }));
    expect(overlay.getAttribute('style')).not.toBe(beforeMove);
    expect(overlay.style.transform).not.toContain('scale');
  });

  it('starts the business-flow panel collapsed and expands it from the canvas edge', async () => {
    const user = userEvent.setup();
    render(<GuideEditor guideId="guide-host" api={createApi()} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    expect(screen.queryByRole('tree', { name: '流程结构' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开业务流程' }));
    expect(screen.getByRole('tree', { name: '流程结构' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '收起业务流程' }));
    expect(screen.queryByRole('tree', { name: '流程结构' })).not.toBeInTheDocument();
  });

  it('reconnects a business edge with semantic handles and anchored endpoints', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'decision-b', type: 'decision', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '是否通过？', shape: 'decision', branchLabels: ['是', '否'] } },
        { id: 'process-c', type: 'process', position: { x: 720, y: 0 }, zIndex: 2, data: { label: '后续处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-c' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-c'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onReconnect?.(reactFlowCallbacks.edges[0]!, {
      source: 'decision-b', sourceHandle: 'anchor-source-RIGHT', target: 'process-c', targetHandle: 'anchor-target-LEFT',
    }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ edges: [expect.objectContaining({
        id: 'business', source: 'decision-b', sourceHandle: 'yes', target: 'process-c', targetHandle: 'in',
        presentation: {
          sourceAnchor: { side: 'RIGHT', offset: 0.5 },
          sourceAnchorMode: 'manual',
          targetAnchor: { side: 'LEFT', offset: 0.5 },
          targetAnchorMode: 'manual',
        },
      })] }),
    }));
  });

  it('reconnects a persisted edge to Markdown material', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process', type: 'process', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
        { id: 'note', type: 'markdown', position: { x: 720, y: 0 }, zIndex: 2, data: { markdown: '共享说明资料' } },
      ],
      edges: [{ id: 'edge', source: 'start', target: 'process' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process'],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onReconnect?.(reactFlowCallbacks.edges[0]!, {
      source: 'start', sourceHandle: 'out', target: 'note', targetHandle: 'in',
    }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ edges: [expect.objectContaining({ id: 'edge', source: 'start', target: 'note', sourceHandle: 'out', targetHandle: 'in' })] }),
    }));
  });

  it('persists the target on the exact right-side drop point after reconnecting', async () => {
    const edgeDocument: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
        { id: 'process-c', type: 'process', position: { x: 720, y: 0 }, zIndex: 1, data: { label: '后续处理', shape: 'process' } },
      ],
      edges: [{ id: 'business', source: 'start', target: 'process-c' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-c'],
    };
    const api = createApi({ document: edgeDocument });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    const target = globalThis.document.querySelector<HTMLElement>('.react-flow__node[data-id="process-c"]')!;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 720, top: 0, width: 240, height: 104 } as DOMRect);

    act(() => reactFlowCallbacks.onReconnectStart?.({} as MouseEvent, reactFlowCallbacks.edges[0]!, 'source'));
    act(() => reactFlowCallbacks.onConnectStart?.({ clientX: 0, clientY: 0 } as MouseEvent, { nodeId: 'start', handleId: 'out', handleType: 'source' }));
    act(() => reactFlowCallbacks.onConnect?.({ source: 'start', sourceHandle: 'out', target: 'process-c', targetHandle: 'anchor-target-RIGHT' }));
    act(() => reactFlowCallbacks.onConnectEnd?.({ clientX: 960, clientY: 52 } as MouseEvent, { toNode: { id: 'process-c' } }));
    act(() => reactFlowCallbacks.onReconnectEnd?.({ clientX: 960, clientY: 52 } as MouseEvent, reactFlowCallbacks.edges[0]!, 'source', { toNode: { id: 'process-c' } }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ edges: [expect.objectContaining({
        id: 'business', presentation: expect.objectContaining({ targetAnchor: { side: 'RIGHT', offset: 0.5 }, targetAnchorMode: 'manual' }),
      })] }),
    }));
  });

  it('exposes edge controls for a persisted content reference edge', async () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
        { id: 'note', type: 'markdown', position: { x: 360, y: 0 }, zIndex: 1, data: { markdown: '资料' } },
      ],
      edges: [{ id: 'attachment', source: 'process', target: 'note' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    render(<GuideEditor guideId="guide-host" api={createApi({ document })} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
    expect(screen.getByRole('toolbar', { name: '连线样式' })).toBeVisible();
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
    openHierarchyPanel();

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

  it('asks before toolbar or keyboard deletion removes an image that contains annotations', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{
        id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0,
        data: {
          url: 'https://example.com/erp.png', alt: 'ERP 页面',
          annotations: [{ id: 'annotation-1', order: 0, title: '客户字段', shape: 'POINT', region: { x: 0.2, y: 0.4 } }],
        },
      }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const api = createApi({ document });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();
    await user.click(screen.getByRole('button', { name: '选择资料 ERP 页面' }));

    await user.click(screen.getByRole('button', { name: '删除选中项' }));
    expect(screen.getByRole('dialog', { name: '确认删除带标注的图片' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消删除' }));
    expect(api.saveGuide).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByRole('dialog', { name: '确认删除带标注的图片' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: [] }),
    }));
  });

  it('asks before replacing an annotated image and does not upload when canceled', async () => {
    const user = userEvent.setup();
    const api = createApi({ document: imageDocumentWithAnnotation() });
    (api.uploadMedia as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'asset-new', url: '/api/media/asset-new', kind: 'IMAGE' });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();
    await user.click(screen.getByRole('button', { name: '选择资料 旧图片说明' }));

    await user.upload(screen.getByLabelText('上传图片'), new File(['new'], 'new.png', { type: 'image/png' }));
    expect(screen.getByRole('dialog', { name: '确认替换带标注的图片' })).toBeInTheDocument();
    expect(api.uploadMedia).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '取消替换' }));
    expect(api.uploadMedia).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: [expect.objectContaining({ data: expect.objectContaining({ url: 'https://example.com/erp.png', annotations: expect.any(Array) }) })] }),
    }));
  });

  it('uploads only after confirmation and clears annotations in the saved replacement revision', async () => {
    const user = userEvent.setup();
    const api = createApi({ document: imageDocumentWithAnnotation() });
    (api.uploadMedia as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'asset-new', url: '/api/media/asset-new', kind: 'IMAGE' });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();
    await user.click(screen.getByRole('button', { name: '选择资料 旧图片说明' }));

    await user.upload(screen.getByLabelText('上传图片'), new File(['new'], 'new.png', { type: 'image/png' }));
    expect(api.uploadMedia).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认并上传' }));
    await waitFor(() => expect(api.uploadMedia).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: [expect.objectContaining({ data: expect.objectContaining({ assetId: 'asset-new', url: '/api/media/asset-new', annotations: [] }) })] }),
    })));
  });

  it('saves a dirty annotated-image snapshot before uploading its replacement', async () => {
    const user = userEvent.setup();
    const api = createApi({ document: imageDocumentWithAnnotation() });
    (api.uploadMedia as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'asset-new', url: '/api/media/asset-new', kind: 'IMAGE' });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();
    await user.click(screen.getByRole('button', { name: '选择资料 旧图片说明' }));
    fireEvent.change(screen.getByLabelText('图片说明'), { target: { value: '刚刚更新的旧说明' } });

    await user.upload(screen.getByLabelText('上传图片'), new File(['new'], 'new.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: '确认并上传' }));
    await waitFor(() => expect(api.uploadMedia).toHaveBeenCalledTimes(1));

    const saveGuide = api.saveGuide as ReturnType<typeof vi.fn>;
    const uploadMedia = api.uploadMedia as ReturnType<typeof vi.fn>;
    expect(saveGuide).toHaveBeenCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: [expect.objectContaining({ data: expect.objectContaining({ url: 'https://example.com/erp.png', caption: '刚刚更新的旧说明', annotations: expect.any(Array) }) })] }),
    }));
    expect(saveGuide.mock.invocationCallOrder[0]!).toBeLessThan(uploadMedia.mock.invocationCallOrder[0]!);
  });

  it('keeps the current image and annotations when replacement upload fails', async () => {
    const user = userEvent.setup();
    const api = createApi({ document: imageDocumentWithAnnotation() });
    (api.uploadMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('上传失败'));
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();
    await user.click(screen.getByRole('button', { name: '选择资料 旧图片说明' }));

    await user.upload(screen.getByLabelText('上传图片'), new File(['new'], 'new.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: '确认并上传' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('上传失败');
    expect(api.saveGuide).not.toHaveBeenCalled();
    expect(api.uploadMedia).toHaveBeenCalledTimes(1);
  });

  it('loads draft history and restores a selected revision through a separate confirmation', async () => {
    const user = userEvent.setup();
    const api = createApi();
    const restoredDocument = sampleEditorDocument('恢复后的内容');
    (api.listDraftHistory as ReturnType<typeof vi.fn>).mockResolvedValue([{
      revision: 2,
      title: '订单教学',
      summary: '误删图片前',
      tags: ['ERP'],
      savedAt: '2026-07-19T01:00:00.000Z',
      savedBy: { id: 'author', displayName: '王作者' },
    }]);
    (api.restoreDraft as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...structuredClone(emptyGuide), revision: 4, document: restoredDocument,
    });
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    await user.click(screen.getByRole('button', { name: '草稿历史' }));
    await user.click(await screen.findByRole('button', { name: '恢复 revision 2' }));
    expect(api.restoreDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认恢复' }));
    await waitFor(() => expect(api.restoreDraft).toHaveBeenCalledWith('guide-host', 2, 0));
    expect(screen.getByText('恢复后的内容')).toBeInTheDocument();
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
    openHierarchyPanel();

    await user.click(screen.getByRole('button', { name: '选择流程节点 操作步骤' }));
    await user.type(screen.getByRole('textbox', { name: '节点明细' }), '填写售达方、物料和交货日期。');
    expect(await screen.findByTestId('flow-description-process-a')).toHaveClass('flow-description');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({ document: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'process-a', data: expect.objectContaining({ description: '填写售达方、物料和交货日期。' }) })] }) }));
  });

  it('opens the solid detail dialog from React Flow node double-click events', async () => {
    const canvasDocument: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{ id: 'process-a', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '操作步骤', description: '第一行\n第二行', shape: 'process' } }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    render(<GuideEditor guideId="guide-host" api={createApi({ document: canvasDocument })} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');

    const trigger = document.createElement('button');
    act(() => reactFlowCallbacks.onNodeDoubleClick?.({ target: trigger, currentTarget: trigger }, { id: 'process-a' }));

    expect(screen.getByRole('dialog', { name: '编辑节点明细' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '操作步骤 · 节点明细' })).toHaveValue('第一行\n第二行');
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

  it('adopts a newer pinned subguide version only when the editor chooses it', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [{
        id: 'subguide-version-source', type: 'subguide', position: { x: 0, y: 0 }, zIndex: 0,
        data: { guideId: 'guide-source', guideVersionId: 'version-source', title: '物料主数据检查', version: 1, expanded: false },
      }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const newerVersion: GuideVersionSnapshot = { ...sourceVersion, id: 'version-source-v2', version: 2, title: '物料主数据检查（新版）' };
    const api = createApi({ document });
    (api.referenceUpdates as ReturnType<typeof vi.fn>).mockResolvedValue([{
      referenceNodeId: 'subguide-version-source', sourceGuideId: 'guide-source',
      currentVersionId: 'version-source', currentVersion: 1, currentTitle: '物料主数据检查',
      latestVersionId: 'version-source-v2', latestVersion: 2, latestTitle: '物料主数据检查（新版）',
    }]);
    (api.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(newerVersion);
    render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
    await screen.findByDisplayValue('订单教学');
    openHierarchyPanel();
    await user.click(screen.getByRole('button', { name: '选择流程节点 物料主数据检查' }));
    await user.click(await screen.findByRole('button', { name: '采用 物料主数据检查（新版） v2' }));

    expect(api.getVersion).toHaveBeenCalledWith('version-source-v2');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: [expect.objectContaining({
        id: 'subguide-version-source',
        data: expect.objectContaining({ guideVersionId: 'version-source-v2', version: 2, expanded: false }),
      })] }),
    })));
  });
});

function createApi(overrides: { document?: CanvasDocument } = {}): EditorApi & Record<string, ReturnType<typeof vi.fn>> {
  const guide = { ...structuredClone(emptyGuide), document: overrides.document ?? structuredClone(emptyGuide.document) };
  return {
    getGuide: vi.fn().mockResolvedValue(guide),
    saveGuide: vi.fn().mockResolvedValue({ ...guide, revision: 1 }),
    listDraftHistory: vi.fn().mockResolvedValue([]),
    restoreDraft: vi.fn().mockResolvedValue({ ...guide, revision: 1 }),
    publishGuide: vi.fn().mockResolvedValue(sourceVersion),
    getFlowSnapshotStatus: vi.fn().mockResolvedValue({ guideRevision: 0, sourceStatus: 'READY', snapshotId: 'snapshot-0', snapshotRevision: 0, snapshotSchemaVersion: 2, failureCode: null }),
    reconcileFlowSnapshot: vi.fn(),
    createGuideDigestProposal: vi.fn().mockResolvedValue({}),
    listGuideDigestProposals: vi.fn().mockResolvedValue([]),
    getGuideDigestProposal: vi.fn(),
    rejectGuideDigestProposal: vi.fn(),
    applyGuideDigestProposal: vi.fn(),
    listFlowRegressionCases: vi.fn().mockResolvedValue([]),
    replayFlowRegressionCase: vi.fn(),
    archiveFlowRegressionCase: vi.fn(),
    createFlowRegressionRealRun: vi.fn(),
    getFlowAnnotationHealth: vi.fn().mockResolvedValue({ snapshotId: 'snapshot-0', issues: [] }),
    search: vi.fn().mockResolvedValue({ items: [{ versionId: 'version-source', guideId: 'guide-source', workspaceId: 'workspace-materials', workspaceItemId: 'item-guide-source', workspaceName: '物料管理', favorite: false, canManageLifecycle: false, title: '物料主数据检查', summary: '', tags: ['物料'], version: 1, authorName: '王作者' }], nextOffset: null }),
    referenceUpdates: vi.fn().mockResolvedValue([]),
    getVersion: vi.fn().mockResolvedValue(sourceVersion),
    uploadMedia: vi.fn(),
  };
}

function imageDocumentWithAnnotation(): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [{
      id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0,
      data: {
        url: 'https://example.com/erp.png', alt: 'ERP 页面', caption: '旧图片说明',
        annotations: [{ id: 'annotation-1', order: 0, title: '客户字段', shape: 'POINT', region: { x: 0.2, y: 0.4 } }],
      },
    }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
  };
}

function snapshotStatus(revision: number): GuideFlowSnapshotStatus {
  return { guideRevision: revision, sourceStatus: 'READY', snapshotId: `snapshot-${revision}`, snapshotRevision: revision, snapshotSchemaVersion: 2, failureCode: null };
}

function digestProposal(): GuideDigestProposal {
  return {
    id: 'proposal-1', guideId: 'guide-host', workspaceId: 'workspace-sales', baseSnapshotId: 'snapshot-0', baseRevision: 0,
    bundleRevision: 1, rendererVersion: 'guide-digest-markdown-v1', generationMetadata: {}, status: 'DRAFT',
    draft: { schemaVersion: 1, shortSummary: '建议的流程摘要', scope: { audiences: [], businessObjects: [], systems: [] }, stageSections: [], keyRules: [], tagSuggestions: [], gaps: [] },
    markdown: '# 建议总览', failureCode: null, supersedesProposalId: null, appliedRevision: null,
    selectedSummary: null, acceptedTags: null, acceptedMarkdown: null, createdBy: 'author',
    createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z',
    sourceDescriptors: [],
  };
}

function sampleEditorDocument(markdown: string): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [{ id: 'note', type: 'markdown', position: { x: 0, y: 0 }, zIndex: 0, data: { markdown } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
  };
}

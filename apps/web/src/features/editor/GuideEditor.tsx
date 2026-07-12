import type { CanvasDocument, CanvasEdge, CanvasNode, FlowStage, GuideVersionSnapshot } from '@guideanything/contracts';
import { CanvasDocumentSchema } from '@guideanything/contracts';
import { duplicateSelection, expandSubguide, getStageBounds, HistoryStack, isContentNode, isPrimaryFlowNode, layoutFlowHierarchy, reconcileSubguideEdges, setSubguideExpanded, type HierarchyLayoutResult } from '@guideanything/canvas-core';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SearchItem } from '../library/LibraryPage';
import { FlowNode } from '../nodes/FlowNode';
import { ImageNode } from '../nodes/ImageNode';
import { MarkdownNode } from '../nodes/MarkdownNode';
import { SubguideNode } from '../nodes/SubguideNode';
import { VideoNode } from '../nodes/VideoNode';
import { HierarchyPanel } from './HierarchyPanel';

export interface GuideDraftDetail {
  id: string;
  ownerId: string;
  authorName: string;
  title: string;
  summary: string;
  tags: string[];
  status: string;
  revision: number;
  document: CanvasDocument;
  publishedVersionId: string | null;
  publishedVersion: number | null;
  updatedAt: string;
}

export interface SearchPage {
  items: SearchItem[];
  nextOffset: number | null;
}

export interface EditorApi {
  getGuide: (guideId: string) => Promise<GuideDraftDetail>;
  saveGuide: (guideId: string, revision: number, changes: { title: string; summary: string; tags: string[]; document: CanvasDocument }) => Promise<GuideDraftDetail>;
  publishGuide: (guideId: string) => Promise<GuideVersionSnapshot>;
  search: (query: string, offset?: number) => Promise<SearchPage>;
  getVersion: (versionId: string) => Promise<GuideVersionSnapshot>;
  uploadMedia: (file: File) => Promise<{ id: string; url: string; kind: 'IMAGE' | 'VIDEO' }>;
}

const nodeTypes: NodeTypes = {
  start: FlowNode,
  end: FlowNode,
  process: FlowNode,
  decision: FlowNode,
  data: FlowNode,
  markdown: MarkdownNode,
  image: ImageNode,
  video: VideoNode,
  subguide: SubguideNode,
};

const defaultEdgeOptions = { type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#52705f', strokeWidth: 2 } };
const snapGrid: [number, number] = [20, 20];
const multiSelectionKeyCode = ['Meta', 'Control'];

export function GuideEditor({ guideId, api, onBack }: { guideId: string; api: EditorApi; onBack: () => void }) {
  const [guide, setGuide] = useState<GuideDraftDetail | null>(null);
  const [document, setDocument] = useState<CanvasDocument | null>(null);
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saveState, setSaveState] = useState('未保存');
  const [error, setError] = useState('');
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [referenceResults, setReferenceResults] = useState<SearchItem[]>([]);
  const [referenceSearching, setReferenceSearching] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [layoutPreview, setLayoutPreview] = useState<HierarchyLayoutResult | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const historyRef = useRef<HistoryStack<CanvasDocument> | null>(null);
  const clipboardRef = useRef<string[]>([]);

  useEffect(() => {
    let active = true;
    api.getGuide(guideId).then((loaded) => {
      if (!active) return;
      const validated = CanvasDocumentSchema.parse(loaded.document);
      const normalized = reconcileSubguideEdges(validated);
      setGuide(loaded);
      setDocument(normalized);
      setFlowNodes(toFlowNodes(normalized.nodes));
      setTitle(loaded.title);
      setSummary(loaded.summary);
      setTags(loaded.tags);
      setSaveState('已保存');
      historyRef.current = new HistoryStack(normalized, 80);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '指南载入失败'));
    return () => { active = false; };
  }, [api, guideId]);

  const commit = useCallback((next: CanvasDocument) => {
    const validated = reconcileSubguideEdges(CanvasDocumentSchema.parse(next));
    historyRef.current?.push(validated);
    setLayoutPreview(null);
    setDocument(validated);
    setFlowNodes(toFlowNodes(validated.nodes, selectedIds));
    setSaveState('未保存');
  }, [selectedIds]);

  const renderedDocument = layoutPreview?.document ?? document;
  const flowEdges = useMemo(() => renderedDocument ? [...renderedDocument.edges as Edge[], ...hierarchyPresentationEdges(renderedDocument)] : [], [renderedDocument]);
  const renderedFlowNodes = useMemo(() => layoutPreview ? toFlowNodes(layoutPreview.document.nodes, selectedIds) : flowNodes, [flowNodes, layoutPreview, selectedIds]);
  const stageBounds = useMemo(() => renderedDocument ? getStageBounds(renderedDocument) : [], [renderedDocument]);

  useEffect(() => {
    setFlowNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const selected = selectedIds.includes(node.id);
        if (node.selected === selected) return node;
        changed = true;
        return { ...node, selected };
      });
      return changed ? next : current;
    });
  }, [selectedIds]);

  useEffect(() => {
    if (!referenceOpen) return;
    let active = true;
    const query = referenceQuery.trim();
    const timer = window.setTimeout(() => {
      setReferenceSearching(true);
      setReferenceError('');
      setReferenceResults([]);
      const loadAll = async () => {
        let offset = 0;
        const items: SearchItem[] = [];
        try {
          while (active) {
            const page = await api.search(query, offset);
            if (!active) return;
            items.push(...page.items);
            setReferenceResults([...items]);
            if (page.nextOffset === null || page.nextOffset <= offset) return;
            offset = page.nextOffset;
          }
        } catch (reason: unknown) {
          if (active) setReferenceError(reason instanceof Error ? reason.message : '子指南列表载入失败');
        } finally {
          if (active) setReferenceSearching(false);
        }
      };
      void loadAll();
    }, query ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, referenceOpen, referenceQuery]);

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    if (layoutPreview) return;
    setFlowNodes((current) => applyNodeChanges(changes, current));
    const persistedChanges = persistableNodeChanges(changes);
    if (persistedChanges.length === 0) return;
    setLayoutPreview(null);
    setSaveState('未保存');
    setDocument((current) => {
      if (!current) return current;
      const changed = applyNodeChanges(persistedChanges, toFlowNodes(current.nodes));
      const next = reconcileSubguideEdges(CanvasDocumentSchema.parse(fromFlowNodes(current, changed)));
      historyRef.current?.push(next);
      return next;
    });
  }, [layoutPreview]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    if (layoutPreview) return;
    const persistedChanges = changes.filter((change) => !isHierarchyPresentationChange(change));
    if (persistedChanges.length === 0) return;
    setLayoutPreview(null);
    setSaveState('未保存');
    setDocument((current) => {
      if (!current) return current;
      const edges = applyEdgeChanges(persistedChanges, current.edges as Edge[]);
      const next = reconcileSubguideEdges(CanvasDocumentSchema.parse({ ...current, edges: edges.map(toCanvasEdge) }));
      historyRef.current?.push(next);
      return next;
    });
  }, [layoutPreview]);

  const onConnect = useCallback((connection: Connection) => {
    if (layoutPreview) return;
    setLayoutPreview(null);
    setSaveState('未保存');
    setDocument((current) => {
      if (!current) return current;
      const edges = addEdge({ ...connection, id: uniqueId('edge'), ...defaultEdgeOptions }, current.edges as Edge[]);
      const next = reconcileSubguideEdges(CanvasDocumentSchema.parse({ ...current, edges: edges.map(toCanvasEdge) }));
      historyRef.current?.push(next);
      return next;
    });
  }, [layoutPreview]);

  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
    const next = nodes.map((node) => node.id);
    setSelectedIds((current) => current.length === next.length && current.every((id, index) => id === next[index]) ? current : next);
  }, []);

  const selectAndFocus = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    const nodeId = ids[0];
    if (nodeId) void flowInstance?.fitView({ nodes: [{ id: nodeId }], duration: 280, padding: 0.8, minZoom: 0.25, maxZoom: 1.4 });
  }, [flowInstance]);

  const onMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: CanvasDocument['viewport']) => {
    setDocument((current) => {
      if (!current || (current.viewport.x === viewport.x && current.viewport.y === viewport.y && current.viewport.zoom === viewport.zoom)) return current;
      return { ...current, viewport };
    });
  }, []);

  const addNode = (type: CanvasNode['type']) => {
    if (!document || layoutPreview) return;
    const id = uniqueId(type);
    const created = createNode(id, type, document.nodes.length);
    const selectedPrimary = document.nodes.find((node) => node.id === selectedIds[0] && isPrimaryFlowNode(node));
    const node = isContentNode(created) && selectedPrimary ? { ...created, contentParentId: selectedPrimary.id } : created;
    commit({ ...document, nodes: [...document.nodes, node] });
    setSelectedIds([id]);
  };

  const addStage = () => {
    if (!document || layoutPreview) return;
    const stages = document.stages ?? [];
    const stage: FlowStage = { id: uniqueId('stage'), title: `业务阶段 ${stages.length + 1}`, order: stages.length };
    commit({ ...document, stages: [...stages, stage] });
  };

  const previewLayout = () => {
    if (!document) return;
    setLayoutPreview(layoutFlowHierarchy(document));
  };

  const applyLayoutPreview = () => {
    if (!layoutPreview) return;
    commit(layoutPreview.document);
  };

  const save = useCallback(async () => {
    if (!guide || !document) return;
    setSaveState('保存中…');
    setError('');
    try {
      const clean = CanvasDocumentSchema.parse(document);
      const updated = await api.saveGuide(guide.id, guide.revision, { title, summary, tags, document: clean });
      setGuide((current) => current ? { ...current, revision: updated.revision, status: updated.status } : current);
      setSaveState('已保存');
    } catch (reason) {
      setSaveState('保存失败');
      setError(reason instanceof Error ? reason.message : '保存失败');
      throw reason;
    }
  }, [api, document, guide, summary, tags, title]);

  useEffect(() => {
    if (!guide || !document || saveState !== '未保存') return;
    const timer = window.setTimeout(() => { void save().catch(() => undefined); }, 1_500);
    return () => window.clearTimeout(timer);
  }, [document, guide, save, saveState, summary, tags, title]);

  const publish = async () => {
    try {
      await save();
      const version = await api.publishGuide(guideId);
      setGuide((current) => current ? { ...current, status: 'PUBLISHED', publishedVersionId: version.id, publishedVersion: version.version } : current);
      setSaveState(`已发布 v${version.version}`);
    } catch { /* save surfaces the error */ }
  };

  const undo = useCallback(() => {
    if (layoutPreview || !historyRef.current?.canUndo) return;
    const previous = reconcileSubguideEdges(historyRef.current.undo());
    setDocument(previous);
    setFlowNodes(toFlowNodes(previous.nodes));
    setSaveState('未保存');
  }, [layoutPreview]);
  const redo = useCallback(() => {
    if (layoutPreview || !historyRef.current?.canRedo) return;
    const next = reconcileSubguideEdges(historyRef.current.redo());
    setDocument(next);
    setFlowNodes(toFlowNodes(next.nodes));
    setSaveState('未保存');
  }, [layoutPreview]);

  const copy = useCallback(() => { clipboardRef.current = [...selectedIds]; }, [selectedIds]);
  const paste = useCallback(() => {
    if (!document || layoutPreview || clipboardRef.current.length === 0) return;
    const result = duplicateSelection(document, clipboardRef.current, uniqueId('paste'));
    commit(result.document);
    setSelectedIds(result.newNodeIds);
  }, [commit, document, layoutPreview]);

  const removeSelected = useCallback(() => {
    if (!document || layoutPreview || selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    commit({
      ...document,
      nodes: document.nodes.filter((node) => !selected.has(node.id)).map((node) =>
        !node.source && isContentNode(node) && node.contentParentId && selected.has(node.contentParentId)
          ? { ...node, contentParentId: undefined }
          : node,
      ),
      edges: document.edges.filter((edge) => !selected.has(edge.source) && !selected.has(edge.target)),
      steps: document.steps.filter((step) => !selected.has(step.nodeId)),
      exitNodeIds: document.exitNodeIds.filter((id) => !selected.has(id)),
      ...(document.entryNodeId && selected.has(document.entryNodeId) ? { entryNodeId: undefined } : {}),
    } as CanvasDocument);
    setSelectedIds([]);
  }, [commit, document, layoutPreview, selectedIds]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      else if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (modifier && event.key.toLowerCase() === 'c') copy();
      else if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) removeSelected();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [copy, paste, redo, removeSelected, save, undo]);

  const insertReference = (item: SearchItem) => {
    if (!document || layoutPreview) return;
    const id = `subguide-${item.versionId}`;
    const node: CanvasNode<'subguide'> = {
      id,
      type: 'subguide',
      position: { x: 120 + document.nodes.length * 28, y: 120 + document.nodes.length * 18 },
      zIndex: maxZIndex(document) + 1,
      data: { guideId: item.guideId, guideVersionId: item.versionId, title: item.title, version: item.version, expanded: false },
    };
    commit({ ...document, nodes: [...document.nodes.filter((existing) => existing.id !== id), node] });
    setSelectedIds([id]);
    setReferenceOpen(false);
  };

  const toggleReference = async () => {
    if (!document || layoutPreview) return;
    const selected = document.nodes.find((node) => node.id === selectedIds[0]);
    if (!selected || selected.type !== 'subguide') return;
    if (selected.data.expanded) {
      commit(setSubguideExpanded(document, selected.id, false));
      return;
    }
    const hasDerived = document.nodes.some((node) => node.source?.referenceNodeId === selected.id);
    if (hasDerived) commit(setSubguideExpanded(document, selected.id, true));
    else commit(expandSubguide(document, selected, await api.getVersion(selected.data.guideVersionId)));
  };

  const updateSelectedNode = (next: CanvasNode) => {
    if (!document || layoutPreview) return;
    commit({ ...document, nodes: document.nodes.map((node) => node.id === next.id ? next : node) });
  };

  const addStep = () => {
    if (!document || layoutPreview || !selectedIds[0]) return;
    const node = document.nodes.find((item) => item.id === selectedIds[0]);
    if (!node) return;
    const title = node.type === 'markdown' ? '阅读说明' : node.type === 'video' ? '观看操作演示' : node.type === 'image' ? '查看界面示意' : node.type === 'subguide' ? `完成子指南：${node.data.title}` : node.data.label;
    commit({ ...document, steps: [...document.steps, { id: uniqueId('step'), order: document.steps.length, title, nodeId: node.id }] });
  };

  const alignLeft = () => {
    if (!document || layoutPreview || selectedIds.length < 2) return;
    const selected = new Set(selectedIds);
    const x = Math.min(...document.nodes.filter((node) => selected.has(node.id)).map((node) => node.position.x));
    commit({ ...document, nodes: document.nodes.map((node) => selected.has(node.id) ? { ...node, position: { ...node.position, x } } : node) });
  };

  const moveLayer = (front: boolean) => {
    if (!document || layoutPreview || !selectedIds[0]) return;
    const target = front ? maxZIndex(document) + 1 : Math.min(...document.nodes.map((node) => node.zIndex)) - 1;
    commit({ ...document, nodes: document.nodes.map((node) => selectedIds.includes(node.id) ? { ...node, zIndex: target } : node) });
  };

  if (!guide || !document) return <main className="center-state">{error ? <p className="error-message" role="alert">{error}</p> : <><span className="spinner" /><p>正在载入画布…</p></>}</main>;
  const selectedNode = document.nodes.find((node) => node.id === selectedIds[0]);
  const primaryNodes = document.nodes.filter(isPrimaryFlowNode);
  const stages = [...(document.stages ?? [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  return <main className="editor-page">
    <header className="editor-header">
      <button className="icon-button" type="button" onClick={onBack} aria-label="返回资料库">←</button>
      <div className="editor-title"><input aria-label="指南标题" value={title} onChange={(event) => { setTitle(event.target.value); setSaveState('未保存'); }} /><span aria-live="polite">{guide.status === 'PUBLISHED' ? `已发布 v${guide.publishedVersion ?? 1}` : '草稿'} · {saveState}</span></div>
      <div className="editor-actions"><button className="secondary-button" type="button" onClick={() => void save()} disabled={Boolean(layoutPreview)} aria-label="保存草稿">保存草稿</button><button className="primary-button" type="button" onClick={() => void publish()} disabled={Boolean(layoutPreview)} aria-label="发布指南">发布指南</button></div>
    </header>
    <div className="editor-toolbar" aria-label="画布工具栏">
      <button type="button" onClick={() => addNode('start')} disabled={Boolean(layoutPreview)} aria-label="添加开始节点">开始</button>
      <button type="button" onClick={() => addNode('process')} disabled={Boolean(layoutPreview)} aria-label="添加流程节点">流程</button>
      <button type="button" onClick={() => addNode('decision')} disabled={Boolean(layoutPreview)} aria-label="添加判断节点">判断</button>
      <button type="button" onClick={() => addNode('data')} disabled={Boolean(layoutPreview)} aria-label="添加数据节点">数据</button>
      <button type="button" onClick={() => addNode('markdown')} disabled={Boolean(layoutPreview)} aria-label="添加 Markdown 节点">Markdown</button>
      <button type="button" onClick={() => addNode('image')} disabled={Boolean(layoutPreview)} aria-label="添加图片节点">图片</button>
      <button type="button" onClick={() => addNode('video')} disabled={Boolean(layoutPreview)} aria-label="添加视频节点">视频</button>
      <span className="toolbar-divider" />
      <button type="button" onClick={undo} disabled={Boolean(layoutPreview) || !historyRef.current?.canUndo} aria-label="撤销">↶</button>
      <button type="button" onClick={redo} disabled={Boolean(layoutPreview) || !historyRef.current?.canRedo} aria-label="重做">↷</button>
      <button type="button" onClick={copy} disabled={selectedIds.length === 0} aria-label="复制选中节点">复制</button>
      <button type="button" onClick={paste} disabled={Boolean(layoutPreview) || clipboardRef.current.length === 0} aria-label="粘贴节点">粘贴</button>
      <button type="button" onClick={alignLeft} disabled={Boolean(layoutPreview) || selectedIds.length < 2} aria-label="左对齐选中节点">左对齐</button>
      <button type="button" onClick={previewLayout} disabled={Boolean(layoutPreview) || document.nodes.length < 2} aria-label="预览自动整理">自动整理</button>
      <button type="button" onClick={() => moveLayer(true)} disabled={Boolean(layoutPreview) || selectedIds.length === 0} aria-label="置于顶层">置顶</button>
      <button type="button" onClick={() => moveLayer(false)} disabled={Boolean(layoutPreview) || selectedIds.length === 0} aria-label="置于底层">置底</button>
      <button type="button" onClick={removeSelected} disabled={Boolean(layoutPreview) || selectedIds.length === 0} aria-label="删除选中项">删除</button>
      <span className="toolbar-divider" />
      <button type="button" className="reference-button" onClick={() => { setReferenceQuery(''); setReferenceResults([]); setReferenceError(''); setReferenceSearching(true); setReferenceOpen(true); }} disabled={Boolean(layoutPreview)} aria-label="插入子指南">＋ 插入子指南</button>
      {layoutPreview ? <div className="layout-preview" role="status"><div className="layout-preview-copy"><span>已按入口从左到右整理</span><div className="layout-preview-summary"><span>主流程 {layoutPreview.report.primaryNodeIds.length}</span><span>阶段 {layoutPreview.report.stageCount}</span><span>已挂靠资料 {layoutPreview.report.attachedContentIds.length}</span><span>未挂靠资料 {layoutPreview.report.unassignedContentIds.length}</span><span>孤立节点 {layoutPreview.report.unconnectedPrimaryIds.length}</span><span>循环 {layoutPreview.report.cycleNodeIds.length}</span></div><span className="layout-preview-rule">入口 → 阶段泳道 → 资料</span></div><button type="button" onClick={applyLayoutPreview} aria-label="应用自动整理">应用自动整理</button><button type="button" onClick={() => setLayoutPreview(null)} aria-label="取消自动整理">取消</button></div> : null}
    </div>
    <div className="editor-workspace">
      <HierarchyPanel document={document} selectedIds={selectedIds} onSelect={selectAndFocus} onAddStage={addStage} editingLocked={Boolean(layoutPreview)} />
      <section className="canvas-shell" aria-label="无限画布编辑区">
        <ReactFlow
          nodes={renderedFlowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onMoveEnd={onMoveEnd}
          onInit={setFlowInstance}
          defaultViewport={document.viewport}
          fitView={document.nodes.length > 0}
          snapToGrid
          snapGrid={snapGrid}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={multiSelectionKeyCode}
          minZoom={0.1}
          maxZoom={2.5}
          nodesDraggable={!layoutPreview}
          nodesConnectable={!layoutPreview}
          edgesFocusable={!layoutPreview}
          elementsSelectable={!layoutPreview}
        >
          <ViewportPortal>
            {stageBounds.map((bound) => <div key={bound.stageId ?? 'none'} className="stage-lane" style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height }}><span>{bound.title}</span></div>)}
          </ViewportPortal>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#a8b3aa" />
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </section>
      <aside className="inspector" aria-label="属性与教学步骤">
        <div><span className="eyebrow">GUIDE DETAILS</span><label>摘要<textarea value={summary} onChange={(event) => { setSummary(event.target.value); setSaveState('未保存'); }} /></label><label>标签<input value={tags.join('，')} onChange={(event) => setTags(event.target.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean))} /></label></div>
        <hr />
        {selectedNode ? <NodeInspector node={selectedNode} primaryNodes={primaryNodes} stages={stages} onChange={updateSelectedNode} onToggleReference={() => void toggleReference()} onAddStep={addStep} api={api} locked={Boolean(layoutPreview)} /> : <div className="inspector-empty"><strong>选择一个节点</strong><p>在这里编辑内容、媒体、步骤和子指南。</p></div>}
        <hr />
        <div className="step-summary"><div><span className="eyebrow">LESSON PATH</span><strong>{document.steps.length} 个教学步骤</strong></div>{[...document.steps].sort((a, b) => a.order - b.order).map((step, index) => <div className="step-row" key={step.id}><span>{index + 1}</span><p>{step.title}</p></div>)}</div>
      </aside>
    </div>
    {error ? <div className="toast-error" role="alert">{error}</div> : null}
    {referenceOpen ? <div className="modal-backdrop" role="presentation"><section className="reference-modal" role="dialog" aria-modal="true" aria-labelledby="reference-title"><button className="modal-close" onClick={() => { setReferenceOpen(false); setReferenceSearching(false); }} aria-label="关闭子指南搜索">×</button><span className="eyebrow">REUSE PUBLISHED GUIDE</span><h2 id="reference-title">插入固定版本子指南</h2><p>打开后会载入全部已发布指南；输入标题、标签或内容关键词即可即时筛选。</p><label className="sr-only" htmlFor="reference-search">搜索可复用指南</label><input id="reference-search" type="search" autoFocus placeholder="例如：物料、销售订单、VA01" aria-label="搜索可复用指南" value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} /><div className="reference-results" aria-live="polite">{referenceSearching ? <p className="status-line">正在载入可复用指南…</p> : null}{referenceError ? <p className="error-message" role="alert">{referenceError}</p> : null}{!referenceSearching && !referenceError && referenceResults.length === 0 ? <p className="muted">没有找到可引用的已发布指南。</p> : null}{referenceResults.map((item) => <article key={item.versionId}><div><strong>{item.title}</strong><span>v{item.version} · {item.authorName}</span></div><button className="secondary-button" type="button" onClick={() => insertReference(item)} aria-label={`插入 ${item.title}`}>插入</button></article>)}</div></section></div> : null}
  </main>;
}

function NodeInspector({ node, primaryNodes, stages, onChange, onToggleReference, onAddStep, api, locked }: { node: CanvasNode; primaryNodes: CanvasNode[]; stages: FlowStage[]; onChange: (node: CanvasNode) => void; onToggleReference: () => void; onAddStep: () => void; api: EditorApi; locked: boolean }) {
  const updateData = (data: CanvasNode['data']) => onChange({ ...node, data } as CanvasNode);
  return <fieldset className="node-inspector" disabled={locked}><div className="inspector-node-heading"><span>{node.type.toUpperCase()}</span><code>{node.id.slice(0, 18)}</code></div>
    {['start', 'end', 'process', 'decision', 'data'].includes(node.type) ? <label>节点标题<input value={(node.data as CanvasNode<'process'>['data']).label} onChange={(event) => updateData({ ...node.data, label: event.target.value } as CanvasNode['data'])} /></label> : null}
    {node.type === 'markdown' ? <label>Markdown<textarea rows={12} value={node.data.markdown} onChange={(event) => updateData({ markdown: event.target.value })} /></label> : null}
    {node.type === 'image' ? <><label>图片地址<input value={node.data.url} onChange={(event) => updateData({ ...node.data, url: event.target.value })} /></label><label>替代文字<input value={node.data.alt} onChange={(event) => updateData({ ...node.data, alt: event.target.value })} /></label><label>图片说明<textarea value={node.data.caption ?? ''} onChange={(event) => updateData({ ...node.data, caption: event.target.value })} /></label><label className="upload-label">上传图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const asset = await api.uploadMedia(file); updateData({ ...node.data, assetId: asset.id, url: asset.url }); }} /></label></> : null}
    {node.type === 'video' ? <><label>视频地址<input value={node.data.url} onChange={(event) => updateData({ ...node.data, url: event.target.value })} /></label><label>视频说明<textarea value={node.data.caption ?? ''} onChange={(event) => updateData({ ...node.data, caption: event.target.value })} /></label><div className="keypoint-editor">{node.data.keypoints.map((point, index) => <div key={point.id}><input aria-label={`关键点 ${index + 1} 标题`} value={point.title} onChange={(event) => updateData({ ...node.data, keypoints: node.data.keypoints.map((item) => item.id === point.id ? { ...item, title: event.target.value } : item) })} /><input type="number" min="0" aria-label={`关键点 ${index + 1} 秒数`} value={point.timeSeconds} onChange={(event) => updateData({ ...node.data, keypoints: node.data.keypoints.map((item) => item.id === point.id ? { ...item, timeSeconds: Number(event.target.value) } : item) })} /></div>)}<button type="button" onClick={() => updateData({ ...node.data, keypoints: [...node.data.keypoints, { id: uniqueId('keypoint'), title: '新关键点', timeSeconds: 0 }] })}>添加视频关键点</button></div><label className="upload-label">上传视频<input type="file" accept="video/mp4,video/webm" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const asset = await api.uploadMedia(file); updateData({ ...node.data, assetId: asset.id, url: asset.url }); }} /></label></> : null}
    {node.type === 'subguide' ? <><div className="pinned-version"><strong>{node.data.title}</strong><span>固定版本 v{node.data.version}</span></div><button className="secondary-button" type="button" onClick={onToggleReference} aria-label={node.data.expanded ? '折叠子指南' : '展开子指南'}>{node.data.expanded ? '折叠子指南' : '展开子指南'}</button></> : null}
    {isPrimaryFlowNode(node) ? <label>所属业务阶段<select value={node.stageId ?? ''} onChange={(event) => onChange({ ...node, stageId: event.target.value || undefined })}><option value="">未分阶段</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label> : null}
    {isContentNode(node) ? <label>挂靠到流程节点<select value={node.contentParentId ?? ''} onChange={(event) => onChange({ ...node, contentParentId: event.target.value || undefined })}><option value="">未挂靠</option>{primaryNodes.map((primary) => <option key={primary.id} value={primary.id}>{nodeLabel(primary)}</option>)}</select></label> : null}
    <button className="secondary-button" type="button" onClick={onAddStep}>加入教学步骤</button>
  </fieldset>;
}

function createNode(id: string, type: CanvasNode['type'], index: number): CanvasNode {
  const position = { x: 80 + (index % 3) * 380, y: 80 + Math.floor(index / 3) * 300 };
  const base = { id, type, position, zIndex: index + 1 };
  switch (type) {
    case 'start': return { ...base, type, data: { label: '开始', shape: 'start' } };
    case 'end': return { ...base, type, data: { label: '结束', shape: 'end' } };
    case 'process': return { ...base, type, data: { label: '操作步骤', shape: 'process' } };
    case 'decision': return { ...base, type, data: { label: '条件成立？', shape: 'decision', branchLabels: ['是', '否'] } };
    case 'data': return { ...base, type, data: { label: '业务数据', shape: 'data' } };
    case 'markdown': return { ...base, type, data: { markdown: '## 操作说明\n\n在这里填写 ERP 操作步骤和字段规则。' } };
    case 'image': return { ...base, type, data: { url: 'https://placehold.co/640x360/png?text=ERP+Screenshot', alt: 'ERP 操作界面截图', caption: '点击右侧属性面板上传真实截图。' } };
    case 'video': return { ...base, type, data: { url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', caption: 'ERP 操作演示', keypoints: [] } };
    case 'subguide': throw new Error('subguide nodes must be created from a published version');
  }
}

export function persistableNodeChanges(changes: NodeChange<Node>[]): NodeChange<Node>[] {
  return changes.filter((change) =>
    change.type === 'remove' ||
    (change.type === 'position' && change.dragging !== true) ||
    (change.type === 'dimensions' && change.resizing === false && Boolean(change.dimensions)),
  );
}

export function toFlowNodes(nodes: CanvasDocument['nodes'], selectedIds: string[] = []): Node[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: node.data as unknown as Record<string, unknown>,
    ...(node.hidden === undefined ? {} : { hidden: node.hidden }),
    zIndex: node.zIndex,
    className: node.contentParentId ? 'context-node' : 'primary-node',
    selected: selectedIds.includes(node.id),
    ...(node.size ? { measured: { width: node.size.width, height: node.size.height } } : {}),
  }));
}

export function hierarchyPresentationEdges(document: CanvasDocument): Edge[] {
  return document.nodes.filter((node) => isContentNode(node) && node.contentParentId && !node.hidden).map((node) => ({
    id: `hierarchy:${node.id}`,
    source: node.contentParentId!,
    target: node.id,
    type: 'smoothstep',
    selectable: false,
    style: { stroke: '#9a6a42', strokeDasharray: '5 5', strokeWidth: 1.5 },
  }));
}

function isHierarchyPresentationChange(change: EdgeChange<Edge>): boolean {
  return ('id' in change && change.id.startsWith('hierarchy:'))
    || ('item' in change && change.item.id.startsWith('hierarchy:'));
}

function fromFlowNodes(document: CanvasDocument, nodes: Node[]): CanvasDocument {
  const existing = new Map(document.nodes.map((node) => [node.id, node]));
  return {
    ...document,
    nodes: nodes.map((node) => {
      const source = existing.get(node.id)!;
      const width = node.width ?? node.measured?.width;
      const height = node.height ?? node.measured?.height;
      return {
        ...source,
        position: node.position,
        zIndex: node.zIndex ?? source.zIndex,
        ...(node.hidden === undefined ? {} : { hidden: node.hidden }),
        ...(width && height ? { size: { width, height } } : {}),
      };
    }),
  };
}

export function toCanvasEdge(edge: Edge): CanvasEdge {
  const sourceTrace = (edge as Edge & Pick<CanvasEdge, 'sourceTrace'>).sourceTrace;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
    ...(edge.hidden === undefined ? {} : { hidden: edge.hidden }),
    ...(sourceTrace ? { sourceTrace } : {}),
  };
}

function maxZIndex(document: CanvasDocument): number {
  return document.nodes.reduce((maximum, node) => Math.max(maximum, node.zIndex), 0);
}

function uniqueId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function nodeLabel(node: CanvasNode): string {
  if (node.type === 'subguide') return node.data.title;
  if (node.type === 'markdown') return node.data.markdown.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 80) || 'Markdown 说明';
  if (node.type === 'image') return node.data.caption || node.data.alt;
  if (node.type === 'video') return node.data.caption || '视频资料';
  return node.data.label;
}

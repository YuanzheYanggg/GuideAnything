import type { CanvasDocument, CanvasNode, FlowLane, FlowStage, GuideVersionSnapshot } from '@guideanything/contracts';
import { routeCanvasEdges } from '@guideanything/canvas-core';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MarkdownNodeView } from '../nodes/MarkdownNode';
import { VideoNodeView } from '../nodes/VideoNode';
import { useMediaSource } from '../nodes/useMediaSource';
import { AppearanceToggle } from '../theme/AppearanceToggle';
import { OrthogonalEdge } from '../editor/OrthogonalEdge';
import type { PersonalApi } from '../workspace/types';
import { MediaLightbox, type MediaPreview } from './MediaLightbox';

export interface LessonApi {
  getVersion: (versionId: string) => Promise<GuideVersionSnapshot>;
}

export function resolveStepStage(document: CanvasDocument, nodeId: string): FlowStage | null {
  const node = document.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const ownerId = node.source?.referenceNodeId ?? node.contentParentId ?? nodeId;
  const owner = document.nodes.find((item) => item.id === ownerId);
  if (!owner || owner.source) return null;
  return document.stages?.find((stage) => stage.id === owner.stageId) ?? null;
}

export function resolveStepLane(document: CanvasDocument, nodeId: string): FlowLane | null {
  const node = document.nodes.find((item) => item.id === nodeId);
  const ownerId = node?.source?.referenceNodeId ?? node?.contentParentId ?? nodeId;
  const owner = document.nodes.find((item) => item.id === ownerId);
  return owner && !owner.source && owner.laneId
    ? document.lanes?.find((lane) => lane.id === owner.laneId) ?? null
    : null;
}

export function resourcesForStep(document: CanvasDocument, nodeId: string): CanvasNode[] {
  return document.nodes.filter((node) =>
    !node.hidden
    && !node.source
    && node.contentParentId === nodeId
    && (node.type === 'markdown' || node.type === 'image' || node.type === 'video'),
  );
}

const LessonMapNode = memo(function LessonMapNode({ data, type }: NodeProps) {
  const value = data as Record<string, unknown>;
  const isSubguide = type === 'subguide';
  const activate = () => {
    if (isSubguide && typeof value.onOpenSubguide === 'function') value.onOpenSubguide();
  };
  return <div
    className={`lesson-map-node lesson-map-${type}`}
    role={isSubguide ? 'button' : undefined}
    tabIndex={isSubguide ? 0 : undefined}
    aria-label={isSubguide ? `打开子指南 ${nodeSummary(type, value)}` : undefined}
    onKeyDown={isSubguide ? (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    } : undefined}
  ><Handle className="lesson-map-handle" type="target" position={Position.Left} id="in" /><span>{typeLabel(type)}</span><strong>{nodeSummary(type, value)}</strong>{type === 'decision'
      ? <><Handle className="lesson-map-handle" type="source" position={Position.Right} id="yes" /><Handle className="lesson-map-handle" type="source" position={Position.Bottom} id="no" /></>
      : <Handle className="lesson-map-handle" type="source" position={Position.Right} id="out" />}</div>;
});

const nodeTypes: NodeTypes = {
  start: LessonMapNode, end: LessonMapNode, process: LessonMapNode, decision: LessonMapNode, data: LessonMapNode,
  markdown: LessonMapNode, image: LessonMapNode, video: LessonMapNode, subguide: LessonMapNode,
};
const edgeTypes: EdgeTypes = { orthogonal: OrthogonalEdge };
const edgeOptions = { type: 'orthogonal', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--ga-accent)', strokeWidth: 2 } };

export function toLessonFlowEdges(document: CanvasDocument): Edge[] {
  const routing = routeCanvasEdges(document);
  return document.edges.map((edge) => {
    const route = routing.routesByEdgeId.get(edge.id);
    const source = document.nodes.find((node) => node.id === edge.source);
    return {
      ...edge,
      sourceHandle: edge.sourceHandle ?? (source?.type === 'decision' ? 'yes' : 'out'),
      targetHandle: edge.targetHandle ?? 'in',
      type: route ? 'orthogonal' : 'smoothstep',
      ...(route ? { data: { route } } : {}),
    } as Edge;
  });
}

export function LessonPage({ versionId, api, personalApi, onBack }: { versionId: string; api: LessonApi; personalApi?: PersonalApi; onBack: () => void }) {
  const [versionHistory, setVersionHistory] = useState<GuideVersionSnapshot[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [instance, setInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const [subguideLoading, setSubguideLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewStack, setPreviewStack] = useState<MediaPreview[]>([]);
  const inFlightSubguidesRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    setVersionHistory([]);
    setCurrentIndex(0);
    setError('');
    api.getVersion(versionId)
      .then((result) => {
        if (!active) return;
        setVersionHistory([result]);
        if (personalApi && result.workspaceItemId) void personalApi.recordRecent(result.workspaceItemId, { mode: 'lesson', versionId: result.id });
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '发布版本载入失败'); });
    return () => { active = false; };
  }, [api, personalApi, versionId]);

  const version = versionHistory[versionHistory.length - 1] ?? null;
  const lessonSteps = useMemo(() => version ? [...version.document.steps]
    .sort((a, b) => a.order - b.order)
    .map((step) => ({
      step,
      stage: resolveStepStage(version.document, step.nodeId),
      lane: resolveStepLane(version.document, step.nodeId),
    })) : [], [version]);
  const currentStep = lessonSteps[currentIndex]?.step;
  const currentLane = lessonSteps[currentIndex]?.lane;
  const currentNode = version?.document.nodes.find((node) => node.id === currentStep?.nodeId);
  const currentResources = useMemo(
    () => version && currentNode ? resourcesForStep(version.document, currentNode.id) : [],
    [currentNode, version],
  );
  const currentPreview = previewStack[previewStack.length - 1] ?? null;
  const openPreview = useCallback((node: CanvasNode) => {
    const preview = previewForNode(node);
    if (preview) setPreviewStack([preview]);
  }, []);
  const openAnnotationTarget = useCallback((targetNodeId: string, annotationIndex: number) => {
    if (!version) return;
    const target = version.document.nodes.find((node) => node.id === targetNodeId);
    const targetPreview = target ? previewForNode(target) : null;
    if (!targetPreview) return;
    setPreviewStack((stack) => {
      const source = stack[stack.length - 1];
      const restoredSource = source?.kind === 'image' ? { ...source, initialAnnotationIndex: annotationIndex } : source;
      return [...stack.slice(0, -1), ...(restoredSource ? [restoredSource] : []), targetPreview];
    });
  }, [version]);
  const openSubguide = useCallback(async (guideVersionId: string) => {
    if (inFlightSubguidesRef.current.has(guideVersionId)) return;
    if (versionHistory.some((item) => item.id === guideVersionId)) {
      setError('这个子指南已经在当前学习路径中，无法再次打开。');
      return;
    }
    inFlightSubguidesRef.current.add(guideVersionId);
    setSubguideLoading(true);
    setError('');
    try {
      const childVersion = await api.getVersion(guideVersionId);
      const knownItemIds = new Set(versionHistory.flatMap((item) => item.workspaceItemId ? [item.workspaceItemId] : []));
      if (personalApi && childVersion.workspaceItemId && !knownItemIds.has(childVersion.workspaceItemId)) {
        void personalApi.recordRecent(childVersion.workspaceItemId, { mode: 'lesson', versionId: childVersion.id });
      }
      setVersionHistory((history) => [...history, childVersion]);
      setCurrentIndex(0);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '子指南载入失败');
    } finally {
      inFlightSubguidesRef.current.delete(guideVersionId);
      setSubguideLoading(false);
    }
  }, [api, personalApi, versionHistory]);
  const handleBack = useCallback(() => {
    setError('');
    if (versionHistory.length > 1) {
      setVersionHistory((history) => history.slice(0, -1));
      setCurrentIndex(0);
    } else {
      onBack();
    }
  }, [onBack, versionHistory.length]);
  const flowNodes = useMemo<Node[]>(() => version ? version.document.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: {
      ...(node.data as unknown as Record<string, unknown>),
      ...(node.type === 'subguide' ? { onOpenSubguide: () => void openSubguide(node.data.guideVersionId) } : {}),
    },
    ...(node.hidden === undefined ? {} : { hidden: node.hidden }),
    zIndex: node.zIndex,
    selected: node.id === currentStep?.nodeId,
  })) : [], [currentStep?.nodeId, openSubguide, version]);
  const flowEdges = useMemo<Edge[]>(() => version ? toLessonFlowEdges(version.document) : [], [version]);

  useEffect(() => {
    if (!instance || !currentStep) return;
    void instance.fitView({ nodes: [{ id: currentStep.nodeId }], duration: 280, padding: 1.2, minZoom: 0.45, maxZoom: 1.25 });
  }, [currentStep, instance]);

  useEffect(() => {
    setPreviewStack([]);
  }, [currentStep?.id, version?.id]);

  if (!version) return <main className="center-state">{error ? <p className="error-message" role="alert">{error}</p> : <><span className="spinner" /><p>正在载入教学指南…</p></>}</main>;

  return <main className="lesson-page">
    <header className="lesson-header">
      <button className="icon-button" type="button" onClick={handleBack} aria-label={versionHistory.length > 1 ? '返回上一级指南' : '返回资料库'}>←</button>
      <div><span className="eyebrow">LEARNING MODE · v{version.version}</span><h1>{version.title}</h1></div>
      <div className="lesson-header-actions"><AppearanceToggle /><div className="lesson-progress"><span>{lessonSteps.length ? `步骤 ${currentIndex + 1} / ${lessonSteps.length}` : '尚未编排步骤'}</span><div><i style={{ width: `${lessonSteps.length ? ((currentIndex + 1) / lessonSteps.length) * 100 : 0}%` }} /></div></div></div>
    </header>
    {lessonSteps.length === 0 ? <section className="lesson-empty"><strong>这个发布版本还没有编排教学步骤</strong><p>仍可在画布中查看流程结构；请联系作者补充学习路径。</p><button className="secondary-button" onClick={handleBack}>{versionHistory.length > 1 ? '返回上一级指南' : '返回资料库'}</button></section> : <div className="lesson-layout">
      <aside className="lesson-steps" aria-label="教学步骤">
        <span className="eyebrow">STEP BY STEP</span>
        {lessonSteps.map(({ step, stage }, index) => <div key={step.id}>
          {stage && stage.id !== lessonSteps[index - 1]?.stage?.id ? <div className="lesson-stage-heading" role="heading" aria-level={2}>{stage.title}</div> : null}
          <button type="button" className={index === currentIndex ? 'active' : ''} onClick={() => setCurrentIndex(index)}><span>{index + 1}</span><p>{step.title}</p></button>
        </div>)}
      </aside>
      <section className="lesson-canvas" aria-label="只读流程画布">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={edgeOptions}
          onInit={setInstance}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onlyRenderVisibleElements
          onNodeClick={(_, node) => {
            if (node.type !== 'subguide') return;
            const guideVersionId = (node.data as { guideVersionId?: unknown }).guideVersionId;
            if (typeof guideVersionId === 'string') void openSubguide(guideVersionId);
          }}
          fitView
          minZoom={0.15}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--ga-border-strong)" />
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
      </section>
      <aside key={currentStep?.id} className="lesson-content" aria-label="当前步骤内容" aria-live="polite" data-step-id={currentStep?.id}>
        {subguideLoading ? <p className="status-line">正在打开子指南…</p> : null}
        <div className="lesson-step-meta"><span>步骤 {currentIndex + 1}</span><span className="lesson-step-context"><small>{typeLabel(currentNode?.type)}</small>{currentLane ? <small className="lesson-responsibility-badge">{currentLane.kind === 'ROLE' ? '责任' : '系统'} · {currentLane.title}</small> : null}</span></div>
        <h2>{currentStep?.title}</h2>
        {currentStep?.body ? <p className="lesson-body">{currentStep.body}</p> : null}
        {currentNode ? <CurrentNodeContent node={currentNode} onOpenPreview={openPreview} /> : <p className="error-message">关联节点不存在</p>}
        {currentResources.length > 0 ? <section className="lesson-resources" aria-labelledby="lesson-resources-title">
          <span className="eyebrow">STEP RESOURCES</span>
          <h3 id="lesson-resources-title">本步骤资料</h3>
          {currentResources.map((node) => <CurrentNodeContent key={node.id} node={node} onOpenPreview={openPreview} />)}
        </section> : null}
        <div className="lesson-navigation"><button className="secondary-button" type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>上一步</button><button className="primary-button" type="button" disabled={currentIndex === lessonSteps.length - 1} onClick={() => setCurrentIndex((index) => Math.min(lessonSteps.length - 1, index + 1))}>下一步</button></div>
      </aside>
    </div>}
    {currentPreview ? <MediaLightbox
      preview={currentPreview}
      onClose={() => setPreviewStack([])}
      {...(previewStack.length > 1 ? { onBack: () => setPreviewStack((stack) => stack.slice(0, -1)) } : {})}
      onOpenTarget={openAnnotationTarget}
      isTargetValid={(targetNodeId) => Boolean(version.document.nodes.find((node) => node.id === targetNodeId && node.id !== (currentPreview.kind === 'image' ? currentPreview.node.id : '')))}
      onActivateNode={(node) => {
        if (node.type === 'subguide') {
          setPreviewStack([]);
          void openSubguide(node.data.guideVersionId);
          return;
        }
        const targetIndex = lessonSteps.findIndex(({ step }) => step.nodeId === node.id);
        if (targetIndex >= 0) setCurrentIndex(targetIndex);
        else void instance?.fitView({ nodes: [{ id: node.id }], duration: 280, padding: 1.1, minZoom: 0.4, maxZoom: 1.3 });
        setPreviewStack([]);
      }}
    /> : null}
  </main>;
}

function CurrentNodeContent({ node, onOpenPreview }: { node: CanvasNode; onOpenPreview: (node: CanvasNode) => void }) {
  if (node.type === 'markdown') return <MarkdownNodeView data={node.data} />;
  if (node.type === 'video') return <VideoNodeView data={node.data} />;
  if (node.type === 'image') return <LessonImage node={node} onOpenPreview={() => onOpenPreview(node)} />;
  if (node.type === 'subguide') return <div className="lesson-reference"><span>固定引用 · v{node.data.version}</span><strong>{node.data.title}</strong><p>{node.data.expanded ? '该子指南已在发布快照中展开。' : '这是一个固定版本子指南；作者可在编辑画布中展开查看完整流程。'}</p></div>;
  return <div className="lesson-flow-detail"><span>{typeLabel(node.type)}</span><strong>{node.data.label}</strong>{node.data.description ? <p>{node.data.description}</p> : null}</div>;
}

function LessonImage({ node, onOpenPreview }: { node: CanvasNode<'image'>; onOpenPreview: () => void }) {
  const source = useMediaSource(node.data.url);
  return <figure>{source ? <button className="lesson-media-trigger" type="button" onClick={onOpenPreview} aria-label={`放大查看 ${node.data.alt}`}><img src={source} alt={node.data.alt} /></button> : <p>图片载入失败</p>}<figcaption>{node.data.caption}</figcaption></figure>;
}

function previewForNode(node: CanvasNode): MediaPreview | null {
  if (node.type === 'image') return { kind: 'image', node };
  if (node.type === 'video') return { kind: 'video', node };
  if (node.type === 'markdown') return { kind: 'markdown', node };
  if (node.type === 'subguide') return { kind: 'subguide', node };
  if (node.type === 'start' || node.type === 'end' || node.type === 'process' || node.type === 'decision' || node.type === 'data') return { kind: 'flow', node };
  return null;
}

function typeLabel(type?: string): string {
  return { start: '开始', end: '结束', process: '流程', decision: '判断', data: '数据', markdown: '说明', image: '图片', video: '视频', subguide: '子指南' }[type ?? ''] ?? '内容';
}

function nodeSummary(type: string | undefined, data: Record<string, unknown>): string {
  if (typeof data.label === 'string') return data.label;
  if (type === 'markdown' && typeof data.markdown === 'string') return data.markdown.replace(/^#+\s*/u, '').split('\n')[0] || 'Markdown 说明';
  if (typeof data.title === 'string') return data.title;
  if (typeof data.caption === 'string') return data.caption;
  if (typeof data.alt === 'string') return data.alt;
  return typeLabel(type);
}

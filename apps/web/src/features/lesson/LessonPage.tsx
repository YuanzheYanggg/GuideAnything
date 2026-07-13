import type { CanvasNode, GuideVersionSnapshot } from '@guideanything/contracts';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { MarkdownNodeView } from '../nodes/MarkdownNode';
import { VideoNodeView } from '../nodes/VideoNode';
import { useMediaSource } from '../nodes/useMediaSource';
import { AppearanceToggle } from '../theme/AppearanceToggle';
import type { PersonalApi } from '../workspace/types';

export interface LessonApi {
  getVersion: (versionId: string) => Promise<GuideVersionSnapshot>;
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
  ><span>{typeLabel(type)}</span><strong>{nodeSummary(type, value)}</strong></div>;
});

const nodeTypes: NodeTypes = {
  start: LessonMapNode, end: LessonMapNode, process: LessonMapNode, decision: LessonMapNode, data: LessonMapNode,
  markdown: LessonMapNode, image: LessonMapNode, video: LessonMapNode, subguide: LessonMapNode,
};
const edgeOptions = { type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--ga-accent)', strokeWidth: 2 } };

export function LessonPage({ versionId, api, personalApi, onBack }: { versionId: string; api: LessonApi; personalApi?: PersonalApi; onBack: () => void }) {
  const [versionHistory, setVersionHistory] = useState<GuideVersionSnapshot[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [instance, setInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const [subguideLoading, setSubguideLoading] = useState(false);
  const [error, setError] = useState('');

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
  const steps = useMemo(() => version ? [...version.document.steps].sort((a, b) => a.order - b.order) : [], [version]);
  const currentStep = steps[currentIndex];
  const currentNode = version?.document.nodes.find((node) => node.id === currentStep?.nodeId);
  const openSubguide = useCallback(async (guideVersionId: string) => {
    if (subguideLoading) return;
    if (versionHistory.some((item) => item.id === guideVersionId)) {
      setError('这个子指南已经在当前学习路径中，无法再次打开。');
      return;
    }
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
      setSubguideLoading(false);
    }
  }, [api, personalApi, subguideLoading, versionHistory]);
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
  const flowEdges = useMemo<Edge[]>(() => version ? version.document.edges as Edge[] : [], [version]);

  useEffect(() => {
    if (!instance || !currentStep) return;
    void instance.fitView({ nodes: [{ id: currentStep.nodeId }], duration: 280, padding: 1.2, minZoom: 0.45, maxZoom: 1.25 });
  }, [currentStep, instance]);

  if (!version) return <main className="center-state">{error ? <p className="error-message" role="alert">{error}</p> : <><span className="spinner" /><p>正在载入教学指南…</p></>}</main>;

  return <main className="lesson-page">
    <header className="lesson-header">
      <button className="icon-button" type="button" onClick={handleBack} aria-label={versionHistory.length > 1 ? '返回上一级指南' : '返回资料库'}>←</button>
      <div><span className="eyebrow">LEARNING MODE · v{version.version}</span><h1>{version.title}</h1></div>
      <div className="lesson-header-actions"><AppearanceToggle /><div className="lesson-progress"><span>{steps.length ? `步骤 ${currentIndex + 1} / ${steps.length}` : '尚未编排步骤'}</span><div><i style={{ width: `${steps.length ? ((currentIndex + 1) / steps.length) * 100 : 0}%` }} /></div></div></div>
    </header>
    {steps.length === 0 ? <section className="lesson-empty"><strong>这个发布版本还没有编排教学步骤</strong><p>仍可在画布中查看流程结构；请联系作者补充学习路径。</p><button className="secondary-button" onClick={handleBack}>{versionHistory.length > 1 ? '返回上一级指南' : '返回资料库'}</button></section> : <div className="lesson-layout">
      <aside className="lesson-steps" aria-label="教学步骤">
        <span className="eyebrow">STEP BY STEP</span>
        {steps.map((step, index) => <button key={step.id} type="button" className={index === currentIndex ? 'active' : ''} onClick={() => setCurrentIndex(index)}><span>{index + 1}</span><p>{step.title}</p></button>)}
      </aside>
      <section className="lesson-canvas" aria-label="只读流程画布">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
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
        <div className="lesson-step-meta"><span>步骤 {currentIndex + 1}</span><small>{typeLabel(currentNode?.type)}</small></div>
        <h2>{currentStep?.title}</h2>
        {currentStep?.body ? <p className="lesson-body">{currentStep.body}</p> : null}
        {currentNode ? <CurrentNodeContent node={currentNode} /> : <p className="error-message">关联节点不存在</p>}
        <div className="lesson-navigation"><button className="secondary-button" type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>上一步</button><button className="primary-button" type="button" disabled={currentIndex === steps.length - 1} onClick={() => setCurrentIndex((index) => Math.min(steps.length - 1, index + 1))}>下一步</button></div>
      </aside>
    </div>}
  </main>;
}

function CurrentNodeContent({ node }: { node: CanvasNode }) {
  if (node.type === 'markdown') return <MarkdownNodeView data={node.data} />;
  if (node.type === 'video') return <VideoNodeView data={node.data} />;
  if (node.type === 'image') return <LessonImage node={node} />;
  if (node.type === 'subguide') return <div className="lesson-reference"><span>固定引用 · v{node.data.version}</span><strong>{node.data.title}</strong><p>{node.data.expanded ? '该子指南已在发布快照中展开。' : '这是一个固定版本子指南；作者可在编辑画布中展开查看完整流程。'}</p></div>;
  return <div className="lesson-flow-detail"><span>{typeLabel(node.type)}</span><strong>{node.data.label}</strong>{node.data.description ? <p>{node.data.description}</p> : null}</div>;
}

function LessonImage({ node }: { node: CanvasNode<'image'> }) {
  const source = useMediaSource(node.data.url);
  return <figure>{source ? <img src={source} alt={node.data.alt} /> : <p>图片载入失败</p>}<figcaption>{node.data.caption}</figcaption></figure>;
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

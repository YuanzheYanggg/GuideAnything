import type { CanvasDocument, CanvasNode } from '@guideanything/contracts';
import { defaultCanvasNodeSize, getStageBounds, getSwimlaneBounds, routeCanvasEdges, type OrthogonalRoute } from '@guideanything/canvas-core';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ViewportPortal,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { memo, useMemo, type CSSProperties } from 'react';

import { OrthogonalEdge } from '../editor/OrthogonalEdge';
import { resolveEdgeVisuals } from '../editor/edge-presentation';

type AnchorHandle = {
  id: string;
  type: 'source' | 'target';
  side: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT';
  offset: number;
};

type LessonNodeData = Record<string, unknown> & {
  lessonSize: { width: number; height: number };
  anchorHandles: AnchorHandle[];
  onOpenSubguide?: () => void;
};

const positionBySide = { TOP: Position.Top, RIGHT: Position.Right, BOTTOM: Position.Bottom, LEFT: Position.Left } as const;
const edgeTypes: EdgeTypes = { orthogonal: OrthogonalEdge };
const edgeOptions = { type: 'orthogonal', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--ga-accent)', strokeWidth: 2 } };
const resourceTypes = new Set<CanvasNode['type']>(['markdown', 'image', 'video']);

export function physicalLessonHandleId(edgeId: string, end: 'source' | 'target'): string {
  return `edge:${edgeId}:${end}`;
}

export function isHiddenResourceNode(node: CanvasNode): boolean {
  return !node.source && resourceTypes.has(node.type) && node.visibility === 'HIDDEN';
}

export function lessonDocumentForDisplay(document: CanvasDocument): CanvasDocument {
  const hiddenResourceIds = new Set(document.nodes.filter(isHiddenResourceNode).map((node) => node.id));
  if (hiddenResourceIds.size === 0) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) => hiddenResourceIds.has(node.id) ? { ...node, hidden: true } : node),
    edges: document.edges.filter((edge) => !hiddenResourceIds.has(edge.source) && !hiddenResourceIds.has(edge.target)),
  };
}

export function toLessonFlowEdges(document: CanvasDocument): Edge[] {
  const displayDocument = lessonDocumentForDisplay(document);
  return lessonFlowEdges(displayDocument, routeCanvasEdges(displayDocument));
}

export function LessonMap({
  document,
  selectedNodeId,
  onSelectNode,
  onOpenSubguide,
  onInit,
}: {
  document: CanvasDocument;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  onOpenSubguide?: (guideVersionId: string) => void;
  onInit?: (instance: ReactFlowInstance<Node, Edge>) => void;
}) {
  const displayDocument = useMemo(() => lessonDocumentForDisplay(document), [document]);
  const routing = useMemo(() => routeCanvasEdges(displayDocument), [displayDocument]);
  const anchorHandles = useMemo(() => anchorHandlesByNodeId(displayDocument, routing.routesByEdgeId), [displayDocument, routing]);
  const flowNodes = useMemo<Node[]>(() => displayDocument.nodes.map((node) => lessonFlowNode(node, {
    selected: node.id === selectedNodeId,
    anchorHandles: anchorHandles.get(node.id) ?? [],
    onOpenSubguide,
  })), [anchorHandles, displayDocument.nodes, onOpenSubguide, selectedNodeId]);
  const flowEdges = useMemo(() => lessonFlowEdges(displayDocument, routing), [displayDocument, routing]);
  const configuredStageIds = useMemo(() => new Set((displayDocument.stages ?? []).map((stage) => stage.id)), [displayDocument.stages]);
  const configuredLaneIds = useMemo(() => new Set((displayDocument.lanes ?? []).map((lane) => lane.id)), [displayDocument.lanes]);
  const stageBounds = useMemo(
    () => configuredStageIds.size > 0 ? getStageBounds(displayDocument).filter((bound) => bound.stageId && configuredStageIds.has(bound.stageId)) : [],
    [configuredStageIds, displayDocument],
  );
  const swimlaneBounds = useMemo(
    () => configuredLaneIds.size > 0 ? getSwimlaneBounds(displayDocument).filter((bound) => bound.laneId && configuredLaneIds.has(bound.laneId)) : [],
    [configuredLaneIds, displayDocument],
  );

  return <ReactFlow
    nodes={flowNodes}
    edges={flowEdges}
    nodeTypes={lessonNodeTypes}
    edgeTypes={edgeTypes}
    defaultEdgeOptions={edgeOptions}
    {...(onInit ? { onInit } : {})}
    nodesDraggable={false}
    nodesConnectable={false}
    elementsSelectable
    onlyRenderVisibleElements
    onNodeClick={(_, node) => {
      onSelectNode(node.id);
      if (node.type !== 'subguide') return;
      const guideVersionId = (node.data as { guideVersionId?: unknown }).guideVersionId;
      if (typeof guideVersionId === 'string') onOpenSubguide?.(guideVersionId);
    }}
    fitView
    minZoom={0.15}
    maxZoom={2}
  >
    <ViewportPortal>
      {swimlaneBounds.map((bound) => <div
        key={bound.laneId}
        className="swimlane-column lesson-swimlane"
        data-testid="lesson-swimlane"
        data-lane-id={bound.laneId}
        style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height }}
      ><div><span>{bound.title}</span><em>{bound.kind === 'ROLE' ? '责任' : '系统'}</em></div></div>)}
      {stageBounds.map((bound) => <div
        key={bound.stageId}
        className="stage-lane lesson-stage-band"
        data-testid="lesson-stage"
        data-stage-id={bound.stageId}
        style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height }}
      ><span className="stage-lane-label">{bound.title}</span></div>)}
    </ViewportPortal>
    <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--ga-border-strong)" />
    <MiniMap pannable zoomable />
    <Controls showInteractive={false} />
  </ReactFlow>;
}

const LessonMapNode = memo(function LessonMapNode({ data, type, id }: NodeProps) {
  const value = data as LessonNodeData;
  const isSubguide = type === 'subguide';
  const activate = () => value.onOpenSubguide?.();
  return <div
    className={`lesson-map-node lesson-map-${type}`}
    data-testid={`lesson-node-${id}`}
    style={{ width: value.lessonSize.width, height: value.lessonSize.height }}
    role={isSubguide ? 'button' : undefined}
    tabIndex={isSubguide ? 0 : undefined}
    aria-label={isSubguide ? `打开子指南 ${nodeSummary(type, value)}` : undefined}
    onKeyDown={isSubguide ? (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    } : undefined}
  >
    <Handle className="lesson-map-handle" type="target" position={Position.Left} id="in" aria-label="输入端口" />
    {value.anchorHandles.map((handle) => <Handle
      key={handle.id}
      className="lesson-map-physical-handle"
      type={handle.type}
      position={positionBySide[handle.side]}
      id={handle.id}
      data-testid={`lesson-anchor-${handle.id.replaceAll(':', '-')}`}
      style={physicalHandleStyle(handle)}
      aria-hidden="true"
    />)}
    <span>{typeLabel(type)}</span>
    <strong>{nodeSummary(type, value)}</strong>
    {type === 'decision'
      ? <><Handle className="lesson-map-handle" type="source" position={Position.Right} id="out" aria-label="输出端口" /><Handle className="lesson-map-handle" type="source" position={Position.Top} id="yes" aria-label="是分支端口" /><Handle className="lesson-map-handle" type="source" position={Position.Bottom} id="no" aria-label="否分支端口" /></>
      : <Handle className="lesson-map-handle" type="source" position={Position.Right} id="out" aria-label="输出端口" />}
  </div>;
});

const lessonNodeTypes: NodeTypes = {
  start: LessonMapNode, end: LessonMapNode, process: LessonMapNode, decision: LessonMapNode, data: LessonMapNode,
  markdown: LessonMapNode, image: LessonMapNode, video: LessonMapNode, subguide: LessonMapNode,
};

function lessonFlowNode(node: CanvasNode, {
  selected,
  anchorHandles,
  onOpenSubguide,
}: {
  selected: boolean;
  anchorHandles: AnchorHandle[];
  onOpenSubguide?: ((guideVersionId: string) => void) | undefined;
}): Node {
  const size = node.size ?? defaultCanvasNodeSize(node);
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    data: {
      ...(node.data as Record<string, unknown>),
      lessonSize: size,
      anchorHandles,
      ...(node.type === 'subguide' && onOpenSubguide ? { onOpenSubguide: () => onOpenSubguide(node.data.guideVersionId) } : {}),
    } satisfies LessonNodeData,
    ...(node.hidden === undefined ? {} : { hidden: node.hidden }),
    zIndex: node.zIndex,
    selected,
    style: { width: size.width, height: size.height },
    ...(node.size ? { measured: { width: node.size.width, height: node.size.height } } : {}),
  };
}

function lessonFlowEdges(document: CanvasDocument, routing: ReturnType<typeof routeCanvasEdges>): Edge[] {
  return document.edges.map((edge) => {
    const route = routing.routesByEdgeId.get(edge.id);
    const source = document.nodes.find((node) => node.id === edge.source);
    const visuals = resolveEdgeVisuals(edge.presentation);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      sourceHandle: route ? physicalLessonHandleId(edge.id, 'source') : edge.sourceHandle ?? (source?.type === 'decision' ? 'yes' : 'out'),
      targetHandle: route ? physicalLessonHandleId(edge.id, 'target') : edge.targetHandle ?? 'in',
      type: route ? 'orthogonal' : 'smoothstep',
      ...visuals,
      data: { ...(route ? { route } : {}), canvasEdge: edge },
    } satisfies Edge;
  });
}

function anchorHandlesByNodeId(document: CanvasDocument, routesByEdgeId: ReadonlyMap<string, OrthogonalRoute>): Map<string, AnchorHandle[]> {
  const result = new Map<string, AnchorHandle[]>();
  const add = (nodeId: string, handle: AnchorHandle) => {
    const handles = result.get(nodeId);
    if (handles) handles.push(handle);
    else result.set(nodeId, [handle]);
  };
  document.edges.forEach((edge) => {
    const route = routesByEdgeId.get(edge.id);
    if (!route) return;
    add(edge.source, { id: physicalLessonHandleId(edge.id, 'source'), type: 'source', side: route.sourceAnchor.side, offset: route.sourceAnchor.offset });
    add(edge.target, { id: physicalLessonHandleId(edge.id, 'target'), type: 'target', side: route.targetAnchor.side, offset: route.targetAnchor.offset });
  });
  return result;
}

function physicalHandleStyle(handle: AnchorHandle): CSSProperties {
  const offset = `${Math.max(0, Math.min(1, handle.offset)) * 100}%`;
  return handle.side === 'TOP' || handle.side === 'BOTTOM' ? { left: offset } : { top: offset };
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

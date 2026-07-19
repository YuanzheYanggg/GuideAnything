import type { CanvasDocument, CanvasEdge, CanvasNode, EdgeAnchor, EdgePresentation, FlowLane, FlowStage, GuideDraftHistorySnapshot, GuideReferenceUpdate, GuideVersionSnapshot } from '@guideanything/contracts';
import { CanvasDocumentSchema } from '@guideanything/contracts';
import { defaultCanvasNodeSize, duplicateSelection, expandSubguide, getStageBounds, HistoryStack, isContentNode, isPrimaryFlowNode, layoutFlowHierarchy, movePrimaryNodeToStage, moveRouteSegment, reconcileSubguideEdges, replaceSubguideReference, routeCanvasEdges, setSubguideExpanded, snapNodeForStraightRoute, translateStageNodes, type HierarchyLayoutResult, type NodeAlignmentSnap, type OrthogonalRoute, type Point } from '@guideanything/canvas-core';
import {
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
  type EdgeTypes,
  type EdgeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

import type { SearchItem } from '../library/LibraryPage';
import { FlowNode } from '../nodes/FlowNode';
import { ImageNode } from '../nodes/ImageNode';
import { InlineNodeEditingProvider, type InlineTextField } from '../nodes/InlineNodeTextEditor';
import { MarkdownNode } from '../nodes/MarkdownNode';
import { SubguideNode } from '../nodes/SubguideNode';
import { VideoNode } from '../nodes/VideoNode';
import { NodeActionProvider, NodeAnchorPresentationProvider, type NodeAnchorHandle } from '../nodes/NodeChrome';
import { NodeDetailPresentationProvider } from '../nodes/NodeDetailPresentation';
import { AppearanceToggle } from '../theme/AppearanceToggle';
import type { PersonalApi } from '../workspace/types';
import { HierarchyPanel } from './HierarchyPanel';
import { HierarchyDeletionDialog } from './HierarchyDeletionDialog';
import { AnnotatedImageDeletionDialog } from './AnnotatedImageDeletionDialog';
import { DraftHistoryDialog } from './DraftHistoryDialog';
import { GuideDigestDialog, type GuideDigestProposal, type GuideFlowSnapshotStatus } from './GuideDigestDialog';
import { ImageAnnotationEditor } from './ImageAnnotationEditor';
import { OrthogonalEdge } from './OrthogonalEdge';
import { CanvasCreationMenu, type CanvasCreationKind } from './CanvasCreationMenu';
import { EdgeLabelEditor } from './EdgeLabelEditor';
import { NodeDetailDialog } from './NodeDetailDialog';
import { EdgeToolbar } from './EdgeToolbar';
import { ManualRouteEditor } from './ManualRouteEditor';
import { edgeAnchorFromClientPoint, isEditableBusinessEdge, resolveEdgeVisuals } from './edge-presentation';
import { routeLabelPoint } from './OrthogonalEdge';

export interface GuideDraftDetail {
  id: string;
  workspaceId: string;
  workspaceItemId: string;
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
  getFlowSnapshotStatus: (guideId: string) => Promise<GuideFlowSnapshotStatus>;
  reconcileFlowSnapshot: (guideId: string) => Promise<GuideFlowSnapshotStatus>;
  createGuideDigestProposal: (guideId: string, input?: { regenerate?: boolean }) => Promise<GuideDigestProposal>;
  listGuideDigestProposals: (guideId: string) => Promise<GuideDigestProposal[]>;
  getGuideDigestProposal: (guideId: string, proposalId: string) => Promise<GuideDigestProposal>;
  rejectGuideDigestProposal: (guideId: string, proposalId: string) => Promise<GuideDigestProposal>;
  applyGuideDigestProposal: (guideId: string, proposalId: string, selection: { applySummary: boolean; acceptedTagLabels: string[]; acceptMarkdown: boolean }) => Promise<{ guide: GuideDraftDetail; proposal: GuideDigestProposal }>;
  listDraftHistory: (guideId: string) => Promise<GuideDraftHistorySnapshot[]>;
  restoreDraft: (guideId: string, sourceRevision: number, revision: number) => Promise<GuideDraftDetail>;
  publishGuide: (guideId: string) => Promise<GuideVersionSnapshot>;
  search: (query: string, offset?: number, consumerWorkspaceId?: string) => Promise<SearchPage>;
  referenceUpdates: (guideId: string) => Promise<GuideReferenceUpdate[]>;
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

const edgeTypes: EdgeTypes = { orthogonal: OrthogonalEdge };
const defaultEdgeOptions = { type: 'orthogonal', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--ga-accent)', strokeWidth: 2 } };
const snapGrid: [number, number] = [20, 20];
const multiSelectionKeyCode = ['Meta', 'Control'];
const noExpandedDetails = new Set<string>();

type PendingConnection = {
  sourceId: string;
  sourceHandle?: string;
  sourceAnchor?: EdgeAnchor;
  connection?: Connection;
};

type PendingReconnect = {
  edgeId: string;
  handleType: 'source' | 'target';
};

type ManualRouteDraft = {
  edgeId: string;
  points: Point[];
};

type StageDrag = {
  stageId: string;
  start: Point;
};

export function GuideEditor({ guideId, api, personalApi, focusNodeId, onBack }: { guideId: string; api: EditorApi; personalApi?: PersonalApi; focusNodeId?: string; onBack: () => void }) {
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
  const [referenceUpdates, setReferenceUpdates] = useState<GuideReferenceUpdate[]>([]);
  const [layoutPreview, setLayoutPreview] = useState<HierarchyLayoutResult | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const [creationMenu, setCreationMenu] = useState<{ sourceId: string; sourceHandle?: string; position: { x: number; y: number } } | null>(null);
  const [edgeLabelEditor, setEdgeLabelEditor] = useState<{ edgeId: string; label?: string; position: { x: number; y: number } } | null>(null);
  const [hierarchyDeletion, setHierarchyDeletion] = useState<{ kind: 'stage' | 'lane'; id: string } | null>(null);
  const [annotatedImageDeletion, setAnnotatedImageDeletion] = useState<{ nodeIds: string[]; imageCount: number; annotationCount: number } | null>(null);
  const [draftHistoryOpen, setDraftHistoryOpen] = useState(false);
  const [draftHistory, setDraftHistory] = useState<GuideDraftHistorySnapshot[]>([]);
  const [draftHistoryLoading, setDraftHistoryLoading] = useState(false);
  const [draftHistoryError, setDraftHistoryError] = useState('');
  const [digestOpen, setDigestOpen] = useState(false);
  const [digestStatus, setDigestStatus] = useState<GuideFlowSnapshotStatus | null>(null);
  const [digestProposal, setDigestProposal] = useState<GuideDigestProposal | null>(null);
  const [digestGenerating, setDigestGenerating] = useState(false);
  const [digestError, setDigestError] = useState('');
  const [expandedDetailNodeIds, setExpandedDetailNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const [detailEditor, setDetailEditor] = useState<{ nodeId: string; title: string; value: string; opener: HTMLElement } | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [manualRouteDraft, setManualRouteDraft] = useState<ManualRouteDraft | null>(null);
  const [annotationEditorNodeId, setAnnotationEditorNodeId] = useState<string | null>(null);
  const [overlayViewport, setOverlayViewport] = useState<CanvasDocument['viewport']>({ x: 0, y: 0, zoom: 1 });
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [dragPreviewDocument, setDragPreviewDocument] = useState<CanvasDocument | null>(null);
  const [alignmentGuide, setAlignmentGuide] = useState<NodeAlignmentSnap | null>(null);
  const [draggedStageId, setDraggedStageId] = useState<string | null>(null);
  const historyRef = useRef<HistoryStack<CanvasDocument> | null>(null);
  const clipboardRef = useRef<string[]>([]);
  const connectSourceRef = useRef<PendingConnection | null>(null);
  const reconnectRef = useRef<PendingReconnect | null>(null);
  const saveInFlightRef = useRef<Promise<GuideDraftDetail | undefined> | null>(null);
  const saveRetryRef = useRef(false);
  const guideRef = useRef<GuideDraftDetail | null>(null);
  const saveStateRef = useRef(saveState);
  const savedEditorStateRef = useRef<{ document: CanvasDocument | null; title: string; summary: string; tags: string[] }>({ document: null, title: '', summary: '', tags: [] });
  const appliedFocusRef = useRef<string | null>(null);
  const stageDragRef = useRef<StageDrag | null>(null);
  const latestEditorStateRef = useRef<{ document: CanvasDocument | null; title: string; summary: string; tags: string[] }>({ document: null, title: '', summary: '', tags: [] });
  const saveRef = useRef<() => Promise<GuideDraftDetail | undefined>>(async () => undefined);
  guideRef.current = guide;
  saveStateRef.current = saveState;
  latestEditorStateRef.current = { document, title, summary, tags };

  useEffect(() => {
    if (!layoutPreview || !flowInstance) return;
    const zoom = layoutPreview.document.viewport.zoom;
    const timer = window.setTimeout(() => {
      void flowInstance.fitView({ duration: 320, padding: 0.16, minZoom: zoom, maxZoom: zoom });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [flowInstance, layoutPreview]);

  useEffect(() => {
    if (!document || !flowInstance || !focusNodeId || !document.nodes.some((node) => node.id === focusNodeId)) return;
    const focusKey = `${guideId}:${focusNodeId}`;
    if (appliedFocusRef.current === focusKey) return;
    appliedFocusRef.current = focusKey;
    setSelectedIds([focusNodeId]);
    void flowInstance.fitView({ nodes: [{ id: focusNodeId }], duration: 280, padding: 0.8, minZoom: 0.25, maxZoom: 1.4 });
  }, [document, flowInstance, focusNodeId, guideId]);

  useEffect(() => {
    let active = true;
    api.getGuide(guideId).then((loaded) => {
      if (!active) return;
      const validated = CanvasDocumentSchema.parse(loaded.document);
      const normalized = reconcileSubguideEdges(validated);
      setGuide(loaded);
      setDocument(normalized);
      setFlowNodes(toFlowNodes(normalized.nodes, [], normalized.lanes));
      setTitle(loaded.title);
      setSummary(loaded.summary);
      setTags(loaded.tags);
      setSaveState('已保存');
      savedEditorStateRef.current = { document: normalized, title: loaded.title, summary: loaded.summary, tags: loaded.tags };
      historyRef.current = new HistoryStack(normalized, 80);
      if (personalApi) void personalApi.recordRecent(loaded.workspaceItemId, { mode: 'edit', guideId: loaded.id });
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '指南载入失败'));
    api.referenceUpdates(guideId).then((items) => {
      if (active) setReferenceUpdates(items);
    }).catch(() => {
      if (active) setReferenceUpdates([]);
    });
    return () => { active = false; };
  }, [api, guideId, personalApi]);

  useEffect(() => {
    if (!document) return;
    setOverlayViewport((current) => sameViewport(current, document.viewport) ? current : document.viewport);
  }, [document]);

  const commit = useCallback((next: CanvasDocument) => {
    const validated = reconcileSubguideEdges(CanvasDocumentSchema.parse(next));
    historyRef.current?.push(validated);
    setLayoutPreview(null);
    setDragPreviewDocument(null);
    setAlignmentGuide(null);
    setDocument(validated);
    setFlowNodes(toFlowNodes(validated.nodes, selectedIds, validated.lanes, expandedDetailNodeIds));
    setSaveState('未保存');
  }, [expandedDetailNodeIds, selectedIds]);

  const renderedDocument = layoutPreview?.document ?? dragPreviewDocument ?? document;
  const routing = useMemo(() => renderedDocument ? routeCanvasEdges(renderedDocument) : null, [renderedDocument]);
  const manualRouteDocument = useMemo(() => {
    if (!document || !manualRouteDraft) return null;
    return {
      ...document,
      edges: document.edges.map((edge) => edge.id === manualRouteDraft.edgeId
        ? { ...edge, presentation: { ...edge.presentation, routeMode: 'manual' as const, waypoints: manualRouteDraft.points.slice(1, -1) } }
        : edge),
    };
  }, [document, manualRouteDraft]);
  const manualDraftRouting = useMemo(() => manualRouteDocument ? routeCanvasEdges(manualRouteDocument) : null, [manualRouteDocument]);
  const manualDraftConflict = Boolean(manualRouteDraft && manualDraftRouting?.report.manualConflictEdgeIds.includes(manualRouteDraft.edgeId));
  const flowEdges = useMemo(() => renderedDocument ? [
    ...renderedDocument.edges.map((edge) => {
      const route = routing?.routesByEdgeId.get(edge.id);
      const displayRoute = route && manualRouteDraft?.edgeId === edge.id
        ? { ...route, points: manualRouteDraft.points, collision: manualDraftConflict }
        : route;
      return renderEdge(renderedDocument, edge, displayRoute);
    }),
    ...hierarchyPresentationEdges(renderedDocument),
  ] : [], [manualDraftConflict, manualRouteDraft, renderedDocument, routing]);
  const nodeAnchorHandles = useMemo(() => renderedDocument && routing ? anchorHandlesByNodeId(renderedDocument, routing) : new Map<string, NodeAnchorHandle[]>(), [renderedDocument, routing]);
  const renderedFlowNodes = useMemo(() => {
    const preview = layoutPreview?.document ?? (draggedStageId ? dragPreviewDocument : null);
    return preview ? toFlowNodes(preview.nodes, selectedIds, preview.lanes, expandedDetailNodeIds) : flowNodes;
  }, [dragPreviewDocument, draggedStageId, expandedDetailNodeIds, flowNodes, layoutPreview, selectedIds]);
  const stageBounds = useMemo(() => renderedDocument ? getStageBounds(renderedDocument) : [], [renderedDocument]);
  const selectedBusinessEdge = selectedEdgeId && document ? document.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null;
  const selectedEdgeRoute = selectedBusinessEdge ? routing?.routesByEdgeId.get(selectedBusinessEdge.id) : undefined;

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
            const page = await api.search(query, offset, guide?.workspaceId);
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
  }, [api, guide?.workspaceId, referenceOpen, referenceQuery]);

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    if (layoutPreview) return;
    const snappedChanges = document ? changes.map((change) => {
      if (change.type !== 'position' || !change.position) return change;
      const snap = snapNodeForStraightRoute(document, change.id, change.position);
      return snap ? { ...change, position: snap.position } : change;
    }) : changes;
    const snapping = document ? snappedChanges.flatMap((change) => {
      if (change.type !== 'position' || !change.position) return [];
      const snap = snapNodeForStraightRoute(document, change.id, change.position);
      return snap ? [snap] : [];
    })[0] ?? null : null;
    const displayChanges = snappedChanges.filter((change) => change.type !== 'dimensions' || !expandedDetailNodeIds.has(change.id));
    setFlowNodes((current) => applyNodeChanges(displayChanges, current));
    const dragging = snappedChanges.some((change) => change.type === 'position' && change.dragging === true);
    if (dragging && document) {
      setDragPreviewDocument((current) => documentWithPositionChanges(current ?? document, snappedChanges));
      setAlignmentGuide(snapping);
    } else {
      setDragPreviewDocument(null);
      setAlignmentGuide(null);
    }
    const persistedChanges = persistableNodeChanges(snappedChanges, expandedDetailNodeIds);
    if (persistedChanges.length === 0) return;
    setLayoutPreview(null);
    setSaveState('未保存');
    setDocument((current) => {
      if (!current) return current;
      const changed = applyNodeChanges(persistedChanges, toFlowNodes(current.nodes, selectedIds, current.lanes, expandedDetailNodeIds));
      const next = reconcileSubguideEdges(CanvasDocumentSchema.parse(fromFlowNodes(current, changed)));
      historyRef.current?.push(next);
      return next;
    });
  }, [document, expandedDetailNodeIds, layoutPreview, selectedIds]);

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
    if (layoutPreview || reconnectRef.current || !connectSourceRef.current) return;
    connectSourceRef.current = { ...connectSourceRef.current, connection };
  }, [layoutPreview]);

  const onConnectStart = useCallback<OnConnectStart>((event, { nodeId, handleId, handleType }) => {
    if (reconnectRef.current) {
      connectSourceRef.current = null;
      return;
    }
    if (!nodeId || handleType !== 'source') {
      connectSourceRef.current = null;
      return;
    }
    const point = clientPoint(event);
    const sourceAnchor = anchorForNodeClientPoint(nodeId, point) ?? anchorFromPhysicalHandle(handleId);
    connectSourceRef.current = {
      sourceId: nodeId,
      ...(handleId ? { sourceHandle: handleId } : {}),
      ...(sourceAnchor ? { sourceAnchor } : {}),
    };
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>((event, connectionState) => {
    const source = connectSourceRef.current;
    connectSourceRef.current = null;
    if (layoutPreview || reconnectRef.current || !document || !source) return;
    const sourceNode = document.nodes.find((node) => node.id === source.sourceId);
    if (!sourceNode || sourceNode.source) return;
    const targetId = connectionState?.toNode?.id ?? source.connection?.target;
    if (targetId) {
      const connection = source.connection;
      if (!connection || connection.target !== targetId) return;
      const targetNode = document.nodes.find((node) => node.id === targetId);
      if (!targetNode || targetNode.source) return;
      const sourceAnchor = source.sourceAnchor ?? anchorFromPhysicalHandle(connection.sourceHandle);
      const targetAnchor = anchorForNodeClientPoint(targetNode.id, clientPoint(event)) ?? anchorFromPhysicalHandle(connection.targetHandle);
      const presentation = edgePresentationWithAnchors(undefined, sourceAnchor, targetAnchor);
      const edge: CanvasEdge = {
        id: uniqueId('edge'),
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: semanticSourceHandle(sourceNode, connection.sourceHandle),
        targetHandle: semanticTargetHandle(connection.targetHandle),
        ...(presentation ? { presentation } : {}),
      };
      commit({ ...document, edges: [...document.edges, edge] });
      return;
    }
    if (!flowInstance || !isCanvasInteractionSurface(event.target)) return;
    setCreationMenu({ ...source, sourceHandle: semanticSourceHandle(sourceNode, source.sourceHandle), position: flowInstance.screenToFlowPosition(clientPoint(event)) });
  }, [commit, document, flowInstance, layoutPreview]);

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    if (layoutPreview || !document || !connection.source || !connection.target) return;
    const persisted = canvasEdgeFromFlowEdge(oldEdge, document);
    if (!persisted || !isEditableBusinessEdge(document, persisted)) return;
    const sourceNode = document.nodes.find((node) => node.id === connection.source);
    const targetNode = document.nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode || sourceNode.source || targetNode.source) return;
    const sourceChanged = connection.source !== persisted.source || isPhysicalAnchorHandle(connection.sourceHandle);
    const targetChanged = connection.target !== persisted.target || isPhysicalAnchorHandle(connection.targetHandle);
    const sourceAnchor = sourceChanged ? anchorFromPhysicalHandle(connection.sourceHandle) ?? persisted.presentation?.sourceAnchor : persisted.presentation?.sourceAnchor;
    const targetAnchor = targetChanged ? anchorFromPhysicalHandle(connection.targetHandle) ?? persisted.presentation?.targetAnchor : persisted.presentation?.targetAnchor;
    const presentation = edgePresentationWithAnchors(persisted.presentation, sourceAnchor, targetAnchor);
    commit({
      ...document,
      edges: document.edges.map((edge) => edge.id === persisted.id ? {
        ...edge,
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: sourceChanged ? semanticSourceHandle(sourceNode, connection.sourceHandle) : edge.sourceHandle ?? semanticSourceHandle(sourceNode),
        targetHandle: targetChanged ? semanticTargetHandle(connection.targetHandle) : edge.targetHandle ?? semanticTargetHandle(),
        ...(presentation ? { presentation } : {}),
      } : edge),
    });
    setSelectedEdgeId(persisted.id);
  }, [commit, document, layoutPreview]);

  const onReconnectStart = useCallback((_: ReactMouseEvent, edge: Edge, oppositeHandleType: 'source' | 'target') => {
    reconnectRef.current = { edgeId: edge.id, handleType: oppositeHandleType === 'source' ? 'target' : 'source' };
  }, []);

  const onReconnectEnd = useCallback((event: MouseEvent | TouchEvent, edge: Edge, oppositeHandleType: 'source' | 'target', connectionState: { toNode?: { id: string } | null; pointer?: { x: number; y: number } | null }) => {
    const pending = reconnectRef.current;
    reconnectRef.current = null;
    const handleType = oppositeHandleType === 'source' ? 'target' : 'source';
    if (layoutPreview || !pending || pending.edgeId !== edge.id || pending.handleType !== handleType || !connectionState.toNode) return;
    const anchor = anchorForNodeClientPoint(connectionState.toNode.id, clientPoint(event));
    if (!anchor) return;
    setDocument((current) => {
      if (!current) return current;
      const persisted = current.edges.find((candidate) => candidate.id === pending.edgeId);
      if (!persisted || !isEditableBusinessEdge(current, persisted)) return current;
      const presentation = edgePresentationWithAnchors(persisted.presentation, handleType === 'source' ? anchor : persisted.presentation?.sourceAnchor, handleType === 'target' ? anchor : persisted.presentation?.targetAnchor);
      const next = reconcileSubguideEdges(CanvasDocumentSchema.parse({ ...current, edges: current.edges.map((candidate) => candidate.id === persisted.id ? { ...candidate, ...(presentation ? { presentation } : {}) } : candidate) }));
      historyRef.current?.push(next);
      setSaveState('未保存');
      return next;
    });
  }, [layoutPreview]);

  const createFromConnection = useCallback((kind: CanvasCreationKind) => {
    if (!document || layoutPreview || !creationMenu) return;
    const source = document.nodes.find((node) => node.id === creationMenu.sourceId);
    if (!source || source.source) {
      setCreationMenu(null);
      return;
    }
    const id = uniqueId(kind);
    const created = createNode(id, kind, document.nodes.length, creationMenu.position);
    const node = isContentNode(created)
      ? created
      : { ...created, ...(source.stageId ? { stageId: source.stageId } : {}), ...(source.laneId ? { laneId: source.laneId } : {}) };
    const edges = [...document.edges, {
      id: uniqueId('edge'), source: source.id, target: id,
      ...(creationMenu.sourceHandle ? { sourceHandle: creationMenu.sourceHandle } : {}),
    }];
    commit({ ...document, nodes: [...document.nodes, node], edges });
    setSelectedIds([id]);
    setCreationMenu(null);
  }, [commit, creationMenu, document, layoutPreview]);

  const onEdgeDoubleClick = useCallback((event: ReactMouseEvent, edge: Edge) => {
    if (layoutPreview || !document || edge.id.startsWith('hierarchy:') || (edge as Edge & Pick<CanvasEdge, 'sourceTrace'>).sourceTrace) return;
    const persisted = document.edges.find((candidate) => candidate.id === edge.id);
    if (!persisted || persisted.sourceTrace) return;
    const nativeEvent = (event as ReactMouseEvent & { nativeEvent?: MouseEvent }).nativeEvent ?? event as unknown as MouseEvent;
    setEdgeLabelEditor({ edgeId: persisted.id, ...(persisted.label ? { label: persisted.label } : {}), position: flowInstance?.screenToFlowPosition(clientPoint(nativeEvent)) ?? clientPoint(nativeEvent) });
  }, [document, flowInstance, layoutPreview]);

  const saveEdgeLabel = useCallback((label: string) => {
    if (!document || layoutPreview || !edgeLabelEditor) return;
    const edgeId = edgeLabelEditor.edgeId;
    commit({ ...document, edges: document.edges.map((edge) => {
      if (edge.id !== edgeId) return edge;
      if (label) return { ...edge, label };
      const { label: _label, ...unlabeled } = edge;
      return unlabeled;
    }) });
    setEdgeLabelEditor(null);
  }, [commit, document, edgeLabelEditor, layoutPreview]);

  const onEdgeClick = useCallback((_: ReactMouseEvent, edge: Edge) => {
    if (layoutPreview || !document) return;
    const persisted = canvasEdgeFromFlowEdge(edge, document);
    const editable = persisted && isEditableBusinessEdge(document, persisted) ? persisted.id : null;
    if (manualRouteDraft && editable && manualRouteDraft.edgeId !== editable) return;
    setSelectedEdgeId(editable);
    if (editable) setSelectedIds([]);
  }, [document, layoutPreview, manualRouteDraft]);

  const updateSelectedEdgePresentation = useCallback((partial: Partial<EdgePresentation>) => {
    if (layoutPreview || !document || !selectedEdgeId) return;
    const selected = document.edges.find((edge) => edge.id === selectedEdgeId);
    if (!selected || !isEditableBusinessEdge(document, selected)) return;
    commit({ ...document, edges: document.edges.map((edge) => edge.id === selected.id ? { ...edge, presentation: { ...edge.presentation, ...partial } } : edge) });
  }, [commit, document, layoutPreview, selectedEdgeId]);

  const startManualRouteEdit = useCallback(() => {
    if (layoutPreview || !document || !selectedEdgeId) return;
    const selected = document.edges.find((edge) => edge.id === selectedEdgeId);
    if (!selected || !isEditableBusinessEdge(document, selected)) return;
    const route = routing?.routesByEdgeId.get(selectedEdgeId);
    if (!route) return;
    setManualRouteDraft({ edgeId: selectedEdgeId, points: route.points.map((point) => ({ ...point })) });
  }, [document, layoutPreview, routing, selectedEdgeId]);

  const moveManualRouteSegment = useCallback((segmentIndex: number, coordinate: number) => {
    setManualRouteDraft((current) => current
      ? { ...current, points: moveRouteSegment(current.points, segmentIndex, coordinate) }
      : current);
  }, []);

  const cancelManualRouteEdit = useCallback(() => {
    setManualRouteDraft(null);
  }, []);

  const saveManualRouteEdit = useCallback(() => {
    if (layoutPreview || !document || !manualRouteDraft || manualDraftConflict) return;
    const selected = document.edges.find((edge) => edge.id === manualRouteDraft.edgeId);
    if (!selected || !isEditableBusinessEdge(document, selected)) return;
    commit({
      ...document,
      edges: document.edges.map((edge) => edge.id === selected.id
        ? { ...edge, presentation: { ...edge.presentation, routeMode: 'manual', waypoints: manualRouteDraft.points.slice(1, -1) } }
        : edge),
    });
    setManualRouteDraft(null);
  }, [commit, document, layoutPreview, manualDraftConflict, manualRouteDraft]);

  const resetSelectedRoute = useCallback(() => {
    if (layoutPreview || !document || !selectedEdgeId) return;
    const selected = document.edges.find((edge) => edge.id === selectedEdgeId);
    if (!selected || !isEditableBusinessEdge(document, selected)) return;
    const edges = document.edges.map((edge) => {
      if (edge.id !== selected.id || !edge.presentation) return edge;
      const { routeMode: _routeMode, waypoints: _waypoints, ...autoPresentation } = edge.presentation;
      if (Object.keys(autoPresentation).length > 0) return { ...edge, presentation: autoPresentation };
      const { presentation: _presentation, ...withoutPresentation } = edge;
      return withoutPresentation;
    });
    commit({ ...document, edges });
    setManualRouteDraft(null);
  }, [commit, document, layoutPreview, selectedEdgeId]);

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
    if (layoutPreview) return;
    setDocument((current) => {
      if (!current || (current.viewport.x === viewport.x && current.viewport.y === viewport.y && current.viewport.zoom === viewport.zoom)) return current;
      const next = { ...current, viewport };
      if (_event === null && !hasUnsavedEditorChanges(latestEditorStateRef.current, savedEditorStateRef.current)) {
        savedEditorStateRef.current = { ...savedEditorStateRef.current, document: next };
      }
      return next;
    });
  }, [layoutPreview]);

  const onMove = useCallback((_event: MouseEvent | TouchEvent | null, viewport: CanvasDocument['viewport']) => {
    setOverlayViewport((current) => sameViewport(current, viewport) ? current : viewport);
  }, []);

  const startStageDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || layoutPreview || !document) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__edgelabel-renderer, .manual-route-editor, .edge-toolbar, .canvas-creation-menu, .edge-label-editor')) return;
    const point = flowPointFromScreen(flowInstance, overlayViewport, { x: event.clientX, y: event.clientY });
    const stageId = [...stageBounds].reverse().find((bound) => bound.stageId
      && point.x >= bound.x
      && point.x <= bound.x + bound.width
      && point.y >= bound.y
      && point.y <= bound.y + bound.height)?.stageId;
    if (!stageId) return;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    stageDragRef.current = {
      stageId,
      start: point,
    };
    setDraggedStageId(stageId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [document, flowInstance, layoutPreview, overlayViewport, stageBounds]);

  const moveStageDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = stageDragRef.current;
    if (!drag || layoutPreview || !document) return;
    const point = flowPointFromScreen(flowInstance, overlayViewport, { x: event.clientX, y: event.clientY });
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    setDragPreviewDocument(translateStageNodes(document, drag.stageId, {
      x: point.x - drag.start.x,
      y: point.y - drag.start.y,
    }));
  }, [document, flowInstance, layoutPreview, overlayViewport]);

  const finishStageDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = stageDragRef.current;
    if (!drag || layoutPreview || !document) return;
    const point = flowPointFromScreen(flowInstance, overlayViewport, { x: event.clientX, y: event.clientY });
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    const next = translateStageNodes(document, drag.stageId, {
      x: point.x - drag.start.x,
      y: point.y - drag.start.y,
    });
    stageDragRef.current = null;
    setDraggedStageId(null);
    setDragPreviewDocument(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (next !== document) commit(next);
  }, [commit, document, flowInstance, layoutPreview, overlayViewport]);

  const addNode = (type: CanvasNode['type']) => {
    if (!document || layoutPreview) return;
    const id = uniqueId(type);
    const created = createNode(id, type, document.nodes.length);
    const selectedSource = document.nodes.find((node) => node.id === selectedIds[0] && !node.source);
    const edges = isContentNode(created) && selectedSource
      ? [...document.edges, { id: uniqueId('edge'), source: selectedSource.id, target: id, sourceHandle: semanticSourceHandle(selectedSource) }]
      : document.edges;
    commit({ ...document, nodes: [...document.nodes, created], edges });
    setSelectedIds([id]);
  };

  const addStage = () => {
    if (!document || layoutPreview) return;
    const stages = document.stages ?? [];
    const stage: FlowStage = { id: uniqueId('stage'), title: `业务阶段 ${stages.length + 1}`, order: stages.length };
    commit({ ...document, stages: [...stages, stage] });
  };

  const updateStage = (stageId: string, stageTitle: string) => {
    if (!document || layoutPreview || !stageTitle.trim()) return;
    commit({ ...document, stages: (document.stages ?? []).map((stage) => stage.id === stageId ? { ...stage, title: stageTitle } : stage) });
  };

  const moveStage = (stageId: string, direction: -1 | 1) => {
    if (!document || layoutPreview) return;
    const stages = moveOrderedItem(document.stages ?? [], stageId, direction);
    if (stages) commit({ ...document, stages });
  };

  const addLane = (kind: FlowLane['kind']) => {
    if (!document || layoutPreview) return;
    const lanes = document.lanes ?? [];
    commit({ ...document, lanes: [...lanes, { id: uniqueId('lane'), title: kind === 'ROLE' ? '新角色' : '新系统', kind, order: lanes.length }] });
  };

  const updateLane = (laneId: string, laneTitle: string) => {
    if (!document || layoutPreview || !laneTitle.trim()) return;
    commit({ ...document, lanes: (document.lanes ?? []).map((lane) => lane.id === laneId ? { ...lane, title: laneTitle } : lane) });
  };

  const moveLane = (laneId: string, direction: -1 | 1) => {
    if (!document || layoutPreview) return;
    const lanes = moveOrderedItem(document.lanes ?? [], laneId, direction);
    if (lanes) commit({ ...document, lanes });
  };

  const requestHierarchyDeletion = (kind: 'stage' | 'lane', id: string) => {
    if (!document || layoutPreview) return;
    setHierarchyDeletion({ kind, id });
  };

  const confirmHierarchyDeletion = () => {
    if (!document || !hierarchyDeletion || layoutPreview) return;
    commit(removeHierarchyItem(document, hierarchyDeletion.kind, hierarchyDeletion.id));
    setHierarchyDeletion(null);
  };

  const previewLayout = () => {
    if (!document || layoutPreview) return;
    setCreationMenu(null);
    setEdgeLabelEditor(null);
    setSelectedEdgeId(null);
    setLayoutPreview(layoutFlowHierarchy(document));
  };

  const applyLayoutPreview = () => {
    if (!layoutPreview) return;
    commit(layoutPreview.document);
  };

  const save = useCallback(async (): Promise<GuideDraftDetail | undefined> => {
    if (layoutPreview || !guide || !document) return;
    if (saveInFlightRef.current) {
      return saveInFlightRef.current;
    }

    const snapshot = { document, guideId: guide.id, revision: guide.revision, title, summary, tags };
    const request = (async () => {
      setSaveState('保存中…');
      setError('');
      try {
        const clean = CanvasDocumentSchema.parse(snapshot.document);
        const updated = await api.saveGuide(snapshot.guideId, snapshot.revision, { title: snapshot.title, summary: snapshot.summary, tags: snapshot.tags, document: clean });
        guideRef.current = updated;
        setGuide(updated);
        savedEditorStateRef.current = { document: snapshot.document, title: snapshot.title, summary: snapshot.summary, tags: snapshot.tags };
        const latest = latestEditorStateRef.current;
        const unchanged = !hasUnsavedEditorChanges(latest, { document: snapshot.document, title: snapshot.title, summary: snapshot.summary, tags: snapshot.tags });
        setSaveState(unchanged ? '已保存' : '未保存');
        if (!unchanged) saveRetryRef.current = true;
        return updated;
      } catch (reason) {
        setSaveState('保存失败');
        setError(reason instanceof Error ? reason.message : '保存失败');
        throw reason;
      }
    })();
    saveInFlightRef.current = request;
    void request.then(() => undefined, () => undefined).finally(() => {
      if (saveInFlightRef.current !== request) return;
      saveInFlightRef.current = null;
      if (!saveRetryRef.current) return;
      saveRetryRef.current = false;
      window.setTimeout(() => { void saveRef.current().catch(() => undefined); }, 0);
    });
    return request;
  }, [api, document, guide, layoutPreview, summary, tags, title]);
  saveRef.current = save;

  const flushPendingSave = useCallback(async (): Promise<GuideDraftDetail | undefined> => {
    if (saveStateRef.current === '保存失败') throw new Error('草稿保存失败，无法生成指南总览');
    let saved = guideRef.current ?? undefined;
    if (!saveInFlightRef.current && !hasUnsavedEditorChanges(latestEditorStateRef.current, savedEditorStateRef.current)) return guideRef.current ?? saved;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = await saveRef.current();
      if (next) saved = next;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!saveInFlightRef.current && !saveRetryRef.current && !hasUnsavedEditorChanges(latestEditorStateRef.current, savedEditorStateRef.current)) return guideRef.current ?? saved;
      if (saveInFlightRef.current) {
        const inFlight = await saveInFlightRef.current;
        if (inFlight) saved = inFlight;
      }
    }
    throw new Error('草稿仍有未保存修改，无法生成指南总览');
  }, []);

  const openDigest = useCallback(async () => {
    if (!guide || layoutPreview) return;
    setDigestOpen(true);
    setDigestError('');
    setDigestProposal(null);
    try {
      setDigestStatus(await api.getFlowSnapshotStatus(guide.id));
    } catch (reason) {
      setDigestError(reason instanceof Error ? reason.message : '无法检查流程快照');
    }
  }, [api, guide, layoutPreview]);

  const reconcileDigest = useCallback(async () => {
    if (!guide) return;
    setDigestError('');
    try { setDigestStatus(await api.reconcileFlowSnapshot(guide.id)); }
    catch (reason) { setDigestError(reason instanceof Error ? reason.message : '快照同步失败'); }
  }, [api, guide]);

  const generateDigest = useCallback(async (regenerate = false) => {
    if (!guide || digestGenerating) return;
    setDigestGenerating(true);
    setDigestError('');
    try {
      const saved = await flushPendingSave();
      if (!saved) throw new Error('草稿尚未保存，无法生成指南总览');
      const currentStatus = await api.getFlowSnapshotStatus(guide.id);
      setDigestStatus(currentStatus);
      if (currentStatus.guideRevision !== saved.revision) throw new Error('草稿 revision 尚未同步到流程快照，请先重新同步快照');
      const proposal = await api.createGuideDigestProposal(guide.id, { regenerate });
      setDigestProposal(proposal);
    } catch (reason) {
      setDigestError(reason instanceof Error ? reason.message : '指南总览生成失败');
    } finally { setDigestGenerating(false); }
  }, [api, digestGenerating, flushPendingSave, guide]);

  const rejectDigest = useCallback(async (proposalId: string) => {
    if (!guide) return;
    setDigestError('');
    try {
      await api.rejectGuideDigestProposal(guide.id, proposalId);
      setDigestOpen(false);
      setDigestProposal(null);
    } catch (reason) { setDigestError(reason instanceof Error ? reason.message : '拒绝提案失败'); }
  }, [api, guide]);

  const applyDigest = useCallback(async (proposalId: string, selection: { applySummary: boolean; acceptedTagLabels: string[]; acceptMarkdown: boolean }) => {
    if (!guide) return;
    setDigestError('');
    try {
      const saved = await flushPendingSave();
      const editorStateBeforeVerification = latestEditorStateRef.current;
      const activeProposal = digestProposal?.id === proposalId ? digestProposal : await api.getGuideDigestProposal(guide.id, proposalId);
      const currentStatus = await api.getFlowSnapshotStatus(guide.id);
      setDigestStatus(currentStatus);
      const changedWhileVerifying = !saved
        || saveInFlightRef.current !== null
        || saveRetryRef.current
        || guideRef.current?.revision !== saved.revision
        || hasUnsavedEditorChanges(latestEditorStateRef.current, savedEditorStateRef.current);
      if (changedWhileVerifying || activeProposal.baseRevision !== saved.revision || currentStatus.guideRevision !== saved.revision || currentStatus.snapshotRevision !== saved.revision) {
        setDigestProposal({ ...activeProposal, status: 'STALE' });
        setDigestError('草稿已更新，提案必须重新生成后才能应用');
        return;
      }
      const beforeApply = editorStateBeforeVerification;
      const result = await api.applyGuideDigestProposal(guide.id, proposalId, selection);
      guideRef.current = result.guide;
      setGuide(result.guide);
      const unchangedDuringApply = !hasUnsavedEditorChanges(latestEditorStateRef.current, beforeApply);
      if (unchangedDuringApply) {
        const currentDocument = document ?? result.guide.document;
        savedEditorStateRef.current = { document: currentDocument, title: result.guide.title, summary: result.guide.summary, tags: result.guide.tags };
        setTitle(result.guide.title);
        setSummary(result.guide.summary);
        setTags(result.guide.tags);
        setDocument((current) => current ?? currentDocument);
        latestEditorStateRef.current = { document: currentDocument, title: result.guide.title, summary: result.guide.summary, tags: result.guide.tags };
        historyRef.current = new HistoryStack(currentDocument, 80);
        setSaveState('已保存');
      } else {
        savedEditorStateRef.current = { document: result.guide.document, title: result.guide.title, summary: result.guide.summary, tags: result.guide.tags };
        setSaveState('未保存');
      }
      saveRetryRef.current = false;
      setDigestProposal(result.proposal);
      setDigestOpen(false);
    } catch (reason) {
      const originalError = reason instanceof Error ? reason.message : '应用提案失败';
      setDigestError(originalError);
      try {
        const [latestProposal, status] = await Promise.all([api.getGuideDigestProposal(guide.id, proposalId), api.getFlowSnapshotStatus(guide.id)]);
        setDigestProposal(latestProposal);
        setDigestStatus(status);
      } catch { /* Preserve the original safe apply error if refresh cannot complete. */ }
    }
  }, [api, digestProposal, document, flushPendingSave, guide]);

  useEffect(() => {
    if (layoutPreview || !guide || !document || saveState !== '未保存') return;
    const timer = window.setTimeout(() => { void save().catch(() => undefined); }, 1_500);
    return () => window.clearTimeout(timer);
  }, [document, guide, layoutPreview, save, saveState, summary, tags, title]);

  const publish = async () => {
    if (layoutPreview) return;
    try {
      await save();
      const version = await api.publishGuide(guideId);
      setGuide((current) => current ? { ...current, status: 'PUBLISHED', publishedVersionId: version.id, publishedVersion: version.version } : current);
      setSaveState(`已发布 v${version.version}`);
    } catch { /* save surfaces the error */ }
  };

  const openDraftHistory = useCallback(async () => {
    if (!guide) return;
    setDraftHistoryOpen(true);
    setDraftHistoryLoading(true);
    setDraftHistoryError('');
    try {
      setDraftHistory(await api.listDraftHistory(guide.id));
    } catch (reason) {
      setDraftHistoryError(reason instanceof Error ? reason.message : '草稿历史载入失败');
    } finally {
      setDraftHistoryLoading(false);
    }
  }, [api, guide]);

  const restoreDraftHistory = useCallback(async (sourceRevision: number) => {
    if (!guide) return;
    const restored = await api.restoreDraft(guide.id, sourceRevision, guide.revision);
    const normalized = reconcileSubguideEdges(CanvasDocumentSchema.parse(restored.document));
    setGuide(restored);
    setDocument(normalized);
    setFlowNodes(toFlowNodes(normalized.nodes, [], normalized.lanes, expandedDetailNodeIds));
    setTitle(restored.title);
    setSummary(restored.summary);
    setTags(restored.tags);
    setSelectedIds([]);
    setSelectedEdgeId(null);
    setSaveState('已保存');
    historyRef.current = new HistoryStack(normalized, 80);
    setDraftHistoryOpen(false);
  }, [api, expandedDetailNodeIds, guide]);

  const undo = useCallback(() => {
    if (layoutPreview || !historyRef.current?.canUndo) return;
    const previous = reconcileSubguideEdges(historyRef.current.undo());
    setDocument(previous);
    setFlowNodes(toFlowNodes(previous.nodes, selectedIds, previous.lanes, expandedDetailNodeIds));
    setSaveState('未保存');
  }, [expandedDetailNodeIds, layoutPreview, selectedIds]);
  const redo = useCallback(() => {
    if (layoutPreview || !historyRef.current?.canRedo) return;
    const next = reconcileSubguideEdges(historyRef.current.redo());
    setDocument(next);
    setFlowNodes(toFlowNodes(next.nodes, selectedIds, next.lanes, expandedDetailNodeIds));
    setSaveState('未保存');
  }, [expandedDetailNodeIds, layoutPreview, selectedIds]);

  const copy = useCallback(() => { clipboardRef.current = [...selectedIds]; }, [selectedIds]);
  const paste = useCallback(() => {
    if (!document || layoutPreview || clipboardRef.current.length === 0) return;
    const result = duplicateSelection(document, clipboardRef.current, uniqueId('paste'));
    commit(result.document);
    setSelectedIds(result.newNodeIds);
  }, [commit, document, layoutPreview]);

  const removeNodesImmediately = useCallback((nodeIds: string[]) => {
    if (!document || layoutPreview || nodeIds.length === 0) return;
    commit(removeNodesFromDocument(document, nodeIds));
    const removed = new Set(nodeIds);
    setSelectedIds((current) => current.filter((id) => !removed.has(id)));
  }, [commit, document, layoutPreview]);
  const requestNodeDeletion = useCallback((nodeIds: string[]) => {
    if (!document || layoutPreview || nodeIds.length === 0) return;
    const uniqueNodeIds = [...new Set(nodeIds)];
    const annotatedImages = uniqueNodeIds.flatMap((nodeId) => {
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      return node?.type === 'image' && (node.data.annotations?.length ?? 0) > 0 ? [node] : [];
    });
    if (annotatedImages.length > 0) {
      setAnnotatedImageDeletion({
        nodeIds: uniqueNodeIds,
        imageCount: annotatedImages.length,
        annotationCount: annotatedImages.reduce((count, node) => count + (node.data.annotations?.length ?? 0), 0),
      });
      return;
    }
    removeNodesImmediately(uniqueNodeIds);
  }, [document, layoutPreview, removeNodesImmediately]);
  const removeEdges = useCallback((edgeIds: string[]) => {
    if (!document || layoutPreview || edgeIds.length === 0) return;
    const removable = document.edges.filter((edge) => edgeIds.includes(edge.id) && isEditableBusinessEdge(document, edge)).map((edge) => edge.id);
    if (removable.length === 0) return;
    commit(removeEdgesFromDocument(document, removable));
    const removed = new Set(removable);
    setSelectedEdgeId((current) => current && removed.has(current) ? null : current);
  }, [commit, document, layoutPreview]);
  const removeSelected = useCallback(() => {
    if (selectedEdgeId) {
      removeEdges([selectedEdgeId]);
      return;
    }
    requestNodeDeletion(selectedIds);
  }, [removeEdges, requestNodeDeletion, selectedEdgeId, selectedIds]);
  const removeNodeById = useCallback((nodeId: string) => requestNodeDeletion([nodeId]), [requestNodeDeletion]);

  const confirmAnnotatedImageDeletion = useCallback(() => {
    if (!annotatedImageDeletion) return;
    removeNodesImmediately(annotatedImageDeletion.nodeIds);
    setAnnotatedImageDeletion(null);
  }, [annotatedImageDeletion, removeNodesImmediately]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      else if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (modifier && event.key.toLowerCase() === 'c') copy();
      else if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); removeSelected(); }
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

  const upgradeReference = async () => {
    if (!document || layoutPreview) return;
    const selected = document.nodes.find((node) => node.id === selectedIds[0]);
    if (!selected || selected.type !== 'subguide') return;
    const update = referenceUpdates.find((item) => item.referenceNodeId === selected.id);
    if (!update) return;
    try {
      const latest = await api.getVersion(update.latestVersionId);
      commit(replaceSubguideReference(document, selected.id, latest));
      setReferenceUpdates((items) => items.filter((item) => item.referenceNodeId !== selected.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法采用子指南的新版本');
    }
  };

  const updateSelectedNode = (next: CanvasNode) => {
    if (!document || layoutPreview) return;
    const current = document.nodes.find((node) => node.id === next.id);
    const nextDocument = { ...document, nodes: document.nodes.map((node) => node.id === next.id ? next : node) };
    commit(current && isPrimaryFlowNode(current) && current.stageId !== next.stageId
      ? movePrimaryNodeToStage(nextDocument, next.id, next.stageId)
      : nextDocument);
  };

  const updateInlineText = useCallback((nodeId: string, field: InlineTextField, value: string) => {
    if (!document || layoutPreview) return;
    const next = updateInlineNodeText(document, nodeId, field, value);
    if (next !== document) commit(next);
  }, [commit, document, layoutPreview]);

  const openNodeDetail = useCallback((nodeId: string, opener: HTMLElement) => {
    if (!document || layoutPreview) return;
    const node = document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !isInlineEditableFlowNode(node)) return;
    setDetailEditor({ nodeId, title: node.data.label, value: node.data.description ?? '', opener });
  }, [document, layoutPreview]);

  const onNodeDoubleClick = useCallback((event: ReactMouseEvent, node: Node) => {
    const trigger = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.flow-detail-trigger') : null;
    const fallback = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (trigger ?? fallback) openNodeDetail(node.id, trigger ?? fallback!);
  }, [openNodeDetail]);

  const saveNodeDetail = useCallback((value: string) => {
    if (!detailEditor) return;
    updateInlineText(detailEditor.nodeId, 'description', value);
  }, [detailEditor, updateInlineText]);

  const toggleNodeDetail = useCallback((nodeId: string) => {
    if (!document || layoutPreview) return;
    setExpandedDetailNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      setFlowNodes(toFlowNodes(document.nodes, selectedIds, document.lanes, next));
      return next;
    });
  }, [document, layoutPreview, selectedIds]);

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
  const selectedReferenceUpdate = selectedNode?.type === 'subguide'
    ? referenceUpdates.find((item) => item.referenceNodeId === selectedNode.id)
    : undefined;
  const primaryNodes = document.nodes.filter(isPrimaryFlowNode);
  const annotationEditorNode = document.nodes.find((node): node is CanvasNode<'image'> => node.id === annotationEditorNodeId && node.type === 'image') ?? null;
  const stages = [...(document.stages ?? [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const lanes = [...(document.lanes ?? [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const hierarchyDeletionItem = hierarchyDeletion
    ? (hierarchyDeletion.kind === 'stage' ? stages : lanes).find((item) => item.id === hierarchyDeletion.id) ?? null
    : null;
  const hierarchyDeletionCount = hierarchyDeletion
    ? document.nodes.filter((node) => node[hierarchyDeletion.kind === 'stage' ? 'stageId' : 'laneId'] === hierarchyDeletion.id).length
    : 0;

  return <main className="editor-page">
    <header className="editor-header">
      <button className="icon-button" type="button" onClick={onBack} aria-label="返回资料库">←</button>
      <div className="editor-title"><input aria-label="指南标题" value={title} disabled={Boolean(layoutPreview)} onChange={(event) => { if (layoutPreview) return; setTitle(event.target.value); setSaveState('未保存'); }} /><span aria-live="polite">{guide.status === 'PUBLISHED' ? `已发布 v${guide.publishedVersion ?? 1}` : '草稿'} · {saveState}</span></div>
      <div className="editor-actions"><AppearanceToggle /><button className="secondary-button" type="button" onClick={() => void openDraftHistory()} disabled={Boolean(layoutPreview)} aria-label="草稿历史">草稿历史</button><button className="secondary-button" type="button" onClick={() => void save()} disabled={Boolean(layoutPreview)} aria-label="保存草稿">保存草稿</button><button className="primary-button" type="button" onClick={() => void publish()} disabled={Boolean(layoutPreview)} aria-label="发布指南">发布指南</button></div>
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
      <button type="button" onClick={removeSelected} disabled={Boolean(layoutPreview) || (selectedIds.length === 0 && !selectedEdgeId)} aria-label="删除选中项">删除</button>
      <span className="toolbar-divider" />
      <button type="button" className="reference-button" onClick={() => { setReferenceQuery(''); setReferenceResults([]); setReferenceError(''); setReferenceSearching(true); setReferenceOpen(true); }} disabled={Boolean(layoutPreview)} aria-label="插入子指南">＋ 插入子指南</button>
      {layoutPreview ? <div className="layout-preview" role="status"><div className="layout-preview-copy"><span>阶段从上到下 · 阶段内从左到右</span><div className="layout-preview-summary"><span>主流程 {layoutPreview.report.primaryNodeIds.length}</span><span>阶段 {layoutPreview.report.stageCount}</span><span>泳道 {layoutPreview.report.laneCount}</span><span>已挂靠资料 {layoutPreview.report.attachedContentIds.length}</span><span>未挂靠资料 {layoutPreview.report.unassignedContentIds.length}</span><span>孤立节点 {layoutPreview.report.unconnectedPrimaryIds.length}</span><span>循环 {layoutPreview.report.cycleNodeIds.length}</span><span>回流 {layoutPreview.report.backEdgeIds.length}</span><span>避障 {routing?.report.avoidedEdgeIds.length ?? 0}</span></div><span className="layout-preview-rule">入口 → 阶段 → 分支与回流 → 资料</span></div><button type="button" onClick={applyLayoutPreview} aria-label="应用自动整理">应用自动整理</button><button type="button" onClick={() => setLayoutPreview(null)} aria-label="取消自动整理">取消</button></div> : null}
    </div>
    <div className={`editor-workspace${hierarchyOpen ? '' : ' is-hierarchy-collapsed'}`}>
      <div className="hierarchy-panel-shell" aria-hidden={!hierarchyOpen}>
        <HierarchyPanel document={document} selectedIds={selectedIds} onSelect={selectAndFocus} onAddStage={addStage} onUpdateStage={updateStage} onMoveStage={moveStage} onRequestDeleteStage={(id) => requestHierarchyDeletion('stage', id)} onAddLane={addLane} onUpdateLane={updateLane} onMoveLane={moveLane} onRequestDeleteLane={(id) => requestHierarchyDeletion('lane', id)} editingLocked={Boolean(layoutPreview)} />
      </div>
      <section className="canvas-shell" aria-label="无限画布编辑区">
        <button className="hierarchy-panel-toggle" type="button" aria-label={hierarchyOpen ? '收起业务流程' : '展开业务流程'} aria-pressed={hierarchyOpen} onClick={() => setHierarchyOpen((current) => !current)}>
          {hierarchyOpen ? <CaretLeft size={22} weight="bold" aria-hidden="true" /> : <CaretRight size={22} weight="bold" aria-hidden="true" />}
        </button>
        <NodeAnchorPresentationProvider handlesByNodeId={nodeAnchorHandles}>
        <NodeDetailPresentationProvider value={{ expandedNodeIds: expandedDetailNodeIds, onOpenEditor: openNodeDetail, onToggleExpanded: toggleNodeDetail }}>
        <NodeActionProvider enabled={!layoutPreview} onDeleteNode={removeNodeById}>
        <InlineNodeEditingProvider value={{ enabled: !layoutPreview, updateText: updateInlineText }}>
        <ReactFlow
          nodes={renderedFlowNodes}
          edges={flowEdges}
          edgeTypes={edgeTypes}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onReconnect={onReconnect}
          onReconnectStart={onReconnectStart}
          onReconnectEnd={onReconnectEnd}
          onPointerDownCapture={startStageDrag}
          onPointerMoveCapture={moveStageDrag}
          onPointerUpCapture={finishStageDrag}
          onPaneClick={() => { setCreationMenu(null); setSelectedEdgeId(null); setManualRouteDraft(null); }}
          onSelectionChange={onSelectionChange}
          onMove={onMove}
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
          nodesDraggable={!layoutPreview && !manualRouteDraft}
          nodesConnectable={!layoutPreview}
          edgesReconnectable={!layoutPreview}
          edgesFocusable={!layoutPreview}
          elementsSelectable={!layoutPreview}
        >
          <ViewportPortal>
            {stageBounds.map((bound) => <div
              key={bound.stageId ?? 'none'}
              className={`stage-lane${draggedStageId === bound.stageId ? ' is-dragging' : ''}`}
              data-stage-id={bound.stageId ?? 'none'}
              style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height }}
            ><span className="stage-lane-label">{bound.title}</span></div>)}
            {!layoutPreview && manualRouteDraft && flowInstance ? <ManualRouteEditor
              points={manualRouteDraft.points}
              conflict={manualDraftConflict}
              onMoveSegment={moveManualRouteSegment}
              screenToFlowPosition={(point) => flowInstance.screenToFlowPosition(point)}
            /> : null}
          </ViewportPortal>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--ga-border-strong)" />
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
          <Controls showInteractive={false} />
        </ReactFlow>
        </InlineNodeEditingProvider>
        </NodeActionProvider>
        </NodeDetailPresentationProvider>
        </NodeAnchorPresentationProvider>
        <div className="canvas-screen-overlay">
          {alignmentGuide ? <AlignmentGuide guide={alignmentGuide} viewport={overlayViewport} /> : null}
          {creationMenu ? <CanvasCreationMenu position={canvasPointToScreen(creationMenu.position, overlayViewport)} allowResources onCreate={createFromConnection} onCancel={() => setCreationMenu(null)} /> : null}
          {edgeLabelEditor ? <EdgeLabelEditor position={canvasPointToScreen(edgeLabelEditor.position, overlayViewport)} {...(edgeLabelEditor.label !== undefined ? { label: edgeLabelEditor.label } : {})} onSave={saveEdgeLabel} onCancel={() => setEdgeLabelEditor(null)} /> : null}
          {!layoutPreview && selectedBusinessEdge && selectedEdgeRoute ? <EdgeToolbarAtRoute
            route={selectedEdgeRoute}
            viewport={overlayViewport}
            presentation={selectedBusinessEdge.presentation}
            onChange={updateSelectedEdgePresentation}
            onClose={() => { setSelectedEdgeId(null); setManualRouteDraft(null); }}
            routeEditing={manualRouteDraft?.edgeId === selectedBusinessEdge.id}
            manualRouteConflict={manualDraftConflict}
            onStartRouteEdit={startManualRouteEdit}
            onSaveRouteEdit={saveManualRouteEdit}
            onCancelRouteEdit={cancelManualRouteEdit}
            onResetRoute={resetSelectedRoute}
          /> : null}
        </div>
      </section>
      <aside className="inspector" aria-label="属性与教学步骤">
        <div><span className="eyebrow">GUIDE DETAILS</span><label>摘要<textarea value={summary} disabled={Boolean(layoutPreview)} onChange={(event) => { if (layoutPreview) return; setSummary(event.target.value); setSaveState('未保存'); }} /></label><label>标签<input value={tags.join('，')} disabled={Boolean(layoutPreview)} onChange={(event) => { if (layoutPreview) return; setTags(event.target.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean)); setSaveState('未保存'); }} /></label><button className="secondary-button guide-digest-open" type="button" onClick={() => void openDigest()} disabled={Boolean(layoutPreview)} aria-label="生成指南总览">生成指南总览</button></div>
        <hr />
        {selectedNode ? <NodeInspector node={selectedNode} primaryNodes={primaryNodes} stages={stages} lanes={lanes} onChange={updateSelectedNode} onToggleReference={() => void toggleReference()} {...(selectedReferenceUpdate ? { referenceUpdate: selectedReferenceUpdate } : {})} onUpgradeReference={() => void upgradeReference()} onAddStep={addStep} onEditAnnotations={() => setAnnotationEditorNodeId(selectedNode.type === 'image' ? selectedNode.id : null)} api={api} locked={Boolean(layoutPreview)} /> : <div className="inspector-empty"><strong>选择一个节点</strong><p>在这里编辑内容、媒体、步骤和子指南。</p></div>}
        <hr />
        <div className="step-summary"><div><span className="eyebrow">LESSON PATH</span><strong>{document.steps.length} 个教学步骤</strong></div>{[...document.steps].sort((a, b) => a.order - b.order).map((step, index) => <div className="step-row" key={step.id}><span>{index + 1}</span><p>{step.title}</p></div>)}</div>
      </aside>
    </div>
    {error ? <div className="toast-error" role="alert">{error}</div> : null}
    {referenceOpen ? <div className="modal-backdrop" role="presentation"><section className="reference-modal" role="dialog" aria-modal="true" aria-labelledby="reference-title"><button className="modal-close" onClick={() => { setReferenceOpen(false); setReferenceSearching(false); }} aria-label="关闭子指南搜索">×</button><span className="eyebrow">REUSE PUBLISHED GUIDE</span><h2 id="reference-title">插入固定版本子指南</h2><p>打开后会载入全部已发布指南；输入标题、标签或内容关键词即可即时筛选。</p><label className="sr-only" htmlFor="reference-search">搜索可复用指南</label><input id="reference-search" type="search" autoFocus placeholder="例如：物料、销售订单、VA01" aria-label="搜索可复用指南" value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} /><div className="reference-results" aria-live="polite">{referenceSearching ? <p className="status-line">正在载入可复用指南…</p> : null}{referenceError ? <p className="error-message" role="alert">{referenceError}</p> : null}{!referenceSearching && !referenceError && referenceResults.length === 0 ? <p className="muted">没有找到可引用的已发布指南。</p> : null}{referenceResults.map((item) => <article key={item.versionId}><div><strong>{item.title}</strong><span>v{item.version} · {item.authorName}</span></div><button className="secondary-button" type="button" onClick={() => insertReference(item)} aria-label={`插入 ${item.title}`}>插入</button></article>)}</div></section></div> : null}
    {annotationEditorNode ? <ImageAnnotationEditor node={annotationEditorNode} nodes={document.nodes} onClose={() => setAnnotationEditorNodeId(null)} onChange={(data) => commit({ ...document, nodes: document.nodes.map((node) => node.id === annotationEditorNode.id ? { ...annotationEditorNode, data } : node) })} onUploadSupplement={async (file) => {
      if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件。');
      const media = await api.uploadMedia(file);
      if (media.kind !== 'IMAGE') throw new Error('仅支持图片文件。');
      return { assetId: media.id, url: media.url, alt: file.name };
    }} /> : null}
    {hierarchyDeletion && hierarchyDeletionItem ? <HierarchyDeletionDialog kind={hierarchyDeletion.kind} title={hierarchyDeletionItem.title} affectedNodeCount={hierarchyDeletionCount} onConfirm={confirmHierarchyDeletion} onCancel={() => setHierarchyDeletion(null)} /> : null}
    {annotatedImageDeletion ? <AnnotatedImageDeletionDialog imageCount={annotatedImageDeletion.imageCount} annotationCount={annotatedImageDeletion.annotationCount} onConfirm={confirmAnnotatedImageDeletion} onCancel={() => setAnnotatedImageDeletion(null)} /> : null}
    {draftHistoryOpen ? <DraftHistoryDialog items={draftHistory} currentRevision={guide.revision} loading={draftHistoryLoading} error={draftHistoryError} onRestore={restoreDraftHistory} onClose={() => setDraftHistoryOpen(false)} /> : null}
    {digestOpen ? <GuideDigestDialog guide={guide} status={digestStatus} proposal={digestProposal} generating={digestGenerating} error={digestError} onReconcile={reconcileDigest} onGenerate={generateDigest} onReject={rejectDigest} onApply={applyDigest} onClose={() => setDigestOpen(false)} /> : null}
    {detailEditor ? <NodeDetailDialog nodeId={detailEditor.nodeId} title={detailEditor.title} value={detailEditor.value} openerRef={{ current: detailEditor.opener }} onSave={saveNodeDetail} onClose={() => setDetailEditor(null)} /> : null}
  </main>;
}

function hasUnsavedEditorChanges(
  latest: { document: CanvasDocument | null; title: string; summary: string; tags: string[] },
  saved: { document: CanvasDocument | null; title: string; summary: string; tags: string[] },
): boolean {
  return editorStateFingerprint(latest) !== editorStateFingerprint(saved);
}

function editorStateFingerprint(state: { document: CanvasDocument | null; title: string; summary: string; tags: string[] }): string {
  return JSON.stringify({ document: state.document, title: state.title, summary: state.summary, tags: state.tags });
}

export function removeHierarchyItem(document: CanvasDocument, kind: 'stage' | 'lane', itemId: string): CanvasDocument {
  if (kind === 'stage') {
    const stages = (document.stages ?? [])
      .filter((stage) => stage.id !== itemId)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((stage, order) => ({ ...stage, order }));
    return {
      ...document,
      stages,
      nodes: document.nodes.map((node) => {
        if (node.stageId !== itemId) return node;
        const { stageId: _stageId, ...withoutStage } = node;
        return withoutStage as CanvasNode;
      }),
    };
  }

  const lanes = (document.lanes ?? [])
    .filter((lane) => lane.id !== itemId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((lane, order) => ({ ...lane, order }));
  return {
    ...document,
    lanes,
    nodes: document.nodes.map((node) => {
      if (node.laneId !== itemId) return node;
      const { laneId: _laneId, ...withoutLane } = node;
      return withoutLane as CanvasNode;
    }),
  };
}

export function updateInlineNodeText(document: CanvasDocument, nodeId: string, field: InlineTextField, value: string): CanvasDocument {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    if (field === 'label' && isInlineEditableFlowNode(node)) {
      const label = value.trim();
      if (!label || node.data.label === label) return node;
      changed = true;
      return { ...node, data: { ...node.data, label } } as CanvasNode;
    }
    if (field === 'description' && isInlineEditableFlowNode(node)) {
      const data = { ...node.data } as CanvasNode<'process'>['data'];
      if (value.trim()) data.description = value;
      else delete data.description;
      if (node.data.description === data.description) return node;
      changed = true;
      return { ...node, data } as CanvasNode;
    }
    if (field === 'markdown' && node.type === 'markdown') {
      if (node.data.markdown === value) return node;
      changed = true;
      return { ...node, data: { markdown: value } };
    }
    if (field === 'imageCaption' && node.type === 'image') {
      const data = { ...node.data };
      if (value.trim()) data.caption = value;
      else delete data.caption;
      if (node.data.caption === data.caption) return node;
      changed = true;
      return { ...node, data };
    }
    if (field === 'videoCaption' && node.type === 'video') {
      const data = { ...node.data };
      if (value.trim()) data.caption = value;
      else delete data.caption;
      if (node.data.caption === data.caption) return node;
      changed = true;
      return { ...node, data };
    }
    return node;
  });
  return changed ? { ...document, nodes } : document;
}

function isInlineEditableFlowNode(node: CanvasNode): node is CanvasNode<'start' | 'end' | 'process' | 'decision' | 'data'> {
  return ['start', 'end', 'process', 'decision', 'data'].includes(node.type);
}

function NodeInspector({ node, primaryNodes, stages, lanes, onChange, onToggleReference, referenceUpdate, onUpgradeReference, onAddStep, onEditAnnotations, api, locked }: { node: CanvasNode; primaryNodes: CanvasNode[]; stages: FlowStage[]; lanes: FlowLane[]; onChange: (node: CanvasNode) => void; onToggleReference: () => void; referenceUpdate?: GuideReferenceUpdate; onUpgradeReference: () => void; onAddStep: () => void; onEditAnnotations: () => void; api: EditorApi; locked: boolean }) {
  const updateData = (data: CanvasNode['data']) => onChange({ ...node, data } as CanvasNode);
  const flowData = ['start', 'end', 'process', 'decision', 'data'].includes(node.type) ? node.data as CanvasNode<'process'>['data'] : null;
  return <fieldset className="node-inspector" disabled={locked}><div className="inspector-node-heading"><span>{node.type.toUpperCase()}</span><code>{node.id.slice(0, 18)}</code></div>
    {flowData ? <><label>节点标题<input value={flowData.label} onChange={(event) => updateData({ ...flowData, label: event.target.value } as CanvasNode['data'])} /></label><label>节点明细<textarea rows={4} value={flowData.description ?? ''} onChange={(event) => { const description = event.target.value.trim(); const { description: _previousDescription, ...withoutDescription } = flowData; updateData((description ? { ...withoutDescription, description: event.target.value } : withoutDescription) as CanvasNode['data']); }} /></label><p className="node-inspector-hint">支持 Markdown 标题、列表、链接和代码块。</p></> : null}
    {node.type === 'markdown' ? <label>Markdown<textarea rows={12} value={node.data.markdown} onChange={(event) => updateData({ markdown: event.target.value })} /></label> : null}
    {node.type === 'image' ? <><label>图片地址<input value={node.data.url} onChange={(event) => updateData({ ...node.data, url: event.target.value })} /></label><label>替代文字<input value={node.data.alt} onChange={(event) => updateData({ ...node.data, alt: event.target.value })} /></label><label>图片说明<textarea value={node.data.caption ?? ''} onChange={(event) => updateData({ ...node.data, caption: event.target.value })} /></label><button className="secondary-button" type="button" onClick={onEditAnnotations} aria-label="编辑图片标注">编辑图片标注（{node.data.annotations?.length ?? 0}）</button><label className="upload-label">上传图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const asset = await api.uploadMedia(file); updateData({ ...node.data, assetId: asset.id, url: asset.url }); }} /></label></> : null}
    {node.type === 'video' ? <><label>视频地址<input value={node.data.url} onChange={(event) => updateData({ ...node.data, url: event.target.value })} /></label><label>视频说明<textarea value={node.data.caption ?? ''} onChange={(event) => updateData({ ...node.data, caption: event.target.value })} /></label><div className="keypoint-editor">{node.data.keypoints.map((point, index) => <div key={point.id}><input aria-label={`关键点 ${index + 1} 标题`} value={point.title} onChange={(event) => updateData({ ...node.data, keypoints: node.data.keypoints.map((item) => item.id === point.id ? { ...item, title: event.target.value } : item) })} /><input type="number" min="0" aria-label={`关键点 ${index + 1} 秒数`} value={point.timeSeconds} onChange={(event) => updateData({ ...node.data, keypoints: node.data.keypoints.map((item) => item.id === point.id ? { ...item, timeSeconds: Number(event.target.value) } : item) })} /></div>)}<button type="button" onClick={() => updateData({ ...node.data, keypoints: [...node.data.keypoints, { id: uniqueId('keypoint'), title: '新关键点', timeSeconds: 0 }] })}>添加视频关键点</button></div><label className="upload-label">上传视频<input type="file" accept="video/mp4,video/webm" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const asset = await api.uploadMedia(file); updateData({ ...node.data, assetId: asset.id, url: asset.url }); }} /></label></> : null}
    {node.type === 'subguide' ? <><div className="pinned-version"><strong>{node.data.title}</strong><span>固定版本 v{node.data.version}</span></div>{referenceUpdate ? <div className="reference-update"><span>发现 v{referenceUpdate.latestVersion}（当前 v{referenceUpdate.currentVersion}）</span><button className="secondary-button" type="button" onClick={onUpgradeReference} aria-label={`采用 ${referenceUpdate.latestTitle} v${referenceUpdate.latestVersion}`}>采用 v{referenceUpdate.latestVersion}</button></div> : null}<button className="secondary-button" type="button" onClick={onToggleReference} aria-label={node.data.expanded ? '折叠子指南' : '展开子指南'}>{node.data.expanded ? '折叠子指南' : '展开子指南'}</button></> : null}
    {isPrimaryFlowNode(node) ? <><label>所属业务阶段<select value={node.stageId ?? ''} onChange={(event) => onChange({ ...node, stageId: event.target.value || undefined })}><option value="">未分阶段</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label><label>责任泳道<select value={node.laneId ?? ''} onChange={(event) => onChange({ ...node, laneId: event.target.value || undefined })}><option value="">未分配责任</option>{lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.title}</option>)}</select></label></> : null}
    {isContentNode(node) ? <><p className="node-inspector-hint">资料可通过画布连线被多个节点引用。</p><label>旧版层级挂靠（兼容）<select value={node.contentParentId ?? ''} onChange={(event) => onChange({ ...node, contentParentId: event.target.value || undefined })}><option value="">未挂靠</option>{primaryNodes.map((primary) => <option key={primary.id} value={primary.id}>{nodeLabel(primary)}</option>)}</select></label></> : null}
    <button className="secondary-button" type="button" onClick={onAddStep}>加入教学步骤</button>
  </fieldset>;
}

function createNode(id: string, type: CanvasNode['type'], index: number, position?: { x: number; y: number }): CanvasNode {
  const createdPosition = position ?? { x: 80 + (index % 3) * 380, y: 80 + Math.floor(index / 3) * 300 };
  const base = { id, type, position: createdPosition, zIndex: index + 1 };
  switch (type) {
    case 'start': return { ...base, type, data: { label: '开始', shape: 'start' } };
    case 'end': return { ...base, type, data: { label: '结束', shape: 'end' } };
    case 'process': return { ...base, type, data: { label: '操作步骤', shape: 'process' } };
    case 'decision': return { ...base, type, data: { label: '条件成立？', shape: 'decision', branchLabels: ['是', '否'] } };
    case 'data': return { ...base, type, data: { label: '业务数据', shape: 'data' } };
    case 'markdown': return { ...base, type, data: { markdown: '## 操作说明\n\n在这里填写 ERP 操作步骤和字段规则。' } };
    case 'image': return { ...base, type, data: { url: 'https://placehold.co/640x360/png?text=ERP+Screenshot', alt: 'ERP 操作界面截图', caption: '点击右侧属性面板上传真实截图。', annotations: [] } };
    case 'video': return { ...base, type, data: { url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', caption: 'ERP 操作演示', keypoints: [] } };
    case 'subguide': throw new Error('subguide nodes must be created from a published version');
  }
}

export function persistableNodeChanges(changes: NodeChange<Node>[], expandedNodeIds: ReadonlySet<string> = noExpandedDetails): NodeChange<Node>[] {
  return changes.filter((change) =>
    change.type === 'remove' ||
    (change.type === 'position' && change.dragging !== true) ||
    (change.type === 'dimensions' && !expandedNodeIds.has(change.id) && change.resizing === false && Boolean(change.dimensions)),
  );
}

export function removeNodesFromDocument(document: CanvasDocument, nodeIds: string[]): CanvasDocument {
  const removed = new Set(nodeIds);
  return {
    ...document,
    nodes: document.nodes.filter((node) => !removed.has(node.id)).map((node) =>
      !node.source && isContentNode(node) && node.contentParentId && removed.has(node.contentParentId)
        ? { ...node, contentParentId: undefined }
        : node,
    ),
    edges: document.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
    steps: document.steps.filter((step) => !removed.has(step.nodeId)),
    exitNodeIds: document.exitNodeIds.filter((id) => !removed.has(id)),
    ...(document.entryNodeId && removed.has(document.entryNodeId) ? { entryNodeId: undefined } : {}),
  } as CanvasDocument;
}

export function removeEdgesFromDocument(document: CanvasDocument, edgeIds: string[]): CanvasDocument {
  const removed = new Set(edgeIds);
  return { ...document, edges: document.edges.filter((edge) => !removed.has(edge.id)) };
}

export function toFlowNodes(nodes: CanvasDocument['nodes'], selectedIds: string[] = [], lanes: FlowLane[] = [], expandedNodeIds: ReadonlySet<string> = noExpandedDetails): Node[] {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  return nodes.map((node) => {
    const size = node.size ?? defaultCanvasNodeSize(node);
    const detailExpanded = expandedNodeIds.has(node.id);
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        ...node.data,
        detailExpanded,
        ...(isPrimaryFlowNode(node) && node.laneId && laneById.has(node.laneId) ? { responsibility: pickResponsibility(laneById.get(node.laneId)!) } : {}),
      } as unknown as Record<string, unknown>,
      ...(node.hidden === undefined ? {} : { hidden: node.hidden }),
      zIndex: node.zIndex,
      className: node.contentParentId ? 'context-node' : 'primary-node',
      selected: selectedIds.includes(node.id),
      style: detailExpanded ? { width: size.width } : { width: size.width, height: size.height },
      ...(node.size && !detailExpanded ? { measured: { width: node.size.width, height: node.size.height } } : {}),
    };
  });
}

export function physicalHandleId(edgeId: string, end: 'source' | 'target'): string {
  return `edge:${edgeId}:${end}`;
}

function EdgeToolbarAtRoute({ route, viewport, presentation, onChange, onClose, routeEditing, manualRouteConflict, onStartRouteEdit, onSaveRouteEdit, onCancelRouteEdit, onResetRoute }: {
  route: OrthogonalRoute;
  viewport: CanvasDocument['viewport'];
  presentation: EdgePresentation | undefined;
  onChange: (partial: Partial<EdgePresentation>) => void;
  onClose: () => void;
  routeEditing: boolean;
  manualRouteConflict: boolean;
  onStartRouteEdit: () => void;
  onSaveRouteEdit: () => void;
  onCancelRouteEdit: () => void;
  onResetRoute: () => void;
}) {
  const position = canvasPointToScreen(routeLabelPoint(route.points), viewport);
  return <div className="edge-toolbar-position" style={{ left: position.x, top: position.y }}>
    <EdgeToolbar
      presentation={presentation}
      onChange={onChange}
      onClose={onClose}
      routeEditing={routeEditing}
      manualRouteConflict={manualRouteConflict}
      onStartRouteEdit={onStartRouteEdit}
      onSaveRouteEdit={onSaveRouteEdit}
      onCancelRouteEdit={onCancelRouteEdit}
      onResetRoute={onResetRoute}
    />
  </div>;
}

function canvasPointToScreen(point: { x: number; y: number }, viewport: CanvasDocument['viewport']) {
  return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y };
}

function flowPointFromScreen(instance: ReactFlowInstance<Node, Edge> | null, viewport: CanvasDocument['viewport'], point: { x: number; y: number }): Point {
  if (instance) return instance.screenToFlowPosition(point);
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

function AlignmentGuide({ guide, viewport }: { guide: NodeAlignmentSnap; viewport: CanvasDocument['viewport'] }) {
  const position = canvasPointToScreen(
    guide.axis === 'y' ? { x: 0, y: guide.coordinate } : { x: guide.coordinate, y: 0 },
    viewport,
  );
  return <div
    aria-hidden="true"
    className={`canvas-alignment-guide is-${guide.axis}`}
    style={guide.axis === 'y' ? { top: position.y } : { left: position.x }}
  />;
}

function sameViewport(left: CanvasDocument['viewport'], right: CanvasDocument['viewport']) {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}

function renderEdge(document: CanvasDocument, edge: CanvasEdge, route: OrthogonalRoute | undefined): Edge {
  const source = document.nodes.find((node) => node.id === edge.source);
  const visuals = resolveEdgeVisuals(edge.presentation);
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    sourceHandle: route ? physicalHandleId(edge.id, 'source') : edge.sourceHandle ?? (source?.type === 'decision' ? 'yes' : 'out'),
    targetHandle: route ? physicalHandleId(edge.id, 'target') : edge.targetHandle ?? 'in',
    type: route ? 'orthogonal' : 'smoothstep',
    ...visuals,
    data: { ...(route ? { route } : {}), canvasEdge: edge },
  };
}

function anchorHandlesByNodeId(document: CanvasDocument, routing: ReturnType<typeof routeCanvasEdges>): Map<string, NodeAnchorHandle[]> {
  const handlesByNodeId = new Map<string, NodeAnchorHandle[]>();
  const add = (nodeId: string, handle: NodeAnchorHandle) => {
    const handles = handlesByNodeId.get(nodeId);
    if (handles) handles.push(handle);
    else handlesByNodeId.set(nodeId, [handle]);
  };
  document.edges.forEach((edge) => {
    if (!isEditableBusinessEdge(document, edge)) return;
    const route = routing.routesByEdgeId.get(edge.id);
    if (!route) return;
    add(edge.source, { id: physicalHandleId(edge.id, 'source'), type: 'source', side: route.sourceAnchor.side, offset: route.sourceAnchor.offset });
    add(edge.target, { id: physicalHandleId(edge.id, 'target'), type: 'target', side: route.targetAnchor.side, offset: route.targetAnchor.offset });
  });
  return handlesByNodeId;
}

function canvasEdgeFromFlowEdge(edge: Edge, document: CanvasDocument): CanvasEdge | undefined {
  const canvasEdge = (edge.data as { canvasEdge?: CanvasEdge } | undefined)?.canvasEdge;
  return canvasEdge ?? document.edges.find((candidate) => candidate.id === edge.id);
}

function isPhysicalAnchorHandle(handle: string | null | undefined): boolean {
  return Boolean(handle?.startsWith('anchor-') || handle?.startsWith('edge:'));
}

function anchorFromPhysicalHandle(handle: string | null | undefined): EdgeAnchor | undefined {
  const match = handle?.match(/^anchor-(?:source|target)-(TOP|RIGHT|BOTTOM|LEFT)$/);
  return match ? { side: match[1] as EdgeAnchor['side'], offset: 0.5 } : undefined;
}

function semanticSourceHandle(source: CanvasNode, handle?: string | null): string {
  if (handle && !isPhysicalAnchorHandle(handle)) return handle;
  return source.type === 'decision' ? 'yes' : 'out';
}

function semanticTargetHandle(handle?: string | null): string {
  return handle && !isPhysicalAnchorHandle(handle) ? handle : 'in';
}

function edgePresentationWithAnchors(existing: EdgePresentation | undefined, sourceAnchor: EdgeAnchor | undefined, targetAnchor: EdgeAnchor | undefined): EdgePresentation | undefined {
  const presentation = {
    ...existing,
    ...(sourceAnchor ? { sourceAnchor } : {}),
    ...(targetAnchor ? { targetAnchor } : {}),
  };
  return Object.keys(presentation).length > 0 ? presentation : undefined;
}

function anchorForNodeClientPoint(nodeId: string, point: { x: number; y: number }): EdgeAnchor | undefined {
  const escapedId = nodeId.replace(/"/g, '\\"');
  const element = globalThis.document?.querySelector<HTMLElement>(`.react-flow__node[data-id="${escapedId}"]`);
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  return edgeAnchorFromClientPoint(rect, point);
}

export function hierarchyPresentationEdges(document: CanvasDocument): Edge[] {
  return document.nodes.filter((node) => isContentNode(node) && node.contentParentId && !node.hidden).map((node) => ({
    id: `hierarchy:${node.id}`,
    source: node.contentParentId!,
    target: node.id,
    sourceHandle: document.nodes.find((candidate) => candidate.id === node.contentParentId)?.type === 'decision' ? 'yes' : 'out',
    targetHandle: 'in',
    type: 'smoothstep',
    selectable: false,
    style: { stroke: '#9a6a42', strokeDasharray: '5 5', strokeWidth: 1.5 },
  }));
}

export function displayEdgeHandles(document: CanvasDocument, edge: CanvasEdge): CanvasEdge {
  const source = document.nodes.find((node) => node.id === edge.source);
  return {
    ...edge,
    sourceHandle: edge.sourceHandle ?? (source?.type === 'decision' ? 'yes' : 'out'),
    targetHandle: edge.targetHandle ?? 'in',
  };
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
      const data = stripPresentationData(node.data);
      return {
        ...source,
        data: data as CanvasNode['data'],
        position: node.position,
        zIndex: node.zIndex ?? source.zIndex,
        ...(node.hidden === undefined ? {} : { hidden: node.hidden }),
        ...(width && height ? { size: { width, height } } : {}),
      } as CanvasNode;
    }),
  };
}

function documentWithPositionChanges(document: CanvasDocument, changes: NodeChange<Node>[]): CanvasDocument {
  const positions = new Map(changes.flatMap((change) => change.type === 'position' && change.position
    ? [[change.id, change.position] as const]
    : []));
  if (positions.size === 0) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    }),
  };
}

function stripPresentationData(data: Record<string, unknown>): Record<string, unknown> {
  const { responsibility: _responsibility, detailExpanded: _detailExpanded, ...persisted } = data;
  return persisted;
}

function pickResponsibility(lane: FlowLane): { title: string; kind: FlowLane['kind'] } {
  return { title: lane.title, kind: lane.kind };
}

export function toCanvasEdge(edge: Edge): CanvasEdge {
  const sourceTrace = (edge as Edge & Pick<CanvasEdge, 'sourceTrace'>).sourceTrace;
  const presentation = (edge as Edge & Pick<CanvasEdge, 'presentation'>).presentation
    ?? (edge.data as { canvasEdge?: CanvasEdge } | undefined)?.canvasEdge?.presentation;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
    ...(edge.hidden === undefined ? {} : { hidden: edge.hidden }),
    ...(sourceTrace ? { sourceTrace } : {}),
    ...(presentation ? { presentation } : {}),
  };
}

function maxZIndex(document: CanvasDocument): number {
  return document.nodes.reduce((maximum, node) => Math.max(maximum, node.zIndex), 0);
}

function uniqueId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function isCanvasInteractionSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('.react-flow'))
    && !target.closest('.react-flow__controls, .react-flow__minimap');
}

function clientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('touches' in event && event.touches.length > 0) return { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
  if ('changedTouches' in event && event.changedTouches.length > 0) return { x: event.changedTouches[0]!.clientX, y: event.changedTouches[0]!.clientY };
  return 'clientX' in event ? { x: event.clientX, y: event.clientY } : { x: 0, y: 0 };
}

function moveOrderedItem<T extends { id: string; order: number }>(items: T[], id: string, direction: -1 | 1): T[] | null {
  const ordered = [...items].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const index = ordered.findIndex((item) => item.id === id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return null;
  const [item] = ordered.splice(index, 1);
  ordered.splice(targetIndex, 0, item!);
  return ordered.map((current, order) => ({ ...current, order }));
}

function nodeLabel(node: CanvasNode): string {
  if (node.type === 'subguide') return node.data.title;
  if (node.type === 'markdown') return node.data.markdown.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 80) || 'Markdown 说明';
  if (node.type === 'image') return node.data.caption || node.data.alt;
  if (node.type === 'video') return node.data.caption || '视频资料';
  return node.data.label;
}

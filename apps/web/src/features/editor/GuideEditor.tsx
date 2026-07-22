import type { CanvasDocument, CanvasEdge, CanvasNode, EdgeAnchor, EdgeAnchorMode, EdgePresentation, FlowLane, FlowStage, GuideDraftHistorySnapshot, GuideReferenceUpdate, GuideVersionSnapshot } from '@guideanything/contracts';
import { CanvasDocumentSchema } from '@guideanything/contracts';
import { defaultCanvasNodeSize, deriveSemanticFlow, duplicateSelection, expandSubguide, getStageBounds, hasSemanticFlow, HistoryStack, isContentNode, isPrimaryFlowNode, layoutFlowHierarchy, movePrimaryNodeToStage, moveRouteSegment, reconcileSubguideEdges, renumberSemanticFlow, replaceSubguideReference, routeCanvasEdges, setSubguideExpanded, snapNodeForStraightRoute, translateStageNodes, type HierarchyLayoutResult, type NodeAlignmentSnap, type OrthogonalRoute, type Point } from '@guideanything/canvas-core';
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
import { ArrowLeft, ChartLineUp, ClockCounterClockwise, CaretLeft, CaretRight, Eye, EyeSlash, FloppyDisk, UploadSimple } from '@phosphor-icons/react';

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
import { GuideSummaryDialog } from './GuideSummaryDialog';
import { FlowRegressionPanel, type FlowRegressionEditorApi } from './FlowRegressionPanel';
import { ImageAnnotationEditor } from './ImageAnnotationEditor';
import { ImageReplacementDialog } from './ImageReplacementDialog';
import { OrthogonalEdge } from './OrthogonalEdge';
import { reorderHierarchyItems, type HierarchyDropPlacement } from './hierarchy-order';
import { CanvasCreationMenu, type CanvasCreationKind } from './CanvasCreationMenu';
import { EdgeLabelEditor, type EdgeLabelValue } from './EdgeLabelEditor';
import { NodeDetailDialog } from './NodeDetailDialog';
import { EdgeToolbar } from './EdgeToolbar';
import { CanvasLayoutPreviewDialog } from './CanvasLayoutPreviewDialog';
import { EditorToolbar } from './EditorToolbar';
import { ManualRouteEditor } from './ManualRouteEditor';
import { edgeAnchorFromClientPoint, edgePresentationForPathStyle, isEditableBusinessEdge, resetEdgeRoutePresentation, resolveEdgeVisuals } from './edge-presentation';
import { findNearestEndpointSnap, pointForEndpointAnchor } from './edge-anchor-snap';
import { routeLabelPoint } from './OrthogonalEdge';
import { connectSemanticNodes, insertSemanticNode, moveSemanticOutlineNode } from './semantic-node-actions';
import { GuideDetailsHeader } from './GuideDetailsHeader';
import { CanvasSwimlanes, getCanvasSwimlaneBounds } from './CanvasSwimlanes';
import { ResourceAppendixAnchorNode, resourceAppendixAnchorHandles, resourceAppendixTargetHandleId, type ResourceAppendixAnchorSide } from './ResourceAppendixAnchorNode';
import { EditorDialogSurface } from './EditorDialogSurface';

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

export interface EditorApi extends FlowRegressionEditorApi {
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
  'resource-appendix-anchor': ResourceAppendixAnchorNode,
};

const edgeTypes: EdgeTypes = { orthogonal: OrthogonalEdge };
const defaultEdgeOptions = { type: 'orthogonal', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--ga-accent)', strokeWidth: 2 } };
const snapGrid: [number, number] = [20, 20];
const multiSelectionKeyCode = ['Meta', 'Control'];
const noExpandedDetails = new Set<string>();

function semanticCodeByNodeId(document: CanvasDocument): Map<string, string> {
  return new Map(deriveSemanticFlow(document).items.map((item) => [item.nodeId, item.code]));
}

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
  sourceAnchor: EdgeAnchor;
  sourceAnchorMode: EdgeAnchorMode;
  targetAnchor: EdgeAnchor;
  targetAnchorMode: EdgeAnchorMode;
};

function manualRoutePresentation(presentation: EdgePresentation | undefined, draft: ManualRouteDraft): EdgePresentation {
  return {
    ...presentation,
    routeMode: 'manual',
    waypoints: draft.points.slice(1, -1),
    sourceAnchor: draft.sourceAnchor,
    sourceAnchorMode: draft.sourceAnchorMode,
    targetAnchor: draft.targetAnchor,
    targetAnchorMode: draft.targetAnchorMode,
  };
}

type StageDrag = {
  stageId: string;
  start: Point;
};

type PendingImageReplacement = {
  nodeId: string;
  file: File;
  annotationCount: number;
};

export function GuideEditor({ guideId, api, personalApi, focusNodeId, focusAnnotationId, onBack, onExport }: { guideId: string; api: EditorApi; personalApi?: PersonalApi; focusNodeId?: string; focusAnnotationId?: string; onBack: () => void; onExport?: () => void }) {
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
  const [edgeLabelEditor, setEdgeLabelEditor] = useState<{ edgeId: string; label?: string; labelFontSize?: number; position: { x: number; y: number } } | null>(null);
  const [hierarchyDeletion, setHierarchyDeletion] = useState<{ kind: 'stage' | 'lane'; id: string } | null>(null);
  const [annotatedImageDeletion, setAnnotatedImageDeletion] = useState<{ nodeIds: string[]; imageCount: number; annotationCount: number } | null>(null);
  const [imageReplacement, setImageReplacement] = useState<PendingImageReplacement | null>(null);
  const [imageReplacementUploading, setImageReplacementUploading] = useState(false);
  const [draftHistoryOpen, setDraftHistoryOpen] = useState(false);
  const [draftHistory, setDraftHistory] = useState<GuideDraftHistorySnapshot[]>([]);
  const [draftHistoryLoading, setDraftHistoryLoading] = useState(false);
  const [draftHistoryError, setDraftHistoryError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
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
  const programmaticViewportRef = useRef<CanvasDocument['viewport'] | null>(null);
  const appliedFocusRef = useRef<string | null>(null);
  const stageDragRef = useRef<StageDrag | null>(null);
  const latestEditorStateRef = useRef<{ document: CanvasDocument | null; title: string; summary: string; tags: string[] }>({ document: null, title: '', summary: '', tags: [] });
  const saveRef = useRef<() => Promise<GuideDraftDetail | undefined>>(async () => undefined);
  const summaryTriggerRef = useRef<HTMLButtonElement>(null);
  const digestTriggerRef = useRef<HTMLButtonElement>(null);
  const digestWasOpenRef = useRef(false);
  const appliedAnnotationFocusRef = useRef<string | null>(null);
  guideRef.current = guide;
  saveStateRef.current = saveState;
  latestEditorStateRef.current = { document, title, summary, tags };

  useEffect(() => {
    if (digestOpen) {
      digestWasOpenRef.current = true;
      return;
    }
    if (!digestWasOpenRef.current) return;
    digestWasOpenRef.current = false;
    digestTriggerRef.current?.focus();
  }, [digestOpen]);

  useEffect(() => {
    if (layoutPreview) setSummaryOpen(false);
  }, [layoutPreview]);

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
    if (!document || !focusNodeId || !focusAnnotationId) return;
    const node = document.nodes.find((item): item is CanvasNode<'image'> => item.id === focusNodeId && item.type === 'image');
    if (!node || !node.data.annotations?.some((annotation) => annotation.id === focusAnnotationId)) return;
    const focusKey = `${guideId}:${focusNodeId}:${focusAnnotationId}`;
    if (appliedAnnotationFocusRef.current === focusKey) return;
    appliedAnnotationFocusRef.current = focusKey;
    setSelectedIds([focusNodeId]);
    setAnnotationEditorNodeId(focusNodeId);
  }, [document, focusAnnotationId, focusNodeId, guideId]);

  useEffect(() => {
    let active = true;
    api.getGuide(guideId).then((loaded) => {
      if (!active) return;
      const validated = CanvasDocumentSchema.parse(loaded.document);
      const normalized = reconcileSubguideEdges(validated);
      const needsPersistenceRepair = normalized !== validated;
      setGuide(loaded);
      setDocument(normalized);
      setFlowNodes(toFlowNodes(normalized.nodes, [], normalized.lanes, noExpandedDetails, semanticCodeByNodeId(normalized)));
      setTitle(loaded.title);
      setSummary(loaded.summary);
      setTags(loaded.tags);
      setSaveState(needsPersistenceRepair ? '未保存' : '已保存');
      savedEditorStateRef.current = { document: needsPersistenceRepair ? validated : normalized, title: loaded.title, summary: loaded.summary, tags: loaded.tags };
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
    setFlowNodes(toFlowNodes(validated.nodes, selectedIds, validated.lanes, expandedDetailNodeIds, semanticCodeByNodeId(validated)));
    setSaveState('未保存');
  }, [expandedDetailNodeIds, selectedIds]);

  const replaceImage = useCallback(async (nodeId: string, file: File): Promise<boolean> => {
    setError('');
    try {
      const asset = await api.uploadMedia(file);
      if (asset.kind !== 'IMAGE') throw new Error('仅支持图片文件。');
      const currentDocument = latestEditorStateRef.current.document;
      const currentNode = currentDocument?.nodes.find((node) => node.id === nodeId);
      if (!currentDocument || !currentNode || currentNode.type !== 'image') throw new Error('图片节点已不存在，无法替换图片。');
      commit({
        ...currentDocument,
        nodes: currentDocument.nodes.map((node) => node.id === nodeId && node.type === 'image'
          ? { ...node, data: { ...node.data, assetId: asset.id, url: asset.url, annotations: [] } }
          : node),
      });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片上传失败');
      return false;
    }
  }, [api, commit]);

  const requestImageUpload = useCallback((nodeId: string, file: File) => {
    if (!document || layoutPreview) return;
    const node = document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== 'image') return;
    const annotationCount = node.data.annotations?.length ?? 0;
    if (annotationCount > 0) {
      setImageReplacement({ nodeId, file, annotationCount });
      return;
    }
    void replaceImage(nodeId, file);
  }, [document, layoutPreview, replaceImage]);

  const confirmImageReplacement = useCallback(async () => {
    if (!imageReplacement || imageReplacementUploading) return;
    setImageReplacementUploading(true);
    try {
      if (hasUnsavedEditorChanges(latestEditorStateRef.current, savedEditorStateRef.current)) {
        const saved = await saveRef.current();
        if (!saved) throw new Error('旧图片及标注尚未保存，无法替换图片。');
      }
      const replaced = await replaceImage(imageReplacement.nodeId, imageReplacement.file);
      if (replaced) setImageReplacement(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片替换前的草稿保存失败');
    } finally {
      setImageReplacementUploading(false);
    }
  }, [imageReplacement, imageReplacementUploading, replaceImage]);

  const updateEdgeLabelOffset = useCallback((edgeId: string, labelOffset: number) => {
    if (!document || layoutPreview) return;
    const edge = document.edges.find((candidate) => candidate.id === edgeId);
    if (!edge || !edge.label) return;
    commit({
      ...document,
      edges: document.edges.map((candidate) => candidate.id === edgeId
        ? { ...candidate, presentation: { ...candidate.presentation, labelOffset } }
        : candidate),
    });
  }, [commit, document, layoutPreview]);

  const openEdgeLabelEditor = useCallback((edgeId: string, event: { clientX: number; clientY: number }) => {
    if (layoutPreview || !document || edgeId.startsWith('hierarchy:')) return;
    const persisted = document.edges.find((candidate) => candidate.id === edgeId);
    if (!persisted || persisted.sourceTrace) return;
    setEdgeLabelEditor({
      edgeId: persisted.id,
      ...(persisted.label ? { label: persisted.label } : {}),
      ...(persisted.presentation?.labelFontSize ? { labelFontSize: persisted.presentation.labelFontSize } : {}),
      position: flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: event.clientX, y: event.clientY },
    });
  }, [document, flowInstance, layoutPreview]);

  const renderedDocument = useMemo(() => {
    const baseDocument = layoutPreview?.document ?? dragPreviewDocument ?? document;
    return baseDocument ? documentWithMeasuredNodeSizes(baseDocument, flowNodes) : null;
  }, [document, dragPreviewDocument, flowNodes, layoutPreview]);
  const routing = useMemo(() => renderedDocument ? routeCanvasEdges(renderedDocument) : null, [renderedDocument]);
  const manualRouteDocument = useMemo(() => {
    if (!renderedDocument || !manualRouteDraft) return null;
    return {
      ...renderedDocument,
      edges: renderedDocument.edges.map((edge) => edge.id === manualRouteDraft.edgeId
        ? { ...edge, presentation: manualRoutePresentation(edge.presentation, manualRouteDraft) }
        : edge),
    };
  }, [manualRouteDraft, renderedDocument]);
  const manualDraftRouting = useMemo(() => manualRouteDocument ? routeCanvasEdges(manualRouteDocument) : null, [manualRouteDocument]);
  const manualDraftConflict = Boolean(manualRouteDraft && manualDraftRouting?.report.manualConflictEdgeIds.includes(manualRouteDraft.edgeId));
  const manualDraftConflictNodeLabels = manualRouteDraft && manualDraftRouting
    ? (manualDraftRouting.report.manualConflictNodeIdsByEdgeId.get(manualRouteDraft.edgeId) ?? [])
      .map((nodeId) => renderedDocument?.nodes.find((node) => node.id === nodeId))
      .filter((node): node is CanvasNode => Boolean(node))
      .map(nodeLabel)
    : [];
  const manualDraftConflictMessage = manualDraftConflict
    ? manualDraftConflictNodeLabels.length > 0
      ? `手动路线被节点阻挡：${manualDraftConflictNodeLabels.join('、')}`
      : '手动路线被节点阻挡：请把当前线段移到节点外侧'
    : undefined;
  const flowEdges = useMemo(() => renderedDocument ? [
    ...renderedDocument.edges.filter((edge) => edge.semantic?.kind !== 'RESOURCE_REFERENCE').map((edge) => {
      const route = routing?.routesByEdgeId.get(edge.id);
      const displayRoute = route && manualRouteDraft?.edgeId === edge.id
        ? {
          ...route,
          points: manualRouteDraft.points,
          collision: manualDraftConflict,
          bridges: [],
          directPathSafe: false,
          smoothSegments: [],
          smoothPathSafe: false,
        }
        : route;
      return renderEdge(
        renderedDocument,
        edge,
        displayRoute,
        flowInstance?.screenToFlowPosition,
        (labelOffset) => updateEdgeLabelOffset(edge.id, labelOffset),
        (event) => openEdgeLabelEditor(edge.id, event),
        !layoutPreview && selectedEdgeId === edge.id,
        !layoutPreview && manualRouteDraft?.edgeId === edge.id,
      );
    }),
    ...hierarchyPresentationEdges(renderedDocument),
  ] : [], [flowInstance, layoutPreview, manualDraftConflict, manualRouteDraft, openEdgeLabelEditor, renderedDocument, routing, selectedEdgeId, updateEdgeLabelOffset]);
  const nodeAnchorHandles = useMemo(() => renderedDocument && routing ? anchorHandlesByNodeId(renderedDocument, routing) : new Map<string, NodeAnchorHandle[]>(), [renderedDocument, routing]);
  const renderedFlowNodes = useMemo(() => {
    const preview = layoutPreview?.document ?? (draggedStageId ? dragPreviewDocument : null);
    const baseNodes = preview ? toFlowNodes(preview.nodes, selectedIds, preview.lanes, expandedDetailNodeIds, semanticCodeByNodeId(preview)) : flowNodes;
    return renderedDocument ? [...baseNodes, ...resourceAppendixAnchorNodes(renderedDocument)] : baseNodes;
  }, [dragPreviewDocument, draggedStageId, expandedDetailNodeIds, flowNodes, layoutPreview, renderedDocument, selectedIds]);
  const stageBounds = useMemo(() => renderedDocument ? getStageBounds(renderedDocument) : [], [renderedDocument]);
  const swimlaneBounds = useMemo(() => renderedDocument ? getCanvasSwimlaneBounds(renderedDocument, stageBounds) : [], [renderedDocument, stageBounds]);
  const appendixGroups = useMemo(() => renderedDocument ? resourceAppendixGroups(renderedDocument) : [], [renderedDocument]);
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
    const authoredChanges = changes.filter((change) => !('id' in change) || !isResourceAppendixAnchorId(change.id));
    // Snap against the same measured node geometry used by the renderer. A
    // saved node size can lag behind text wrapping, which otherwise makes a
    // visually aligned drag miss the snap target.
    const dimensionChanges = authoredChanges.filter((change) => change.type === 'dimensions');
    const measuredFlowNodes = dimensionChanges.length > 0
      ? applyNodeChanges(dimensionChanges, flowNodes)
      : flowNodes;
    const snapDocument = document ? documentWithMeasuredNodeSizes(document, measuredFlowNodes) : null;
    const snappedChanges = snapDocument ? authoredChanges.map((change) => {
      if (change.type !== 'position' || !change.position) return change;
      const snap = snapNodeForStraightRoute(snapDocument, change.id, change.position);
      return snap ? { ...change, position: snap.position } : change;
    }) : authoredChanges;
    const snapping = snapDocument ? snappedChanges.flatMap((change) => {
      if (change.type !== 'position' || !change.position) return [];
      const snap = snapNodeForStraightRoute(snapDocument, change.id, change.position);
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
      const changed = applyNodeChanges(persistedChanges, toFlowNodes(current.nodes, selectedIds, current.lanes, expandedDetailNodeIds, semanticCodeByNodeId(current)));
      const next = reconcileSubguideEdges(CanvasDocumentSchema.parse(fromFlowNodes(current, changed)));
      historyRef.current?.push(next);
      return next;
    });
  }, [document, expandedDetailNodeIds, flowNodes, layoutPreview, selectedIds]);

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
    const sourceAnchor = isManualAnchorHandle(handleId)
      ? anchorForNodeClientPoint(nodeId, clientPoint(event)) ?? anchorFromPhysicalHandle(handleId)
      : undefined;
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
      const sourceAnchor = source.sourceAnchor ?? (isManualAnchorHandle(connection.sourceHandle) ? anchorFromPhysicalHandle(connection.sourceHandle) : undefined);
      const targetAnchor = isManualAnchorHandle(connection.targetHandle)
        ? anchorForNodeClientPoint(targetNode.id, clientPoint(event)) ?? anchorFromPhysicalHandle(connection.targetHandle)
        : undefined;
      const presentation = edgePresentationWithAnchorUpdates(
        undefined,
        sourceAnchor ? { anchor: sourceAnchor } : undefined,
        targetAnchor ? { anchor: targetAnchor } : undefined,
      );
      const edge: CanvasEdge = {
        id: uniqueId('edge'),
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: semanticSourceHandle(sourceNode, connection.sourceHandle),
        targetHandle: semanticTargetHandle(connection.targetHandle),
        ...(presentation ? { presentation } : {}),
      };
      commit(connectSemanticNodes(document, edge));
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
    const sourceChanged = connection.source !== persisted.source || isManualAnchorHandle(connection.sourceHandle);
    const targetChanged = connection.target !== persisted.target || isManualAnchorHandle(connection.targetHandle);
    const sourceUpdate = sourceChanged ? manualAnchorUpdate(connection.sourceHandle) : undefined;
    const targetUpdate = targetChanged ? manualAnchorUpdate(connection.targetHandle) : undefined;
    const presentation = edgePresentationWithAnchorUpdates(persisted.presentation, sourceUpdate, targetUpdate);
    commit({
      ...document,
      edges: document.edges.map((edge) => {
        if (edge.id !== persisted.id) return edge;
        return edgeWithPresentation({
          ...edge,
          source: sourceNode.id,
          target: targetNode.id,
          sourceHandle: sourceChanged ? semanticSourceHandle(sourceNode, connection.sourceHandle) : edge.sourceHandle ?? semanticSourceHandle(sourceNode),
          targetHandle: targetChanged ? semanticTargetHandle(connection.targetHandle) : edge.targetHandle ?? semanticTargetHandle(),
        }, presentation);
      }),
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
    const pointer = clientPoint(event);
    const flowPoint = flowInstance?.screenToFlowPosition(pointer);
    const snap = flowPoint && document && routing
      ? findNearestEndpointSnap(document, routing.routesByEdgeId, edge.id, handleType, connectionState.toNode.id, flowPoint)
      : undefined;
    const anchor = snap?.anchor ?? anchorForNodeClientPoint(connectionState.toNode.id, pointer);
    if (!anchor) return;
    const endpointNode = document?.nodes.find((node) => node.id === connectionState.toNode?.id);
    const anchorPoint = endpointNode ? pointForEndpointAnchor(endpointNode, anchor) : undefined;
    setDocument((current) => {
      if (!current) return current;
      const persisted = current.edges.find((candidate) => candidate.id === pending.edgeId);
      if (!persisted || !isEditableBusinessEdge(current, persisted)) return current;
      const peerIds = new Set([persisted.id, ...(snap?.peerEdgeIds ?? [])]);
      const next = reconcileSubguideEdges(CanvasDocumentSchema.parse({
        ...current,
        edges: current.edges.map((candidate) => {
          const attachedNodeId = handleType === 'source' ? candidate.source : candidate.target;
          if (!peerIds.has(candidate.id) || attachedNodeId !== connectionState.toNode?.id) return candidate;
          const presentation = edgePresentationWithAnchorUpdates(
            candidate.presentation,
            handleType === 'source' ? { anchor } : undefined,
            handleType === 'target' ? { anchor } : undefined,
          );
          return edgeWithPresentation(candidate, presentation);
        }),
      }));
      historyRef.current?.push(next);
      setSaveState('未保存');
      return next;
    });
    if (anchorPoint) {
      setManualRouteDraft((current) => {
        if (!current || current.edgeId !== edge.id) return current;
        return {
          ...current,
          points: handleType === 'source'
            ? [anchorPoint, ...current.points.slice(1)]
            : [...current.points.slice(0, -1), anchorPoint],
        };
      });
    }
  }, [document, flowInstance, layoutPreview, routing]);

  const createFromConnection = useCallback((kind: CanvasCreationKind) => {
    if (!document || layoutPreview || !creationMenu) return;
    const source = document.nodes.find((node) => node.id === creationMenu.sourceId);
    if (!source || source.source) {
      setCreationMenu(null);
      return;
    }
    const id = uniqueId(kind);
    const created = createNode(id, kind, document.nodes.length, creationMenu.position);
    commit(insertSemanticNode(document, created, {
      origin: 'connection',
      sourceId: source.id,
      ...(creationMenu.sourceHandle ? { sourceHandle: creationMenu.sourceHandle } : {}),
      ...(isContentNode(created) ? {} : { edgeId: uniqueId('edge') }),
    }));
    setSelectedIds([id]);
    setCreationMenu(null);
  }, [commit, creationMenu, document, layoutPreview]);

  const onEdgeDoubleClick = useCallback((event: ReactMouseEvent, edge: Edge) => {
    const nativeEvent = (event as ReactMouseEvent & { nativeEvent?: MouseEvent }).nativeEvent ?? event as unknown as MouseEvent;
    openEdgeLabelEditor(edge.id, nativeEvent);
  }, [openEdgeLabelEditor]);

  const saveEdgeLabel = useCallback(({ label, fontSize }: EdgeLabelValue) => {
    if (!document || layoutPreview || !edgeLabelEditor) return;
    const edgeId = edgeLabelEditor.edgeId;
    commit({ ...document, edges: document.edges.map((edge) => {
      if (edge.id !== edgeId) return edge;
      if (label) return { ...edge, label, presentation: { ...edge.presentation, labelFontSize: fontSize } };
      const { label: _label, ...unlabeled } = edge;
      if (!unlabeled.presentation) return unlabeled;
      const { labelFontSize: _labelFontSize, labelOffset: _labelOffset, ...presentation } = unlabeled.presentation;
      if (Object.keys(presentation).length > 0) return { ...unlabeled, presentation };
      const { presentation: _presentation, ...withoutPresentation } = unlabeled;
      return withoutPresentation;
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
    const nextPresentation = partial.pathStyle !== undefined
      ? edgePresentationForPathStyle({ ...selected.presentation, ...partial }, partial.pathStyle)
      : { ...selected.presentation, ...partial };
    commit({ ...document, edges: document.edges.map((edge) => edge.id === selected.id ? { ...edge, presentation: nextPresentation } : edge) });
  }, [commit, document, layoutPreview, selectedEdgeId]);

  const startManualRouteEdit = useCallback(() => {
    if (layoutPreview || !document || !selectedEdgeId) return;
    const selected = document.edges.find((edge) => edge.id === selectedEdgeId);
    if (!selected || !isEditableBusinessEdge(document, selected)) return;
    const route = routing?.routesByEdgeId.get(selectedEdgeId);
    if (!route) return;
    setManualRouteDraft({
      edgeId: selectedEdgeId,
      points: route.points.map((point) => ({ ...point })),
      sourceAnchor: { ...route.sourceAnchor },
      sourceAnchorMode: selected.presentation?.sourceAnchor
        ? selected.presentation.sourceAnchorMode ?? 'manual'
        : 'auto',
      targetAnchor: { ...route.targetAnchor },
      targetAnchorMode: selected.presentation?.targetAnchor
        ? selected.presentation.targetAnchorMode ?? 'manual'
        : 'auto',
    });
  }, [document, layoutPreview, routing, selectedEdgeId]);

  const moveManualRouteSegment = useCallback((segmentIndex: number, coordinate: number) => {
    setManualRouteDraft((current) => current
      ? { ...current, points: moveRouteSegment(current.points, segmentIndex, coordinate) }
      : current);
  }, []);

  const finishManualRouteSegment = useCallback((segmentIndex: number, coordinate: number) => {
    if (layoutPreview || !document || !manualRouteDraft || manualDraftConflict) return;
    const selected = document.edges.find((edge) => edge.id === manualRouteDraft.edgeId);
    if (!selected || !isEditableBusinessEdge(document, selected)) return;
    const nextPoints = moveRouteSegment(manualRouteDraft.points, segmentIndex, coordinate);
    const persistedRoute = routing?.routesByEdgeId.get(selected.id);
    const unchanged = persistedRoute?.points.length === nextPoints.length
      && persistedRoute.points.every((point, index) => point.x === nextPoints[index]?.x && point.y === nextPoints[index]?.y);
    if (unchanged) return;
    commit({
      ...document,
      edges: document.edges.map((edge) => edge.id === selected.id
        ? { ...edge, presentation: manualRoutePresentation(edge.presentation, { ...manualRouteDraft, points: nextPoints }) }
        : edge),
    });
    setManualRouteDraft({ ...manualRouteDraft, edgeId: selected.id, points: nextPoints });
  }, [commit, document, layoutPreview, manualDraftConflict, manualRouteDraft, routing]);

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
        ? { ...edge, presentation: manualRoutePresentation(edge.presentation, manualRouteDraft) }
        : edge),
    });
    setManualRouteDraft(null);
  }, [commit, document, layoutPreview, manualDraftConflict, manualRouteDraft]);

  const resetSelectedRoute = useCallback(() => {
    if (layoutPreview || !document || !selectedEdgeId) return;
    const selected = document.edges.find((edge) => edge.id === selectedEdgeId);
    if (!selected || !isEditableBusinessEdge(document, selected)) return;
    const edges = document.edges.map((edge) => {
      if (edge.id !== selected.id) return edge;
      const presentation = resetEdgeRoutePresentation(edge.presentation);
      if (presentation) return { ...edge, presentation };
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
      if (_event === null) {
        programmaticViewportRef.current = viewport;
        if (!hasUnsavedEditorChanges(latestEditorStateRef.current, savedEditorStateRef.current)) {
          savedEditorStateRef.current = { ...savedEditorStateRef.current, document: next };
        }
      }
      return next;
    });
  }, [layoutPreview]);

  const onMove = useCallback((_event: MouseEvent | TouchEvent | null, viewport: CanvasDocument['viewport']) => {
    setOverlayViewport((current) => sameViewport(current, viewport) ? current : viewport);
  }, []);

  const startStageDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || layoutPreview || !document || hasSemanticFlow(document)) return;
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
    if (!drag || layoutPreview || !document || hasSemanticFlow(document)) return;
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
    if (!drag || layoutPreview || !document || hasSemanticFlow(document)) return;
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
    const source = selectedSource && isPrimaryFlowNode(selectedSource) ? selectedSource : undefined;
    commit(insertSemanticNode(document, created, {
      origin: 'toolbar',
      ...(source ? {
        sourceId: source.id,
        sourceHandle: semanticSourceHandle(source),
        ...(isContentNode(created) ? {} : { edgeId: uniqueId('edge') }),
      } : {}),
    }));
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

  const reorderStage = (stageId: string, targetId: string, placement: HierarchyDropPlacement) => {
    if (!document || layoutPreview) return;
    const stages = reorderHierarchyItems(document.stages ?? [], stageId, targetId, placement);
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

  const reorderLane = (laneId: string, targetId: string, placement: HierarchyDropPlacement) => {
    if (!document || layoutPreview) return;
    const lanes = reorderHierarchyItems(document.lanes ?? [], laneId, targetId, placement);
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
    setLayoutPreview(layoutFlowHierarchy(renumberSemanticFlow(documentWithMeasuredNodeSizes(document, flowNodes))));
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
        const latest = latestEditorStateRef.current;
        const savedDocument = mergeProgrammaticViewport(snapshot.document, latest.document, programmaticViewportRef.current);
        if (programmaticViewportRef.current && latest.document && sameViewport(latest.document.viewport, programmaticViewportRef.current)) {
          programmaticViewportRef.current = null;
        }
        savedEditorStateRef.current = { document: savedDocument, title: snapshot.title, summary: snapshot.summary, tags: snapshot.tags };
        const unchanged = !hasUnsavedEditorChanges(latest, { document: savedDocument, title: snapshot.title, summary: snapshot.summary, tags: snapshot.tags });
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

  const openPdfExport = useCallback(async () => {
    if (!onExport || layoutPreview) return;
    try {
      const saved = await flushPendingSave();
      if (!saved) throw new Error('草稿尚未保存，无法导出 PDF');
      onExport();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法导出 PDF');
    }
  }, [flushPendingSave, layoutPreview, onExport]);

  const openDigest = useCallback(async () => {
    if (!guide || layoutPreview) return;
    setSummaryOpen(false);
    setDigestOpen(true);
    setDigestError('');
    setDigestProposal(null);
    try {
      setDigestStatus(await api.getFlowSnapshotStatus(guide.id));
    } catch (reason) {
      setDigestError(reason instanceof Error ? reason.message : '无法检查流程快照');
    }
  }, [api, guide, layoutPreview]);

  const closeDigest = useCallback(() => {
    setDigestOpen(false);
  }, []);

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
      closeDigest();
      setDigestProposal(null);
    } catch (reason) { setDigestError(reason instanceof Error ? reason.message : '拒绝提案失败'); }
  }, [api, closeDigest, guide]);

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
      const authoritative = { document: result.guide.document, title: result.guide.title, summary: result.guide.summary, tags: result.guide.tags };
      const latestDuringApply = latestEditorStateRef.current;
      const documentChangedDuringApply = !sameEditorValue(latestDuringApply.document, beforeApply.document);
      const merged = mergeAppliedEditorState(beforeApply, latestDuringApply, authoritative);
      const summaryConflict = selection.applySummary
        && !sameEditorValue(latestDuringApply.summary, beforeApply.summary)
        && !sameEditorValue(latestDuringApply.summary, authoritative.summary);
      const mergedGuide = { ...result.guide, ...merged };
      guideRef.current = mergedGuide;
      setGuide(mergedGuide);
      savedEditorStateRef.current = authoritative;
      setTitle(merged.title);
      setSummary(merged.summary);
      setTags(merged.tags);
      setDocument(merged.document);
      latestEditorStateRef.current = merged;
      if (!documentChangedDuringApply) historyRef.current = new HistoryStack(merged.document, 80);
      setSaveState(hasUnsavedEditorChanges(merged, authoritative) ? '未保存' : '已保存');
      saveRetryRef.current = false;
      setDigestProposal(result.proposal);
      if (summaryConflict) setError('摘要应用期间检测到本地修改；已保留本地摘要，服务端建议摘要未覆盖，本地内容将按自动保存规则继续保存。');
      closeDigest();
    } catch (reason) {
      const originalError = reason instanceof Error ? reason.message : '应用提案失败';
      setDigestError(originalError);
      try {
        const [latestProposal, status] = await Promise.all([api.getGuideDigestProposal(guide.id, proposalId), api.getFlowSnapshotStatus(guide.id)]);
        setDigestProposal(latestProposal);
        setDigestStatus(status);
      } catch { /* Preserve the original safe apply error if refresh cannot complete. */ }
    }
  }, [api, closeDigest, digestProposal, document, flushPendingSave, guide]);

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
    setFlowNodes(toFlowNodes(normalized.nodes, [], normalized.lanes, expandedDetailNodeIds, semanticCodeByNodeId(normalized)));
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
    setManualRouteDraft(null);
    setDocument(previous);
    setFlowNodes(toFlowNodes(previous.nodes, selectedIds, previous.lanes, expandedDetailNodeIds, semanticCodeByNodeId(previous)));
    setSaveState('未保存');
  }, [expandedDetailNodeIds, layoutPreview, selectedIds]);
  const redo = useCallback(() => {
    if (layoutPreview || !historyRef.current?.canRedo) return;
    const next = reconcileSubguideEdges(historyRef.current.redo());
    setManualRouteDraft(null);
    setDocument(next);
    setFlowNodes(toFlowNodes(next.nodes, selectedIds, next.lanes, expandedDetailNodeIds, semanticCodeByNodeId(next)));
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
  const toggleResourceVisibility = useCallback((nodeId: string) => {
    if (!document || layoutPreview) return;
    const node = document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !isAuthorResourceNode(node)) return;
    commit(toggleResourceVisibilityInDocument(document, nodeId));
  }, [commit, document, layoutPreview]);
  const toggleResourceVisibilityGroup = useCallback((resourceIds: string[]) => {
    if (!document || layoutPreview || resourceIds.length === 0) return;
    const resourceIdSet = new Set(resourceIds);
    const resources = document.nodes.filter((node) => resourceIdSet.has(node.id) && isAuthorResourceNode(node));
    if (resources.length === 0) return;
    const allHidden = resources.every((node) => node.visibility === 'HIDDEN');
    commit(setResourceVisibilityInDocument(document, resources.map((node) => node.id), !allHidden));
  }, [commit, document, layoutPreview]);

  const confirmAnnotatedImageDeletion = useCallback(() => {
    if (!annotatedImageDeletion) return;
    removeNodesImmediately(annotatedImageDeletion.nodeIds);
    setAnnotatedImageDeletion(null);
  }, [annotatedImageDeletion, removeNodesImmediately]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (digestOpen) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      else if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (modifier && event.key.toLowerCase() === 'c') copy();
      else if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); removeSelected(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [copy, digestOpen, paste, redo, removeSelected, save, undo]);

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
    const stageChanged = current && isPrimaryFlowNode(current) && current.stageId !== next.stageId;
    const laneChanged = current && isPrimaryFlowNode(current) && current.laneId !== next.laneId;
    const attachmentChanged = current && isContentNode(current) && (current.attachment?.ownerNodeId ?? current.contentParentId) !== (next.attachment?.ownerNodeId ?? next.contentParentId);
    commit(stageChanged
      ? movePrimaryNodeToStage(nextDocument, next.id, next.stageId)
      : laneChanged || attachmentChanged
        ? layoutFlowHierarchy(renumberSemanticFlow(nextDocument)).document
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
      setFlowNodes(toFlowNodes(document.nodes, selectedIds, document.lanes, next, semanticCodeByNodeId(document)));
      return next;
    });
  }, [document, layoutPreview, selectedIds]);

  const addChildStep = () => {
    if (!document || layoutPreview || !selectedIds[0]) return;
    const parent = document.nodes.find((node) => node.id === selectedIds[0]);
    if (!parent || !isPrimaryFlowNode(parent)) return;
    const created = createNode(uniqueId('process'), 'process', document.nodes.length);
    commit(insertSemanticNode(document, created, { origin: 'child', sourceId: parent.id, edgeId: uniqueId('edge'), sourceHandle: semanticSourceHandle(parent) }));
    setSelectedIds([created.id]);
  };

  const moveSelectedStep = (direction: 'previous' | 'next') => {
    if (!document || layoutPreview || !selectedIds[0]) return;
    const selected = document.nodes.find((node) => node.id === selectedIds[0]);
    if (!selected || !isPrimaryFlowNode(selected)) return;
    commit(moveSemanticOutlineNode(document, selected.id, direction));
  };

  const alignLeft = () => {
    if (!document || layoutPreview || selectedIds.length < 2) return;
    const selected = new Set(selectedIds);
    const x = Math.min(...document.nodes.filter((node) => selected.has(node.id)).map((node) => node.position.x));
    commit({ ...document, nodes: document.nodes.map((node) => selected.has(node.id) ? { ...node, position: { ...node.position, x } } : node) });
  };

  if (!guide || !document) return <main className="center-state">{error ? <p className="error-message" role="alert">{error}</p> : <><span className="spinner" /><p>正在载入画布…</p></>}</main>;
  const selectedNode = document.nodes.find((node) => node.id === selectedIds[0]);
  const selectedReferenceUpdate = selectedNode?.type === 'subguide'
    ? referenceUpdates.find((item) => item.referenceNodeId === selectedNode.id)
    : undefined;
  const primaryNodes = document.nodes.filter(isPrimaryFlowNode);
  const semanticCodes = semanticCodeByNodeId(document);
  const selectedResourceReferences = selectedNode && isPrimaryFlowNode(selectedNode)
    ? document.edges
      .filter((edge) => edge.semantic?.kind === 'RESOURCE_REFERENCE' && edge.source === selectedNode.id)
      .map((edge) => ({ nodeId: edge.target, code: semanticCodes.get(edge.target) ?? '资料' }))
    : [];
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
    <div className="editor-page-content" inert={digestOpen || undefined} aria-hidden={digestOpen || undefined}>
    <header className="editor-header">
      <button className="icon-button" type="button" onClick={onBack} aria-label="返回资料库"><ArrowLeft size={21} weight="bold" aria-hidden="true" /></button>
      <div className="editor-title"><input aria-label="指南标题" value={title} disabled={Boolean(layoutPreview)} onChange={(event) => { if (layoutPreview) return; setTitle(event.target.value); setSaveState('未保存'); }} /><span aria-live="polite">{guide.status === 'PUBLISHED' ? `已发布 v${guide.publishedVersion ?? 1}` : '草稿'} · {saveState}</span></div>
      <section className="guide-details-header" aria-label="指南信息">
        <GuideDetailsHeader
          tags={tags}
          disabled={Boolean(layoutPreview)}
          summaryTriggerRef={summaryTriggerRef}
          digestTriggerRef={digestTriggerRef}
          onTagsChange={(value) => { if (layoutPreview) return; setTags(value); setSaveState('未保存'); }}
          onOpenSummary={() => setSummaryOpen(true)}
          onOpenDigest={() => void openDigest()}
        />
      </section>
      <div className="editor-actions" aria-label="指南操作">
        <div className="editor-action-group editor-action-group--diagnostics" role="group" aria-label="状态与诊断">
          <span className="editor-action-group-label"><ChartLineUp size={14} weight="bold" aria-hidden="true" />状态</span>
          <FlowRegressionPanel guideId={guide.id} api={api} annotationTitle={(target) => annotationTitleForTarget(document, target)} />
        </div>
        <div className="editor-action-group editor-action-group--appearance" role="group" aria-label="外观设置">
          <span className="editor-action-group-label">外观</span>
          <AppearanceToggle />
        </div>
        <div className="editor-action-group editor-action-group--versions" role="group" aria-label="版本操作">
          <span className="editor-action-group-label"><ClockCounterClockwise size={14} weight="bold" aria-hidden="true" />版本</span>
          <div className="editor-action-segment">
            <button className="editor-action-button" type="button" onClick={() => void openDraftHistory()} disabled={Boolean(layoutPreview)} aria-label="草稿历史"><ClockCounterClockwise size={17} aria-hidden="true" />草稿历史</button>
            <button className="editor-action-button" type="button" onClick={() => void save()} disabled={Boolean(layoutPreview)} aria-label="保存草稿"><FloppyDisk size={17} aria-hidden="true" />保存草稿</button>
          </div>
        </div>
        <div className="editor-action-group editor-action-group--primary" role="group" aria-label="主操作">
          <button className="editor-action-button editor-export-button" type="button" onClick={() => void openPdfExport()} disabled={Boolean(layoutPreview) || !onExport} aria-label="导出 PDF">导出 PDF</button>
          <button className="primary-button editor-publish-button" type="button" onClick={() => void publish()} disabled={Boolean(layoutPreview)} aria-label="发布指南"><UploadSimple size={18} weight="bold" aria-hidden="true" />发布指南</button>
        </div>
      </div>
    </header>
    <EditorToolbar
      layoutPreview={Boolean(layoutPreview)}
      canUndo={Boolean(historyRef.current?.canUndo)}
      canRedo={Boolean(historyRef.current?.canRedo)}
      canCopy={selectedIds.length > 0}
      canPaste={clipboardRef.current.length > 0}
      canAlign={selectedIds.length >= 2}
      canPreviewLayout={document.nodes.length >= 2}
      canDelete={selectedIds.length > 0 || Boolean(selectedEdgeId)}
      onAddNode={addNode}
      onInsertSubguide={() => { setReferenceQuery(''); setReferenceResults([]); setReferenceError(''); setReferenceSearching(true); setReferenceOpen(true); }}
      onUndo={undo}
      onRedo={redo}
      onCopy={copy}
      onPaste={paste}
      onAlign={alignLeft}
      onPreviewLayout={previewLayout}
      onRemoveSelected={removeSelected}
    />
    <div className={`editor-workspace${hierarchyOpen ? '' : ' is-hierarchy-collapsed'}`}>
      <div className="hierarchy-panel-shell" aria-hidden={!hierarchyOpen}>
        <HierarchyPanel document={document} selectedIds={selectedIds} onSelect={selectAndFocus} onAddStage={addStage} onUpdateStage={updateStage} onMoveStage={moveStage} onReorderStage={reorderStage} onRequestDeleteStage={(id) => requestHierarchyDeletion('stage', id)} onAddLane={addLane} onUpdateLane={updateLane} onMoveLane={moveLane} onReorderLane={reorderLane} onRequestDeleteLane={(id) => requestHierarchyDeletion('lane', id)} editingLocked={Boolean(layoutPreview)} />
      </div>
      <section className={`canvas-shell${manualRouteDraft ? ' is-route-editing' : ''}`} aria-label="无限画布编辑区">
        <button className="hierarchy-panel-toggle" type="button" aria-label={hierarchyOpen ? '收起业务流程' : '展开业务流程'} aria-pressed={hierarchyOpen} onClick={() => setHierarchyOpen((current) => !current)}>
          {hierarchyOpen ? <CaretLeft size={22} weight="bold" aria-hidden="true" /> : <CaretRight size={22} weight="bold" aria-hidden="true" />}
        </button>
        <NodeAnchorPresentationProvider handlesByNodeId={nodeAnchorHandles}>
        <NodeDetailPresentationProvider value={{ expandedNodeIds: expandedDetailNodeIds, onOpenEditor: openNodeDetail, onToggleExpanded: toggleNodeDetail }}>
        <NodeActionProvider enabled={!layoutPreview} onDeleteNode={removeNodeById} onToggleResourceVisibility={toggleResourceVisibility}>
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
          edgesReconnectable={!layoutPreview && Boolean(manualRouteDraft)}
          edgesFocusable={!layoutPreview}
          elementsSelectable={!layoutPreview}
        >
          <ViewportPortal>
            <CanvasSwimlanes bounds={swimlaneBounds} />
            {appendixGroups.map((group) => <div
              key={group.ownerId}
              className={`resource-appendix${group.allHidden ? ' is-all-hidden' : ''}`}
              style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
            >
              {group.allHidden ? <button
                className="resource-appendix-collapsed-toggle nodrag nopan nowheel"
                type="button"
                aria-label={`展开${group.ownerTitle}节点资料`}
                aria-pressed={true}
                title={`展开${group.ownerTitle}节点资料`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleResourceVisibilityGroup(group.resourceIds);
                }}
              ><EyeSlash size={15} weight="bold" aria-hidden="true" /><span>{group.ownerTitle} · 节点资料 ×{group.resourceIds.length}</span></button> : <>
                <span>资料附录 · {group.resourceIds.length}</span>
                <button
                  className="resource-appendix-visibility nodrag nopan nowheel"
                  type="button"
                  aria-label="隐藏全部资料"
                  aria-pressed={false}
                  title="隐藏全部资料"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleResourceVisibilityGroup(group.resourceIds);
                  }}
                ><Eye size={14} weight="bold" aria-hidden="true" /></button>
              </>}
            </div>)}
            {stageBounds.map((bound) => <div
              key={bound.stageId ?? 'none'}
              className={`stage-lane${draggedStageId === bound.stageId ? ' is-dragging' : ''}`}
              data-stage-id={bound.stageId ?? 'none'}
              style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height }}
            ><span className="stage-lane-label">{bound.title}</span></div>)}
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
          {edgeLabelEditor ? <EdgeLabelEditor position={canvasPointToScreen(edgeLabelEditor.position, overlayViewport)} {...(edgeLabelEditor.label !== undefined ? { label: edgeLabelEditor.label } : {})} {...(edgeLabelEditor.labelFontSize !== undefined ? { labelFontSize: edgeLabelEditor.labelFontSize } : {})} onSave={saveEdgeLabel} onCancel={() => setEdgeLabelEditor(null)} /> : null}
          {!layoutPreview && manualRouteDraft && flowInstance ? <ManualRouteEditor
            points={manualRouteDraft.points}
            conflict={manualDraftConflict}
            {...(manualDraftConflictMessage ? { conflictMessage: manualDraftConflictMessage } : {})}
            onMoveSegment={moveManualRouteSegment}
            onFinishSegment={finishManualRouteSegment}
            screenToFlowPosition={(point) => flowInstance.screenToFlowPosition(point)}
            flowToScreenPosition={(point) => canvasPointToScreen(point, overlayViewport)}
          /> : null}
          {!layoutPreview && !manualRouteDraft && selectedBusinessEdge && selectedEdgeRoute ? <EdgeToolbarAtRoute
            route={selectedEdgeRoute}
            viewport={overlayViewport}
            presentation={selectedBusinessEdge.presentation}
            onChange={updateSelectedEdgePresentation}
            onClose={() => { setSelectedEdgeId(null); setManualRouteDraft(null); }}
            routeEditing={false}
            manualRouteConflict={false}
            onStartRouteEdit={startManualRouteEdit}
            onSaveRouteEdit={saveManualRouteEdit}
            onCancelRouteEdit={cancelManualRouteEdit}
            onResetRoute={resetSelectedRoute}
          /> : null}
        </div>
      </section>
      <aside className="inspector" aria-label="节点属性">
        {layoutPreview ? <CanvasLayoutPreviewDialog
          layout={layoutPreview}
          avoidedEdgeCount={routing?.report.avoidedEdgeIds.length ?? 0}
          onApply={applyLayoutPreview}
          onClose={() => setLayoutPreview(null)}
        /> : selectedNode ? <NodeInspector node={selectedNode} primaryNodes={primaryNodes} stages={stages} lanes={lanes} onChange={updateSelectedNode} onToggleReference={() => void toggleReference()} {...(selectedReferenceUpdate ? { referenceUpdate: selectedReferenceUpdate } : {})} onUpgradeReference={() => void upgradeReference()} onAddChildStep={addChildStep} onMoveStep={moveSelectedStep} resourceReferences={selectedResourceReferences} onFocusReference={(nodeId) => selectAndFocus([nodeId])} onEditAnnotations={() => setAnnotationEditorNodeId(selectedNode.type === 'image' ? selectedNode.id : null)} onUploadImage={(file) => requestImageUpload(selectedNode.id, file)} api={api} locked={Boolean(layoutPreview)} /> : <div className="inspector-empty"><strong>选择一个节点</strong><p>在这里编辑内容、媒体、步骤和子指南。</p></div>}
      </aside>
    </div>
    {error ? <div className="toast-error" role="alert">{error}</div> : null}
    </div>
    {summaryOpen ? <GuideSummaryDialog summary={summary} disabled={Boolean(layoutPreview)} openerRef={summaryTriggerRef} onSummaryChange={(value) => { if (layoutPreview) return; setSummary(value); setSaveState('未保存'); }} onClose={() => setSummaryOpen(false)} /> : null}
    {referenceOpen ? <EditorDialogSurface className="reference-modal guide-reference-dialog" ariaLabelledBy="reference-title" closeLabel="关闭子指南搜索" onClose={() => { setReferenceOpen(false); setReferenceSearching(false); }}><span className="eyebrow">REUSE PUBLISHED GUIDE</span><h2 id="reference-title">插入固定版本子指南</h2><p>打开后会载入全部已发布指南；输入标题、标签或内容关键词即可即时筛选。</p><label className="sr-only" htmlFor="reference-search">搜索可复用指南</label><input id="reference-search" type="search" autoFocus placeholder="例如：物料、销售订单、VA01" aria-label="搜索可复用指南" value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} /><div className="reference-results" aria-live="polite">{referenceSearching ? <p className="status-line">正在载入可复用指南…</p> : null}{referenceError ? <p className="error-message" role="alert">{referenceError}</p> : null}{!referenceSearching && !referenceError && referenceResults.length === 0 ? <p className="muted">没有找到可引用的已发布指南。</p> : null}{referenceResults.map((item) => <article key={item.versionId}><div><strong>{item.title}</strong><span>v{item.version} · {item.authorName}</span></div><button className="secondary-button" type="button" onClick={() => insertReference(item)} aria-label={`插入 ${item.title}`}>插入</button></article>)}</div></EditorDialogSurface> : null}
    {annotationEditorNode ? <ImageAnnotationEditor node={annotationEditorNode} nodes={document.nodes} {...(annotationEditorNode.id === focusNodeId && focusAnnotationId ? { focusAnnotationId } : {})} onClose={() => setAnnotationEditorNodeId(null)} onChange={(data) => commit({ ...document, nodes: document.nodes.map((node) => node.id === annotationEditorNode.id ? { ...annotationEditorNode, data } : node) })} onUploadSupplement={async (file) => {
      if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件。');
      const media = await api.uploadMedia(file);
      if (media.kind !== 'IMAGE') throw new Error('仅支持图片文件。');
      return { assetId: media.id, url: media.url, alt: file.name };
    }} /> : null}
    {hierarchyDeletion && hierarchyDeletionItem ? <HierarchyDeletionDialog kind={hierarchyDeletion.kind} title={hierarchyDeletionItem.title} affectedNodeCount={hierarchyDeletionCount} onConfirm={confirmHierarchyDeletion} onCancel={() => setHierarchyDeletion(null)} /> : null}
    {annotatedImageDeletion ? <AnnotatedImageDeletionDialog imageCount={annotatedImageDeletion.imageCount} annotationCount={annotatedImageDeletion.annotationCount} onConfirm={confirmAnnotatedImageDeletion} onCancel={() => setAnnotatedImageDeletion(null)} /> : null}
    {imageReplacement ? <ImageReplacementDialog annotationCount={imageReplacement.annotationCount} uploading={imageReplacementUploading} onConfirm={() => void confirmImageReplacement()} onCancel={() => { if (!imageReplacementUploading) setImageReplacement(null); }} /> : null}
    {draftHistoryOpen ? <DraftHistoryDialog items={draftHistory} currentRevision={guide.revision} loading={draftHistoryLoading} error={draftHistoryError} onRestore={restoreDraftHistory} onClose={() => setDraftHistoryOpen(false)} /> : null}
    {digestOpen ? <GuideDigestDialog guide={guide} status={digestStatus} proposal={digestProposal} generating={digestGenerating} error={digestError} onReconcile={reconcileDigest} onGenerate={generateDigest} onReject={rejectDigest} onApply={applyDigest} onClose={closeDigest} /> : null}
    {detailEditor ? <NodeDetailDialog nodeId={detailEditor.nodeId} title={detailEditor.title} value={detailEditor.value} openerRef={{ current: detailEditor.opener }} onSave={saveNodeDetail} onClose={() => setDetailEditor(null)} /> : null}
  </main>;
}

function hasUnsavedEditorChanges(
  latest: { document: CanvasDocument | null; title: string; summary: string; tags: string[] },
  saved: { document: CanvasDocument | null; title: string; summary: string; tags: string[] },
): boolean {
  return editorStateFingerprint(latest) !== editorStateFingerprint(saved);
}

function mergeAppliedEditorState(
  beforeApply: { document: CanvasDocument | null; title: string; summary: string; tags: string[] },
  latest: { document: CanvasDocument | null; title: string; summary: string; tags: string[] },
  authoritative: { document: CanvasDocument; title: string; summary: string; tags: string[] },
): { document: CanvasDocument; title: string; summary: string; tags: string[] } {
  return {
    document: sameEditorValue(latest.document, beforeApply.document) ? authoritative.document : latest.document ?? authoritative.document,
    title: sameEditorValue(latest.title, beforeApply.title) ? authoritative.title : latest.title,
    summary: sameEditorValue(latest.summary, beforeApply.summary) ? authoritative.summary : latest.summary,
    tags: mergeAppliedTags(beforeApply.tags, latest.tags, authoritative.tags),
  };
}

function mergeAppliedTags(beforeApply: readonly string[], latest: readonly string[], authoritative: readonly string[]): string[] {
  const baseline = new Set(beforeApply.map(normalizeTagForMerge));
  const latestKeys = new Set(latest.map(normalizeTagForMerge));
  const locallyRemoved = new Set([...baseline].filter((key) => !latestKeys.has(key)));
  const merged: string[] = [];
  const mergedKeys = new Set<string>();
  for (const tag of authoritative) {
    const key = normalizeTagForMerge(tag);
    if (!key || locallyRemoved.has(key) || mergedKeys.has(key)) continue;
    merged.push(tag);
    mergedKeys.add(key);
  }
  for (const tag of latest) {
    const key = normalizeTagForMerge(tag);
    if (key && !baseline.has(key) && !mergedKeys.has(key)) {
      merged.push(tag);
      mergedKeys.add(key);
    }
  }
  return merged;
}

function normalizeTagForMerge(tag: string): string {
  return tag.normalize('NFKC').trim().toLocaleLowerCase('und');
}

function sameEditorValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function editorStateFingerprint(state: { document: CanvasDocument | null; title: string; summary: string; tags: string[] }): string {
  return JSON.stringify({ document: state.document, title: state.title, summary: state.summary, tags: state.tags });
}

function mergeProgrammaticViewport(
  savedDocument: CanvasDocument,
  latestDocument: CanvasDocument | null,
  programmaticViewport: CanvasDocument['viewport'] | null,
): CanvasDocument {
  if (!latestDocument || !programmaticViewport || !sameViewport(latestDocument.viewport, programmaticViewport)) return savedDocument;
  return sameViewport(savedDocument.viewport, programmaticViewport)
    ? savedDocument
    : { ...savedDocument, viewport: programmaticViewport };
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

type VideoKeypoint = CanvasNode<'video'>['data']['keypoints'][number];

function VideoKeypointTitleInput({ point, index, onCommit }: { point: VideoKeypoint; index: number; onCommit: (title: string) => void }) {
  const [value, setValue] = useState(point.title);

  useEffect(() => {
    setValue(point.title);
  }, [point.id, point.title]);

  return <input
    aria-label={`关键点 ${index + 1} 标题`}
    value={value}
    onChange={(event) => {
      const nextValue = event.target.value;
      setValue(nextValue);
      if (nextValue.trim()) onCommit(nextValue);
    }}
    onBlur={() => {
      if (!value.trim()) setValue(point.title);
    }}
  />;
}

function NodeInspector({ node, primaryNodes, stages, lanes, onChange, onToggleReference, referenceUpdate, onUpgradeReference, onAddChildStep, onMoveStep, resourceReferences, onFocusReference, onEditAnnotations, onUploadImage, api, locked }: { node: CanvasNode; primaryNodes: CanvasNode[]; stages: FlowStage[]; lanes: FlowLane[]; onChange: (node: CanvasNode) => void; onToggleReference: () => void; referenceUpdate?: GuideReferenceUpdate; onUpgradeReference: () => void; onAddChildStep: () => void; onMoveStep: (direction: 'previous' | 'next') => void; resourceReferences: Array<{ nodeId: string; code: string }>; onFocusReference: (nodeId: string) => void; onEditAnnotations: () => void; onUploadImage: (file: File) => void; api: EditorApi; locked: boolean }) {
  const updateData = (data: CanvasNode['data']) => onChange({ ...node, data } as CanvasNode);
  const flowData = ['start', 'end', 'process', 'decision', 'data'].includes(node.type) ? node.data as CanvasNode<'process'>['data'] : null;
  return <fieldset className="node-inspector" disabled={locked}><div className="inspector-node-heading"><span>{node.type.toUpperCase()}</span><code>{node.id.slice(0, 18)}</code></div>
    {flowData ? <><label>节点标题<input value={flowData.label} onChange={(event) => updateData({ ...flowData, label: event.target.value } as CanvasNode['data'])} /></label><label>节点明细<textarea rows={4} value={flowData.description ?? ''} onChange={(event) => { const description = event.target.value.trim(); const { description: _previousDescription, ...withoutDescription } = flowData; updateData((description ? { ...withoutDescription, description: event.target.value } : withoutDescription) as CanvasNode['data']); }} /></label><p className="node-inspector-hint">支持 Markdown 标题、列表、链接和代码块。</p></> : null}
    {node.type === 'markdown' ? <label>Markdown<textarea rows={12} value={node.data.markdown} onChange={(event) => updateData({ markdown: event.target.value })} /></label> : null}
    {node.type === 'image' ? <><label>图片地址<input value={node.data.url} onChange={(event) => updateData({ ...node.data, url: event.target.value })} /></label><label>替代文字<input value={node.data.alt} onChange={(event) => updateData({ ...node.data, alt: event.target.value })} /></label><label>图片说明<textarea value={node.data.caption ?? ''} onChange={(event) => updateData({ ...node.data, caption: event.target.value })} /></label><button className="secondary-button" type="button" onClick={onEditAnnotations} aria-label="编辑图片标注">编辑图片标注（{node.data.annotations?.length ?? 0}）</button><label className="upload-label">上传图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; onUploadImage(file); event.currentTarget.value = ''; }} /></label></> : null}
    {node.type === 'video' ? <><label>视频地址<input value={node.data.url} onChange={(event) => updateData({ ...node.data, url: event.target.value })} /></label><label>视频说明<textarea value={node.data.caption ?? ''} onChange={(event) => updateData({ ...node.data, caption: event.target.value })} /></label><div className="keypoint-editor">{node.data.keypoints.map((point, index) => <div key={point.id}><VideoKeypointTitleInput point={point} index={index} onCommit={(title) => updateData({ ...node.data, keypoints: node.data.keypoints.map((item) => item.id === point.id ? { ...item, title } : item) })} /><input type="number" min="0" aria-label={`关键点 ${index + 1} 秒数`} value={point.timeSeconds} onChange={(event) => updateData({ ...node.data, keypoints: node.data.keypoints.map((item) => item.id === point.id ? { ...item, timeSeconds: Number(event.target.value) } : item) })} /></div>)}<button type="button" onClick={() => updateData({ ...node.data, keypoints: [...node.data.keypoints, { id: uniqueId('keypoint'), title: '新关键点', timeSeconds: 0 }] })}>添加视频关键点</button></div><label className="upload-label">上传视频<input type="file" accept="video/mp4,video/webm,video/quicktime,.mov" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const asset = await api.uploadMedia(file); updateData({ ...node.data, assetId: asset.id, url: asset.url }); }} /></label></> : null}
    {node.type === 'subguide' ? <><div className="pinned-version"><strong>{node.data.title}</strong><span>固定版本 v{node.data.version}</span></div>{referenceUpdate ? <div className="reference-update"><span>发现 v{referenceUpdate.latestVersion}（当前 v{referenceUpdate.currentVersion}）</span><button className="secondary-button" type="button" onClick={onUpgradeReference} aria-label={`采用 ${referenceUpdate.latestTitle} v${referenceUpdate.latestVersion}`}>采用 v{referenceUpdate.latestVersion}</button></div> : null}<button className="secondary-button" type="button" onClick={onToggleReference} aria-label={node.data.expanded ? '折叠子指南' : '展开子指南'}>{node.data.expanded ? '折叠子指南' : '展开子指南'}</button></> : null}
    {isPrimaryFlowNode(node) ? <><label>所属业务阶段<select value={node.stageId ?? ''} onChange={(event) => onChange({ ...node, stageId: event.target.value || undefined })}><option value="">未分阶段</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label><label>责任泳道<select value={node.laneId ?? ''} onChange={(event) => onChange({ ...node, laneId: event.target.value || undefined })}><option value="">未分配责任</option>{lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.title}</option>)}</select></label></> : null}
    {isContentNode(node) ? <><p className="node-inspector-hint">每份资料只挂靠一个主节点；其它节点通过可跳转引用访问它。</p><label>挂靠主节点<select value={node.attachment?.ownerNodeId ?? node.contentParentId ?? ''} onChange={(event) => {
      const ownerNodeId = event.target.value;
      const { contentParentId: _legacyParent, attachment: _attachment, ...withoutAttachment } = node;
      const order = primaryNodes.filter((primary) => primary.id !== node.id && primary.id === ownerNodeId).length;
      onChange(ownerNodeId ? { ...withoutAttachment, attachment: { ownerNodeId, order } } as CanvasNode : withoutAttachment as CanvasNode);
    }}><option value="">未挂靠</option>{primaryNodes.map((primary) => <option key={primary.id} value={primary.id}>{nodeLabel(primary)}</option>)}</select></label></> : null}
    {isPrimaryFlowNode(node) ? <><NodeStepActions key={node.id} onAddChildStep={onAddChildStep} onMoveStep={onMoveStep} />{resourceReferences.length > 0 ? <div className="node-reference-links"><span>资料引用</span>{resourceReferences.map((reference) => <button key={reference.nodeId} type="button" onClick={() => onFocusReference(reference.nodeId)}>↗ 引用 {reference.code}</button>)}</div> : null}</> : null}
  </fieldset>;
}

function NodeStepActions({ onAddChildStep, onMoveStep }: { onAddChildStep: () => void; onMoveStep: (direction: 'previous' | 'next') => void }) {
  return <div className="node-step-actions" role="group" aria-label="当前步骤操作">
    <div className="node-order-actions"><button className="secondary-button" type="button" onClick={() => onMoveStep('previous')} aria-label="前移步骤">前移步骤</button><button className="secondary-button" type="button" onClick={() => onMoveStep('next')} aria-label="后移步骤">后移步骤</button></div>
    <button className="secondary-button" type="button" onClick={onAddChildStep}>添加子步骤</button>
  </div>;
}

function nodeLabel(node: CanvasNode): string {
  if (node.type === 'subguide') return node.data.title;
  if (node.type === 'start' || node.type === 'end' || node.type === 'process' || node.type === 'decision' || node.type === 'data') return node.data.label;
  return node.id;
}

function annotationTitleForTarget(
  document: CanvasDocument,
  target: { resourceNodeId: string; annotationId: string },
): string {
  const image = document.nodes.find((node): node is CanvasNode<'image'> =>
    node.id === target.resourceNodeId && node.type === 'image',
  );
  return image?.data.annotations?.find((annotation) => annotation.id === target.annotationId)?.title
    ?? target.annotationId;
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
  let changed = true;
  while (changed) {
    changed = false;
    document.nodes.forEach((node) => {
      if (!node.source?.referenceNodeId || !removed.has(node.source.referenceNodeId) || removed.has(node.id)) return;
      removed.add(node.id);
      changed = true;
    });
  }
  return {
    ...document,
    nodes: document.nodes.filter((node) => !removed.has(node.id)).map((node) =>
      !node.source && isContentNode(node) && (node.attachment?.ownerNodeId ?? node.contentParentId) && removed.has(node.attachment?.ownerNodeId ?? node.contentParentId!)
        ? (() => {
          if (!node.attachment) return { ...node, contentParentId: undefined } as CanvasNode;
          const { attachment: _attachment, contentParentId: _legacyParent, ...withoutOwner } = node;
          return withoutOwner as CanvasNode;
        })()
        : node,
    ),
    edges: document.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
    steps: document.steps.filter((step) => !removed.has(step.nodeId)),
    exitNodeIds: document.exitNodeIds.filter((id) => !removed.has(id)),
    ...(document.entryNodeId && removed.has(document.entryNodeId) ? { entryNodeId: undefined } : {}),
  } as CanvasDocument;
}

function isAuthorResourceNode(node: CanvasNode): boolean {
  return isContentNode(node) && node.source === undefined;
}

const resourceAppendixAnchorPrefix = 'resource-appendix-anchor:';

export function resourceAppendixAnchorId(ownerId: string): string {
  return `${resourceAppendixAnchorPrefix}${ownerId}`;
}

function isResourceAppendixAnchorId(nodeId: string): boolean {
  return nodeId.startsWith(resourceAppendixAnchorPrefix);
}

function resourceOwnerId(node: CanvasNode): string | undefined {
  return node.attachment?.ownerNodeId ?? node.contentParentId;
}

function resourceOwnerTitle(node: CanvasNode): string {
  if ('label' in node.data && typeof node.data.label === 'string') return node.data.label;
  if ('title' in node.data && typeof node.data.title === 'string') return node.data.title;
  return '节点';
}

function allHiddenResourceIds(nodes: CanvasDocument['nodes']): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const byOwner = new Map<string, CanvasNode[]>();
  nodes.filter((node) => isAuthorResourceNode(node) && !node.hidden).forEach((node) => {
    const ownerId = resourceOwnerId(node);
    if (!ownerId) return;
    const resources = byOwner.get(ownerId);
    if (resources) resources.push(node);
    else byOwner.set(ownerId, [node]);
  });

  const collapsed = new Set<string>();
  for (const [ownerId, resources] of byOwner) {
    if (!nodeIds.has(ownerId) || !resources.every((node) => node.visibility === 'HIDDEN')) continue;
    resources.forEach((node) => collapsed.add(node.id));
  }
  return collapsed;
}

export function setResourceVisibilityInDocument(document: CanvasDocument, nodeIds: Iterable<string>, hidden: boolean): CanvasDocument {
  const resourceIds = new Set(nodeIds);
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!resourceIds.has(node.id) || !isAuthorResourceNode(node)) return node;
      if (!hidden) {
        const { visibility: _visibility, ...visibleNode } = node;
        return visibleNode as CanvasNode;
      }
      return { ...node, visibility: 'HIDDEN' as const };
    }),
  };
}

export function toggleResourceVisibilityInDocument(document: CanvasDocument, nodeId: string): CanvasDocument {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !isAuthorResourceNode(node)) return document;
  return setResourceVisibilityInDocument(document, [nodeId], node.visibility !== 'HIDDEN');
}

export function removeEdgesFromDocument(document: CanvasDocument, edgeIds: string[]): CanvasDocument {
  const removed = new Set(edgeIds);
  return { ...document, edges: document.edges.filter((edge) => !removed.has(edge.id)) };
}

/**
 * React Flow reports the actual size after a node's text has wrapped. Keep that
 * transient measurement in the rendering/layout model immediately, rather
 * than routing from the last saved minimum height for one render.
 */
export function documentWithMeasuredNodeSizes(document: CanvasDocument, flowNodes: Node[]): CanvasDocument {
  const measuredSizeByNodeId = new Map<string, { width: number; height: number }>();
  for (const flowNode of flowNodes) {
    const width = flowNode.measured?.width ?? flowNode.width;
    const height = flowNode.measured?.height ?? flowNode.height;
    if (width === undefined || height === undefined || width <= 0 || height <= 0) continue;
    measuredSizeByNodeId.set(flowNode.id, { width, height });
  }
  if (measuredSizeByNodeId.size === 0) return document;

  let changed = false;
  const nodes = document.nodes.map((node) => {
    const size = measuredSizeByNodeId.get(node.id);
    if (!size || (node.size?.width === size.width && node.size?.height === size.height)) return node;
    changed = true;
    return { ...node, size };
  });
  return changed ? { ...document, nodes } : document;
}

export function toFlowNodes(
  nodes: CanvasDocument['nodes'],
  selectedIds: string[] = [],
  lanes: FlowLane[] = [],
  expandedNodeIds: ReadonlySet<string> = noExpandedDetails,
  semanticCodeByNodeId: ReadonlyMap<string, string> = new Map(),
): Node[] {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const collapsedResourceIds = allHiddenResourceIds(nodes);
  return nodes.map((node) => {
    const size = node.size ?? defaultCanvasNodeSize(node);
    const detailExpanded = expandedNodeIds.has(node.id);
    const baseStyle = detailExpanded
      ? { width: size.width }
      : isPrimaryFlowNode(node)
        ? { width: size.width, minHeight: size.height }
        : { width: size.width, height: size.height };
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        ...node.data,
        detailExpanded,
        ...(isAuthorResourceNode(node) ? { resourceVisibility: node.visibility ?? 'VISIBLE' } : {}),
        ...(isPrimaryFlowNode(node) && node.laneId && laneById.has(node.laneId) ? { responsibility: pickResponsibility(laneById.get(node.laneId)!) } : {}),
        ...(semanticCodeByNodeId.get(node.id) ? { semanticCode: semanticCodeByNodeId.get(node.id) } : {}),
      } as unknown as Record<string, unknown>,
      ...(node.hidden === undefined ? {} : { hidden: node.hidden }),
      zIndex: node.zIndex,
      className: node.attachment || node.contentParentId ? 'context-node appendix-node' : 'primary-node',
      selected: selectedIds.includes(node.id),
      style: collapsedResourceIds.has(node.id) ? { ...baseStyle, display: 'none' as const } : baseStyle,
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
  const placementClassName = position.y < 90 ? ' edge-toolbar-position--below' : '';
  return <div className={`edge-toolbar-position${placementClassName}`} style={{ left: position.x, top: position.y }}>
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

function renderEdge(document: CanvasDocument, edge: CanvasEdge, route: OrthogonalRoute | undefined, screenToFlowPosition?: (point: { x: number; y: number }) => Point, onLabelOffsetChange?: (offset: number) => void, onLabelDoubleClick?: (event: { clientX: number; clientY: number }) => void, selected = false, reconnectActive = false): Edge {
  const source = document.nodes.find((node) => node.id === edge.source);
  const visuals = resolveEdgeVisuals(edge.presentation);
  const editable = isEditableBusinessEdge(document, edge);
  const endpointMode = editable ? (reconnectActive ? 'active' : 'idle') : undefined;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    sourceHandle: route ? physicalHandleId(edge.id, 'source') : edge.sourceHandle ?? (source?.type === 'decision' ? 'yes' : 'out'),
    targetHandle: route ? physicalHandleId(edge.id, 'target') : edge.targetHandle ?? 'in',
    type: route ? 'orthogonal' : 'smoothstep',
    selected: editable && selected,
    reconnectable: editable && reconnectActive,
    ...visuals,
    data: {
      ...(route ? { route } : {}),
      ...(endpointMode ? { endpointMode } : {}),
      ...(edge.label ? { labelOffset: edge.presentation?.labelOffset, labelFontSize: edge.presentation?.labelFontSize } : {}),
      ...(screenToFlowPosition && onLabelOffsetChange ? { screenToFlowPosition, onLabelOffsetChange } : {}),
      ...(onLabelDoubleClick ? { onLabelDoubleClick } : {}),
      canvasEdge: edge,
    },
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

function isManualAnchorHandle(handle: string | null | undefined): boolean {
  return Boolean(handle?.startsWith('anchor-source-') || handle?.startsWith('anchor-target-'));
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

type EndpointAnchorUpdate = { anchor?: EdgeAnchor };

function manualAnchorUpdate(handle: string | null | undefined): EndpointAnchorUpdate {
  const anchor = isManualAnchorHandle(handle) ? anchorFromPhysicalHandle(handle) : undefined;
  return anchor ? { anchor } : {};
}

function edgePresentationWithAnchorUpdates(
  existing: EdgePresentation | undefined,
  sourceUpdate?: EndpointAnchorUpdate,
  targetUpdate?: EndpointAnchorUpdate,
): EdgePresentation | undefined {
  const presentation = { ...existing };
  applyEndpointAnchorUpdate(presentation, 'source', sourceUpdate);
  applyEndpointAnchorUpdate(presentation, 'target', targetUpdate);
  return Object.keys(presentation).length > 0 ? presentation : undefined;
}

function applyEndpointAnchorUpdate(
  presentation: EdgePresentation,
  endpoint: 'source' | 'target',
  update: EndpointAnchorUpdate | undefined,
) {
  if (!update) return;
  if (endpoint === 'source') {
    if (update.anchor) {
      presentation.sourceAnchor = update.anchor;
      presentation.sourceAnchorMode = 'manual';
    } else {
      delete presentation.sourceAnchor;
      delete presentation.sourceAnchorMode;
    }
    return;
  }
  if (update.anchor) {
    presentation.targetAnchor = update.anchor;
    presentation.targetAnchorMode = 'manual';
  } else {
    delete presentation.targetAnchor;
    delete presentation.targetAnchorMode;
  }
}

function edgeWithPresentation(edge: CanvasEdge, presentation: EdgePresentation | undefined): CanvasEdge {
  if (presentation) return { ...edge, presentation };
  const { presentation: _presentation, ...withoutPresentation } = edge;
  return withoutPresentation;
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
  const byOwner = new Map<string, CanvasNode[]>();
  const appendixGroupByOwner = new Map(resourceAppendixGroups(document).map((group) => [group.ownerId, group]));
  document.nodes.filter((node) => isContentNode(node) && !node.hidden).forEach((node) => {
    const ownerId = node.attachment?.ownerNodeId ?? node.contentParentId;
    if (!ownerId) return;
    const attachments = byOwner.get(ownerId);
    if (attachments) attachments.push(node);
    else byOwner.set(ownerId, [node]);
  });
  return [...byOwner.entries()].flatMap(([ownerId, attachments]) => {
    const owner = document.nodes.find((node) => node.id === ownerId);
    if (!owner) return [];
    const target = [...attachments].sort((left, right) => (left.attachment?.order ?? 0) - (right.attachment?.order ?? 0) || left.id.localeCompare(right.id))[0]!;
    const appendixGroup = appendixGroupByOwner.get(ownerId);
    const attachmentIds = new Set(attachments.map((node) => node.id));
    const collapsed = appendixGroup?.allHidden === true
      && appendixGroup.resourceIds.length === attachments.length
      && appendixGroup.resourceIds.every((resourceId) => attachmentIds.has(resourceId));
    const targetRect = collapsed
      ? { x: appendixGroup!.x, y: appendixGroup!.y, width: appendixGroup!.width, height: appendixGroup!.height }
      : canvasRect(target);
    const sourceSide = boundarySideFromRectToward(canvasRect(owner), targetRect);
    const targetSide = boundarySideFromRectToward(targetRect, canvasRect(owner));
    return [{
      id: `hierarchy:${ownerId}`,
      source: ownerId,
      target: collapsed ? resourceAppendixAnchorId(ownerId) : target.id,
      sourceHandle: `anchor-source-${sourceSide}`,
      targetHandle: collapsed ? resourceAppendixTargetHandleId(targetSide) : `anchor-target-${targetSide}`,
      type: 'straight',
      selectable: false,
      reconnectable: false,
      className: 'hierarchy-presentation-edge',
      style: { stroke: '#9a6a42', strokeDasharray: '5 5', strokeWidth: 1.5 },
      label: attachments.length > 1 ? `资料 ×${attachments.length}` : undefined,
    }];
  });
}

export interface ResourceAppendixGroup {
  ownerId: string;
  ownerTitle: string;
  resourceIds: string[];
  allHidden: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function resourceAppendixGroups(document: CanvasDocument): ResourceAppendixGroup[] {
  const byOwner = new Map<string, CanvasNode[]>();
  document.nodes.filter((node) => isAuthorResourceNode(node) && !node.hidden).forEach((node) => {
    const ownerId = resourceOwnerId(node);
    if (!ownerId) return;
    const resources = byOwner.get(ownerId);
    if (resources) resources.push(node);
    else byOwner.set(ownerId, [node]);
  });
  return [...byOwner.entries()].flatMap(([ownerId, resources]) => {
    const owner = document.nodes.find((node) => node.id === ownerId);
    if (!owner) return [];
    const minX = Math.min(...resources.map((node) => node.position.x));
    const minY = Math.min(...resources.map((node) => node.position.y));
    const maxX = Math.max(...resources.map((node) => node.position.x + (node.size?.width ?? defaultCanvasNodeSize(node).width)));
    const maxY = Math.max(...resources.map((node) => node.position.y + (node.size?.height ?? defaultCanvasNodeSize(node).height)));
    const allHidden = resources.every((node) => node.visibility === 'HIDDEN');
    const ownerTitle = resourceOwnerTitle(owner);
    const resourceIds = [...resources].sort((left, right) => (left.attachment?.order ?? 0) - (right.attachment?.order ?? 0) || left.id.localeCompare(right.id)).map((node) => node.id);
    return [{
      ownerId,
      ownerTitle,
      resourceIds,
      allHidden,
      x: minX - 18,
      y: minY - 30,
      width: allHidden ? Math.max(220, Math.min(420, ownerTitle.length * 14 + 132)) : maxX - minX + 36,
      height: allHidden ? 58 : maxY - minY + 48,
    }];
  });
}

export function resourceAppendixTargetSide(group: ResourceAppendixGroup, owner: CanvasNode): ResourceAppendixAnchorSide {
  return boundarySideFromRectToward(
    { x: group.x, y: group.y, width: group.width, height: group.height },
    canvasRect(owner),
  );
}

function canvasRect(node: CanvasNode): { x: number; y: number; width: number; height: number } {
  const size = node.size ?? defaultCanvasNodeSize(node);
  return { x: node.position.x, y: node.position.y, width: size.width, height: size.height };
}

function boundarySideFromRectToward(
  from: { x: number; y: number; width: number; height: number },
  toward: { x: number; y: number; width: number; height: number },
): ResourceAppendixAnchorSide {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const towardCenter = { x: toward.x + toward.width / 2, y: toward.y + toward.height / 2 };
  const deltaX = towardCenter.x - fromCenter.x;
  const deltaY = towardCenter.y - fromCenter.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX >= 0 ? 'RIGHT' : 'LEFT';
  return deltaY >= 0 ? 'BOTTOM' : 'TOP';
}

export function resourceAppendixAnchorNodes(document: CanvasDocument): Node[] {
  return resourceAppendixGroups(document).flatMap((group) => {
    if (!group.allHidden) return [];
    const owner = document.nodes.find((node) => node.id === group.ownerId);
    if (!owner) return [];
    return [{
      id: resourceAppendixAnchorId(group.ownerId),
      type: 'resource-appendix-anchor',
      position: { x: group.x, y: group.y },
      data: { targetSide: resourceAppendixTargetSide(group, owner) },
      className: 'resource-appendix-anchor',
      selectable: false,
      draggable: false,
      connectable: false,
      width: group.width,
      height: group.height,
      handles: resourceAppendixAnchorHandles(group.width, group.height),
      style: { width: group.width, height: group.height, pointerEvents: 'none' as const },
    } satisfies Node];
  });
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

function pickResponsibility(lane: FlowLane): { title: string } {
  return { title: lane.title };
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

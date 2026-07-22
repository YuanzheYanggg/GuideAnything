import {
  defaultCanvasNodeSize,
  deriveSemanticFlow,
  getStageBounds,
  isContentNode,
  isPrimaryFlowNode,
  routeCanvasEdges,
  type OrthogonalRoute,
  type StageBounds,
} from '@guideanything/canvas-core';
import type { CanvasDocument, CanvasEdge, CanvasNode, ImageAnnotation } from '@guideanything/contracts';

import type { GuideDraftDetail } from '../editor/GuideEditor';

export type GuidePdfExportInput = Pick<
  GuideDraftDetail,
  'title' | 'summary' | 'tags' | 'status' | 'revision' | 'publishedVersion' | 'document'
> & { generatedAt: string };

export type GuidePdfExportWarningCode =
  | 'NO_FLOW_NODES'
  | 'VIDEO_URL_NOT_PUBLIC'
  | 'IMAGE_LOAD_FAILED'
  | 'VIDEO_QR_FAILED';

export interface GuidePdfExportWarning {
  code: GuidePdfExportWarningCode;
  message: string;
  nodeId?: string;
}

export interface GuidePdfOverviewNode {
  id: string;
  type: CanvasNode['type'];
  code: string;
  title: string;
  summary: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  stageTitle?: string;
  laneTitle?: string;
}

export interface GuidePdfOverviewEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  route?: OrthogonalRoute;
  presentation?: CanvasEdge['presentation'];
}

export type GuidePdfResource =
  | { kind: 'markdown'; id: string; code: string; markdown: string }
  | { kind: 'image'; id: string; code: string; url: string; alt: string; caption?: string; annotations: ImageAnnotation[] }
  | { kind: 'video'; id: string; code: string; url: string; caption?: string; keypoints: CanvasNode<'video'>['data']['keypoints'] };

export interface GuidePdfStep {
  code: string;
  node: CanvasNode;
  title: string;
  description: string;
  stageTitle?: string;
  laneTitle?: string;
  resources: GuidePdfResource[];
  relatedEdgeLabels: string[];
}

export interface GuidePdfExportModel {
  cover: {
    title: string;
    summary: string;
    tags: string[];
    status: string;
    revision: number;
    publishedVersion: number | null;
    generatedAt: string;
    counts: { steps: number; markdown: number; images: number; videos: number };
  };
  overview: {
    nodes: GuidePdfOverviewNode[];
    edges: GuidePdfOverviewEdge[];
    stageBounds: StageBounds[];
    hasFlow: boolean;
  };
  steps: GuidePdfStep[];
  warnings: GuidePdfExportWarning[];
}

const PUBLIC_VIDEO_PROTOCOLS = new Set(['http:', 'https:']);

export function buildGuidePdfExportModel(input: GuidePdfExportInput): GuidePdfExportModel {
  const { document } = input;
  const semanticFlow = deriveSemanticFlow(document);
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const stagesById = new Map((document.stages ?? []).map((stage) => [stage.id, stage]));
  const lanesById = new Map((document.lanes ?? []).map((lane) => [lane.id, lane]));
  const semanticItemsByNodeId = semanticFlow.itemsByNodeId;
  const visiblePrimaryIds = new Set(document.nodes.filter((node) => isVisiblePrimary(node)).map((node) => node.id));
  const overviewDocument = buildOverviewDocument(document, visiblePrimaryIds);
  const routesByEdgeId = routeCanvasEdges(overviewDocument).routesByEdgeId;
  const overviewNodes = semanticFlow.items
    .filter((item) => item.kind !== 'RESOURCE' && visiblePrimaryIds.has(item.nodeId))
    .map((item) => {
      const node = nodesById.get(item.nodeId);
      return node ? toOverviewNode(node, item.code, stagesById, lanesById) : undefined;
    })
    .filter((node): node is GuidePdfOverviewNode => Boolean(node));
  const overviewEdges = overviewDocument.edges.map((edge) => toOverviewEdge(edge, routesByEdgeId.get(edge.id)));
  const steps = semanticFlow.items
    .filter((item) => item.kind !== 'RESOURCE' && visiblePrimaryIds.has(item.nodeId))
    .map((item) => {
      const node = nodesById.get(item.nodeId);
      if (!node) return undefined;
      return toStep(node, item.code, semanticFlow.items, nodesById, stagesById, lanesById, document.edges, semanticItemsByNodeId);
    })
    .filter((step): step is GuidePdfStep => Boolean(step));
  const resources = steps.flatMap((step) => step.resources);
  const warnings: GuidePdfExportWarning[] = [];
  if (overviewNodes.length === 0) {
    warnings.push({ code: 'NO_FLOW_NODES', message: '没有可展示的流程节点。' });
  }
  resources.forEach((resource) => {
    if (resource.kind !== 'video' || isPublicVideoUrl(resource.url)) return;
    warnings.push({
      code: 'VIDEO_URL_NOT_PUBLIC',
      message: `视频“${resource.caption || resource.id}”不是可公开访问的 HTTP(S) 地址，无法生成外部二维码。`,
      nodeId: resource.id,
    });
  });

  return {
    cover: {
      title: input.title,
      summary: input.summary,
      tags: [...input.tags],
      status: input.status,
      revision: input.revision,
      publishedVersion: input.publishedVersion,
      generatedAt: input.generatedAt,
      counts: {
        steps: steps.length,
        markdown: resources.filter((resource) => resource.kind === 'markdown').length,
        images: resources.filter((resource) => resource.kind === 'image').length,
        videos: resources.filter((resource) => resource.kind === 'video').length,
      },
    },
    overview: {
      nodes: overviewNodes,
      edges: overviewEdges,
      stageBounds: getStageBounds(overviewDocument),
      hasFlow: overviewNodes.length > 0,
    },
    steps,
    warnings,
  };
}

export function isPublicVideoUrl(value: string): boolean {
  try {
    return PUBLIC_VIDEO_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function buildOverviewDocument(document: CanvasDocument, primaryIds: Set<string>): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.filter((node) => primaryIds.has(node.id)),
    edges: document.edges.filter((edge) => isOverviewEdge(edge, primaryIds)),
  };
}

function isOverviewEdge(edge: CanvasEdge, primaryIds: Set<string>): boolean {
  return !edge.hidden
    && !edge.sourceTrace
    && edge.semantic?.kind !== 'RESOURCE_REFERENCE'
    && primaryIds.has(edge.source)
    && primaryIds.has(edge.target);
}

function isVisiblePrimary(node: CanvasNode): boolean {
  return !node.hidden && node.visibility !== 'HIDDEN' && isPrimaryFlowNode(node);
}

function isVisibleResource(node: CanvasNode | undefined): node is CanvasNode<'markdown' | 'image' | 'video'> {
  if (!node) return false;
  return !node.hidden && node.visibility !== 'HIDDEN' && isContentNode(node);
}

function toOverviewNode(
  node: CanvasNode,
  code: string,
  stagesById: Map<string, { title: string }>,
  lanesById: Map<string, { title: string }>,
): GuidePdfOverviewNode {
  const stageTitle = node.stageId ? stagesById.get(node.stageId)?.title : undefined;
  const laneTitle = node.laneId ? lanesById.get(node.laneId)?.title : undefined;
  return {
    id: node.id,
    type: node.type,
    code,
    title: nodeTitle(node),
    summary: nodeDescription(node),
    position: { ...node.position },
    size: { ...(node.size ?? defaultCanvasNodeSize(node)) },
    ...(stageTitle ? { stageTitle } : {}),
    ...(laneTitle ? { laneTitle } : {}),
  };
}

function toOverviewEdge(edge: CanvasEdge, route: OrthogonalRoute | undefined): GuidePdfOverviewEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    ...(route ? { route } : {}),
    ...(edge.presentation ? { presentation: edge.presentation } : {}),
  };
}

function toStep(
  node: CanvasNode,
  code: string,
  semanticItems: ReturnType<typeof deriveSemanticFlow>['items'],
  nodesById: Map<string, CanvasNode>,
  stagesById: Map<string, { title: string }>,
  lanesById: Map<string, { title: string }>,
  edges: CanvasEdge[],
  semanticItemsByNodeId: Map<string, ReturnType<typeof deriveSemanticFlow>['items'][number]>,
): GuidePdfStep {
  const stageTitle = node.stageId ? stagesById.get(node.stageId)?.title : undefined;
  const laneTitle = node.laneId ? lanesById.get(node.laneId)?.title : undefined;
  const resources = semanticItems
    .filter((item) => item.kind === 'RESOURCE' && item.parentId === node.id)
    .map((item) => {
      const resourceNode = nodesById.get(item.nodeId);
      return resourceNode && isVisibleResource(resourceNode) ? toResource(resourceNode, item.code) : undefined;
    })
    .filter((resource): resource is GuidePdfResource => Boolean(resource));
  const relatedEdgeLabels = edges
    .filter((edge) => isRelatedFlowEdge(edge, node.id, semanticItemsByNodeId))
    .map((edge) => edge.label?.trim())
    .filter((label): label is string => Boolean(label));
  return {
    code,
    node,
    title: nodeTitle(node),
    description: nodeDescription(node),
    ...(stageTitle ? { stageTitle } : {}),
    ...(laneTitle ? { laneTitle } : {}),
    resources,
    relatedEdgeLabels: [...new Set(relatedEdgeLabels)],
  };
}

function isRelatedFlowEdge(
  edge: CanvasEdge,
  nodeId: string,
  semanticItemsByNodeId: Map<string, ReturnType<typeof deriveSemanticFlow>['items'][number]>,
): boolean {
  return !edge.hidden
    && !edge.sourceTrace
    && edge.semantic?.kind !== 'RESOURCE_REFERENCE'
    && (edge.source === nodeId || edge.target === nodeId)
    && semanticItemsByNodeId.has(edge.source)
    && semanticItemsByNodeId.has(edge.target);
}

function toResource(node: CanvasNode<'markdown' | 'image' | 'video'>, code: string): GuidePdfResource {
  if (node.type === 'markdown') {
    return { kind: 'markdown', id: node.id, code, markdown: node.data.markdown };
  }
  if (node.type === 'image') {
    const annotations = [...(node.data.annotations ?? [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    return {
      kind: 'image',
      id: node.id,
      code,
      url: node.data.url,
      alt: node.data.alt,
      annotations,
      ...(node.data.caption !== undefined ? { caption: node.data.caption } : {}),
    };
  }
  return {
    kind: 'video',
    id: node.id,
    code,
    url: node.data.url,
    keypoints: [...node.data.keypoints],
    ...(node.data.caption !== undefined ? { caption: node.data.caption } : {}),
  };
}

function nodeTitle(node: CanvasNode): string {
  if (node.type === 'subguide') return node.data.title;
  if (node.type === 'markdown') return node.data.markdown.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 200) || 'Markdown 资料';
  if (node.type === 'image') return node.data.caption || node.data.alt;
  if (node.type === 'video') return node.data.caption || '视频资料';
  return node.data.label;
}

function nodeDescription(node: CanvasNode): string {
  if (node.type === 'start' || node.type === 'end' || node.type === 'process' || node.type === 'decision' || node.type === 'data') {
    return node.data.description ?? '';
  }
  if (node.type === 'subguide') return `固定引用版本 v${node.data.version}`;
  return '';
}

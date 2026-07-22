import type { CanvasDocument, CanvasEdge, CanvasNode } from '@guideanything/contracts';
import { deriveSemanticFlow, isContentNode, isPrimaryFlowNode, layoutFlowHierarchy, reconcileSemanticFanoutParents, renumberSemanticFlow } from '@guideanything/canvas-core';

export type SemanticCreationOrigin = 'toolbar' | 'connection' | 'child';
export type SemanticOutlineMove = 'previous' | 'next';

export interface SemanticNodeInsert {
  origin: SemanticCreationOrigin;
  sourceId?: string;
  edgeId?: string;
  sourceHandle?: string;
}

/**
 * Converts all authoring entry points into the same semantic operation while
 * preserving the author's current canvas positions. Automatic arrangement is
 * an explicit preview/apply action in the editor.
 */
export function insertSemanticNode(document: CanvasDocument, createdNode: CanvasNode, input: SemanticNodeInsert): CanvasDocument {
  const source = input.sourceId
    ? document.nodes.find((node) => node.id === input.sourceId && isPrimaryFlowNode(node) && !node.source)
    : undefined;
  const created = isContentNode(createdNode)
    ? attachResource(document, createdNode, source)
    : insertPrimaryStep(document, createdNode, source, input.origin);
  const edge = created && source && !isContentNode(created) && input.edgeId
    ? semanticEdge(source, created, input)
    : undefined;
  const next: CanvasDocument = {
    ...document,
    nodes: [...document.nodes, created],
    ...(edge ? { edges: [...document.edges, edge] } : {}),
  };
  const normalized = renumberSemanticFlow(next);
  const ordered = source && !isContentNode(created) && !(input.origin === 'child' || (input.origin === 'connection' && source.type === 'decision'))
    ? moveInsertedStepAfterSource(normalized, source.id, created.id)
    : normalized;
  return renumberSemanticFlow(ordered);
}

/** Moves a node within its semantic siblings, then refreshes codes and placement. */
export function moveSemanticOutlineNode(
  document: CanvasDocument,
  nodeId: string,
  direction: SemanticOutlineMove,
): CanvasDocument {
  const flow = deriveSemanticFlow(document);
  const target = flow.itemsByNodeId.get(nodeId);
  if (!target || target.kind === 'RESOURCE') return document;
  const siblings = flow.items.filter((item) => item.kind === target.kind && item.parentId === target.parentId);
  const currentIndex = siblings.findIndex((item) => item.nodeId === nodeId);
  const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= siblings.length) return document;
  const currentSibling = siblings[currentIndex];
  const nextSibling = siblings[nextIndex];
  if (!currentSibling || !nextSibling) return document;
  const reordered = [...siblings];
  [reordered[currentIndex], reordered[nextIndex]] = [nextSibling, currentSibling];
  const orderByNodeId = new Map(reordered.map((item, order) => [item.nodeId, order]));
  const reorderedDocument: CanvasDocument = {
    ...document,
    nodes: document.nodes.map((node) => {
      const order = orderByNodeId.get(node.id);
      if (order === undefined || !isPrimaryFlowNode(node)) return node;
      return {
        ...node,
        outline: { ...(target.parentId ? { parentId: target.parentId } : {}), order, kind: target.kind === 'BRANCH' ? 'BRANCH' : 'STEP' },
      } as CanvasNode;
    }),
  };
  return layoutFlowHierarchy(renumberSemanticFlow(reorderedDocument)).document;
}

/** Writes the semantic relationship for a connection made to an existing node. */
export function connectSemanticNodes(document: CanvasDocument, edge: CanvasEdge): CanvasDocument {
  const source = document.nodes.find((node) => node.id === edge.source && isPrimaryFlowNode(node) && !node.source);
  const target = document.nodes.find((node) => node.id === edge.target && !node.source);
  if (!source || !target) return { ...document, edges: [...document.edges, edge] };
  if (isContentNode(target)) {
    return { ...document, edges: [...document.edges, { ...edge, semantic: { kind: 'RESOURCE_REFERENCE' } }] };
  }
  if (!isPrimaryFlowNode(target)) return { ...document, edges: [...document.edges, edge] };
  if (source.type !== 'decision') {
    return reconcileSemanticFanoutParents({
      ...document,
      edges: [...document.edges, { ...edge, semantic: { kind: 'FLOW' } }],
    });
  }
  const order = nextSiblingOrder(document, source.id, 'BRANCH');
  const label = source.data.branchLabels?.[order];
  const next: CanvasDocument = {
    ...document,
    nodes: document.nodes.map((node) => node.id === target.id
      ? {
        ...node,
        ...(source.stageId && !node.stageId ? { stageId: source.stageId } : {}),
        ...(source.laneId && !node.laneId ? { laneId: source.laneId } : {}),
        outline: { parentId: source.id, order, kind: 'BRANCH' },
      } as CanvasNode
      : node),
    edges: [...document.edges, {
      ...edge,
      semantic: { kind: 'BRANCH', order },
      ...(label ? { label } : {}),
    }],
  };
  return renumberSemanticFlow(next);
}

function attachResource(document: CanvasDocument, created: CanvasNode, source: CanvasNode | undefined): CanvasNode {
  if (!source) return created;
  const attachmentOrder = document.nodes.filter((node) => isContentNode(node) && (node.attachment?.ownerNodeId ?? node.contentParentId) === source.id).length;
  return { ...created, attachment: { ownerNodeId: source.id, order: attachmentOrder } } as CanvasNode;
}

function insertPrimaryStep(
  document: CanvasDocument,
  created: CanvasNode,
  source: CanvasNode | undefined,
  origin: SemanticCreationOrigin,
): CanvasNode {
  if (!source) {
    return { ...created, outline: { order: nextTopLevelOrder(document), kind: 'STEP' } } as CanvasNode;
  }
  const branch = origin === 'connection' && source.type === 'decision';
  const child = origin === 'child';
  const parentId = child || branch ? source.id : source.outline?.parentId;
  const kind = branch ? 'BRANCH' as const : source.outline?.kind === 'BRANCH' && !child ? 'BRANCH' as const : 'STEP' as const;
  const order = child || branch
    ? nextSiblingOrder(document, parentId, kind)
    : afterSourceOrder(document, source.id);
  return {
    ...created,
    ...(source.stageId ? { stageId: source.stageId } : {}),
    ...(source.laneId ? { laneId: source.laneId } : {}),
    outline: { ...(parentId ? { parentId } : {}), order, kind },
  } as CanvasNode;
}

function semanticEdge(source: CanvasNode, target: CanvasNode, input: SemanticNodeInsert): CanvasEdge {
  const branch = target.outline?.kind === 'BRANCH';
  const branchOrder = target.outline?.order ?? 0;
  const branchLabel = branch && source.type === 'decision'
    ? source.data.branchLabels?.[branchOrder]
    : undefined;
  return {
    id: input.edgeId!,
    source: source.id,
    target: target.id,
    ...(input.sourceHandle ? { sourceHandle: input.sourceHandle } : {}),
    semantic: branch ? { kind: 'BRANCH', order: Math.floor(branchOrder) } : { kind: 'FLOW' },
    ...(branchLabel ? { label: branchLabel } : {}),
  };
}

function nextTopLevelOrder(document: CanvasDocument): number {
  const flow = deriveSemanticFlow(document);
  const topLevel = flow.items.filter((item) => item.kind !== 'RESOURCE' && !item.parentId);
  return Math.max(-1, ...topLevel.map((item) => item.order)) + 1;
}

function nextSiblingOrder(document: CanvasDocument, parentId: string | undefined, kind: 'STEP' | 'BRANCH'): number {
  const flow = deriveSemanticFlow(document);
  const siblingOrders = flow.items
    .filter((item) => item.kind === kind && item.parentId === parentId)
    .map((item) => item.order);
  return Math.max(-1, ...siblingOrders) + 1;
}

function afterSourceOrder(document: CanvasDocument, sourceId: string): number {
  const item = deriveSemanticFlow(document).itemsByNodeId.get(sourceId);
  return (item?.order ?? document.nodes.findIndex((node) => node.id === sourceId)) + 0.5;
}

function moveInsertedStepAfterSource(document: CanvasDocument, sourceId: string, createdId: string): CanvasDocument {
  const source = document.nodes.find((node) => node.id === sourceId);
  const created = document.nodes.find((node) => node.id === createdId);
  if (!source || !created || !isPrimaryFlowNode(source) || !isPrimaryFlowNode(created)) return document;
  const parentId = created.outline?.parentId;
  const kind = created.outline?.kind ?? 'STEP';
  const siblings = document.nodes
    .filter((node) => isPrimaryFlowNode(node) && node.outline?.parentId === parentId && (node.outline?.kind ?? 'STEP') === kind)
    .sort((left, right) => (left.outline?.order ?? 0) - (right.outline?.order ?? 0) || left.id.localeCompare(right.id));
  const withoutCreated = siblings.filter((node) => node.id !== createdId);
  const sourceIndex = withoutCreated.findIndex((node) => node.id === sourceId);
  if (sourceIndex < 0) return document;
  withoutCreated.splice(sourceIndex + 1, 0, created);
  const orderById = new Map(withoutCreated.map((node, order) => [node.id, order]));
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const order = orderById.get(node.id);
      if (order === undefined || !node.outline) return node;
      return { ...node, outline: { ...node.outline, order } } as CanvasNode;
    }),
  };
}

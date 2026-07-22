import type { CanvasDocument, CanvasNode, EdgeAnchor } from '@guideanything/contracts';
import { defaultCanvasNodeSize, type OrthogonalRoute, type Point } from '@guideanything/canvas-core';

export const DEFAULT_ENDPOINT_SNAP_DISTANCE = 18;

type EndpointKind = 'source' | 'target';

export interface EndpointSnapResult {
  anchor: EdgeAnchor;
  peerEdgeIds: string[];
}

export function findNearestEndpointSnap(
  document: CanvasDocument,
  routesByEdgeId: ReadonlyMap<string, OrthogonalRoute>,
  editingEdgeId: string,
  endpoint: EndpointKind,
  nodeId: string,
  pointer: Point,
  threshold = DEFAULT_ENDPOINT_SNAP_DISTANCE,
): EndpointSnapResult | undefined {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return undefined;

  const candidates = document.edges.flatMap((edge) => {
    if (edge.id === editingEdgeId || edge.hidden || edge.sourceTrace) return [];
    const attachedNodeId = endpoint === 'source' ? edge.source : edge.target;
    if (attachedNodeId !== nodeId) return [];
    const route = routesByEdgeId.get(edge.id);
    if (!route) return [];
    const anchor = endpoint === 'source' ? route.sourceAnchor : route.targetAnchor;
    return [{ edgeId: edge.id, anchor, point: pointForEndpointAnchor(node, anchor) }];
  });
  if (candidates.length === 0) return undefined;

  const nearest = [...candidates]
    .map((candidate) => ({ ...candidate, distance: distance(candidate.point, pointer) }))
    .sort((left, right) => left.distance - right.distance || left.edgeId.localeCompare(right.edgeId))[0];
  if (!nearest || nearest.distance > threshold) return undefined;

  return {
    anchor: nearest.anchor,
    peerEdgeIds: candidates
      .filter((candidate) => distance(candidate.point, nearest.point) <= 0.5)
      .map((candidate) => candidate.edgeId),
  };
}

export function pointForEndpointAnchor(node: CanvasNode, anchor: EdgeAnchor): Point {
  const size = node.size ?? defaultCanvasNodeSize(node);
  if (anchor.side === 'TOP') return { x: node.position.x + size.width * anchor.offset, y: node.position.y };
  if (anchor.side === 'RIGHT') return { x: node.position.x + size.width, y: node.position.y + size.height * anchor.offset };
  if (anchor.side === 'BOTTOM') return { x: node.position.x + size.width * anchor.offset, y: node.position.y + size.height };
  return { x: node.position.x, y: node.position.y + size.height * anchor.offset };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

import type { CanvasDocument, CanvasEdge, EdgeAnchor, EdgePresentation } from '@guideanything/contracts';
import { MarkerType } from '@xyflow/react';
import type { CSSProperties } from 'react';

const primaryFlowTypes = new Set(['start', 'end', 'process', 'decision', 'data', 'subguide']);

const colorByName = {
  default: 'var(--ga-accent)',
  blue: 'var(--ga-edge-blue)',
  green: 'var(--ga-edge-green)',
  yellow: 'var(--ga-edge-yellow)',
  red: 'var(--ga-edge-red)',
  purple: 'var(--ga-edge-purple)',
} as const;

export function resolveEdgeVisuals(presentation: EdgePresentation | undefined): {
  style: CSSProperties;
  markerStart?: { type: MarkerType };
  markerEnd?: { type: MarkerType };
} {
  const arrows = presentation?.arrows ?? 'forward';
  return {
    style: {
      stroke: colorByName[presentation?.color ?? 'default'],
      strokeWidth: presentation?.width ?? 2,
      ...(presentation?.pattern === 'dashed' ? { strokeDasharray: '8 5' }
        : presentation?.pattern === 'dotted' ? { strokeDasharray: '1 5', strokeLinecap: 'round' }
        : {}),
    },
    ...(arrows === 'reverse' || arrows === 'both' ? { markerStart: { type: MarkerType.ArrowClosed } } : {}),
    ...(arrows === 'forward' || arrows === 'both' ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
  };
}

export function edgeAnchorFromClientPoint(
  rect: { left: number; top: number; width: number; height: number },
  point: { x: number; y: number },
): EdgeAnchor {
  const x = Math.min(1, Math.max(0, (point.x - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (point.y - rect.top) / rect.height));
  const distances = [['TOP', y], ['RIGHT', 1 - x], ['BOTTOM', 1 - y], ['LEFT', x]] as const;
  const [side] = distances.reduce((closest, candidate) => candidate[1] < closest[1] ? candidate : closest);
  return { side, offset: side === 'TOP' || side === 'BOTTOM' ? x : y };
}

export function isEditableBusinessEdge(document: CanvasDocument, edge: CanvasEdge): boolean {
  if (edge.hidden || edge.sourceTrace) return false;
  const source = document.nodes.find((node) => node.id === edge.source);
  const target = document.nodes.find((node) => node.id === edge.target);
  return Boolean(source && target && !source.source && !target.source
    && !source.contentParentId && !target.contentParentId
    && primaryFlowTypes.has(source.type) && primaryFlowTypes.has(target.type));
}

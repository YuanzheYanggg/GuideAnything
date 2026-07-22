import type { CanvasDocument, CanvasEdge, EdgeAnchor, EdgePresentation, EdgeRouting } from '@guideanything/contracts';
import { MarkerType } from '@xyflow/react';
import type { CSSProperties } from 'react';

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
      stroke: edgeStrokeColor(presentation?.color),
      strokeWidth: presentation?.width ?? 2,
      ...(presentation?.pattern === 'dashed' ? { strokeDasharray: '8 5' }
        : presentation?.pattern === 'dotted' ? { strokeDasharray: '1 5', strokeLinecap: 'round' }
        : {}),
    },
    ...(arrows === 'reverse' || arrows === 'both' ? { markerStart: { type: MarkerType.ArrowClosed } } : {}),
    ...(arrows === 'forward' || arrows === 'both' ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
  };
}

/**
 * A routing choice is an explicit request to leave manual geometry behind.
 * Keeping old waypoints or endpoint anchors here makes the renderer continue
 * drawing the previous route even though the toolbar says straight/smart.
 */
export function edgePresentationForRouting(presentation: EdgePresentation | undefined, routing: EdgeRouting): EdgePresentation {
  const {
    routeMode: _routeMode,
    waypoints: _waypoints,
    sourceAnchor: _sourceAnchor,
    sourceAnchorMode: _sourceAnchorMode,
    targetAnchor: _targetAnchor,
    targetAnchorMode: _targetAnchorMode,
    ...automaticPresentation
  } = { ...presentation, routing };
  return automaticPresentation;
}

function edgeStrokeColor(color: EdgePresentation['color']): string {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
  return colorByName[color as keyof typeof colorByName] ?? colorByName.default;
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
  return Boolean(source && target && !source.source && !target.source);
}

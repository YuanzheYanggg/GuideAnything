import type { OrthogonalRoute, Point } from '@guideanything/canvas-core';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { memo, useLayoutEffect } from 'react';

interface OrthogonalEdgeData extends Record<string, unknown> {
  route?: OrthogonalRoute;
}

export const OrthogonalEdge = memo(function OrthogonalEdge({
  id, data, sourceX, sourceY, targetX, targetY, markerStart, markerEnd, style, label,
}: EdgeProps) {
  const route = (data as OrthogonalEdgeData | undefined)?.route;
  const points = route?.points ?? fallbackPoints(sourceX, sourceY, targetX, targetY);
  const path = orthogonalPath(points);
  const labelPoint = routeLabelPoint(points);
  useLayoutEffect(() => {
    if (route) syncEdgeUpdaterCoordinates(id, points);
  }, [id, points, route, sourceX, sourceY, targetX, targetY]);
  return <>
    <BaseEdge id={id} path={path} {...(markerStart ? { markerStart } : {})} {...(markerEnd ? { markerEnd } : {})} {...(style ? { style } : {})} />
    {label ? <EdgeLabelRenderer><div
      className={`orthogonal-edge-label${route?.kind === 'BACK' ? ' is-back-edge' : ''}`}
      style={{ transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)` }}
    >{label}</div></EdgeLabelRenderer> : null}
  </>;
});

export function syncEdgeUpdaterCoordinates(edgeId: string, points: Point[], root: ParentNode = document) {
  const source = points[0];
  const target = points.at(-1);
  if (!source || !target) return;
  const escapedId = edgeId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const edge = root.querySelector(`.react-flow__edge[data-id="${escapedId}"]`);
  const update = (selector: string, point: Point) => {
    const updater = edge?.querySelector<SVGCircleElement>(selector);
    updater?.setAttribute('cx', String(point.x));
    updater?.setAttribute('cy', String(point.y));
  };
  update('.react-flow__edgeupdater-source', source);
  update('.react-flow__edgeupdater-target', target);
}

export function orthogonalPath(points: Point[], radius = 12): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  const commands = [`M ${points[0]!.x} ${points[0]!.y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incomingLength = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    const outgoingLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    const corner = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    const entry = moveToward(current, previous, corner);
    const exit = moveToward(current, next, corner);
    commands.push(`L ${entry.x} ${entry.y}`, `Q ${current.x} ${current.y} ${exit.x} ${exit.y}`);
  }
  const last = points[points.length - 1]!;
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(' ');
}

export function routeLabelPoint(points: Point[]): Point {
  let result = points[0] ?? { x: 0, y: 0 };
  let longest = -1;
  points.slice(1).forEach((point, index) => {
    const previous = points[index]!;
    const length = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    if (length > longest) {
      longest = length;
      result = { x: (point.x + previous.x) / 2, y: (point.y + previous.y) / 2 };
    }
  });
  return result;
}

function moveToward(from: Point, to: Point, distance: number): Point {
  if (from.x === to.x) return { x: from.x, y: from.y + Math.sign(to.y - from.y) * distance };
  return { x: from.x + Math.sign(to.x - from.x) * distance, y: from.y };
}

function fallbackPoints(sourceX: number, sourceY: number, targetX: number, targetY: number): Point[] {
  const middleX = (sourceX + targetX) / 2;
  return [{ x: sourceX, y: sourceY }, { x: middleX, y: sourceY }, { x: middleX, y: targetY }, { x: targetX, y: targetY }];
}

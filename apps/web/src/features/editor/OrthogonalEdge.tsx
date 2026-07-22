import { ORTHOGONAL_BRIDGE_HALF_WIDTH, ORTHOGONAL_BRIDGE_HEIGHT, type OrthogonalRoute, type Point } from '@guideanything/canvas-core';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

interface OrthogonalEdgeData extends Record<string, unknown> {
  route?: OrthogonalRoute;
  endpointMode?: 'idle' | 'active';
  labelOffset?: number;
  labelFontSize?: number;
  onLabelOffsetChange?: (offset: number) => void;
  onLabelDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  screenToFlowPosition?: (point: Point) => Point;
}

export const OrthogonalEdge = memo(function OrthogonalEdge({
  id, data, sourceX, sourceY, targetX, targetY, markerStart, markerEnd, style, label,
}: EdgeProps) {
  const route = (data as OrthogonalEdgeData | undefined)?.route;
  const edgeData = data as OrthogonalEdgeData | undefined;
  const points = route?.points ?? fallbackPoints(sourceX, sourceY, targetX, targetY);
  const endpointMode = edgeData?.endpointMode;
  const path = renderRoutePath(route, points);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragPointerId = useRef<number | null>(null);
  const dragStartPoint = useRef<Point | null>(null);
  const dragMoved = useRef(false);
  const pendingDragOffset = useRef<number | null>(null);
  const dragCommitTimer = useRef<number | null>(null);
  const labelOffset = clamp01(dragOffset ?? edgeData?.labelOffset ?? 0.5);
  const labelPoint = labelPointAtOffset(points, labelOffset);
  const labelFontSize = edgeData?.labelFontSize ?? 14;

  useEffect(() => {
    if (!dragging || dragPointerId.current === null || !edgeData?.screenToFlowPosition) return;
    const updateOffset = (event: PointerEvent) => {
      if (!dragStartPoint.current) return;
      const distance = Math.hypot(event.clientX - dragStartPoint.current.x, event.clientY - dragStartPoint.current.y);
      if (!dragMoved.current && distance < 4) return;
      dragMoved.current = true;
      const flowPoint = edgeData.screenToFlowPosition!({ x: event.clientX, y: event.clientY });
      setDragOffset(labelOffsetAtPoint(points, flowPoint));
    };
    const finishDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragPointerId.current) return;
      if (dragMoved.current) {
        const flowPoint = edgeData.screenToFlowPosition!({ x: event.clientX, y: event.clientY });
        pendingDragOffset.current = labelOffsetAtPoint(points, flowPoint);
        if (dragCommitTimer.current !== null) window.clearTimeout(dragCommitTimer.current);
        dragCommitTimer.current = window.setTimeout(() => {
          const offset = pendingDragOffset.current;
          pendingDragOffset.current = null;
          dragCommitTimer.current = null;
          if (offset !== null) edgeData.onLabelOffsetChange?.(offset);
        }, 220);
      }
      dragPointerId.current = null;
      dragStartPoint.current = null;
      dragMoved.current = false;
      setDragOffset(null);
      setDragging(false);
    };
    window.addEventListener('pointermove', updateOffset);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', updateOffset);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [dragging, edgeData, points]);

  useEffect(() => () => {
    if (dragCommitTimer.current !== null) window.clearTimeout(dragCommitTimer.current);
  }, []);

  const startLabelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !edgeData?.screenToFlowPosition || !edgeData.onLabelOffsetChange) return;
    if (event.detail > 1) {
      if (dragCommitTimer.current !== null) window.clearTimeout(dragCommitTimer.current);
      dragCommitTimer.current = null;
      pendingDragOffset.current = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragPointerId.current = event.pointerId;
    dragStartPoint.current = { x: event.clientX, y: event.clientY };
    dragMoved.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  useLayoutEffect(() => {
    if (route) syncEdgeUpdaterCoordinates(id, points);
  }, [endpointMode, id, points, route, sourceX, sourceY, targetX, targetY]);
  return <>
    <BaseEdge id={id} path={path} {...(markerStart ? { markerStart } : {})} {...(markerEnd ? { markerEnd } : {})} {...(style ? { style } : {})} />
    {endpointMode === 'active' ? <>
      <circle aria-hidden="true" className="orthogonal-edge-endpoint is-source is-active" cx={points[0]!.x} cy={points[0]!.y} r={8} pointerEvents="none" />
      <circle aria-hidden="true" className="orthogonal-edge-endpoint is-target is-active" cx={points.at(-1)!.x} cy={points.at(-1)!.y} r={8} pointerEvents="none" />
    </> : endpointMode === 'idle' ? <>
      <circle aria-hidden="true" className="orthogonal-edge-endpoint is-source" cx={points[0]!.x} cy={points[0]!.y} r={3.5} pointerEvents="none" />
      <circle aria-hidden="true" className="orthogonal-edge-endpoint is-target" cx={points.at(-1)!.x} cy={points.at(-1)!.y} r={3.5} pointerEvents="none" />
    </> : null}
    {label ? <EdgeLabelRenderer><div
      className={`orthogonal-edge-label${route?.kind === 'BACK' ? ' is-back-edge' : ''}`}
      style={{ transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`, fontSize: `${labelFontSize}px`, pointerEvents: edgeData?.onLabelOffsetChange ? 'all' : 'none', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}
      onPointerDown={startLabelDrag}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        edgeData?.onLabelDoubleClick?.(event);
      }}
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

export function renderRoutePath(route: OrthogonalRoute | undefined, fallback: Point[]): string {
  const points = route?.points ?? fallback;
  if (points.length === 2 && (points[0]!.x === points[1]!.x || points[0]!.y === points[1]!.y)) return linePath(points);
  if (route?.pathStyle === 'diagonal' && route.directPathSafe && route.directPath.length >= 2) return linePath(route.directPath);
  if (route?.pathStyle === 'smooth' && route.smoothPathSafe && route.smoothSegments.length > 0) return cubicPath(route.smoothSegments);
  return orthogonalPath(points, 12, route?.bridges ?? []);
}

function linePath(points: Point[]): string {
  if (points.length === 0) return '';
  const commands = [`M ${points[0]!.x} ${points[0]!.y}`];
  points.slice(1).forEach((point) => commands.push(`L ${point.x} ${point.y}`));
  return commands.join(' ');
}

function cubicPath(segments: OrthogonalRoute['smoothSegments']): string {
  if (segments.length === 0) return '';
  const commands = [`M ${segments[0]!.start.x} ${segments[0]!.start.y}`];
  segments.forEach((segment) => {
    commands.push(`C ${segment.control1.x} ${segment.control1.y} ${segment.control2.x} ${segment.control2.y} ${segment.end.x} ${segment.end.y}`);
  });
  return commands.join(' ');
}

export function orthogonalPath(points: Point[], radius = 12, bridges: Point[] = []): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  const commands = [`M ${points[0]!.x} ${points[0]!.y}`];
  let cursor = points[0]!;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incomingLength = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    const outgoingLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    const corner = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    const entry = moveToward(current, previous, corner);
    const exit = moveToward(current, next, corner);
    appendLineWithBridges(commands, cursor, entry, bridges);
    commands.push(`Q ${current.x} ${current.y} ${exit.x} ${exit.y}`);
    cursor = exit;
  }
  const last = points[points.length - 1]!;
  appendLineWithBridges(commands, cursor, last, bridges);
  return commands.join(' ');
}

function appendLineWithBridges(commands: string[], from: Point, to: Point, bridges: Point[]) {
  const segmentBridges = bridges
    .filter((bridge) => bridgeOnSegment(bridge, from, to))
    .sort((left, right) => Math.hypot(left.x - from.x, left.y - from.y) - Math.hypot(right.x - from.x, right.y - from.y));
  for (const bridge of segmentBridges) {
    const direction = from.x !== to.x ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y);
    const before = from.x !== to.x
      ? { x: bridge.x - direction * ORTHOGONAL_BRIDGE_HALF_WIDTH, y: bridge.y }
      : { x: bridge.x - ORTHOGONAL_BRIDGE_HEIGHT, y: bridge.y - direction * ORTHOGONAL_BRIDGE_HALF_WIDTH };
    const after = from.x !== to.x
      ? { x: bridge.x + direction * ORTHOGONAL_BRIDGE_HALF_WIDTH, y: bridge.y }
      : { x: bridge.x, y: bridge.y + direction * ORTHOGONAL_BRIDGE_HALF_WIDTH };
    commands.push(`L ${before.x} ${before.y}`);
    if (from.x !== to.x) commands.push(`Q ${bridge.x} ${bridge.y - ORTHOGONAL_BRIDGE_HEIGHT} ${after.x} ${after.y}`);
    else commands.push(`Q ${bridge.x - ORTHOGONAL_BRIDGE_HEIGHT} ${bridge.y} ${after.x} ${after.y}`);
  }
  commands.push(`L ${to.x} ${to.y}`);
}

function bridgeOnSegment(point: Point, start: Point, finish: Point): boolean {
  if (start.y === finish.y && start.x !== finish.x) {
    return point.y === start.y
      && point.x > Math.min(start.x, finish.x) + ORTHOGONAL_BRIDGE_HALF_WIDTH
      && point.x < Math.max(start.x, finish.x) - ORTHOGONAL_BRIDGE_HALF_WIDTH;
  }
  if (start.x === finish.x && start.y !== finish.y) {
    return point.x === start.x
      && point.y > Math.min(start.y, finish.y) + ORTHOGONAL_BRIDGE_HALF_WIDTH
      && point.y < Math.max(start.y, finish.y) - ORTHOGONAL_BRIDGE_HALF_WIDTH;
  }
  return false;
}

export function routeLabelPoint(points: Point[]): Point {
  return labelPointAtOffset(points, 0.5);
}

export function labelPointAtOffset(points: Point[], offset: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths = points.slice(1).map((point, index) => segmentLength(points[index]!, point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return points[0]!;
  let remaining = clamp01(offset) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (remaining <= length || index === lengths.length - 1) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const ratio = length === 0 ? 0 : remaining / length;
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    }
    remaining -= length;
  }
  return points.at(-1)!;
}

export function labelOffsetAtPoint(points: Point[], point: Point): number {
  if (points.length < 2) return 0.5;
  const lengths = points.slice(1).map((candidate, index) => segmentLength(points[index]!, candidate));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return 0.5;
  let travelled = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestDistanceAlongRoute = 0;
  points.slice(1).forEach((end, index) => {
    const start = points[index]!;
    const length = lengths[index]!;
    const ratio = length === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)));
    const candidate = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestDistanceAlongRoute = travelled + length * ratio;
    }
    travelled += length;
  });
  return clamp01(closestDistanceAlongRoute / total);
}

function segmentLength(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function moveToward(from: Point, to: Point, distance: number): Point {
  if (from.x === to.x) return { x: from.x, y: from.y + Math.sign(to.y - from.y) * distance };
  return { x: from.x + Math.sign(to.x - from.x) * distance, y: from.y };
}

function fallbackPoints(sourceX: number, sourceY: number, targetX: number, targetY: number): Point[] {
  const middleX = (sourceX + targetX) / 2;
  return [{ x: sourceX, y: sourceY }, { x: middleX, y: sourceY }, { x: middleX, y: targetY }, { x: targetX, y: targetY }];
}

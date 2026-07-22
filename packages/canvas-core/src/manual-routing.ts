import type { Point } from './routing';

export type RouteSegmentOrientation = 'horizontal' | 'vertical';

const MANUAL_ROUTE_GRID = 20;
const MANUAL_ROUTE_ENDPOINT_SNAP = 12;

export interface EditableRouteSegment {
  index: number;
  orientation: RouteSegmentOrientation;
  start: Point;
  end: Point;
  midpoint: Point;
}

export function seedManualRoute(points: Point[], clearance = 24, detour = 80): Point[] {
  const cloned = points.map((point) => ({ ...point }));
  if (cloned.length !== 2) return cloned;

  const source = cloned[0]!;
  const target = cloned[1]!;
  if (source.y === target.y && source.x !== target.x) {
    const direction = Math.sign(target.x - source.x) || 1;
    const sourceX = source.x + direction * clearance;
    const targetX = target.x - direction * clearance;
    const channelY = source.y + detour;
    return [
      source,
      { x: sourceX, y: source.y },
      { x: sourceX, y: channelY },
      { x: targetX, y: channelY },
      { x: targetX, y: target.y },
      target,
    ];
  }

  if (source.x === target.x && source.y !== target.y) {
    const direction = Math.sign(target.y - source.y) || 1;
    const sourceY = source.y + direction * clearance;
    const targetY = target.y - direction * clearance;
    const channelX = source.x + detour;
    return [
      source,
      { x: source.x, y: sourceY },
      { x: channelX, y: sourceY },
      { x: channelX, y: targetY },
      { x: target.x, y: targetY },
      target,
    ];
  }

  const middleX = (source.x + target.x) / 2;
  return [source, { x: middleX, y: source.y }, { x: middleX, y: target.y }, target];
}

export function editableRouteSegments(points: Point[]): EditableRouteSegment[] {
  const segments: EditableRouteSegment[] = [];
  for (let index = 1; index < points.length - 2; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (start.x === end.x && start.y !== end.y) {
      segments.push({ index, orientation: 'vertical', start, end, midpoint: midpoint(start, end) });
    } else if (start.y === end.y && start.x !== end.x) {
      segments.push({ index, orientation: 'horizontal', start, end, midpoint: midpoint(start, end) });
    }
  }
  return segments;
}

export function moveRouteSegment(points: Point[], segmentIndex: number, coordinate: number): Point[] {
  if (points.length === 2 && segmentIndex === 0) {
    const source = points[0]!;
    const target = points[1]!;
    if (source.y === target.y && source.x !== target.x) {
      if (coordinate === source.y) return points.map(copyPoint);
      return seedManualRoute(points, 24, coordinate - source.y);
    }
    if (source.x === target.x && source.y !== target.y) {
      if (coordinate === source.x) return points.map(copyPoint);
      return seedManualRoute(points, 24, coordinate - source.x);
    }
  }

  const segment = editableRouteSegments(points).find((candidate) => candidate.index === segmentIndex);
  if (!segment || !Number.isFinite(coordinate)) return points.map(copyPoint);

  const next = points.map(copyPoint);
  if (segment.orientation === 'horizontal') {
    next[segment.index] = { ...next[segment.index]!, y: coordinate };
    next[segment.index + 1] = { ...next[segment.index + 1]!, y: coordinate };
  } else {
    next[segment.index] = { ...next[segment.index]!, x: coordinate };
    next[segment.index + 1] = { ...next[segment.index + 1]!, x: coordinate };
  }
  return next;
}

export function snapRouteCoordinate(points: Point[], orientation: RouteSegmentOrientation, coordinate: number): number {
  if (!Number.isFinite(coordinate)) return coordinate;
  const first = points[0];
  const last = points.at(-1);
  const endpointCoordinate = orientation === 'horizontal'
    ? [first?.y, last?.y]
    : [first?.x, last?.x];
  const nearestEndpoint = endpointCoordinate
    .filter((candidate): candidate is number => candidate !== undefined)
    .sort((left, right) => Math.abs(left - coordinate) - Math.abs(right - coordinate))[0];
  if (nearestEndpoint !== undefined && Math.abs(nearestEndpoint - coordinate) <= MANUAL_ROUTE_ENDPOINT_SNAP) return nearestEndpoint;
  return Math.round(coordinate / MANUAL_ROUTE_GRID) * MANUAL_ROUTE_GRID;
}

function midpoint(start: Point, end: Point): Point {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

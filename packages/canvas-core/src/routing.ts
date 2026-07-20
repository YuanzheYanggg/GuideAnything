import type { CanvasDocument, CanvasEdge, CanvasNode, EdgeAnchor, EdgeRouting } from '@guideanything/contracts';

const CHANNEL_GAP = 18;
const PORT_GAP = 24;
const OUTER_GAP = 64;
const OBSTACLE_PADDING = 10;
const FANOUT_NEIGHBORHOOD = 18;
const FANOUT_GAP = 18;
const FANOUT_EDGE_INSET = 12;
const DEFAULT_ALIGNMENT_THRESHOLD = 12;

export interface Point {
  x: number;
  y: number;
}

export interface NodeRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RouteSide = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
export type RouteKind = 'FORWARD' | 'BRANCH' | 'WRAP' | 'CROSS_STAGE' | 'BACK';

export interface OrthogonalRoute {
  edgeId: string;
  points: Point[];
  routing: EdgeRouting;
  kind: RouteKind;
  sourceSide: RouteSide;
  targetSide: RouteSide;
  sourceAnchor: EdgeAnchor;
  targetAnchor: EdgeAnchor;
  collision: boolean;
}

export interface NodeAlignmentSnap {
  edgeId: string;
  axis: 'x' | 'y';
  coordinate: number;
  position: Point;
}

export interface RoutingReport {
  backEdgeIds: string[];
  avoidedEdgeIds: string[];
  collisionEdgeIds: string[];
  manualConflictEdgeIds: string[];
}

export interface RoutingResult {
  routesByEdgeId: Map<string, OrthogonalRoute>;
  report: RoutingReport;
}

interface RoutePort {
  point: Point;
  side: RouteSide;
  offset: number;
}

interface RouteCandidate {
  edge: CanvasEdge;
  source: NodeRect;
  target: NodeRect;
  kind: RouteKind;
  fallbackSides: { source: RouteSide; target: RouteSide };
  sourcePort: RoutePort;
  targetPort: RoutePort;
  usesAnchors: boolean;
  routing: EdgeRouting;
  sourceFanned: boolean;
  targetFanned: boolean;
}

export function routeCanvasEdges(document: CanvasDocument): RoutingResult {
  const visibleNodes = document.nodes.filter((node) => !node.hidden);
  const rects = visibleNodes.map(nodeRect);
  const rectById = new Map(rects.map((rect) => [rect.id, rect]));
  const routable = document.edges
    .filter((edge) => !edge.hidden && !edge.sourceTrace && edge.semantic?.kind !== 'RESOURCE_REFERENCE' && rectById.has(edge.source) && rectById.has(edge.target))
    .sort((left, right) => left.id.localeCompare(right.id));
  const maximumRight = Math.max(0, ...rects.map((rect) => rect.x + rect.width));
  const minimumTop = Math.min(0, ...rects.map((rect) => rect.y));
  const routesByEdgeId = new Map<string, OrthogonalRoute>();
  const avoidedEdgeIds: string[] = [];
  const collisionEdgeIds: string[] = [];
  const manualConflictEdgeIds: string[] = [];
  const backEdgeIds: string[] = [];
  const offsetCountByChannel = new Map<string, number>();

  const candidates: RouteCandidate[] = routable.map((edge) => {
    const source = rectById.get(edge.source)!;
    const target = rectById.get(edge.target)!;
    const kind = classify(edge, source, target, document.nodes);
    const fallbackSides = sidesFor(kind, source, target);
    const sourcePort = anchoredPort(source, edge.presentation?.sourceAnchor, fallbackSides.source);
    const targetPort = anchoredPort(target, edge.presentation?.targetAnchor, fallbackSides.target);
    return {
      edge,
      source,
      target,
      kind,
      fallbackSides,
      sourcePort,
      targetPort,
      usesAnchors: Boolean(edge.presentation?.sourceAnchor || edge.presentation?.targetAnchor),
      routing: edge.presentation?.routing ?? 'elbow',
      sourceFanned: false,
      targetFanned: false,
    };
  });
  fanOutSharedPorts(candidates);

  candidates.forEach((candidate) => {
    const { edge, source, target, kind, fallbackSides, sourcePort, targetPort, routing } = candidate;
    const channelKey = offsetChannelKey(kind, edge, sourcePort.side);
    const channelIndex = channelKey ? offsetCountByChannel.get(channelKey) ?? 0 : 0;
    if (channelKey) offsetCountByChannel.set(channelKey, channelIndex + 1);
    const offset = channelIndex * CHANNEL_GAP;
    const obstacles = rects.filter((rect) => rect.id !== source.id && rect.id !== target.id);
    const directPoints = [sourcePort.point, targetPort.point];
    const routeBlocked = (candidatePoints: Point[]) => routeIntersects(candidatePoints, obstacles)
      || routeIntersectsEndpointNodes(candidatePoints, source, target);
    const usesDisplayedPorts = candidate.usesAnchors || candidate.sourceFanned || candidate.targetFanned;
    const manualPoints = edge.presentation?.routeMode === 'manual' && edge.presentation.waypoints?.length
      ? compact([sourcePort.point, ...edge.presentation.waypoints, targetPort.point])
      : undefined;
    const manualBlocked = manualPoints ? !isOrthogonal(manualPoints) || routeBlocked(manualPoints) : false;
    const elbowPoints = () => usesDisplayedPorts
      ? anchoredDirectRoute(kind, sourcePort, targetPort, offset, maximumRight)
      : directRoute(kind, source, target, fallbackSides.source, fallbackSides.target, offset, maximumRight);
    const elbowCandidates = [elbowPoints()];
    if (kind === 'BACK' && usesDisplayedPorts && portsFaceEachOther(sourcePort, targetPort)) {
      elbowCandidates.push(routePorts(sourcePort, targetPort, offset));
    }
    const clearElbowCandidates = elbowCandidates.filter((candidatePoints) => !routeBlocked(candidatePoints));
    let points: Point[];
    if (manualPoints && !manualBlocked) {
      points = manualPoints;
    } else {
      if (manualPoints && manualBlocked) manualConflictEdgeIds.push(edge.id);
      points = routing === 'straight' && !manualPoints
        ? directPoints
        : routing === 'smart' && !manualPoints && !routeBlocked(directPoints)
          ? directPoints
          : chooseShortestRoute(clearElbowCandidates) ?? elbowCandidates[0]!;
    }
    if ((routing !== 'straight' || manualBlocked) && clearElbowCandidates.length === 0) {
      avoidedEdgeIds.push(edge.id);
      points = usesDisplayedPorts
        ? kind === 'BACK'
          ? anchoredBackRoute(sourcePort, targetPort, offset, maximumRight)
          : anchoredOuterRoute(sourcePort, targetPort, offset, maximumRight, minimumTop)
        : kind === 'BACK'
          ? backRoute(source, target, offset, maximumRight)
          : outerRoute(source, target, fallbackSides.source, fallbackSides.target, offset, maximumRight, minimumTop);
    }
    points = compact(points);
    const collision = routeBlocked(points);
    if (collision) collisionEdgeIds.push(edge.id);
    if (kind === 'BACK') backEdgeIds.push(edge.id);
    routesByEdgeId.set(edge.id, {
      edgeId: edge.id,
      points,
      routing,
      kind,
      sourceSide: sourcePort.side,
      targetSide: targetPort.side,
      sourceAnchor: anchorFromPort(sourcePort),
      targetAnchor: anchorFromPort(targetPort),
      collision,
    });
  });

  return { routesByEdgeId, report: { backEdgeIds, avoidedEdgeIds, collisionEdgeIds, manualConflictEdgeIds } };
}

export function snapNodeForStraightRoute(
  document: CanvasDocument,
  nodeId: string,
  position: Point,
  threshold = DEFAULT_ALIGNMENT_THRESHOLD,
): NodeAlignmentSnap | undefined {
  const movingNode = document.nodes.find((node) => node.id === nodeId && !node.hidden);
  if (!movingNode) return undefined;

  const rects = document.nodes.filter((node) => !node.hidden).map((node) => node.id === nodeId
    ? nodeRect({ ...node, position })
    : nodeRect(node));
  const rectById = new Map(rects.map((rect) => [rect.id, rect]));
  const movingRect = rectById.get(nodeId)!;
  const candidates: NodeAlignmentSnap[] = [];

  document.edges
    .filter((edge) => !edge.hidden && !edge.sourceTrace && (edge.source === nodeId || edge.target === nodeId))
    .forEach((edge) => {
      const source = rectById.get(edge.source);
      const target = rectById.get(edge.target);
      if (!source || !target) return;
      const kind = classify(edge, source, target, document.nodes);
      const fallbackSides = sidesFor(kind, source, target);
      const sourcePort = anchoredPort(source, edge.presentation?.sourceAnchor, fallbackSides.source);
      const targetPort = anchoredPort(target, edge.presentation?.targetAnchor, fallbackSides.target);
      if (!portsFaceEachOther(sourcePort, targetPort)) return;

      const horizontal = isHorizontalSide(sourcePort.side);
      const desired = horizontal
        ? target.id === nodeId
          ? sourcePort.point.y - movingRect.height * targetPort.offset
          : targetPort.point.y - movingRect.height * sourcePort.offset
        : target.id === nodeId
          ? sourcePort.point.x - movingRect.width * targetPort.offset
          : targetPort.point.x - movingRect.width * sourcePort.offset;
      const distance = Math.abs((horizontal ? position.y : position.x) - desired);
      if (distance > threshold) return;

      const snappedPosition = horizontal ? { x: position.x, y: desired } : { x: desired, y: position.y };
      const snappedMovingRect = { ...movingRect, x: snappedPosition.x, y: snappedPosition.y };
      const snappedSource = source.id === nodeId ? snappedMovingRect : source;
      const snappedTarget = target.id === nodeId ? snappedMovingRect : target;
      const snappedSourcePort = anchoredPort(snappedSource, edge.presentation?.sourceAnchor, fallbackSides.source);
      const snappedTargetPort = anchoredPort(snappedTarget, edge.presentation?.targetAnchor, fallbackSides.target);
      const obstacles = rects.filter((rect) => rect.id !== source.id && rect.id !== target.id);
      if (routeIntersects([snappedSourcePort.point, snappedTargetPort.point], obstacles)) return;

      candidates.push({
        edgeId: edge.id,
        axis: horizontal ? 'y' : 'x',
        coordinate: horizontal ? snappedSourcePort.point.y : snappedSourcePort.point.x,
        position: snappedPosition,
      });
    });

  return candidates.sort((left, right) => {
    const leftDistance = Math.abs((left.axis === 'y' ? position.y : position.x) - (left.axis === 'y' ? left.position.y : left.position.x));
    const rightDistance = Math.abs((right.axis === 'y' ? position.y : position.x) - (right.axis === 'y' ? right.position.y : right.position.x));
    return leftDistance - rightDistance || left.edgeId.localeCompare(right.edgeId);
  })[0];
}

function classify(edge: CanvasEdge, source: NodeRect, target: NodeRect, nodes: CanvasNode[]): RouteKind {
  const sourceNode = nodes.find((node) => node.id === edge.source);
  const targetNode = nodes.find((node) => node.id === edge.target);
  if (edge.semantic?.kind === 'RETRY' || edge.semantic?.kind === 'EXCEPTION') return 'BACK';
  if (edge.semantic?.kind === 'BRANCH') return 'BRANCH';
  if (sourceNode?.stageId && targetNode?.stageId && sourceNode.stageId !== targetNode.stageId) return 'CROSS_STAGE';
  if (edge.sourceHandle !== 'no' && target.y > source.y + source.height + CHANNEL_GAP && target.x <= source.x) return 'WRAP';
  const nearlySameRow = Math.abs(target.y - source.y) <= DEFAULT_ALIGNMENT_THRESHOLD;
  if ((!nearlySameRow && target.y < source.y) || (target.x <= source.x && sourceNode?.stageId === targetNode?.stageId)) return 'BACK';
  if (edge.sourceHandle === 'no' || target.y > source.y + source.height + CHANNEL_GAP) return 'BRANCH';
  return 'FORWARD';
}

function sidesFor(kind: RouteKind, source: NodeRect, target: NodeRect): { source: RouteSide; target: RouteSide } {
  if (kind === 'CROSS_STAGE' || kind === 'WRAP') return { source: 'BOTTOM', target: 'TOP' };
  if (kind === 'BRANCH') return { source: 'BOTTOM', target: target.x > source.x ? 'LEFT' : 'TOP' };
  if (kind === 'BACK') return { source: 'RIGHT', target: 'RIGHT' };
  return { source: 'RIGHT', target: 'LEFT' };
}

function directRoute(
  kind: RouteKind,
  source: NodeRect,
  target: NodeRect,
  sourceSide: RouteSide,
  targetSide: RouteSide,
  offset: number,
  maximumRight: number,
): Point[] {
  const start = port(source, sourceSide);
  const finish = port(target, targetSide);
  if (kind === 'BACK') return backRoute(source, target, offset, maximumRight);
  if (kind === 'CROSS_STAGE' || kind === 'WRAP') {
    const channelY = start.y + Math.max(PORT_GAP, (finish.y - start.y) / 2) + offset;
    return [start, { x: start.x, y: channelY }, { x: finish.x, y: channelY }, finish];
  }
  if (kind === 'BRANCH') {
    const channelY = start.y + PORT_GAP + offset;
    const beforeTarget = targetSide === 'LEFT' ? { x: finish.x - PORT_GAP, y: finish.y } : { x: finish.x, y: finish.y - PORT_GAP };
    return [start, { x: start.x, y: channelY }, { x: beforeTarget.x, y: channelY }, beforeTarget, finish];
  }
  const channelX = start.x + Math.max(PORT_GAP, (finish.x - start.x) / 2) + offset;
  return [start, { x: channelX, y: start.y }, { x: channelX, y: finish.y }, finish];
}

function anchoredDirectRoute(
  kind: RouteKind,
  source: RoutePort,
  target: RoutePort,
  offset: number,
  maximumRight: number,
): Point[] {
  if (kind === 'BACK') return anchoredBackRoute(source, target, offset, maximumRight);
  return routePorts(source, target, offset);
}

function backRoute(source: NodeRect, target: NodeRect, offset: number, maximumRight: number): Point[] {
  const start = port(source, 'RIGHT');
  const finish = port(target, 'RIGHT');
  const outerX = maximumRight + OUTER_GAP + offset;
  const sourceApproachX = start.x + PORT_GAP;
  const targetApproachX = finish.x + PORT_GAP;
  const targetChannelY = target.y - PORT_GAP - offset;
  return [
    start,
    { x: sourceApproachX, y: start.y },
    { x: outerX, y: start.y },
    { x: outerX, y: targetChannelY },
    { x: targetApproachX, y: targetChannelY },
    { x: targetApproachX, y: finish.y },
    finish,
  ];
}

function anchoredBackRoute(source: RoutePort, target: RoutePort, offset: number, maximumRight: number): Point[] {
  const sourceExit = extendPort(source, PORT_GAP);
  const targetApproach = extendPort(target, PORT_GAP);
  const outerX = maximumRight + OUTER_GAP + offset;
  const outerY = Math.min(sourceExit.y, targetApproach.y) - OUTER_GAP - offset;
  return [
    source.point,
    sourceExit,
    { x: outerX, y: sourceExit.y },
    { x: outerX, y: outerY },
    { x: targetApproach.x, y: outerY },
    targetApproach,
    target.point,
  ];
}

function offsetChannelKey(kind: RouteKind, edge: CanvasEdge, sourceSide: RouteSide): string | null {
  return `${kind}:${edge.source}:${sourceSide}`;
}

function outerRoute(
  source: NodeRect,
  target: NodeRect,
  sourceSide: RouteSide,
  targetSide: RouteSide,
  offset: number,
  maximumRight: number,
  minimumTop: number,
): Point[] {
  const start = port(source, sourceSide);
  const finish = port(target, targetSide);
  const outerX = maximumRight + OUTER_GAP + offset;
  const outerY = minimumTop - OUTER_GAP - offset;
  const sourceApproach = sourceSide === 'BOTTOM'
    ? { x: start.x, y: start.y + PORT_GAP }
    : { x: start.x + PORT_GAP, y: start.y };
  const targetApproachX = targetSide === 'RIGHT' ? finish.x + PORT_GAP : finish.x - PORT_GAP;
  const points = [
    start,
    sourceApproach,
    { x: sourceApproach.x, y: outerY },
  ];
  if (target.x <= source.x) points.push({ x: outerX, y: outerY });
  points.push(
    { x: targetApproachX, y: outerY },
    { x: targetApproachX, y: finish.y },
    finish,
  );
  return points;
}

function anchoredOuterRoute(
  source: RoutePort,
  target: RoutePort,
  offset: number,
  maximumRight: number,
  minimumTop: number,
): Point[] {
  const sourceExit = extendPort(source, PORT_GAP);
  const targetApproach = extendPort(target, PORT_GAP);
  const outerX = maximumRight + OUTER_GAP + offset;
  const outerY = minimumTop - OUTER_GAP - offset;
  return [
    source.point,
    sourceExit,
    { x: sourceExit.x, y: outerY },
    { x: outerX, y: outerY },
    { x: targetApproach.x, y: outerY },
    targetApproach,
    target.point,
  ];
}

function routePorts(source: RoutePort, target: RoutePort, offset: number): Point[] {
  const sourceExit = extendPort(source, PORT_GAP);
  const targetApproach = extendPort(target, PORT_GAP);
  if (source.side === 'LEFT' || source.side === 'RIGHT') {
    const channelX = (sourceExit.x + targetApproach.x) / 2 + offset;
    return [
      source.point,
      sourceExit,
      { x: channelX, y: sourceExit.y },
      { x: channelX, y: targetApproach.y },
      targetApproach,
      target.point,
    ];
  }
  const channelY = (sourceExit.y + targetApproach.y) / 2 + offset;
  return [
    source.point,
    sourceExit,
    { x: sourceExit.x, y: channelY },
    { x: targetApproach.x, y: channelY },
    targetApproach,
    target.point,
  ];
}

function anchoredPort(rect: NodeRect, anchor: EdgeAnchor | undefined, fallback: RouteSide): RoutePort {
  const side = anchor?.side ?? fallback;
  const offset = Math.min(1, Math.max(0, anchor?.offset ?? 0.5));
  if (side === 'LEFT') return { side, offset, point: { x: rect.x, y: rect.y + rect.height * offset } };
  if (side === 'RIGHT') return { side, offset, point: { x: rect.x + rect.width, y: rect.y + rect.height * offset } };
  if (side === 'TOP') return { side, offset, point: { x: rect.x + rect.width * offset, y: rect.y } };
  return { side, offset, point: { x: rect.x + rect.width * offset, y: rect.y + rect.height } };
}

function fanOutSharedPorts(candidates: RouteCandidate[]) {
  const endpoints = candidates.flatMap((candidate) => [
    { candidate, end: 'source' as const, node: candidate.source, port: candidate.sourcePort },
    { candidate, end: 'target' as const, node: candidate.target, port: candidate.targetPort },
  ]);
  const groups = new Map<string, typeof endpoints>();
  endpoints.forEach((endpoint) => {
    const key = `${endpoint.node.id}:${endpoint.port.side}`;
    const group = groups.get(key) ?? [];
    group.push(endpoint);
    groups.set(key, group);
  });

  groups.forEach((group) => {
    const sideLength = isHorizontalSide(group[0]!.port.side) ? group[0]!.node.height : group[0]!.node.width;
    group
      .sort((left, right) => left.port.offset - right.port.offset || endpointKey(left).localeCompare(endpointKey(right)))
      .reduce<typeof group[]>((clusters, endpoint) => {
        const cluster = clusters.at(-1);
        const first = cluster?.[0];
        if (!cluster || !first || (endpoint.port.offset - first.port.offset) * sideLength > FANOUT_NEIGHBORHOOD) {
          clusters.push([endpoint]);
        } else {
          cluster.push(endpoint);
        }
        return clusters;
      }, [])
      .filter((cluster) => cluster.length > 1)
      .forEach((cluster) => {
        const average = cluster.reduce((total, endpoint) => total + endpoint.port.offset, 0) / cluster.length;
        const gap = Math.min(FANOUT_GAP, (sideLength - FANOUT_EDGE_INSET * 2) / Math.max(1, cluster.length - 1));
        const span = gap * (cluster.length - 1);
        const minimum = FANOUT_EDGE_INSET / sideLength;
        const firstOffset = Math.min(1 - minimum - span / sideLength, Math.max(minimum, average - span / sideLength / 2));
        cluster.forEach((endpoint, index) => {
          const port = anchoredPort(endpoint.node, {
            side: endpoint.port.side,
            offset: firstOffset + index * gap / sideLength,
          }, endpoint.port.side);
          if (endpoint.end === 'source') {
            endpoint.candidate.sourcePort = port;
            endpoint.candidate.sourceFanned = true;
          } else {
            endpoint.candidate.targetPort = port;
            endpoint.candidate.targetFanned = true;
          }
        });
      });
  });
}

function endpointKey(endpoint: { candidate: RouteCandidate; end: 'source' | 'target' }): string {
  return `${endpoint.candidate.edge.id}:${endpoint.end}`;
}

function anchorFromPort(port: RoutePort): EdgeAnchor {
  return { side: port.side, offset: port.offset };
}

function isHorizontalSide(side: RouteSide): boolean {
  return side === 'LEFT' || side === 'RIGHT';
}

function portsFaceEachOther(source: RoutePort, target: RoutePort): boolean {
  if (isHorizontalSide(source.side) !== isHorizontalSide(target.side)) return false;
  if (source.side === 'RIGHT' && target.side === 'LEFT') return source.point.x <= target.point.x;
  if (source.side === 'LEFT' && target.side === 'RIGHT') return source.point.x >= target.point.x;
  if (source.side === 'BOTTOM' && target.side === 'TOP') return source.point.y <= target.point.y;
  if (source.side === 'TOP' && target.side === 'BOTTOM') return source.point.y >= target.point.y;
  return false;
}

function chooseShortestRoute(routes: Point[][]): Point[] | undefined {
  return routes.reduce<Point[] | undefined>((shortest, candidate) => {
    if (!shortest) return candidate;
    const lengthDifference = routeLength(candidate) - routeLength(shortest);
    if (lengthDifference !== 0) return lengthDifference < 0 ? candidate : shortest;
    return bendCount(candidate) < bendCount(shortest) ? candidate : shortest;
  }, undefined);
}

function routeLength(points: Point[]): number {
  return points.slice(1).reduce((length, point, index) => {
    const previous = points[index]!;
    return length + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
  }, 0);
}

function bendCount(points: Point[]): number {
  return points.slice(2).reduce((count, point, index) => {
    const previous = points[index + 1]!;
    const beforePrevious = points[index]!;
    const previousHorizontal = previous.y === beforePrevious.y;
    const currentHorizontal = point.y === previous.y;
    return count + Number(previousHorizontal !== currentHorizontal);
  }, 0);
}

function extendPort(port: RoutePort, amount: number): Point {
  if (port.side === 'LEFT') return { x: port.point.x - amount, y: port.point.y };
  if (port.side === 'RIGHT') return { x: port.point.x + amount, y: port.point.y };
  if (port.side === 'TOP') return { x: port.point.x, y: port.point.y - amount };
  return { x: port.point.x, y: port.point.y + amount };
}

function port(rect: NodeRect, side: RouteSide): Point {
  if (side === 'LEFT') return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === 'RIGHT') return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === 'TOP') return { x: rect.x + rect.width / 2, y: rect.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

function routeIntersects(points: Point[], obstacles: NodeRect[]): boolean {
  return points.slice(1).some((point, index) => obstacles.some((rect) => segmentIntersects(points[index]!, point, rect)));
}

function routeIntersectsEndpointNodes(points: Point[], source: NodeRect, target: NodeRect): boolean {
  const segments = points.slice(1);
  return segments.some((finish, index) => {
    const start = points[index]!;
    return [source, target].some((rect) => {
      if (rect.id === source.id && index === 0) return false;
      if (rect.id === target.id && index === segments.length - 1) return false;
      return segmentIntersects(start, finish, rect);
    });
  });
}

function segmentIntersects(start: Point, finish: Point, rect: NodeRect): boolean {
  const left = rect.x - OBSTACLE_PADDING;
  const right = rect.x + rect.width + OBSTACLE_PADDING;
  const top = rect.y - OBSTACLE_PADDING;
  const bottom = rect.y + rect.height + OBSTACLE_PADDING;
  const deltaX = finish.x - start.x;
  const deltaY = finish.y - start.y;
  const boundaries: Array<[number, number]> = [
    [-deltaX, start.x - left],
    [deltaX, right - start.x],
    [-deltaY, start.y - top],
    [deltaY, bottom - start.y],
  ];
  let entry = 0;
  let exit = 1;
  for (const [delta, distance] of boundaries) {
    if (delta === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / delta;
    if (delta < 0) {
      if (ratio > exit) return false;
      entry = Math.max(entry, ratio);
    } else {
      if (ratio < entry) return false;
      exit = Math.min(exit, ratio);
    }
  }
  return entry <= exit;
}

function compact(points: Point[]): Point[] {
  const unique = points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const previous = unique[index - 1]!;
    const next = unique[index + 1]!;
    return !(previous.x === point.x && point.x === next.x) && !(previous.y === point.y && point.y === next.y);
  });
}

function isOrthogonal(points: Point[]): boolean {
  return points.slice(1).every((point, index) => {
    const previous = points[index]!;
    return point.x === previous.x || point.y === previous.y;
  });
}

function nodeRect(node: CanvasNode): NodeRect {
  const size = node.size ?? defaultCanvasNodeSize(node);
  return { id: node.id, x: node.position.x, y: node.position.y, width: size.width, height: size.height };
}

export function defaultCanvasNodeSize(node: CanvasNode): { width: number; height: number } {
  if (node.type === 'markdown') return { width: 300, height: 180 };
  if (node.type === 'image' || node.type === 'video') return { width: 320, height: 260 };
  if (node.type === 'subguide') return { width: 240, height: 120 };
  return { width: 240, height: 104 };
}

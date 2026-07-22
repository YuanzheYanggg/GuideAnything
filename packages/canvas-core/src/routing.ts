import {
  resolveEdgePathStyle,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type EdgeAnchor,
  type EdgePathStyle,
  type EdgeRouting,
} from '@guideanything/contracts';

const CHANNEL_GAP = 18;
const PORT_GAP = 24;
const OUTER_GAP = 64;
const OBSTACLE_PADDING = 6;
const ROUTE_CLEARANCE = 2;
const ROUTE_BEND_PENALTY = 18;
const FANOUT_NEIGHBORHOOD = 18;
const FANOUT_GAP = 18;
const FANOUT_EDGE_INSET = 12;
const DEFAULT_ALIGNMENT_THRESHOLD = 12;
const FORWARD_ALIGNMENT_THRESHOLD = 24;
const NODE_ALIGNMENT_THRESHOLD = 24;
const CUBIC_HANDLE_RATIO = 0.22;
const CUBIC_SAMPLES_PER_SEGMENT = 24;

export const ORTHOGONAL_BRIDGE_HALF_WIDTH = 8;
export const ORTHOGONAL_BRIDGE_HEIGHT = 12;

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

export interface CubicBezierSegment {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}

export type RouteSide = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
export type RouteKind = 'FORWARD' | 'DOWNSTREAM' | 'BRANCH' | 'WRAP' | 'CROSS_STAGE' | 'BACK';

export interface OrthogonalRoute {
  edgeId: string;
  points: Point[];
  routing: EdgeRouting;
  pathStyle: EdgePathStyle;
  directPath: Point[];
  directPathSafe: boolean;
  smoothSegments: CubicBezierSegment[];
  smoothPathSafe: boolean;
  kind: RouteKind;
  sourceSide: RouteSide;
  targetSide: RouteSide;
  sourceAnchor: EdgeAnchor;
  targetAnchor: EdgeAnchor;
  collision: boolean;
  bridges?: Point[];
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
  manualConflictNodeIdsByEdgeId: Map<string, string[]>;
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
  routeOrder: RouteOrder;
  sourceAnchorPinned: boolean;
  targetAnchorPinned: boolean;
}

interface RouteStyleContext {
  source: NodeRect;
  target: NodeRect;
  kind: RouteKind;
  sourcePort: RoutePort;
  targetPort: RoutePort;
  obstacles: NodeRect[];
  directPath: Point[];
}

interface RouteOrder {
  semanticPriority: number;
  order: number;
  targetY: number;
  targetX: number;
  nodeIndex: number;
  edgeId: string;
}

export function routeCanvasEdges(document: CanvasDocument): RoutingResult {
  const visibleNodes = document.nodes.filter((node) => !node.hidden);
  const rects = visibleNodes.map(nodeRect);
  const rectById = new Map(rects.map((rect) => [rect.id, rect]));
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const nodeIndexById = new Map(document.nodes.map((node, index) => [node.id, index]));
  const routable = document.edges
    .filter((edge) => !edge.hidden && !edge.sourceTrace && edge.semantic?.kind !== 'RESOURCE_REFERENCE' && rectById.has(edge.source) && rectById.has(edge.target))
    .sort((left, right) => compareRouteOrder(
      routeOrderForEdge(left, nodeById.get(left.source)!, nodeById.get(left.target)!, nodeIndexById),
      routeOrderForEdge(right, nodeById.get(right.source)!, nodeById.get(right.target)!, nodeIndexById),
    ));
  const maximumRight = Math.max(0, ...rects.map((rect) => rect.x + rect.width));
  const minimumTop = Math.min(0, ...rects.map((rect) => rect.y));
  const routesByEdgeId = new Map<string, OrthogonalRoute>();
  const avoidedEdgeIds: string[] = [];
  const collisionEdgeIds: string[] = [];
  const manualConflictEdgeIds: string[] = [];
  const manualConflictNodeIdsByEdgeId = new Map<string, string[]>();
  const backEdgeIds: string[] = [];
  const offsetCountByChannel = new Map<string, number>();
  const styleContextByEdgeId = new Map<string, RouteStyleContext>();

  const candidates: RouteCandidate[] = routable.map((edge) => {
    const source = rectById.get(edge.source)!;
    const target = rectById.get(edge.target)!;
    const sourceNode = nodeById.get(edge.source)!;
    const targetNode = nodeById.get(edge.target)!;
    const kind = classify(edge, source, target, document.nodes);
    const fallbackSides = sidesFor(kind, source, target);
    const sourceAnchor = manualEndpointAnchor(edge, 'source');
    const targetAnchor = manualEndpointAnchor(edge, 'target');
    let sourcePort = anchoredPort(source, sourceAnchor, fallbackSides.source);
    let targetPort = anchoredPort(target, targetAnchor, fallbackSides.target);
    if (kind === 'FORWARD') {
      const aligned = alignAutomaticForwardPorts(source, target, sourcePort, targetPort, !sourceAnchor, !targetAnchor);
      sourcePort = aligned.source;
      targetPort = aligned.target;
    }
    return {
      edge,
      source,
      target,
      kind,
      fallbackSides,
      sourcePort,
      targetPort,
      usesAnchors: Boolean(sourceAnchor || targetAnchor),
      routing: edge.presentation?.routing ?? 'elbow',
      sourceFanned: false,
      targetFanned: false,
      routeOrder: routeOrderForEdge(edge, sourceNode, targetNode, nodeIndexById),
      sourceAnchorPinned: isManualEndpointAnchor(edge, 'source'),
      targetAnchorPinned: isManualEndpointAnchor(edge, 'target'),
    };
  });
  fanOutSharedPorts(candidates);
  candidates.forEach((candidate) => {
    if (candidate.kind !== 'FORWARD' || (!candidate.sourceFanned && !candidate.targetFanned)) return;
    const aligned = alignAutomaticForwardPorts(candidate.source, candidate.target, candidate.sourcePort, candidate.targetPort, true, true);
    candidate.sourcePort = aligned.source;
    candidate.targetPort = aligned.target;
  });

  candidates.forEach((candidate) => {
    const { edge, source, target, kind, fallbackSides, sourcePort, targetPort, routing } = candidate;
    const channelKey = offsetChannelKey(kind, edge, sourcePort.side);
    const channelIndex = channelKey ? offsetCountByChannel.get(channelKey) ?? 0 : 0;
    if (channelKey) offsetCountByChannel.set(channelKey, channelIndex + 1);
    const offset = channelIndex * CHANNEL_GAP;
    const obstacles = rects.filter((rect) => rect.id !== source.id && rect.id !== target.id);
    const directPath = [{ ...sourcePort.point }, { ...targetPort.point }];
    const routeBlocked = (candidatePoints: Point[]) => routeBlockedByNodes(
      candidatePoints,
      obstacles,
      kind,
      source,
      target,
      sourcePort,
      targetPort,
    );
    const usesDisplayedPorts = candidate.usesAnchors || candidate.sourceFanned || candidate.targetFanned;
    const manualPoints = edge.presentation?.routeMode === 'manual' && edge.presentation.waypoints?.length
      ? compact([sourcePort.point, ...edge.presentation.waypoints, targetPort.point])
      : undefined;
    const manualBlockedNodeIds = manualPoints
      ? blockedNodeIdsForRoute(manualPoints, obstacles, kind, source, target, sourcePort, targetPort)
      : [];
    const manualBlocked = manualPoints ? !isOrthogonal(manualPoints) || manualBlockedNodeIds.length > 0 : false;
    const hasAdjustedForwardPorts = kind === 'FORWARD'
      && (!samePort(sourcePort, source, fallbackSides.source) || !samePort(targetPort, target, fallbackSides.target));
    const elbowPoints = () => usesDisplayedPorts || hasAdjustedForwardPorts
      ? anchoredDirectRoute(kind, sourcePort, targetPort, offset, maximumRight)
      : directRoute(kind, source, target, fallbackSides.source, fallbackSides.target, offset, maximumRight);
    const elbowCandidates = [elbowPoints(), ...localVerticalChannelRoutes(kind, sourcePort, targetPort, obstacles, offset)];
    if (kind === 'BACK' && usesDisplayedPorts && portsFaceEachOther(sourcePort, targetPort)) {
      elbowCandidates.push(routePorts(sourcePort, targetPort, offset));
    }
    const clearElbowCandidates = elbowCandidates.filter((candidatePoints) => !routeBlocked(candidatePoints));
    let points: Point[];
    if (manualPoints && !manualBlocked) {
      points = manualPoints;
    } else {
      if (manualPoints && manualBlocked) {
        manualConflictEdgeIds.push(edge.id);
        manualConflictNodeIdsByEdgeId.set(edge.id, manualBlockedNodeIds);
      }
      points = chooseShortestRoute(clearElbowCandidates) ?? elbowCandidates[0]!;
    }
    if ((!manualPoints || manualBlocked) && clearElbowCandidates.length === 0) {
      const clearLocalDetours = localObstacleRoutes(kind, sourcePort, targetPort, obstacles)
        .filter((candidatePoints) => !routeBlocked(candidatePoints));
      const localDetour = chooseShortestRoute(clearLocalDetours);
      if (localDetour) {
        points = localDetour;
      } else {
        avoidedEdgeIds.push(edge.id);
        points = usesDisplayedPorts
          ? kind === 'BACK'
            ? anchoredBackRoute(sourcePort, targetPort, offset, maximumRight)
            : anchoredOuterRoute(sourcePort, targetPort, offset, maximumRight, minimumTop)
          : kind === 'BACK'
            ? backRoute(source, target, offset, maximumRight)
            : outerRoute(source, target, fallbackSides.source, fallbackSides.target, offset, maximumRight, minimumTop);
      }
    }
    points = compact(points);
    const collision = routeBlocked(points);
    if (collision) collisionEdgeIds.push(edge.id);
    if (kind === 'BACK') backEdgeIds.push(edge.id);
    routesByEdgeId.set(edge.id, {
      edgeId: edge.id,
      points,
      routing,
      pathStyle: resolveEdgePathStyle(edge.presentation),
      directPath,
      directPathSafe: false,
      smoothSegments: [],
      smoothPathSafe: false,
      kind,
      sourceSide: sourcePort.side,
      targetSide: targetPort.side,
      sourceAnchor: anchorFromPort(sourcePort),
      targetAnchor: anchorFromPort(targetPort),
      collision,
      bridges: [],
    });
    styleContextByEdgeId.set(edge.id, {
      source,
      target,
      kind,
      sourcePort,
      targetPort,
      obstacles,
      directPath,
    });
  });

  annotateRouteBridges(routesByEdgeId);
  routesByEdgeId.forEach((route, edgeId) => {
    const context = styleContextByEdgeId.get(edgeId);
    if (!context) return;
    const routeBlocked = (candidatePoints: Point[]) => routeBlockedByNodes(
      candidatePoints,
      context.obstacles,
      context.kind,
      context.source,
      context.target,
      context.sourcePort,
      context.targetPort,
    );
    const smoothSegments = smoothSegmentsForRoute(route.points, route.sourceSide, route.targetSide);
    // A bridge is an edge-vs-edge decoration for the orthogonal renderer. It
    // is not a node collision and must not silently turn a selected diagonal
    // or smooth visual style back into the canonical elbow route.
    route.directPathSafe = !routeBlocked(route.directPath);
    route.smoothSegments = smoothSegments;
    route.smoothPathSafe = smoothSegments.length > 0
      && !sampledCurveBlockedByNodes(
        sampleCubicSegments(smoothSegments),
        context.obstacles,
        context.source,
        context.target,
        context.sourcePort,
        context.targetPort,
      );
  });

  return {
    routesByEdgeId,
    report: { backEdgeIds, avoidedEdgeIds, collisionEdgeIds, manualConflictEdgeIds, manualConflictNodeIdsByEdgeId },
  };
}

function routeBlockedByNodes(
  candidatePoints: Point[],
  obstacles: NodeRect[],
  kind: RouteKind,
  source: NodeRect,
  target: NodeRect,
  sourcePort: RoutePort,
  targetPort: RoutePort,
): boolean {
  return blockedNodeIdsForRoute(candidatePoints, obstacles, kind, source, target, sourcePort, targetPort).length > 0;
}

function blockedNodeIdsForRoute(
  candidatePoints: Point[],
  obstacles: NodeRect[],
  kind: RouteKind,
  source: NodeRect,
  target: NodeRect,
  sourcePort: RoutePort,
  targetPort: RoutePort,
): string[] {
  const blockedIds = obstacles
    .filter((rect) => routeIntersects(candidatePoints, [rect]))
    .map((rect) => rect.id);
  if (!isLocalDownstreamGap(candidatePoints, kind, sourcePort, targetPort)) {
    if (routeIntersectsEndpointNode(candidatePoints, source, source, target, sourcePort, targetPort)) blockedIds.push(source.id);
    if (routeIntersectsEndpointNode(candidatePoints, target, source, target, sourcePort, targetPort)) blockedIds.push(target.id);
  }
  return [...new Set(blockedIds)];
}

function sampledCurveBlockedByNodes(
  candidatePoints: Point[],
  obstacles: NodeRect[],
  source: NodeRect,
  target: NodeRect,
  sourcePort: RoutePort,
  targetPort: RoutePort,
): boolean {
  return routeIntersects(candidatePoints, obstacles)
    || sampledCurveIntersectsEndpointNodes(candidatePoints, source, target, sourcePort, targetPort);
}

function sampledCurveIntersectsEndpointNodes(
  points: Point[],
  source: NodeRect,
  target: NodeRect,
  sourcePort: RoutePort,
  targetPort: RoutePort,
): boolean {
  const sourceExitIndex = points.findIndex((point, index) => index > 0 && !pointInsidePaddedNode(point, source));
  let targetEntryIndex = -1;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    if (!pointInsidePaddedNode(points[index]!, target)) {
      targetEntryIndex = index;
      break;
    }
  }
  if (sourceExitIndex < 0 || targetEntryIndex < 0 || sourceExitIndex >= targetEntryIndex) return true;

  const sourceExit = points.slice(0, sourceExitIndex + 1);
  const targetEntry = points.slice(targetEntryIndex);
  if (!sourceExit.every((point) => pointStaysOutsidePortSide(point, sourcePort))) return true;
  if (!targetEntry.every((point) => pointStaysOutsidePortSide(point, targetPort))) return true;

  return routeIntersects(points.slice(sourceExitIndex, targetEntryIndex + 1), [source, target]);
}

function smoothSegmentsForRoute(
  points: Point[],
  sourceSide: RouteSide,
  targetSide: RouteSide,
): CubicBezierSegment[] {
  const guides = compact(points);
  if (guides.length < 3 || !isOrthogonal(guides)) return [];

  const sourceDirection = sideDirection(sourceSide);
  const targetDirection = negateVector(sideDirection(targetSide));
  if (!pointsMoveInDirection(guides[0]!, guides[1]!, sourceDirection)
    || !pointsMoveInDirection(guides.at(-2)!, guides.at(-1)!, targetDirection)) return [];

  const tangents = guides.map((point, index) => {
    if (index === 0) return sourceDirection;
    if (index === guides.length - 1) return targetDirection;
    const incoming = directionBetween(guides[index - 1]!, point);
    const outgoing = directionBetween(point, guides[index + 1]!);
    return normalizeVector({ x: incoming.x + outgoing.x, y: incoming.y + outgoing.y })
      ?? outgoing;
  });
  const handleLengths = guides.map((point, index) => {
    const previousLength = index > 0 ? distanceBetween(guides[index - 1]!, point) : undefined;
    const nextLength = index < guides.length - 1 ? distanceBetween(point, guides[index + 1]!) : undefined;
    return Math.min(...[previousLength, nextLength].filter((length): length is number => length !== undefined)) * CUBIC_HANDLE_RATIO;
  });

  return guides.slice(1).map((end, index) => {
    const start = guides[index]!;
    return {
      start,
      control1: translatePoint(start, tangents[index]!, handleLengths[index]!),
      control2: translatePoint(end, tangents[index + 1]!, -handleLengths[index + 1]!),
      end,
    };
  });
}

function sampleCubicSegments(segments: CubicBezierSegment[]): Point[] {
  return segments.flatMap((segment, segmentIndex) => {
    const points = Array.from({ length: CUBIC_SAMPLES_PER_SEGMENT }, (_, index) => cubicPoint(segment, (index + 1) / CUBIC_SAMPLES_PER_SEGMENT));
    return segmentIndex === 0 ? [segment.start, ...points] : points;
  });
}

function cubicPoint(segment: CubicBezierSegment, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * segment.start.x
      + 3 * inverse ** 2 * t * segment.control1.x
      + 3 * inverse * t ** 2 * segment.control2.x
      + t ** 3 * segment.end.x,
    y: inverse ** 3 * segment.start.y
      + 3 * inverse ** 2 * t * segment.control1.y
      + 3 * inverse * t ** 2 * segment.control2.y
      + t ** 3 * segment.end.y,
  };
}

function sideDirection(side: RouteSide): Point {
  if (side === 'LEFT') return { x: -1, y: 0 };
  if (side === 'RIGHT') return { x: 1, y: 0 };
  if (side === 'TOP') return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function negateVector(vector: Point): Point {
  return { x: -vector.x, y: -vector.y };
}

function directionBetween(start: Point, finish: Point): Point {
  return normalizeVector({ x: finish.x - start.x, y: finish.y - start.y }) ?? { x: 0, y: 0 };
}

function normalizeVector(vector: Point): Point | undefined {
  const length = Math.hypot(vector.x, vector.y);
  return length === 0 ? undefined : { x: vector.x / length, y: vector.y / length };
}

function distanceBetween(start: Point, finish: Point): number {
  return Math.hypot(finish.x - start.x, finish.y - start.y);
}

function translatePoint(point: Point, direction: Point, amount: number): Point {
  return { x: point.x + direction.x * amount, y: point.y + direction.y * amount };
}

function pointsMoveInDirection(start: Point, finish: Point, direction: Point): boolean {
  return (finish.x - start.x) * direction.x + (finish.y - start.y) * direction.y > 0;
}

export function snapNodeForStraightRoute(
  document: CanvasDocument,
  nodeId: string,
  position: Point,
  threshold = NODE_ALIGNMENT_THRESHOLD,
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
      const ports = alignmentPorts(edge, source, target);
      if (!ports) return;
      const { sourcePort, targetPort } = ports;

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
      const snappedPorts = alignmentPorts(edge, snappedSource, snappedTarget);
      if (!snappedPorts) return;
      const { sourcePort: snappedSourcePort, targetPort: snappedTargetPort } = snappedPorts;
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

function alignmentPorts(edge: CanvasEdge, source: NodeRect, target: NodeRect): { sourcePort: RoutePort; targetPort: RoutePort } | undefined {
  if (
    edge.semantic?.kind === 'BRANCH'
    || edge.semantic?.kind === 'RETRY'
    || edge.semantic?.kind === 'EXCEPTION'
    || edge.sourceHandle === 'yes'
    || edge.sourceHandle === 'no'
  ) return undefined;

  const sourceAnchor = manualEndpointAnchor(edge, 'source');
  const targetAnchor = manualEndpointAnchor(edge, 'target');

  if (sourceAnchor && targetAnchor) {
    const sourcePort = anchoredPort(source, sourceAnchor, sourceAnchor.side);
    const targetPort = anchoredPort(target, targetAnchor, targetAnchor.side);
    return portsFaceEachOther(sourcePort, targetPort)
      ? { sourcePort, targetPort }
      : undefined;
  }

  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);
  const inferredSourceSide = horizontal
    ? targetCenter.x >= sourceCenter.x ? 'RIGHT' : 'LEFT'
    : targetCenter.y >= sourceCenter.y ? 'BOTTOM' : 'TOP';
  const inferredTargetSide = oppositeSide(inferredSourceSide);
  const sourceSide = sourceAnchor?.side ?? (targetAnchor ? oppositeSide(targetAnchor.side) : inferredSourceSide);
  const targetSide = targetAnchor?.side ?? (sourceAnchor ? oppositeSide(sourceAnchor.side) : inferredTargetSide);
  const sourcePort = anchoredPort(source, sourceAnchor, sourceSide);
  const targetPort = anchoredPort(target, targetAnchor, targetSide);
  return portsFaceEachOther(sourcePort, targetPort) ? { sourcePort, targetPort } : undefined;
}

function classify(edge: CanvasEdge, source: NodeRect, target: NodeRect, nodes: CanvasNode[]): RouteKind {
  const sourceNode = nodes.find((node) => node.id === edge.source);
  const targetNode = nodes.find((node) => node.id === edge.target);
  if (edge.semantic?.kind === 'RETRY' || edge.semantic?.kind === 'EXCEPTION') return 'BACK';
  if (edge.semantic?.kind === 'BRANCH') return 'BRANCH';
  if (sourceNode?.stageId && targetNode?.stageId && sourceNode.stageId !== targetNode.stageId) return 'CROSS_STAGE';
  if (isSameLaneDownstreamContinuation(edge, sourceNode, targetNode, source, target)) return 'DOWNSTREAM';
  if (edge.sourceHandle !== 'no' && target.y > source.y + source.height + CHANNEL_GAP && target.x <= source.x) return 'WRAP';
  const nearlySameRow = Math.abs(target.y - source.y) <= DEFAULT_ALIGNMENT_THRESHOLD;
  if ((!nearlySameRow && target.y < source.y) || (target.x <= source.x && sourceNode?.stageId === targetNode?.stageId)) return 'BACK';
  if (edge.sourceHandle === 'no' || target.y > source.y + source.height + CHANNEL_GAP) return 'BRANCH';
  return 'FORWARD';
}

function sidesFor(kind: RouteKind, source: NodeRect, target: NodeRect): { source: RouteSide; target: RouteSide } {
  if (kind === 'CROSS_STAGE' || kind === 'DOWNSTREAM' || kind === 'WRAP') return { source: 'BOTTOM', target: 'TOP' };
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
  if (kind === 'DOWNSTREAM') {
    const channelY = channelCoordinate(start.y, finish.y, offset);
    return [start, { x: start.x, y: channelY }, { x: finish.x, y: channelY }, finish];
  }
  if (kind === 'CROSS_STAGE' || kind === 'WRAP') {
    const channelY = channelCoordinate(start.y, finish.y, offset);
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

function routeOrderForEdge(
  edge: CanvasEdge,
  source: CanvasNode,
  target: CanvasNode,
  nodeIndexById: ReadonlyMap<string, number>,
): RouteOrder {
  const directChildOrder = target.outline?.parentId === source.id ? target.outline.order : undefined;
  const edgeOrder = edge.semantic?.order;
  const fallbackOutlineOrder = target.outline?.order;
  const order = directChildOrder ?? edgeOrder ?? fallbackOutlineOrder ?? target.position.y;
  return {
    semanticPriority: directChildOrder !== undefined ? 0 : edgeOrder !== undefined ? 1 : fallbackOutlineOrder !== undefined ? 2 : 3,
    order,
    targetY: target.position.y,
    targetX: target.position.x,
    nodeIndex: nodeIndexById.get(target.id) ?? Number.MAX_SAFE_INTEGER,
    edgeId: edge.id,
  };
}

function compareRouteOrder(left: RouteOrder, right: RouteOrder): number {
  return left.semanticPriority - right.semanticPriority
    || left.order - right.order
    || left.targetY - right.targetY
    || left.targetX - right.targetX
    || left.nodeIndex - right.nodeIndex
    || left.edgeId.localeCompare(right.edgeId);
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
  if (portsFaceEachOther(source, target)) return facingPortsRoute(source, target, offset);
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

function facingPortsRoute(source: RoutePort, target: RoutePort, offset: number): Point[] {
  if (isHorizontalSide(source.side)) {
    const channelX = channelCoordinate(source.point.x, target.point.x, offset);
    return [
      source.point,
      { x: channelX, y: source.point.y },
      { x: channelX, y: target.point.y },
      target.point,
    ];
  }
  const channelY = channelCoordinate(source.point.y, target.point.y, offset);
  return [
    source.point,
    { x: source.point.x, y: channelY },
    { x: target.point.x, y: channelY },
    target.point,
  ];
}

function localVerticalChannelRoutes(
  kind: RouteKind,
  source: RoutePort,
  target: RoutePort,
  obstacles: NodeRect[],
  offset: number,
): Point[][] {
  if (!['DOWNSTREAM', 'WRAP', 'CROSS_STAGE'].includes(kind)) return [];
  if (source.side !== 'BOTTOM' || target.side !== 'TOP' || source.point.y >= target.point.y) return [];
  const channels = localVerticalChannelCoordinates(source, target, obstacles, offset);
  return channels.map((channelY) => [
    source.point,
    { x: source.point.x, y: channelY },
    { x: target.point.x, y: channelY },
    target.point,
  ]);
}

function localVerticalChannelCoordinates(
  source: RoutePort,
  target: RoutePort,
  obstacles: NodeRect[],
  offset: number,
): number[] {
  const lower = source.point.y + OBSTACLE_PADDING;
  const upper = target.point.y - OBSTACLE_PADDING;
  if (lower >= upper) return [];
  const left = Math.min(source.point.x, target.point.x);
  const right = Math.max(source.point.x, target.point.x);
  let gaps: Array<{ start: number; end: number }> = [{ start: lower, end: upper }];

  obstacles.forEach((obstacle) => {
    const obstacleLeft = obstacle.x - OBSTACLE_PADDING;
    const obstacleRight = obstacle.x + obstacle.width + OBSTACLE_PADDING;
    if (right < obstacleLeft || left > obstacleRight) return;
    const blockedStart = Math.max(lower, obstacle.y - OBSTACLE_PADDING);
    const blockedEnd = Math.min(upper, obstacle.y + obstacle.height + OBSTACLE_PADDING);
    if (blockedStart >= blockedEnd) return;
    gaps = gaps.flatMap((gap) => subtractVerticalInterval(gap, { start: blockedStart, end: blockedEnd }));
  });

  const preferred = channelCoordinate(source.point.y, target.point.y, offset);
  return gaps
    .map((gap) => channelCoordinate(gap.start, gap.end, offset))
    .sort((leftChannel, rightChannel) => Math.abs(leftChannel - preferred) - Math.abs(rightChannel - preferred));
}

function localObstacleRoutes(kind: RouteKind, source: RoutePort, target: RoutePort, obstacles: NodeRect[]): Point[][] {
  if (!['DOWNSTREAM', 'BRANCH', 'WRAP', 'CROSS_STAGE'].includes(kind)) return [];
  if (source.side !== 'BOTTOM' || !['TOP', 'LEFT', 'RIGHT'].includes(target.side)) return [];

  const targetApproach = extendPort(target, PORT_GAP);
  const sourceExit = extendPort(source, PORT_GAP);
  const corridorPoints = [source.point, sourceExit, targetApproach, target.point];
  const corridor = {
    left: Math.min(...corridorPoints.map((point) => point.x)) - OBSTACLE_PADDING,
    right: Math.max(...corridorPoints.map((point) => point.x)) + OBSTACLE_PADDING,
    top: Math.min(...corridorPoints.map((point) => point.y)) - OBSTACLE_PADDING,
    bottom: Math.max(...corridorPoints.map((point) => point.y)) + OBSTACLE_PADDING,
  };
  const relevantObstacles = obstacles.filter((obstacle) => {
    const right = obstacle.x + obstacle.width + OBSTACLE_PADDING;
    const bottom = obstacle.y + obstacle.height + OBSTACLE_PADDING;
    return right >= corridor.left && obstacle.x - OBSTACLE_PADDING <= corridor.right
      && bottom >= corridor.top && obstacle.y - OBSTACLE_PADDING <= corridor.bottom;
  });
  const xCoordinates = uniqueCoordinates([
    ...corridorPoints.map((point) => point.x),
    ...relevantObstacles.flatMap((obstacle) => [
      obstacle.x - OBSTACLE_PADDING - ROUTE_CLEARANCE,
      obstacle.x + obstacle.width + OBSTACLE_PADDING + ROUTE_CLEARANCE,
    ]),
  ]);
  const yCoordinates = uniqueCoordinates([
    ...corridorPoints.map((point) => point.y),
    ...relevantObstacles.flatMap((obstacle) => [
      obstacle.y - OBSTACLE_PADDING - ROUTE_CLEARANCE,
      obstacle.y + obstacle.height + OBSTACLE_PADDING + ROUTE_CLEARANCE,
    ]),
  ]);
  const vertices = new Map<string, Point>();
  xCoordinates.forEach((x) => yCoordinates.forEach((y) => {
    const point = { x, y };
    if (!pointInsideRoutingObstacle(point, relevantObstacles)) vertices.set(pointKey(point), point);
  }));
  const startKey = pointKey(source.point);
  const targetKey = pointKey(targetApproach);
  if (!vertices.has(startKey) || !vertices.has(targetKey)) return [];

  const adjacency = new Map<string, Array<{ key: string; direction: 'H' | 'V' }>>();
  vertices.forEach((point, key) => adjacency.set(key, []));
  const addVisibleNeighbours = (points: Point[]) => {
    points.sort((left, right) => left.x - right.x || left.y - right.y);
    points.slice(1).forEach((point, index) => {
      const previous = points[index]!;
      if (routeIntersects([previous, point], relevantObstacles)) return;
      const previousKey = pointKey(previous);
      const pointKeyValue = pointKey(point);
      const direction = previous.x === point.x ? 'V' : 'H';
      adjacency.get(previousKey)?.push({ key: pointKeyValue, direction });
      adjacency.get(pointKeyValue)?.push({ key: previousKey, direction });
    });
  };
  const rows = new Map<number, Point[]>();
  const columns = new Map<number, Point[]>();
  vertices.forEach((point) => {
    const row = rows.get(point.y) ?? [];
    row.push(point);
    rows.set(point.y, row);
    const column = columns.get(point.x) ?? [];
    column.push(point);
    columns.set(point.x, column);
  });
  rows.forEach(addVisibleNeighbours);
  columns.forEach(addVisibleNeighbours);

  const path = shortestVisibilityPath(startKey, targetKey, vertices, adjacency);
  return path ? [compact([...path, target.point])] : [];
}

function shortestVisibilityPath(
  startKey: string,
  targetKey: string,
  vertices: Map<string, Point>,
  adjacency: Map<string, Array<{ key: string; direction: 'H' | 'V' }>>,
): Point[] | undefined {
  type SearchState = { key: string; direction: 'H' | 'V' | null };
  const stateKey = (key: string, direction: 'H' | 'V' | null) => `${key}|${direction ?? 'START'}`;
  const startState = stateKey(startKey, null);
  const distances = new Map<string, number>([[startState, 0]]);
  const previous = new Map<string, string>();
  const queue: Array<{ state: SearchState; key: string; cost: number }> = [{ state: { key: startKey, direction: null }, key: startState, cost: 0 }];

  while (queue.length > 0) {
    queue.sort((left, right) => left.cost - right.cost || left.key.localeCompare(right.key));
    const current = queue.shift()!;
    if (current.cost !== distances.get(current.key)) continue;
    for (const next of adjacency.get(current.state.key) ?? []) {
      const nextCost = current.cost
        + manhattanDistance(vertices.get(current.state.key)!, vertices.get(next.key)!)
        + (current.state.direction && current.state.direction !== next.direction ? ROUTE_BEND_PENALTY : 0);
      const nextStateKey = stateKey(next.key, next.direction);
      if (nextCost >= (distances.get(nextStateKey) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(nextStateKey, nextCost);
      previous.set(nextStateKey, current.key);
      queue.push({ state: { key: next.key, direction: next.direction }, key: nextStateKey, cost: nextCost });
    }
  }

  const endState = [...distances.entries()]
    .filter(([key]) => key.startsWith(`${targetKey}|`))
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))[0]?.[0];
  if (!endState) return undefined;
  const keys: string[] = [];
  for (let key: string | undefined = endState; key; key = previous.get(key)) keys.push(key.split('|')[0]!);
  return keys.reverse().map((key) => vertices.get(key)!).filter(Boolean);
}

function uniqueCoordinates(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function pointKey(point: Point): string {
  return `${point.x}:${point.y}`;
}

function pointInsideRoutingObstacle(point: Point, obstacles: NodeRect[]): boolean {
  return obstacles.some((obstacle) => point.x > obstacle.x - OBSTACLE_PADDING && point.x < obstacle.x + obstacle.width + OBSTACLE_PADDING
    && point.y > obstacle.y - OBSTACLE_PADDING && point.y < obstacle.y + obstacle.height + OBSTACLE_PADDING);
}

function manhattanDistance(left: Point, right: Point): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function subtractVerticalInterval(
  gap: { start: number; end: number },
  blocked: { start: number; end: number },
): Array<{ start: number; end: number }> {
  if (blocked.end <= gap.start || blocked.start >= gap.end) return [gap];
  return [
    ...(blocked.start > gap.start ? [{ start: gap.start, end: blocked.start }] : []),
    ...(blocked.end < gap.end ? [{ start: blocked.end, end: gap.end }] : []),
  ];
}

function channelCoordinate(start: number, finish: number, offset: number): number {
  const minimum = Math.min(start, finish);
  const maximum = Math.max(start, finish);
  const midpoint = (start + finish) / 2;
  const clearance = Math.min(PORT_GAP, Math.max(1, (maximum - minimum) / 3));
  const lower = minimum + clearance;
  const upper = maximum - clearance;
  if (lower > upper) return midpoint;
  const direction = finish >= start ? 1 : -1;
  return Math.min(upper, Math.max(lower, midpoint + direction * offset));
}

function manualEndpointAnchor(edge: CanvasEdge, endpoint: 'source' | 'target'): EdgeAnchor | undefined {
  const presentation = edge.presentation;
  const anchor = endpoint === 'source' ? presentation?.sourceAnchor : presentation?.targetAnchor;
  const mode = endpoint === 'source' ? presentation?.sourceAnchorMode : presentation?.targetAnchorMode;
  if (!anchor) return undefined;
  if (presentation?.routeMode === 'manual') return anchor;
  // Anchor modes were introduced after the first published guides. Their
  // persisted anchors were always intentional, so an omitted mode remains
  // manual for backwards compatibility. New automatic routes clear anchors or
  // may explicitly persist `auto`.
  return mode === 'auto' ? undefined : anchor;
}

function isManualEndpointAnchor(edge: CanvasEdge, endpoint: 'source' | 'target'): boolean {
  const presentation = edge.presentation;
  const anchor = endpoint === 'source' ? presentation?.sourceAnchor : presentation?.targetAnchor;
  if (!anchor) return false;
  const mode = endpoint === 'source' ? presentation?.sourceAnchorMode : presentation?.targetAnchorMode;
  return presentation?.routeMode === 'manual' || mode !== 'auto';
}

function isSameLaneDownstreamContinuation(
  edge: CanvasEdge,
  sourceNode: CanvasNode | undefined,
  targetNode: CanvasNode | undefined,
  source: NodeRect,
  target: NodeRect,
): boolean {
  const hasSemanticContinuation = edge.semantic?.kind === 'FLOW'
    || Boolean(sourceNode?.outline && targetNode?.outline)
    // Historical ordinary connections predate semantic edge kinds.  Their
    // out-to-in handle pair is still an unambiguous main-flow signal, while
    // explicit yes/no handles remain branch intent.
    || (!edge.semantic?.kind && edge.sourceHandle !== 'yes' && edge.sourceHandle !== 'no');
  if (!hasSemanticContinuation) return false;
  const sameStage = Boolean(sourceNode?.stageId) && sourceNode?.stageId === targetNode?.stageId;
  const sameLane = (sourceNode?.laneId ?? null) === (targetNode?.laneId ?? null);
  return sameStage && sameLane && target.y > source.y + DEFAULT_ALIGNMENT_THRESHOLD;
}

function anchoredPort(rect: NodeRect, anchor: EdgeAnchor | undefined, fallback: RouteSide): RoutePort {
  const side = anchor?.side ?? fallback;
  const offset = Math.min(1, Math.max(0, anchor?.offset ?? 0.5));
  if (side === 'LEFT') return { side, offset, point: { x: rect.x, y: rect.y + rect.height * offset } };
  if (side === 'RIGHT') return { side, offset, point: { x: rect.x + rect.width, y: rect.y + rect.height * offset } };
  if (side === 'TOP') return { side, offset, point: { x: rect.x + rect.width * offset, y: rect.y } };
  return { side, offset, point: { x: rect.x + rect.width * offset, y: rect.y + rect.height } };
}

function samePort(portValue: RoutePort, rect: NodeRect, side: RouteSide): boolean {
  const defaultPoint = port(rect, side);
  return portValue.side === side && portValue.point.x === defaultPoint.x && portValue.point.y === defaultPoint.y;
}

function alignAutomaticForwardPorts(
  source: NodeRect,
  target: NodeRect,
  sourcePort: RoutePort,
  targetPort: RoutePort,
  adjustSource: boolean,
  adjustTarget: boolean,
): { source: RoutePort; target: RoutePort } {
  if (!portsFaceEachOther(sourcePort, targetPort) || !isHorizontalSide(sourcePort.side)) return { source: sourcePort, target: targetPort };
  const sourceCenter = sourcePort.point.y;
  const targetTop = target.y;
  const targetBottom = target.y + target.height;
  const sourceTop = source.y;
  const sourceBottom = source.y + source.height;
  if (!adjustSource && !adjustTarget) {
    if (Math.abs(sourcePort.point.y - targetPort.point.y) > FORWARD_ALIGNMENT_THRESHOLD) return { source: sourcePort, target: targetPort };
    const coordinate = (sourcePort.point.y + targetPort.point.y) / 2;
    return {
      source: horizontalPortAtY(source, sourcePort, coordinate),
      target: horizontalPortAtY(target, targetPort, coordinate),
    };
  }
  if (!adjustSource && (sourceCenter < targetTop || sourceCenter > targetBottom)) return { source: sourcePort, target: targetPort };
  if (!adjustTarget && (targetPort.point.y < sourceTop || targetPort.point.y > sourceBottom)) return { source: sourcePort, target: targetPort };
  const coordinate = !adjustSource
    ? sourceCenter
    : !adjustTarget
      ? targetPort.point.y
      : sourceCenter >= targetTop && sourceCenter <= targetBottom
        ? sourceCenter
        : targetPort.point.y >= sourceTop && targetPort.point.y <= sourceBottom
          ? targetPort.point.y
          : (Math.max(sourceTop, targetTop) + Math.min(sourceBottom, targetBottom)) / 2;
  return {
    source: adjustSource
      ? horizontalPortAtY(source, sourcePort, coordinate)
      : sourcePort,
    target: adjustTarget
      ? horizontalPortAtY(target, targetPort, coordinate)
      : targetPort,
  };
}

function horizontalPortAtY(rect: NodeRect, portValue: RoutePort, y: number): RoutePort {
  return {
    side: portValue.side,
    offset: Math.min(1, Math.max(0, (y - rect.y) / rect.height)),
    point: { x: portValue.point.x, y },
  };
}

function fanOutSharedPorts(candidates: RouteCandidate[]) {
  type Endpoint = {
    candidate: RouteCandidate;
    end: 'source' | 'target';
    node: NodeRect;
    port: RoutePort;
    pinned: boolean;
  };
  const endpoints: Endpoint[] = candidates.flatMap((candidate) => [
    { candidate, end: 'source' as const, node: candidate.source, port: candidate.sourcePort, pinned: candidate.sourceAnchorPinned },
    { candidate, end: 'target' as const, node: candidate.target, port: candidate.targetPort, pinned: candidate.targetAnchorPinned },
  ]);
  const groups = new Map<string, Endpoint[]>();
  endpoints.forEach((endpoint) => {
    const key = `${endpoint.node.id}:${endpoint.port.side}`;
    const group = groups.get(key) ?? [];
    group.push(endpoint);
    groups.set(key, group);
  });

  groups.forEach((group) => {
    const sideLength = isHorizontalSide(group[0]!.port.side) ? group[0]!.node.height : group[0]!.node.width;
    group
      .sort((left, right) => left.port.offset - right.port.offset || compareEndpointOrder(left, right))
      .reduce<Endpoint[][]>((clusters, endpoint) => {
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
      .forEach((cluster) => fanOutEndpointCluster(cluster, sideLength));
  });
}

function fanOutEndpointCluster(
  cluster: Array<{
    candidate: RouteCandidate;
    end: 'source' | 'target';
    node: NodeRect;
    port: RoutePort;
    pinned: boolean;
  }>,
  sideLength: number,
) {
  const average = cluster.reduce((total, endpoint) => total + endpoint.port.offset, 0) / cluster.length;
  const gap = Math.min(FANOUT_GAP, (sideLength - FANOUT_EDGE_INSET * 2) / Math.max(1, cluster.length - 1));
  const span = gap * (cluster.length - 1);
  const minimum = FANOUT_EDGE_INSET / sideLength;
  const firstOffset = Math.min(1 - minimum - span / sideLength, Math.max(minimum, average - span / sideLength / 2));
  const offsets = cluster.map((_, index) => firstOffset + index * gap / sideLength);
  const pinnedOffsets = cluster.filter((endpoint) => endpoint.pinned).map((endpoint) => endpoint.port.offset);
  const usedOffsets: number[] = [];

  cluster.forEach((endpoint, index) => {
    if (endpoint.pinned) return;
    const desired = offsets[index]!;
    const available = offsets
      .map((offset, offsetIndex) => ({ offset, offsetIndex }))
      .filter(({ offset }) => !pinnedOffsets.some((pinnedOffset) => Math.abs(offset - pinnedOffset) * sideLength < FANOUT_GAP * 0.75))
      .filter(({ offset }) => !usedOffsets.some((usedOffset) => Math.abs(offset - usedOffset) * sideLength < FANOUT_GAP * 0.75))
      .sort((left, right) => Math.abs(left.offset - desired) - Math.abs(right.offset - desired) || left.offsetIndex - right.offsetIndex);
    const nextOffset = available[0]?.offset ?? desired;
    usedOffsets.push(nextOffset);
    const port = anchoredPort(endpoint.node, { side: endpoint.port.side, offset: nextOffset }, endpoint.port.side);
    if (endpoint.end === 'source') {
      endpoint.candidate.sourcePort = port;
      endpoint.candidate.sourceFanned = true;
    } else {
      endpoint.candidate.targetPort = port;
      endpoint.candidate.targetFanned = true;
    }
  });

  if (pinnedOffsets.length === 0) {
    cluster.forEach((endpoint, index) => {
      const port = anchoredPort(endpoint.node, { side: endpoint.port.side, offset: offsets[index]! }, endpoint.port.side);
      if (endpoint.end === 'source') {
        endpoint.candidate.sourcePort = port;
        endpoint.candidate.sourceFanned = true;
      } else {
        endpoint.candidate.targetPort = port;
        endpoint.candidate.targetFanned = true;
      }
    });
  }
}

function compareEndpointOrder(
  left: { candidate: RouteCandidate; end: 'source' | 'target' },
  right: { candidate: RouteCandidate; end: 'source' | 'target' },
): number {
  return compareRouteOrder(left.candidate.routeOrder, right.candidate.routeOrder)
    || left.end.localeCompare(right.end)
    || left.candidate.edge.id.localeCompare(right.candidate.edge.id);
}

function anchorFromPort(port: RoutePort): EdgeAnchor {
  return { side: port.side, offset: port.offset };
}

function isHorizontalSide(side: RouteSide): boolean {
  return side === 'LEFT' || side === 'RIGHT';
}

function oppositeSide(side: RouteSide): RouteSide {
  if (side === 'LEFT') return 'RIGHT';
  if (side === 'RIGHT') return 'LEFT';
  if (side === 'TOP') return 'BOTTOM';
  return 'TOP';
}

function portsFaceEachOther(source: RoutePort, target: RoutePort): boolean {
  if (isHorizontalSide(source.side) !== isHorizontalSide(target.side)) return false;
  if (source.side === 'RIGHT' && target.side === 'LEFT') return source.point.x <= target.point.x;
  if (source.side === 'LEFT' && target.side === 'RIGHT') return source.point.x >= target.point.x;
  if (source.side === 'BOTTOM' && target.side === 'TOP') return source.point.y <= target.point.y;
  if (source.side === 'TOP' && target.side === 'BOTTOM') return source.point.y >= target.point.y;
  return false;
}

function isLocalDownstreamGap(points: Point[], kind: RouteKind, source: RoutePort, target: RoutePort): boolean {
  if (kind !== 'DOWNSTREAM' || source.side !== 'BOTTOM' || target.side !== 'TOP') return false;
  if (source.point.y > target.point.y) return false;
  return compact(points).every((point) => point.y >= source.point.y && point.y <= target.point.y);
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

function annotateRouteBridges(routesByEdgeId: Map<string, OrthogonalRoute>) {
  const bridgesByEdgeId = new Map<string, Point[]>();
  const rawRoutes = [...routesByEdgeId.values()];
  const hasHorizontalSegment = rawRoutes.some((route) => route.points.some((point, index) => index > 0 && point.y === route.points[index - 1]!.y && point.x !== route.points[index - 1]!.x));
  const hasVerticalSegment = rawRoutes.some((route) => route.points.some((point, index) => index > 0 && point.x === route.points[index - 1]!.x && point.y !== route.points[index - 1]!.y));
  if (!hasHorizontalSegment || !hasVerticalSegment) {
    rawRoutes.forEach((route) => { route.bridges = []; });
    return;
  }
  const routes = rawRoutes.map((route) => ({
    route,
    segments: routeSegments(route.points),
    bounds: routeBounds(route.points),
  })).sort((left, right) => left.bounds.left - right.bounds.left || left.route.edgeId.localeCompare(right.route.edgeId));
  const addBridge = (edgeId: string, point: Point) => {
    const bridges = bridgesByEdgeId.get(edgeId) ?? [];
    if (!bridges.some((candidate) => candidate.x === point.x && candidate.y === point.y)) bridges.push(point);
    bridgesByEdgeId.set(edgeId, bridges);
  };

  routes.forEach((left, leftIndex) => {
    for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
      const right = routes[rightIndex]!;
      if (right.bounds.left > left.bounds.right) break;
      if (right.bounds.top > left.bounds.bottom || right.bounds.bottom < left.bounds.top) continue;
      for (const leftSegment of left.segments) {
        for (const rightSegment of right.segments) {
          const crossing = crossingBetween(leftSegment, rightSegment);
          if (!crossing) continue;
          addBridge(crossing.horizontal === 'left' ? left.route.edgeId : right.route.edgeId, crossing.point);
        }
      }
    }
  });

  routes.forEach(({ route }) => {
    route.bridges = bridgesByEdgeId.get(route.edgeId) ?? [];
  });
}

interface RouteSegment {
  start: Point;
  finish: Point;
}

function routeSegments(points: Point[]): RouteSegment[] {
  return points.slice(1).flatMap((finish, index) => {
    const start = points[index]!;
    return start.x === finish.x || start.y === finish.y ? [{ start, finish }] : [];
  });
}

function routeBounds(points: Point[]): { left: number; right: number; top: number; bottom: number } {
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function crossingBetween(left: RouteSegment, right: RouteSegment): { point: Point; horizontal: 'left' | 'right' } | undefined {
  const leftHorizontal = left.start.y === left.finish.y && left.start.x !== left.finish.x;
  const rightHorizontal = right.start.y === right.finish.y && right.start.x !== right.finish.x;
  const leftVertical = left.start.x === left.finish.x && left.start.y !== left.finish.y;
  const rightVertical = right.start.x === right.finish.x && right.start.y !== right.finish.y;
  if (leftHorizontal && rightVertical) {
    const point = { x: right.start.x, y: left.start.y };
    return isInteriorCrossing(point, left, right) ? { point, horizontal: 'left' } : undefined;
  }
  if (leftVertical && rightHorizontal) {
    const point = { x: left.start.x, y: right.start.y };
    return isInteriorCrossing(point, right, left) ? { point, horizontal: 'right' } : undefined;
  }
  return undefined;
}

function isInteriorCrossing(point: Point, horizontal: RouteSegment, vertical: RouteSegment): boolean {
  const horizontalMin = Math.min(horizontal.start.x, horizontal.finish.x);
  const horizontalMax = Math.max(horizontal.start.x, horizontal.finish.x);
  const verticalMin = Math.min(vertical.start.y, vertical.finish.y);
  const verticalMax = Math.max(vertical.start.y, vertical.finish.y);
  return point.x > horizontalMin + ORTHOGONAL_BRIDGE_HALF_WIDTH
    && point.x < horizontalMax - ORTHOGONAL_BRIDGE_HALF_WIDTH
    && point.y > verticalMin + ROUTE_CLEARANCE
    && point.y < verticalMax - ROUTE_CLEARANCE;
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

function routeIntersectsEndpointNode(
  points: Point[],
  rect: NodeRect,
  source: NodeRect,
  target: NodeRect,
  sourcePort: RoutePort,
  targetPort: RoutePort,
): boolean {
  const segments = points.slice(1);
  const targetApproach = points.length >= 3 ? points.at(-2) : undefined;
  const beforeTargetApproach = points.length >= 3 ? points.at(-3) : undefined;
  const hasSafeTargetApproach = Boolean(targetApproach && beforeTargetApproach
    && pointOnNodeBoundary(targetApproach, target)
    && !pointInsideNode(beforeTargetApproach, target));
  return segments.some((finish, index) => {
    const start = points[index]!;
    if (rect.id === source.id && index === 0 && segmentLeavesPort(start, finish, sourcePort)) return false;
    if (rect.id === target.id && index === segments.length - 1 && segmentApproachesPort(start, finish, targetPort)) return false;
    if (rect.id === target.id && index === segments.length - 2 && hasSafeTargetApproach) return false;
    return segmentIntersects(start, finish, rect);
  });
}

function segmentLeavesPort(start: Point, finish: Point, port: RoutePort): boolean {
  if (port.side === 'LEFT') return finish.x <= start.x;
  if (port.side === 'RIGHT') return finish.x >= start.x;
  if (port.side === 'TOP') return finish.y <= start.y;
  return finish.y >= start.y;
}

function segmentApproachesPort(start: Point, finish: Point, port: RoutePort): boolean {
  if (port.side === 'LEFT') return start.x <= finish.x;
  if (port.side === 'RIGHT') return start.x >= finish.x;
  if (port.side === 'TOP') return start.y <= finish.y;
  return start.y >= finish.y;
}

function pointOnNodeBoundary(point: Point, rect: NodeRect): boolean {
  const onHorizontalBoundary = (point.y === rect.y || point.y === rect.y + rect.height)
    && point.x >= rect.x && point.x <= rect.x + rect.width;
  const onVerticalBoundary = (point.x === rect.x || point.x === rect.x + rect.width)
    && point.y >= rect.y && point.y <= rect.y + rect.height;
  return onHorizontalBoundary || onVerticalBoundary;
}

function pointInsideNode(point: Point, rect: NodeRect): boolean {
  return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
}

function pointInsidePaddedNode(point: Point, rect: NodeRect): boolean {
  return point.x > rect.x - OBSTACLE_PADDING
    && point.x < rect.x + rect.width + OBSTACLE_PADDING
    && point.y > rect.y - OBSTACLE_PADDING
    && point.y < rect.y + rect.height + OBSTACLE_PADDING;
}

function pointStaysOutsidePortSide(point: Point, port: RoutePort): boolean {
  if (port.side === 'LEFT') return point.x <= port.point.x;
  if (port.side === 'RIGHT') return point.x >= port.point.x;
  if (port.side === 'TOP') return point.y <= port.point.y;
  return point.y >= port.point.y;
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

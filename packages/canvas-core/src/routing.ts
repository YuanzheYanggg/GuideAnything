import type { CanvasDocument, CanvasEdge, CanvasNode, EdgeAnchor } from '@guideanything/contracts';

const CHANNEL_GAP = 18;
const PORT_GAP = 24;
const OUTER_GAP = 64;
const OBSTACLE_PADDING = 10;

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
  kind: RouteKind;
  sourceSide: RouteSide;
  targetSide: RouteSide;
  collision: boolean;
}

export interface RoutingReport {
  backEdgeIds: string[];
  avoidedEdgeIds: string[];
  collisionEdgeIds: string[];
}

export interface RoutingResult {
  routesByEdgeId: Map<string, OrthogonalRoute>;
  report: RoutingReport;
}

interface RoutePort {
  point: Point;
  side: RouteSide;
}

export function routeCanvasEdges(document: CanvasDocument): RoutingResult {
  const visibleNodes = document.nodes.filter((node) => !node.hidden);
  const rects = visibleNodes.map(nodeRect);
  const rectById = new Map(rects.map((rect) => [rect.id, rect]));
  const routable = document.edges
    .filter((edge) => !edge.hidden && !edge.sourceTrace && rectById.has(edge.source) && rectById.has(edge.target))
    .sort((left, right) => left.id.localeCompare(right.id));
  const maximumRight = Math.max(0, ...rects.map((rect) => rect.x + rect.width));
  const minimumTop = Math.min(0, ...rects.map((rect) => rect.y));
  const routesByEdgeId = new Map<string, OrthogonalRoute>();
  const avoidedEdgeIds: string[] = [];
  const collisionEdgeIds: string[] = [];
  const backEdgeIds: string[] = [];
  const offsetCountByChannel = new Map<string, number>();

  routable.forEach((edge) => {
    const source = rectById.get(edge.source)!;
    const target = rectById.get(edge.target)!;
    const kind = classify(edge, source, target, document.nodes);
    const fallbackSides = sidesFor(kind, source, target);
    const sourcePort = anchoredPort(source, edge.presentation?.sourceAnchor, fallbackSides.source);
    const targetPort = anchoredPort(target, edge.presentation?.targetAnchor, fallbackSides.target);
    const usesAnchors = Boolean(edge.presentation?.sourceAnchor || edge.presentation?.targetAnchor);
    const channelKey = offsetChannelKey(kind, edge, sourcePort.side);
    const channelIndex = channelKey ? offsetCountByChannel.get(channelKey) ?? 0 : 0;
    if (channelKey) offsetCountByChannel.set(channelKey, channelIndex + 1);
    const offset = channelIndex * CHANNEL_GAP;
    let points = usesAnchors
      ? anchoredDirectRoute(kind, sourcePort, targetPort, offset, maximumRight)
      : directRoute(kind, source, target, fallbackSides.source, fallbackSides.target, offset, maximumRight);
    const obstacles = rects.filter((rect) => rect.id !== source.id && rect.id !== target.id);
    if (routeIntersects(points, obstacles)) {
      avoidedEdgeIds.push(edge.id);
      points = usesAnchors
        ? kind === 'BACK'
          ? anchoredBackRoute(sourcePort, targetPort, offset, maximumRight)
          : anchoredOuterRoute(sourcePort, targetPort, offset, maximumRight, minimumTop)
        : kind === 'BACK'
          ? backRoute(source, target, offset, maximumRight)
          : outerRoute(source, target, fallbackSides.source, fallbackSides.target, offset, maximumRight, minimumTop);
    }
    points = compact(points);
    const collision = routeIntersects(points, obstacles);
    if (collision) collisionEdgeIds.push(edge.id);
    if (kind === 'BACK') backEdgeIds.push(edge.id);
    routesByEdgeId.set(edge.id, { edgeId: edge.id, points, kind, sourceSide: sourcePort.side, targetSide: targetPort.side, collision });
  });

  return { routesByEdgeId, report: { backEdgeIds, avoidedEdgeIds, collisionEdgeIds } };
}

function classify(edge: CanvasEdge, source: NodeRect, target: NodeRect, nodes: CanvasNode[]): RouteKind {
  const sourceNode = nodes.find((node) => node.id === edge.source);
  const targetNode = nodes.find((node) => node.id === edge.target);
  if (sourceNode?.stageId && targetNode?.stageId && sourceNode.stageId !== targetNode.stageId) return 'CROSS_STAGE';
  if (edge.sourceHandle !== 'no' && target.y > source.y + source.height + CHANNEL_GAP && target.x <= source.x) return 'WRAP';
  if (target.y < source.y || (target.x <= source.x && sourceNode?.stageId === targetNode?.stageId)) return 'BACK';
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
  if (kind === 'FORWARD') return null;
  if (kind === 'BACK') return 'BACK';
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
  if (side === 'LEFT') return { side, point: { x: rect.x, y: rect.y + rect.height * offset } };
  if (side === 'RIGHT') return { side, point: { x: rect.x + rect.width, y: rect.y + rect.height * offset } };
  if (side === 'TOP') return { side, point: { x: rect.x + rect.width * offset, y: rect.y } };
  return { side, point: { x: rect.x + rect.width * offset, y: rect.y + rect.height } };
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

function segmentIntersects(start: Point, finish: Point, rect: NodeRect): boolean {
  const left = rect.x - OBSTACLE_PADDING;
  const right = rect.x + rect.width + OBSTACLE_PADDING;
  const top = rect.y - OBSTACLE_PADDING;
  const bottom = rect.y + rect.height + OBSTACLE_PADDING;
  if (start.y === finish.y) {
    return start.y >= top && start.y <= bottom && Math.max(start.x, finish.x) >= left && Math.min(start.x, finish.x) <= right;
  }
  if (start.x === finish.x) {
    return start.x >= left && start.x <= right && Math.max(start.y, finish.y) >= top && Math.min(start.y, finish.y) <= bottom;
  }
  return true;
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

function nodeRect(node: CanvasNode): NodeRect {
  const size = node.size ?? defaultSize(node);
  return { id: node.id, x: node.position.x, y: node.position.y, width: size.width, height: size.height };
}

function defaultSize(node: CanvasNode): { width: number; height: number } {
  if (node.type === 'markdown') return { width: 300, height: 180 };
  if (node.type === 'image' || node.type === 'video') return { width: 320, height: 260 };
  if (node.type === 'subguide') return { width: 240, height: 120 };
  return { width: 240, height: 104 };
}

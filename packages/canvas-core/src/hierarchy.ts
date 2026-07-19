import type { CanvasDocument, CanvasEdge, CanvasNode, FlowLane, FlowStage } from '@guideanything/contracts';

const BASE_RANK_GAP = 72;
const NODE_GAP_Y = 32;
const STAGE_GAP_Y = 96;
const CONTENT_GAP_X = 32;
const CONTENT_GAP_Y = 24;
const STAGE_PADDING = 40;
const GRID_COLUMN_GAP = 72;
const EMPTY_GRID_CELL_WIDTH = 240;
const EMPTY_GRID_CELL_HEIGHT = 104;
const MAX_FLOW_ROW_WIDTH = 1_800;
const FLOW_ROW_GAP_Y = 96;

interface NodeSize {
  width: number;
  height: number;
}

interface PrimaryGraph {
  outgoing: Map<string, string[]>;
  incomingCount: Map<string, number>;
}

interface RankedPrimaryNodes {
  rankById: Map<string, number>;
  cycleNodeIds: string[];
  unconnectedPrimaryIds: string[];
}

interface PrimaryPlacement {
  nodes: CanvasNode[];
  byId: Map<string, CanvasNode>;
  unassignedContentX: number;
  unassignedContentY: number;
  contentPlacement: 'right' | 'below';
}

interface GridRow {
  stage: FlowStage | null;
  y: number;
  height: number;
}

interface GridColumn {
  lane: FlowLane | null;
  x: number;
  width: number;
}

interface GridGeometry {
  rows: GridRow[];
  columns: GridColumn[];
  cells: Map<string, CanvasNode[]>;
  totalWidth: number;
  totalHeight: number;
}

interface DecisionBranchPlacement {
  sourceId: string;
  priority: number | undefined;
}

interface RankedStageNode {
  node: CanvasNode;
  row: number;
}

interface WrappedRankGroup {
  x: number;
  width: number;
  nodes: RankedStageNode[];
}

interface WrappedFlowRow {
  groups: WrappedRankGroup[];
}

export interface HierarchyLayoutReport {
  primaryNodeIds: string[];
  attachedContentIds: string[];
  unassignedContentIds: string[];
  unconnectedPrimaryIds: string[];
  cycleNodeIds: string[];
  backEdgeIds: string[];
  denseStageIds: string[];
  stageCount: number;
  laneCount: number;
}

export interface StageBounds {
  stageId: string | null;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SwimlaneBounds {
  laneId: string | null;
  title: string;
  kind: FlowLane['kind'] | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HierarchyLayoutResult {
  document: CanvasDocument;
  report: HierarchyLayoutReport;
  stageBounds: StageBounds[];
}

export function isPrimaryFlowNode(node: CanvasNode): boolean {
  return ['start', 'end', 'process', 'decision', 'data', 'subguide'].includes(node.type) && !node.source;
}

export function isContentNode(node: CanvasNode): boolean {
  return ['markdown', 'image', 'video'].includes(node.type) && !node.source;
}

/**
 * Reassigning a primary node changes the row that gives the stage its visual
 * bounds. Re-run the deterministic hierarchy placement so the node (and any
 * legacy attached content) enters the new stage instead of retaining an
 * absolute position from the old stage.
 */
export function movePrimaryNodeToStage(document: CanvasDocument, nodeId: string, stageId?: string): CanvasDocument {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !isPrimaryFlowNode(node)) return document;
  if (stageId && !(document.stages ?? []).some((stage) => stage.id === stageId)) return document;

  const nodes = document.nodes.map((candidate) => {
    if (candidate.id !== nodeId) return candidate;
    if (stageId) return { ...candidate, stageId };
    const { stageId: _stageId, ...withoutStage } = candidate;
    return withoutStage;
  });
  return layoutFlowHierarchy({ ...document, nodes }).document;
}

/** Move a stage as a group while keeping attached resources aligned. */
export function translateStageNodes(document: CanvasDocument, stageId: string, delta: { x: number; y: number }): CanvasDocument {
  const primaryIds = new Set(document.nodes.filter((node) => isPrimaryFlowNode(node) && node.stageId === stageId).map((node) => node.id));
  if (delta.x === 0 && delta.y === 0) return document;
  const linkedContentIds = new Set(document.edges
    .filter((edge) => !edge.hidden && !edge.sourceTrace && primaryIds.has(edge.source))
    .map((edge) => edge.target));
  const currentBound = getStageBounds(document).find((bound) => bound.stageId === stageId);
  const stages = primaryIds.size === 0 ? document.stages?.map((stage) => {
    if (stage.id !== stageId) return stage;
    const position = stage.position ?? (currentBound ? { x: currentBound.x, y: currentBound.y } : { x: 0, y: 0 });
    return { ...stage, position: { x: position.x + delta.x, y: position.y + delta.y } };
  }) : document.stages;

  return {
    ...document,
    ...(stages ? { stages } : {}),
    nodes: document.nodes.map((node) => {
      const belongsToStage = primaryIds.has(node.id)
        || (isContentNode(node) && (
          Boolean(node.contentParentId && primaryIds.has(node.contentParentId))
          || linkedContentIds.has(node.id)
        ));
      return belongsToStage
        ? { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } }
        : node;
    }),
  };
}

export function layoutFlowHierarchy(document: CanvasDocument): HierarchyLayoutResult {
  const visible = document.nodes.filter((node) => !node.hidden);
  const primary = visible.filter(isPrimaryFlowNode).sort(compareNodes);
  const content = visible.filter(isContentNode).sort(compareNodes);
  const primaryIds = new Set(primary.map((node) => node.id));
  const connectedContent = flowThroughContent(content, document.edges);
  const connectedContentIds = new Set(connectedContent.map((node) => node.id));
  const layoutNodes = [...primary, ...connectedContent].sort(compareNodes);
  const layoutNodeIds = new Set(layoutNodes.map((node) => node.id));
  const remainingContent = content.filter((node) => !connectedContentIds.has(node.id));
  const graph = buildPrimaryGraph(document.edges, layoutNodeIds);
  const ranked = rankFromEntry(document.entryNodeId, layoutNodes, graph);
  const contentByParent = attachedContentByParent(remainingContent, primaryIds);
  const looseContent = unassignedContent(remainingContent, primaryIds);
  const stages = document.stages ?? [];
  const lanes = orderedLanes(document.lanes ?? []);
  const positioned = placePrimary(layoutNodes, ranked.rankById, stages, contentByParent, document.edges);
  const withExpandedSubguides = placeExpandedSubguideArtifacts(document.nodes, positioned);
  const withContent = placeContent(remainingContent, withExpandedSubguides, contentByParent);
  const byId = new Map(withContent.map((node) => [node.id, node]));
  const next = { ...document, nodes: document.nodes.map((node) => byId.get(node.id) ?? node) };

  return {
    document: next,
    report: reportFor(primary, content, ranked, stages, lanes, primaryIds, connectedContentIds, document.edges),
    stageBounds: getStageBounds(next),
  };
}

function flowThroughContent(content: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  const connectedIds = new Set<string>();
  edges.forEach((edge) => {
    if (edge.hidden || edge.sourceTrace) return;
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  });
  return content.filter((node) => !node.contentParentId && connectedIds.has(node.id));
}

export function getStageBounds(document: CanvasDocument): StageBounds[] {
  const stages = orderedStages(document.stages ?? []);
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]));
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const boundsByStage = new Map<string | null, { minX: number; minY: number; maxX: number; maxY: number }>();

  document.nodes.forEach((node) => {
    if (node.hidden || node.source) return;
    const stageId = stageForNode(node, nodesById, stagesById, document.edges);
    const size = nodeSize(node);
    const existing = boundsByStage.get(stageId);
    const maxX = node.position.x + size.width;
    const maxY = node.position.y + size.height;
    if (existing) {
      existing.minX = Math.min(existing.minX, node.position.x);
      existing.minY = Math.min(existing.minY, node.position.y);
      existing.maxX = Math.max(existing.maxX, maxX);
      existing.maxY = Math.max(existing.maxY, maxY);
      return;
    }
    boundsByStage.set(stageId, { minX: node.position.x, minY: node.position.y, maxX, maxY });
  });

  const configuredBounds = stages.map((stage) => {
    const bounds = boundsByStage.get(stage.id);
    return bounds ? toStageBounds(stage.id, stage.title, bounds) : null;
  });
  const configuredWidth = Math.max(EMPTY_GRID_CELL_WIDTH + STAGE_PADDING * 2, ...configuredBounds.map((bound) => bound?.width ?? 0));
  let nextY = -STAGE_PADDING;
  const result = stages.map((stage, index) => {
    const actual = configuredBounds[index];
    const bound = actual
      ? { ...actual, width: Math.max(actual.width, configuredWidth) }
      : { stageId: stage.id, title: stage.title, x: stage.position?.x ?? -STAGE_PADDING, y: stage.position?.y ?? nextY, width: configuredWidth, height: EMPTY_GRID_CELL_HEIGHT + STAGE_PADDING * 2 };
    nextY = Math.max(nextY, bound.y + bound.height + STAGE_GAP_Y - STAGE_PADDING * 2);
    return bound;
  });
  const unassigned = boundsByStage.get(null);
  if (unassigned) result.push(toStageBounds(null, '未分阶段', unassigned));
  return result;
}

export function getSwimlaneBounds(document: CanvasDocument): SwimlaneBounds[] {
  const lanes = orderedLanes(document.lanes ?? []);
  if (lanes.length === 0) return [];
  const geometry = getGridGeometryForDocument(document, lanes);
  const height = Math.max(geometry.totalHeight, EMPTY_GRID_CELL_HEIGHT);
  return geometry.columns.map((column) => ({
    laneId: column.lane?.id ?? null,
    title: column.lane?.title ?? '未分配责任',
    kind: column.lane?.kind ?? null,
    x: column.x - STAGE_PADDING,
    y: -STAGE_PADDING,
    width: column.width + STAGE_PADDING * 2,
    height: height + STAGE_PADDING * 2,
  }));
}

function getGridGeometryForDocument(document: CanvasDocument, lanes: FlowLane[]): GridGeometry {
  const visible = document.nodes.filter((node) => !node.hidden);
  const primary = visible.filter(isPrimaryFlowNode).sort(compareNodes);
  const primaryIds = new Set(primary.map((node) => node.id));
  const content = visible.filter(isContentNode).sort(compareNodes);
  return gridGeometry(primary, document.stages ?? [], lanes, attachedContentByParent(content, primaryIds), unassignedContent(content, primaryIds));
}

function gridGeometry(
  primary: CanvasNode[],
  stages: FlowStage[],
  lanes: FlowLane[],
  contentByParent: Map<string, CanvasNode[]>,
  looseContent: CanvasNode[] = [],
): GridGeometry {
  const orderedStageList = orderedStages(stages);
  const stageIds = new Set(orderedStageList.map((stage) => stage.id));
  const laneIds = new Set(lanes.map((lane) => lane.id));
  const hasUnassignedStage = looseContent.length > 0 || primary.some((node) => !node.stageId || !stageIds.has(node.stageId));
  const hasUnassignedLane = looseContent.length > 0 || primary.some((node) => !node.laneId || !laneIds.has(node.laneId));
  const rowStages: Array<FlowStage | null> = [...orderedStageList, ...(hasUnassignedStage ? [null] : [])];
  const columnLanes: Array<FlowLane | null> = [...lanes, ...(hasUnassignedLane ? [null] : [])];
  const cells = new Map<string, CanvasNode[]>();

  primary.forEach((node) => {
    const stageId = node.stageId && stageIds.has(node.stageId) ? node.stageId : null;
    const laneId = node.laneId && laneIds.has(node.laneId) ? node.laneId : null;
    const key = gridCellKey(stageId, laneId);
    const nodes = cells.get(key);
    if (nodes) nodes.push(node);
    else cells.set(key, [node]);
  });

  const rows: GridRow[] = [];
  let nextY = 0;
  rowStages.forEach((stage, index) => {
    const stageId = stage?.id ?? null;
    const height = Math.max(
      EMPTY_GRID_CELL_HEIGHT,
      ...columnLanes.map((lane) => gridCellHeight(
        cells.get(gridCellKey(stageId, lane?.id ?? null)) ?? [],
        contentByParent,
        stageId === null && lane === null ? looseContent : [],
      )),
    );
    rows.push({ stage, y: nextY, height });
    nextY += height + (index < rowStages.length - 1 ? STAGE_GAP_Y : 0);
  });

  const columns: GridColumn[] = [];
  let nextX = 0;
  columnLanes.forEach((lane, index) => {
    const laneId = lane?.id ?? null;
    const width = Math.max(
      EMPTY_GRID_CELL_WIDTH,
      ...rowStages.map((stage) => gridCellWidth(
        cells.get(gridCellKey(stage?.id ?? null, laneId)) ?? [],
        contentByParent,
        stage === null && laneId === null ? looseContent : [],
      )),
    );
    columns.push({ lane, x: nextX, width });
    nextX += width + (index < columnLanes.length - 1 ? GRID_COLUMN_GAP : 0);
  });

  return {
    rows,
    columns,
    cells,
    totalWidth: columns.length > 0 ? nextX : 0,
    totalHeight: rows.length > 0 ? nextY : 0,
  };
}

function gridCellKey(stageId: string | null, laneId: string | null): string {
  return JSON.stringify([stageId, laneId]);
}

function gridCellWidth(nodes: CanvasNode[], contentByParent: Map<string, CanvasNode[]>, looseContent: CanvasNode[] = []): number {
  const primaryWidth = nodes.reduce((width, node) => {
    const attachedWidth = (contentByParent.get(node.id) ?? []).reduce((current, content) => Math.max(current, nodeSize(content).width), 0);
    return Math.max(width, nodeSize(node).width, attachedWidth);
  }, 0);
  return looseContent.reduce((width, node) => Math.max(width, nodeSize(node).width), primaryWidth);
}

function gridCellHeight(nodes: CanvasNode[], contentByParent: Map<string, CanvasNode[]>, looseContent: CanvasNode[] = []): number {
  const primaryHeight = nodes.reduce((height, node, index) => height + gridOccupiedHeight(node, contentByParent) + (index > 0 ? NODE_GAP_Y : 0), 0);
  const looseHeight = looseContent.reduce((height, node, index) => height + nodeSize(node).height + (index > 0 ? CONTENT_GAP_Y : 0), 0);
  return primaryHeight + (primaryHeight > 0 && looseHeight > 0 ? NODE_GAP_Y : 0) + looseHeight;
}

function compareNodes(left: CanvasNode, right: CanvasNode): number {
  return left.position.y - right.position.y
    || left.position.x - right.position.x
    || left.id.localeCompare(right.id);
}

function nodeSize(node: CanvasNode): NodeSize {
  if (node.size) return node.size;
  if (node.type === 'markdown') return { width: 300, height: 180 };
  if (node.type === 'image' || node.type === 'video') return { width: 320, height: 260 };
  if (node.type === 'subguide') return { width: 240, height: 120 };
  return { width: 240, height: 104 };
}

function buildPrimaryGraph(edges: CanvasEdge[], primaryIds: Set<string>): PrimaryGraph {
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  primaryIds.forEach((id) => {
    outgoing.set(id, []);
    incomingCount.set(id, 0);
  });
  edges.forEach((edge) => {
    if (edge.hidden || edge.sourceTrace || !primaryIds.has(edge.source) || !primaryIds.has(edge.target)) return;
    outgoing.get(edge.source)!.push(edge.target);
    incomingCount.set(edge.target, incomingCount.get(edge.target)! + 1);
  });
  return { outgoing, incomingCount };
}

function rankFromEntry(entryNodeId: string | undefined, primary: CanvasNode[], graph: PrimaryGraph): RankedPrimaryNodes {
  const primaryIds = new Set(primary.map((node) => node.id));
  let roots = entryNodeId && primaryIds.has(entryNodeId)
    ? [entryNodeId]
    : primary.filter((node) => graph.incomingCount.get(node.id) === 0).map((node) => node.id);
  if (roots.length === 0 && primary.length > 0) roots = [primary[0]!.id];
  const acyclicOutgoing = withoutDepthFirstBackEdges(primary, roots, graph.outgoing);
  const reachable = reachableFrom(roots, acyclicOutgoing);
  const inDegree = new Map<string, number>();
  reachable.forEach((id) => inDegree.set(id, 0));
  reachable.forEach((id) => {
    acyclicOutgoing.get(id)!.forEach((target) => {
      if (reachable.has(target)) inDegree.set(target, inDegree.get(target)! + 1);
    });
  });

  const rankById = new Map<string, number>();
  const rootIds = new Set(roots);
  const queued = new Set<string>();
  const dequeued = new Set<string>();
  const queue: string[] = [];
  roots.forEach((id) => {
    if (!queued.has(id)) {
      queued.add(id);
      queue.push(id);
      rankById.set(id, 0);
    }
  });
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!;
    dequeued.add(id);
    const rank = rankById.get(id)!;
    acyclicOutgoing.get(id)!.forEach((target) => {
      if (!reachable.has(target)) return;
      if (!rootIds.has(target) && !dequeued.has(target)) {
        rankById.set(target, Math.max(rankById.get(target) ?? 0, rank + 1));
      }
      const remaining = inDegree.get(target)! - 1;
      inDegree.set(target, remaining);
      if (remaining === 0 && !queued.has(target)) {
        queued.add(target);
        queue.push(target);
      }
    });
  }

  let nextRank = Math.max(-1, ...rankById.values()) + 1;
  primary.forEach((node) => {
    if (!rankById.has(node.id)) {
      rankById.set(node.id, nextRank);
      nextRank += 1;
    }
  });

  const cycleIds = findCycleNodeIds(primary, graph.outgoing);
  return {
    rankById,
    cycleNodeIds: primary.filter((node) => cycleIds.has(node.id)).map((node) => node.id),
    unconnectedPrimaryIds: primary.filter((node) => !reachable.has(node.id)).map((node) => node.id),
  };
}

function withoutDepthFirstBackEdges(
  primary: CanvasNode[],
  roots: string[],
  outgoing: Map<string, string[]>,
): Map<string, string[]> {
  const result = new Map(primary.map((node) => [node.id, [] as string[]]));
  const state = new Map<string, 'visiting' | 'finished'>();
  const traversalOrder = [...roots, ...primary.map((node) => node.id).filter((id) => !roots.includes(id))];

  traversalOrder.forEach((root) => {
    if (state.has(root)) return;
    state.set(root, 'visiting');
    const stack: Array<{ id: string; nextIndex: number }> = [{ id: root, nextIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const targets = outgoing.get(frame.id)!;
      if (frame.nextIndex >= targets.length) {
        state.set(frame.id, 'finished');
        stack.pop();
        continue;
      }
      const target = targets[frame.nextIndex]!;
      frame.nextIndex += 1;
      if (state.get(target) === 'visiting') continue;
      result.get(frame.id)!.push(target);
      if (!state.has(target)) {
        state.set(target, 'visiting');
        stack.push({ id: target, nextIndex: 0 });
      }
    }
  });

  return result;
}

function reachableFrom(roots: string[], outgoing: Map<string, string[]>): Set<string> {
  const reachable = new Set<string>(roots);
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    outgoing.get(queue[index]!)!.forEach((target) => {
      if (!reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    });
  }
  return reachable;
}

function findCycleNodeIds(primary: CanvasNode[], outgoing: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const finished: string[] = [];
  primary.forEach((node) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const stack: Array<{ id: string; nextIndex: number }> = [{ id: node.id, nextIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const targets = outgoing.get(frame.id)!;
      if (frame.nextIndex < targets.length) {
        const target = targets[frame.nextIndex]!;
        frame.nextIndex += 1;
        if (!visited.has(target)) {
          visited.add(target);
          stack.push({ id: target, nextIndex: 0 });
        }
        continue;
      }
      finished.push(frame.id);
      stack.pop();
    }
  });

  const incoming = new Map<string, string[]>();
  primary.forEach((node) => incoming.set(node.id, []));
  outgoing.forEach((targets, source) => targets.forEach((target) => incoming.get(target)!.push(source)));
  const cycleIds = new Set<string>();
  const assigned = new Set<string>();
  for (let index = finished.length - 1; index >= 0; index -= 1) {
    const root = finished[index]!;
    if (assigned.has(root)) continue;
    const component: string[] = [];
    const stack = [root];
    assigned.add(root);
    while (stack.length > 0) {
      const id = stack.pop()!;
      component.push(id);
      incoming.get(id)!.forEach((source) => {
        if (!assigned.has(source)) {
          assigned.add(source);
          stack.push(source);
        }
      });
    }
    if (component.length > 1 || outgoing.get(root)!.includes(root)) component.forEach((id) => cycleIds.add(id));
  }
  return cycleIds;
}

function attachedContentByParent(content: CanvasNode[], primaryIds: Set<string>): Map<string, CanvasNode[]> {
  const result = new Map<string, CanvasNode[]>();
  content.forEach((node) => {
    if (!node.contentParentId || !primaryIds.has(node.contentParentId)) return;
    const attachments = result.get(node.contentParentId);
    if (attachments) attachments.push(node);
    else result.set(node.contentParentId, [node]);
  });
  return result;
}

function unassignedContent(content: CanvasNode[], primaryIds: Set<string>): CanvasNode[] {
  return content.filter((node) => !node.contentParentId || !primaryIds.has(node.contentParentId));
}

function calculateRankX(primary: CanvasNode[], content: CanvasNode[], rankById: Map<string, number>, primaryIds: Set<string>): Map<number, number> {
  const widthByRank = new Map<number, { primary: number; content: number }>();
  primary.forEach((node) => {
    const rank = rankById.get(node.id)!;
    const current = widthByRank.get(rank) ?? { primary: 0, content: 0 };
    current.primary = Math.max(current.primary, nodeSize(node).width);
    widthByRank.set(rank, current);
  });
  content.forEach((node) => {
    if (!node.contentParentId || !primaryIds.has(node.contentParentId)) return;
    const rank = rankById.get(node.contentParentId)!;
    const current = widthByRank.get(rank)!;
    current.content = Math.max(current.content, nodeSize(node).width);
  });

  const rankX = new Map<number, number>();
  let x = 0;
  [...widthByRank.keys()].sort((left, right) => left - right).forEach((rank) => {
    const width = widthByRank.get(rank)!;
    rankX.set(rank, x);
    x += width.primary + (width.content > 0 ? CONTENT_GAP_X + width.content : 0) + BASE_RANK_GAP;
  });
  return rankX;
}

function placePrimary(primary: CanvasNode[], rankById: Map<string, number>, stages: FlowStage[], contentByParent: Map<string, CanvasNode[]>, edges: CanvasEdge[]): PrimaryPlacement {
  const ordered = orderedStages(stages);
  const stageIds = new Set(ordered.map((stage) => stage.id));
  const stageNodes = new Map<string | null, CanvasNode[]>();
  primary.forEach((node) => {
    const stageId = node.stageId && stageIds.has(node.stageId) ? node.stageId : null;
    const nodes = stageNodes.get(stageId) ?? [];
    nodes.push(node);
    stageNodes.set(stageId, nodes);
  });

  const nodes: CanvasNode[] = [];
  const byId = new Map<string, CanvasNode>();
  const branchesByTarget = decisionBranchPlacements(primary, edges);
  const branchRows = branchRowsByNode(primary, edges, branchesByTarget);
  let stageY = 0;
  let unassignedContentY = 0;
  [...ordered.map((stage) => stage.id), null].forEach((stageId) => {
    const inStage = stageNodes.get(stageId) ?? [];
    let stageHeight = 0;
    if (inStage.length > 0) {
      const ranks = inStage.map((node) => rankById.get(node.id)!);
      const minimumRank = Math.min(...ranks);
      const localRankById = new Map(inStage.map((node) => [node.id, rankById.get(node.id)! - minimumRank]));
      const flowRows = wrapStageRanks(inStage, localRankById, branchesByTarget, branchRows);
      let flowRowY = stageY;
      flowRows.forEach((flowRow) => {
        const heightByNodeRow = new Map<number, number>();
        flowRow.groups.forEach((group) => group.nodes.forEach(({ node, row }) => {
          heightByNodeRow.set(row, Math.max(heightByNodeRow.get(row) ?? 0, gridOccupiedHeight(node, contentByParent)));
        }));
        const maximumNodeRow = Math.max(0, ...heightByNodeRow.keys());
        const yByNodeRow = new Map<number, number>();
        let flowRowHeight = 0;
        for (let row = 0; row <= maximumNodeRow; row += 1) {
          yByNodeRow.set(row, flowRowHeight);
          const rowHeight = heightByNodeRow.get(row) ?? 0;
          if (rowHeight > 0) flowRowHeight += rowHeight + NODE_GAP_Y;
        }
        flowRowHeight = Math.max(EMPTY_GRID_CELL_HEIGHT, flowRowHeight > 0 ? flowRowHeight - NODE_GAP_Y : 0);
        flowRow.groups.forEach((group) => group.nodes.forEach(({ node, row }) => {
          const positioned = { ...node, position: { x: group.x, y: flowRowY + (yByNodeRow.get(row) ?? 0) } };
          nodes.push(positioned);
          byId.set(node.id, positioned);
        }));
        stageHeight = flowRowY - stageY + flowRowHeight;
        flowRowY += flowRowHeight + FLOW_ROW_GAP_Y;
      });
    }
    if (stageId !== null && stageHeight === 0) stageHeight = EMPTY_GRID_CELL_HEIGHT;
    if (stageId === null) unassignedContentY = stageY + (stageHeight > 0 ? stageHeight + STAGE_GAP_Y : 0);
    if (stageHeight > 0) stageY += stageHeight + STAGE_GAP_Y;
  });
  return { nodes, byId, unassignedContentX: 0, unassignedContentY, contentPlacement: 'below' };
}

function wrapStageRanks(
  nodes: CanvasNode[],
  rankById: Map<string, number>,
  branchesByTarget: Map<string, DecisionBranchPlacement>,
  branchRows: Map<string, number>,
): WrappedFlowRow[] {
  const byRank = new Map<number, CanvasNode[]>();
  nodes.forEach((node) => {
    const rank = rankById.get(node.id)!;
    const ranked = byRank.get(rank) ?? [];
    ranked.push(node);
    byRank.set(rank, ranked);
  });

  const groups = [...byRank.keys()].sort((left, right) => left - right).map((rank) => {
    const usedRows = new Set<number>();
    const rankedNodes = orderRankNodes(byRank.get(rank)!, branchesByTarget).map((node) => {
      let row = branchRows.get(node.id) ?? 0;
      while (usedRows.has(row)) row += 1;
      usedRows.add(row);
      return { node, row };
    });
    return {
      x: 0,
      width: Math.max(...rankedNodes.map(({ node }) => nodeSize(node).width)),
      nodes: rankedNodes,
    };
  });

  const rows: WrappedFlowRow[] = [];
  let current: WrappedFlowRow = { groups: [] };
  let nextX = 0;
  groups.forEach((group) => {
    if (current.groups.length > 0 && nextX + group.width > MAX_FLOW_ROW_WIDTH) {
      rows.push(current);
      current = { groups: [] };
      nextX = 0;
    }
    current.groups.push({ ...group, x: nextX });
    nextX += group.width + BASE_RANK_GAP;
  });
  if (current.groups.length > 0) rows.push(current);
  return rows;
}

function localRankX(nodes: CanvasNode[], rankById: Map<string, number>): Map<number, number> {
  const widthByRank = new Map<number, number>();
  nodes.forEach((node) => {
    const rank = rankById.get(node.id)!;
    widthByRank.set(rank, Math.max(widthByRank.get(rank) ?? 0, nodeSize(node).width));
  });
  const result = new Map<number, number>();
  let x = 0;
  [...widthByRank.keys()].sort((left, right) => left - right).forEach((rank) => {
    result.set(rank, x);
    x += widthByRank.get(rank)! + BASE_RANK_GAP;
  });
  return result;
}

function branchRowsByNode(
  primary: CanvasNode[],
  edges: CanvasEdge[],
  branchesByTarget: Map<string, DecisionBranchPlacement>,
): Map<string, number> {
  const primaryIds = new Set(primary.map((node) => node.id));
  const outgoing = new Map(primary.map((node) => [node.id, [] as string[]]));
  const incoming = new Map(primary.map((node) => [node.id, 0]));
  edges.forEach((edge) => {
    if (edge.hidden || edge.sourceTrace || !primaryIds.has(edge.source) || !primaryIds.has(edge.target)) return;
    outgoing.get(edge.source)!.push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  });
  const result = new Map<string, number>();
  [...branchesByTarget.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([targetId, branch]) => {
      const row = branch.priority ?? 0;
      const queue = [targetId];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id) || (id !== targetId && incoming.get(id)! > 1)) continue;
        seen.add(id);
        result.set(id, Math.max(result.get(id) ?? 0, row));
        outgoing.get(id)?.forEach((next) => queue.push(next));
      }
    });
  return result;
}

function placePrimaryInGrid(
  primary: CanvasNode[],
  rankById: Map<string, number>,
  stages: FlowStage[],
  lanes: FlowLane[],
  contentByParent: Map<string, CanvasNode[]>,
  looseContent: CanvasNode[],
  edges: CanvasEdge[],
): PrimaryPlacement {
  const geometry = gridGeometry(primary, stages, lanes, contentByParent, looseContent);
  const branchesByTarget = decisionBranchPlacements(primary, edges);
  const nodes: CanvasNode[] = [];
  const byId = new Map<string, CanvasNode>();

  geometry.rows.forEach((row) => {
    geometry.columns.forEach((column) => {
      const cell = geometry.cells.get(gridCellKey(row.stage?.id ?? null, column.lane?.id ?? null)) ?? [];
      let y = row.y;
      orderGridCell(cell, rankById, branchesByTarget).forEach((node) => {
        const positioned = { ...node, position: { x: column.x, y } };
        nodes.push(positioned);
        byId.set(node.id, positioned);
        y += gridOccupiedHeight(node, contentByParent) + NODE_GAP_Y;
      });
    });
  });

  const unassignedRow = geometry.rows.find((row) => row.stage === null);
  const unassignedColumn = geometry.columns.find((column) => column.lane === null);
  return {
    nodes,
    byId,
    unassignedContentX: unassignedColumn?.x ?? 0,
    unassignedContentY: unassignedRow?.y ?? geometry.totalHeight + (geometry.rows.length > 0 ? STAGE_GAP_Y : 0),
    contentPlacement: 'below',
  };
}

function orderGridCell(
  nodes: CanvasNode[],
  rankById: Map<string, number>,
  branchesByTarget: Map<string, DecisionBranchPlacement>,
): CanvasNode[] {
  const byRank = new Map<number, CanvasNode[]>();
  nodes.forEach((node) => {
    const rank = rankById.get(node.id) ?? Number.MAX_SAFE_INTEGER;
    const ranked = byRank.get(rank);
    if (ranked) ranked.push(node);
    else byRank.set(rank, [node]);
  });
  return [...byRank.keys()]
    .sort((left, right) => left - right)
    .flatMap((rank) => orderRankNodes([...byRank.get(rank)!].sort(compareNodes), branchesByTarget));
}

function decisionBranchPlacements(primary: CanvasNode[], edges: CanvasEdge[]): Map<string, DecisionBranchPlacement> {
  const primaryById = new Map(primary.map((node) => [node.id, node]));
  const branchByTarget = new Map<string, DecisionBranchPlacement>();
  edges.forEach((edge) => {
    if (edge.hidden || edge.sourceTrace) return;
    const source = primaryById.get(edge.source);
    if (!source || source.type !== 'decision' || !primaryById.has(edge.target)) return;
    const priority = decisionBranchPriority(source, edge);
    const existing = branchByTarget.get(edge.target);
    const existingSource = existing ? primaryById.get(existing.sourceId) : undefined;
    const existingPriority = existing?.priority ?? Number.MAX_SAFE_INTEGER;
    const sourceOrder = existingSource ? compareNodes(source, existingSource) : -1;
    if (!existingSource || sourceOrder < 0 || (sourceOrder === 0 && (priority ?? Number.MAX_SAFE_INTEGER) < existingPriority)) {
      branchByTarget.set(edge.target, { sourceId: source.id, priority });
    }
  });
  return branchByTarget;
}

function orderRankNodes(nodes: CanvasNode[], branchesByTarget: Map<string, DecisionBranchPlacement>): CanvasNode[] {
  const groups = new Map<string, { firstIndex: number; sourceId: string | null; nodes: CanvasNode[] }>();
  nodes.forEach((node, index) => {
    const branch = branchesByTarget.get(node.id);
    const key = branch ? `decision:${branch.sourceId}` : `node:${node.id}`;
    const group = groups.get(key);
    if (group) group.nodes.push(node);
    else groups.set(key, { firstIndex: index, sourceId: branch?.sourceId ?? null, nodes: [node] });
  });

  return [...groups.values()]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .flatMap((group) => {
      if (!group.sourceId) return group.nodes;
      return [...group.nodes].sort((left, right) => {
        const leftPriority = branchesByTarget.get(left.id)?.priority ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = branchesByTarget.get(right.id)?.priority ?? Number.MAX_SAFE_INTEGER;
        return leftPriority - rightPriority || compareNodes(left, right);
      });
    });
}

function decisionBranchPriority(node: CanvasNode<'decision'>, edge: CanvasEdge): number | undefined {
  const values = [edge.label, edge.sourceHandle].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const labelIndex = (node.data.branchLabels ?? []).findIndex((label) => values.some((value) => sameBranchLabel(value, label)));
  if (labelIndex >= 0) return labelIndex;
  return values.map(yesNoBranch).find((value): value is number => value !== undefined);
}

function sameBranchLabel(value: string, label: string): boolean {
  return normalizeBranchLabel(value) === normalizeBranchLabel(label);
}

function normalizeBranchLabel(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === '是' || normalized === 'yes') return 'yes';
  if (normalized === '否' || normalized === 'no') return 'no';
  return normalized;
}

function yesNoBranch(value: string): number | undefined {
  const normalized = normalizeBranchLabel(value);
  if (normalized === 'yes') return 0;
  if (normalized === 'no') return 1;
  return undefined;
}

function occupiedHeight(node: CanvasNode, contentByParent: Map<string, CanvasNode[]>): number {
  const attached = contentByParent.get(node.id);
  if (!attached || attached.length === 0) return nodeSize(node).height;
  const contentHeight = attached.reduce((total, item, index) => total + nodeSize(item).height + (index > 0 ? CONTENT_GAP_Y : 0), 0);
  return Math.max(nodeSize(node).height, contentHeight);
}

function gridOccupiedHeight(node: CanvasNode, contentByParent: Map<string, CanvasNode[]>): number {
  const attached = contentByParent.get(node.id);
  if (!attached || attached.length === 0) return nodeSize(node).height;
  const contentHeight = attached.reduce((total, item, index) => total + nodeSize(item).height + (index > 0 ? CONTENT_GAP_Y : 0), 0);
  return nodeSize(node).height + CONTENT_GAP_Y + contentHeight;
}

function placeContent(content: CanvasNode[], positioned: PrimaryPlacement, contentByParent: Map<string, CanvasNode[]>): CanvasNode[] {
  const nodes = [...positioned.nodes];
  const nextYByParent = new Map<string, number>();
  let unassignedY = positioned.unassignedContentY;
  content.forEach((node) => {
    const parent = node.contentParentId ? positioned.byId.get(node.contentParentId) : undefined;
    if (!parent || !contentByParent.has(parent.id)) {
      nodes.push({ ...node, position: { x: positioned.unassignedContentX, y: unassignedY } });
      unassignedY += nodeSize(node).height + CONTENT_GAP_Y;
      return;
    }
    const y = nextYByParent.get(parent.id) ?? parent.position.y;
    const below = positioned.contentPlacement === 'below';
    const contentY = below && !nextYByParent.has(parent.id)
      ? parent.position.y + nodeSize(parent).height + CONTENT_GAP_Y
      : y;
    nodes.push({
      ...node,
      position: {
        x: below ? parent.position.x : parent.position.x + nodeSize(parent).width + CONTENT_GAP_X,
        y: contentY,
      },
    });
    nextYByParent.set(parent.id, contentY + nodeSize(node).height + CONTENT_GAP_Y);
  });
  return nodes;
}

function placeExpandedSubguideArtifacts(allNodes: CanvasNode[], positioned: PrimaryPlacement): PrimaryPlacement {
  const references = positioned.nodes
    .filter((node): node is CanvasNode<'subguide'> => node.type === 'subguide' && Boolean(node.data.expanded))
    .sort(compareNodes);
  if (references.length === 0) return positioned;

  const nodes = [...positioned.nodes];
  const byId = new Map(positioned.byId);
  let nextY = positioned.unassignedContentY;
  references.forEach((reference) => {
    const derived = allNodes.filter((node) => !node.hidden && node.source?.referenceNodeId === reference.id);
    if (derived.length === 0) return;
    const minimumX = Math.min(...derived.map((node) => node.position.x));
    const minimumY = Math.min(...derived.map((node) => node.position.y));
    const maximumY = Math.max(...derived.map((node) => node.position.y + nodeSize(node).height));
    const offsetX = positioned.unassignedContentX - minimumX;
    const offsetY = nextY - minimumY;
    derived.forEach((node) => {
      const moved = {
        ...node,
        position: {
          x: node.position.x + offsetX,
          y: node.position.y + offsetY,
        },
      };
      nodes.push(moved);
      byId.set(moved.id, moved);
    });
    nextY += maximumY - minimumY + STAGE_GAP_Y;
  });

  return { ...positioned, nodes, byId, unassignedContentY: nextY };
}

function reportFor(
  primary: CanvasNode[],
  content: CanvasNode[],
  ranked: RankedPrimaryNodes,
  stages: FlowStage[],
  lanes: FlowLane[],
  primaryIds: Set<string>,
  connectedContentIds: Set<string>,
  edges: CanvasEdge[],
): HierarchyLayoutReport {
  const attached = content.filter((node) => node.contentParentId && primaryIds.has(node.contentParentId));
  return {
    primaryNodeIds: primary.map((node) => node.id),
    attachedContentIds: attached.map((node) => node.id),
    unassignedContentIds: content.filter((node) => !connectedContentIds.has(node.id) && (!node.contentParentId || !primaryIds.has(node.contentParentId))).map((node) => node.id),
    unconnectedPrimaryIds: ranked.unconnectedPrimaryIds.filter((id) => primaryIds.has(id)),
    cycleNodeIds: ranked.cycleNodeIds.filter((id) => primaryIds.has(id)),
    backEdgeIds: edges
      .filter((edge) => !edge.hidden && !edge.sourceTrace && primaryIds.has(edge.source) && primaryIds.has(edge.target))
      .filter((edge) => (ranked.rankById.get(edge.target) ?? 0) <= (ranked.rankById.get(edge.source) ?? 0))
      .map((edge) => edge.id)
      .sort(),
    denseStageIds: [],
    stageCount: stages.length,
    laneCount: lanes.length,
  };
}

function orderedStages(stages: FlowStage[]): FlowStage[] {
  return [...stages].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function orderedLanes(lanes: FlowLane[]): FlowLane[] {
  return [...lanes].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function stageForNode(
  node: CanvasNode,
  nodesById: Map<string, CanvasNode>,
  stagesById: Map<string, FlowStage>,
  edges: CanvasEdge[] = [],
): string | null {
  const parent = isContentNode(node) && node.contentParentId ? nodesById.get(node.contentParentId) : undefined;
  const linkedParent = !parent && isContentNode(node)
    ? edges
      .filter((edge) => !edge.hidden && !edge.sourceTrace && edge.target === node.id)
      .map((edge) => nodesById.get(edge.source))
      .find((candidate) => candidate && isPrimaryFlowNode(candidate))
    : undefined;
  const candidateParent = parent && isPrimaryFlowNode(parent) ? parent : linkedParent;
  const candidate = candidateParent ? candidateParent.stageId : node.stageId;
  return candidate && stagesById.has(candidate) ? candidate : null;
}

function toStageBounds(
  stageId: string | null,
  title: string,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): StageBounds {
  return {
    stageId,
    title,
    x: bounds.minX - STAGE_PADDING,
    y: bounds.minY - STAGE_PADDING,
    width: bounds.maxX - bounds.minX + STAGE_PADDING * 2,
    height: bounds.maxY - bounds.minY + STAGE_PADDING * 2,
  };
}

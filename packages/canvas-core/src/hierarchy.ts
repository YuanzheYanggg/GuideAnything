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

export interface HierarchyLayoutReport {
  primaryNodeIds: string[];
  attachedContentIds: string[];
  unassignedContentIds: string[];
  unconnectedPrimaryIds: string[];
  cycleNodeIds: string[];
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
  laneId: string;
  title: string;
  kind: FlowLane['kind'];
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

export function layoutFlowHierarchy(document: CanvasDocument): HierarchyLayoutResult {
  const visible = document.nodes.filter((node) => !node.hidden);
  const primary = visible.filter(isPrimaryFlowNode).sort(compareNodes);
  const content = visible.filter(isContentNode).sort(compareNodes);
  const primaryIds = new Set(primary.map((node) => node.id));
  const graph = buildPrimaryGraph(document.edges, primaryIds);
  const ranked = rankFromEntry(document.entryNodeId, primary, graph);
  const contentByParent = attachedContentByParent(content, primaryIds);
  const stages = document.stages ?? [];
  const lanes = orderedLanes(document.lanes ?? []);
  const positioned = lanes.length > 0
    ? placePrimaryInGrid(primary, ranked.rankById, stages, lanes, contentByParent, document.edges)
    : placePrimary(primary, ranked.rankById, calculateRankX(primary, content, ranked.rankById, primaryIds), stages, contentByParent, document.edges);
  const withContent = placeContent(content, positioned, contentByParent);
  const byId = new Map(withContent.map((node) => [node.id, node]));
  const next = { ...document, nodes: document.nodes.map((node) => byId.get(node.id) ?? node) };

  return {
    document: next,
    report: reportFor(primary, content, ranked, stages, lanes, primaryIds),
    stageBounds: getStageBounds(next),
  };
}

export function getStageBounds(document: CanvasDocument): StageBounds[] {
  const lanes = orderedLanes(document.lanes ?? []);
  if (lanes.length > 0) {
    const geometry = getGridGeometryForDocument(document, lanes);
    return geometry.rows.map((row) => ({
      stageId: row.stage?.id ?? null,
      title: row.stage?.title ?? '未分阶段',
      x: -STAGE_PADDING,
      y: row.y - STAGE_PADDING,
      width: geometry.totalWidth + STAGE_PADDING * 2,
      height: row.height + STAGE_PADDING * 2,
    }));
  }

  const stages = orderedStages(document.stages ?? []);
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]));
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const boundsByStage = new Map<string | null, { minX: number; minY: number; maxX: number; maxY: number }>();

  document.nodes.forEach((node) => {
    if (node.hidden || node.source) return;
    const stageId = stageForNode(node, nodesById, stagesById);
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

  const result = stages.flatMap((stage) => {
    const bounds = boundsByStage.get(stage.id);
    return bounds ? [toStageBounds(stage.id, stage.title, bounds)] : [];
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
  return geometry.columns.flatMap((column) => column.lane ? [{
    laneId: column.lane.id,
    title: column.lane.title,
    kind: column.lane.kind,
    x: column.x - STAGE_PADDING,
    y: -STAGE_PADDING,
    width: column.width + STAGE_PADDING * 2,
    height: height + STAGE_PADDING * 2,
  }] : []);
}

function getGridGeometryForDocument(document: CanvasDocument, lanes: FlowLane[]): GridGeometry {
  const visible = document.nodes.filter((node) => !node.hidden);
  const primary = visible.filter(isPrimaryFlowNode).sort(compareNodes);
  const primaryIds = new Set(primary.map((node) => node.id));
  const content = visible.filter(isContentNode).sort(compareNodes);
  return gridGeometry(primary, document.stages ?? [], lanes, attachedContentByParent(content, primaryIds));
}

function gridGeometry(
  primary: CanvasNode[],
  stages: FlowStage[],
  lanes: FlowLane[],
  contentByParent: Map<string, CanvasNode[]>,
): GridGeometry {
  const orderedStageList = orderedStages(stages);
  const stageIds = new Set(orderedStageList.map((stage) => stage.id));
  const laneIds = new Set(lanes.map((lane) => lane.id));
  const hasUnassignedStage = primary.some((node) => !node.stageId || !stageIds.has(node.stageId));
  const hasUnassignedLane = primary.some((node) => !node.laneId || !laneIds.has(node.laneId));
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
      ...columnLanes.map((lane) => gridCellHeight(cells.get(gridCellKey(stageId, lane?.id ?? null)) ?? [], contentByParent)),
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
      ...rowStages.map((stage) => gridCellWidth(cells.get(gridCellKey(stage?.id ?? null, laneId)) ?? [], contentByParent)),
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

function gridCellWidth(nodes: CanvasNode[], contentByParent: Map<string, CanvasNode[]>): number {
  return nodes.reduce((width, node) => {
    const attachedWidth = (contentByParent.get(node.id) ?? []).reduce((current, content) => Math.max(current, nodeSize(content).width), 0);
    return Math.max(width, nodeSize(node).width, attachedWidth);
  }, 0);
}

function gridCellHeight(nodes: CanvasNode[], contentByParent: Map<string, CanvasNode[]>): number {
  return nodes.reduce((height, node, index) => height + gridOccupiedHeight(node, contentByParent) + (index > 0 ? NODE_GAP_Y : 0), 0);
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
  const roots = entryNodeId && primaryIds.has(entryNodeId)
    ? [entryNodeId]
    : primary.filter((node) => graph.incomingCount.get(node.id) === 0).map((node) => node.id);
  const reachable = reachableFrom(roots, graph.outgoing);
  const inDegree = new Map<string, number>();
  reachable.forEach((id) => inDegree.set(id, 0));
  reachable.forEach((id) => {
    graph.outgoing.get(id)!.forEach((target) => {
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
    graph.outgoing.get(id)!.forEach((target) => {
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

function placePrimary(
  primary: CanvasNode[],
  rankById: Map<string, number>,
  rankX: Map<number, number>,
  stages: FlowStage[],
  contentByParent: Map<string, CanvasNode[]>,
  edges: CanvasEdge[],
): PrimaryPlacement {
  const ordered = orderedStages(stages);
  const stageIds = new Set(ordered.map((stage) => stage.id));
  const laneNodes = new Map<string | null, Map<number, CanvasNode[]>>();
  primary.forEach((node) => {
    const stageId = node.stageId && stageIds.has(node.stageId) ? node.stageId : null;
    const byRank = laneNodes.get(stageId) ?? new Map<number, CanvasNode[]>();
    const rank = rankById.get(node.id)!;
    const nodes = byRank.get(rank) ?? [];
    nodes.push(node);
    byRank.set(rank, nodes);
    laneNodes.set(stageId, byRank);
  });

  const nodes: CanvasNode[] = [];
  const byId = new Map<string, CanvasNode>();
  const branchesByTarget = decisionBranchPlacements(primary, edges);
  let laneY = 0;
  let unassignedContentY = 0;
  [...ordered.map((stage) => stage.id), null].forEach((stageId) => {
    const byRank = laneNodes.get(stageId);
    let laneHeight = 0;
    if (byRank) {
      [...byRank.keys()].sort((left, right) => left - right).forEach((rank) => {
        let y = laneY;
        orderRankNodes(byRank.get(rank)!, branchesByTarget).forEach((node) => {
          const positioned = { ...node, position: { x: rankX.get(rank)!, y } };
          nodes.push(positioned);
          byId.set(node.id, positioned);
          y += occupiedHeight(node, contentByParent) + NODE_GAP_Y;
        });
        laneHeight = Math.max(laneHeight, y - laneY - NODE_GAP_Y);
      });
    }
    if (stageId === null) unassignedContentY = laneY + (laneHeight > 0 ? laneHeight + STAGE_GAP_Y : 0);
    if (laneHeight > 0) laneY += laneHeight + STAGE_GAP_Y;
  });
  return { nodes, byId, unassignedContentY, contentPlacement: 'right' };
}

function placePrimaryInGrid(
  primary: CanvasNode[],
  rankById: Map<string, number>,
  stages: FlowStage[],
  lanes: FlowLane[],
  contentByParent: Map<string, CanvasNode[]>,
  edges: CanvasEdge[],
): PrimaryPlacement {
  const geometry = gridGeometry(primary, stages, lanes, contentByParent);
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

  return {
    nodes,
    byId,
    unassignedContentY: geometry.totalHeight + (geometry.rows.length > 0 ? STAGE_GAP_Y : 0),
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
      nodes.push({ ...node, position: { x: 0, y: unassignedY } });
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

function reportFor(
  primary: CanvasNode[],
  content: CanvasNode[],
  ranked: RankedPrimaryNodes,
  stages: FlowStage[],
  lanes: FlowLane[],
  primaryIds: Set<string>,
): HierarchyLayoutReport {
  const attached = content.filter((node) => node.contentParentId && primaryIds.has(node.contentParentId));
  return {
    primaryNodeIds: primary.map((node) => node.id),
    attachedContentIds: attached.map((node) => node.id),
    unassignedContentIds: content.filter((node) => !node.contentParentId || !primaryIds.has(node.contentParentId)).map((node) => node.id),
    unconnectedPrimaryIds: ranked.unconnectedPrimaryIds,
    cycleNodeIds: ranked.cycleNodeIds,
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

function stageForNode(node: CanvasNode, nodesById: Map<string, CanvasNode>, stagesById: Map<string, FlowStage>): string | null {
  const parent = isContentNode(node) && node.contentParentId ? nodesById.get(node.contentParentId) : undefined;
  const candidate = parent && isPrimaryFlowNode(parent) ? parent.stageId : node.stageId;
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

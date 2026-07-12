import type { CanvasDocument, CanvasEdge, CanvasNode, FlowStage } from '@guideanything/contracts';

const BASE_RANK_GAP = 72;
const NODE_GAP_Y = 32;
const STAGE_GAP_Y = 96;
const CONTENT_GAP_X = 32;
const CONTENT_GAP_Y = 24;
const STAGE_PADDING = 40;

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
}

export interface HierarchyLayoutReport {
  primaryNodeIds: string[];
  attachedContentIds: string[];
  unassignedContentIds: string[];
  unconnectedPrimaryIds: string[];
  cycleNodeIds: string[];
  stageCount: number;
}

export interface StageBounds {
  stageId: string | null;
  title: string;
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
  const rankX = calculateRankX(primary, content, ranked.rankById, primaryIds);
  const positioned = placePrimary(primary, ranked.rankById, rankX, document.stages ?? [], contentByParent, document.edges);
  const withContent = placeContent(content, positioned, contentByParent);
  const byId = new Map(withContent.map((node) => [node.id, node]));
  const next = { ...document, nodes: document.nodes.map((node) => byId.get(node.id) ?? node) };

  return {
    document: next,
    report: reportFor(primary, content, ranked, document.stages ?? [], primaryIds),
    stageBounds: getStageBounds(next),
  };
}

export function getStageBounds(document: CanvasDocument): StageBounds[] {
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
  const compareSiblings = decisionSiblingComparator(primary, edges);
  let laneY = 0;
  let unassignedContentY = 0;
  [...ordered.map((stage) => stage.id), null].forEach((stageId) => {
    const byRank = laneNodes.get(stageId);
    let laneHeight = 0;
    if (byRank) {
      [...byRank.keys()].sort((left, right) => left - right).forEach((rank) => {
        let y = laneY;
        byRank.get(rank)!.sort(compareSiblings).forEach((node) => {
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
  return { nodes, byId, unassignedContentY };
}

function decisionSiblingComparator(primary: CanvasNode[], edges: CanvasEdge[]): (left: CanvasNode, right: CanvasNode) => number {
  const primaryById = new Map(primary.map((node) => [node.id, node]));
  const branchByTarget = new Map<string, { sourceId: string; priority: number }>();
  edges.forEach((edge) => {
    if (edge.hidden || edge.sourceTrace) return;
    const source = primaryById.get(edge.source);
    if (!source || source.type !== 'decision' || !primaryById.has(edge.target)) return;
    const priority = decisionBranchPriority(source, edge);
    if (priority === undefined) return;
    const existing = branchByTarget.get(edge.target);
    if (!existing || priority < existing.priority) branchByTarget.set(edge.target, { sourceId: source.id, priority });
  });

  return (left, right) => {
    const leftBranch = branchByTarget.get(left.id);
    const rightBranch = branchByTarget.get(right.id);
    if (leftBranch && rightBranch && leftBranch.sourceId === rightBranch.sourceId && leftBranch.priority !== rightBranch.priority) {
      return leftBranch.priority - rightBranch.priority;
    }
    return compareNodes(left, right);
  };
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
    nodes.push({
      ...node,
      position: { x: parent.position.x + nodeSize(parent).width + CONTENT_GAP_X, y },
    });
    nextYByParent.set(parent.id, y + nodeSize(node).height + CONTENT_GAP_Y);
  });
  return nodes;
}

function reportFor(
  primary: CanvasNode[],
  content: CanvasNode[],
  ranked: RankedPrimaryNodes,
  stages: FlowStage[],
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
  };
}

function orderedStages(stages: FlowStage[]): FlowStage[] {
  return [...stages].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
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

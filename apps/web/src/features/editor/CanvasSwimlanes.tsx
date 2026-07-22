import type { CanvasDocument, CanvasNode, FlowLane } from '@guideanything/contracts';
import { defaultCanvasNodeSize, getStageBounds, getSwimlaneBounds as getGridSwimlaneBounds, isPrimaryFlowNode, type StageBounds, type SwimlaneBounds } from '@guideanything/canvas-core';

const SWIMLANE_PADDING_X = 40;
const SWIMLANE_PADDING_Y = 40;

type PositionBounds = { minX: number; minY: number; maxX: number; maxY: number };

function orderedLanes(document: CanvasDocument): FlowLane[] {
  return [...(document.lanes ?? [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function nodeSize(node: CanvasNode): { width: number; height: number } {
  return node.size ?? defaultCanvasNodeSize(node);
}

function addNodeToBounds(bounds: PositionBounds | undefined, node: CanvasNode): PositionBounds {
  const size = nodeSize(node);
  const maxX = node.position.x + size.width;
  const maxY = node.position.y + size.height;
  if (!bounds) return { minX: node.position.x, minY: node.position.y, maxX, maxY };
  return {
    minX: Math.min(bounds.minX, node.position.x),
    minY: Math.min(bounds.minY, node.position.y),
    maxX: Math.max(bounds.maxX, maxX),
    maxY: Math.max(bounds.maxY, maxY),
  };
}

function toSwimlaneBounds(lane: FlowLane | null, bounds: PositionBounds): SwimlaneBounds {
  return {
    laneId: lane?.id ?? null,
    title: lane?.title ?? '未分配责任',
    kind: lane?.kind ?? null,
    x: bounds.minX - SWIMLANE_PADDING_X,
    y: bounds.minY - SWIMLANE_PADDING_Y,
    width: bounds.maxX - bounds.minX + SWIMLANE_PADDING_X * 2,
    height: bounds.maxY - bounds.minY + SWIMLANE_PADDING_Y * 2,
  };
}

/**
 * Editor-only bounds: keep the stage-like behavior tied to current node
 * positions instead of the learner map's fixed grid columns.
 */
export function getCanvasSwimlaneBounds(document: CanvasDocument, stageBounds: StageBounds[] = getStageBounds(document)): SwimlaneBounds[] {
  const lanes = orderedLanes(document);
  if (lanes.length === 0) return [];
  const laneIds = new Set(lanes.map((lane) => lane.id));
  const boundsByLaneId = new Map<string | null, PositionBounds>();

  document.nodes.forEach((node) => {
    if (node.hidden || !isPrimaryFlowNode(node)) return;
    const laneId = node.laneId && laneIds.has(node.laneId) ? node.laneId : null;
    boundsByLaneId.set(laneId, addNodeToBounds(boundsByLaneId.get(laneId), node));
  });

  const gridFallbacks = getGridSwimlaneBounds(document);
  const configured = lanes.map((lane) => {
    const actual = boundsByLaneId.get(lane.id);
    if (actual) return toSwimlaneBounds(lane, actual);
    return gridFallbacks.find((bound) => bound.laneId === lane.id) ?? {
      laneId: lane.id,
      title: lane.title,
      kind: lane.kind,
      x: 0,
      y: -SWIMLANE_PADDING_Y,
      width: 240 + SWIMLANE_PADDING_X * 2,
      height: 104 + SWIMLANE_PADDING_Y * 2,
    };
  });
  const unassigned = boundsByLaneId.get(null);
  const bounds = unassigned ? [...configured, toSwimlaneBounds(null, unassigned)] : configured;
  const top = stageBounds.length > 0
    ? Math.min(...stageBounds.map((bound) => bound.y))
    : Math.min(...bounds.map((bound) => bound.y));
  const bottom = stageBounds.length > 0
    ? Math.max(...stageBounds.map((bound) => bound.y + bound.height))
    : Math.max(...bounds.map((bound) => bound.y + bound.height));
  return bounds.map((bound) => ({ ...bound, y: top, height: Math.max(0, bottom - top) }));
}

function laneKindLabel(kind: SwimlaneBounds['kind']): string {
  return kind === 'ROLE' ? '责任' : kind === 'SYSTEM' ? '系统' : '未分配';
}

function laneModifier(kind: SwimlaneBounds['kind']): string {
  return kind === 'ROLE' ? 'canvas-swimlane--role' : kind === 'SYSTEM' ? 'canvas-swimlane--system' : 'canvas-swimlane--unassigned';
}

export function CanvasSwimlanes({ bounds }: { bounds: SwimlaneBounds[] }) {
  const headingWidthByIndex = new Map<number, number>();
  bounds
    .map((bound, index) => ({ bound, index }))
    .sort((left, right) => left.bound.x - right.bound.x || left.index - right.index)
    .forEach(({ bound, index }, sortedIndex, sortedBounds) => {
      const next = sortedBounds[sortedIndex + 1]?.bound;
      const available = next ? next.x - bound.x - 12 : bound.width - 16;
      headingWidthByIndex.set(index, Math.max(0, Math.min(bound.width - 16, available)));
    });

  return <>{bounds.map((bound, index) => {
    const laneKey = bound.laneId ?? 'unassigned';
    return <div
      key={laneKey}
      className={`canvas-swimlane ${laneModifier(bound.kind)}`}
      data-testid="canvas-swimlane"
      data-lane-id={bound.laneId ?? 'unassigned'}
      data-lane-kind={bound.kind ?? 'UNASSIGNED'}
      aria-hidden="true"
      style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height }}
    >
      <div className="canvas-swimlane-heading" style={{ width: headingWidthByIndex.get(index) ?? Math.max(0, bound.width - 16) }}>
        <span>{bound.title}</span>
        <em>{laneKindLabel(bound.kind)}</em>
      </div>
    </div>;
  })}</>;
}

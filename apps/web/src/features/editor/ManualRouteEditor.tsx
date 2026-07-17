import {
  editableRouteSegments,
  type Point,
  type RouteSegmentOrientation,
} from "@guideanything/canvas-core";
import { useEffect, useMemo, useState } from "react";

type ManualRouteEditorProps = {
  points: Point[];
  conflict: boolean;
  onMoveSegment: (segmentIndex: number, coordinate: number) => void;
  screenToFlowPosition: (point: { x: number; y: number }) => Point;
};

export function ManualRouteEditor({
  points,
  conflict,
  onMoveSegment,
  screenToFlowPosition,
}: ManualRouteEditorProps) {
  const segments = useMemo(() => {
    const editableSegments = editableRouteSegments(points);
    if (editableSegments.length > 0 || points.length !== 2) return editableSegments;

    const [start, end] = points;
    if (start && end && start.y === end.y && start.x !== end.x) {
      return [{ index: 0, orientation: "horizontal" as const, start, end, midpoint: { x: (start.x + end.x) / 2, y: start.y } }];
    }
    if (start && end && start.x === end.x && start.y !== end.y) {
      return [{ index: 0, orientation: "vertical" as const, start, end, midpoint: { x: start.x, y: (start.y + end.y) / 2 } }];
    }
    return editableSegments;
  }, [points]);
  const [draggingSegment, setDraggingSegment] = useState<{ index: number; orientation: RouteSegmentOrientation } | null>(null);

  useEffect(() => {
    if (draggingSegment === null) {
      return;
    }

    const segment = segments.find((candidate) => candidate.index === draggingSegment.index);
    if (!segment) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const flowPoint = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const rawCoordinate = segment.orientation === "horizontal" ? flowPoint.y : flowPoint.x;
      if (!Number.isFinite(rawCoordinate)) {
        return;
      }

      onMoveSegment(segment.index, Math.round(rawCoordinate / 20) * 20);
      if (draggingSegment.index === 0 && points.length === 2) {
        setDraggingSegment({ index: 2, orientation: draggingSegment.orientation });
      }
    };
    const handlePointerUp = () => setDraggingSegment(null);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggingSegment, onMoveSegment, points.length, screenToFlowPosition, segments]);

  return (
    <div className="manual-route-editor" aria-label="编辑连线走向">
      {conflict ? (
        <div className="manual-route-editor__status" role="status">
          手动路线被节点阻挡
        </div>
      ) : null}
      {segments.map((segment, displayIndex) => (
        <button
          key={`${segment.index}-${segment.orientation}`}
          type="button"
          className={`manual-route-segment is-${segment.orientation} nodrag nopan nowheel`}
          aria-label={`拖动连线段 ${displayIndex + 1}`}
          style={{ left: segment.midpoint.x, top: segment.midpoint.y }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDraggingSegment({ index: segment.index, orientation: segment.orientation });
          }}
        />
      ))}
    </div>
  );
}

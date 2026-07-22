import {
  editableRouteSegments,
  snapRouteCoordinate,
  type Point,
  type RouteSegmentOrientation,
} from "@guideanything/canvas-core";
import { useEffect, useMemo, useRef, useState } from "react";

import { BorderGlow } from '../../components/reactbits/BorderGlow';

type ManualRouteEditorProps = {
  points: Point[];
  conflict: boolean;
  conflictMessage?: string;
  onMoveSegment: (segmentIndex: number, coordinate: number) => void;
  onFinishSegment?: (segmentIndex: number, coordinate: number) => void;
  screenToFlowPosition: (point: { x: number; y: number }) => Point;
  flowToScreenPosition?: (point: Point) => Point;
};

export function ManualRouteEditor({
  points,
  conflict,
  conflictMessage,
  onMoveSegment,
  onFinishSegment,
  screenToFlowPosition,
  flowToScreenPosition,
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
  const latestMoveRef = useRef<{ segmentIndex: number; coordinate: number } | null>(null);

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

      const coordinate = snapRouteCoordinate(points, segment.orientation, rawCoordinate);
      latestMoveRef.current = { segmentIndex: segment.index, coordinate };
      onMoveSegment(segment.index, coordinate);
      if (draggingSegment.index === 0 && points.length === 2) {
        setDraggingSegment({ index: 2, orientation: draggingSegment.orientation });
      }
    };
    const handlePointerUp = () => {
      const latestMove = latestMoveRef.current;
      if (latestMove) onFinishSegment?.(latestMove.segmentIndex, latestMove.coordinate);
      latestMoveRef.current = null;
      setDraggingSegment(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingSegment, onFinishSegment, onMoveSegment, points, screenToFlowPosition, segments]);

  return (
    <div className="manual-route-editor" aria-label="编辑连线走向">
      {conflict ? (
        <BorderGlow className="manual-route-editor__status-shell" active tone="warning">
          <div className="manual-route-editor__status" role="status">{conflictMessage ?? '手动路线被节点阻挡'}</div>
        </BorderGlow>
      ) : null}
      {segments.map((segment, displayIndex) => {
        const position = flowToScreenPosition?.(segment.midpoint) ?? segment.midpoint;
        return <button
          key={`${segment.index}-${segment.orientation}`}
          type="button"
          className={`manual-route-node is-${segment.orientation} nodrag nopan nowheel`}
          aria-label={`拖动连线节点 ${displayIndex + 1}`}
          style={{ left: position.x, top: position.y }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            latestMoveRef.current = null;
            setDraggingSegment({ index: segment.index, orientation: segment.orientation });
          }}
        />;
      })}
    </div>
  );
}

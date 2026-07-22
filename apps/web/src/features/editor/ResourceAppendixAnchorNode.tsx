import { Handle, Position, type Node } from '@xyflow/react';

export type ResourceAppendixAnchorSide = 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT';

const handleBySide = {
  TOP: { id: 'appendix-in-top', position: Position.Top },
  RIGHT: { id: 'appendix-in-right', position: Position.Right },
  BOTTOM: { id: 'appendix-in-bottom', position: Position.Bottom },
  LEFT: { id: 'appendix-in-left', position: Position.Left },
} as const;

export function resourceAppendixTargetHandleId(side: ResourceAppendixAnchorSide): string {
  return handleBySide[side].id;
}

export function resourceAppendixAnchorHandles(width: number, height: number): NonNullable<Node['handles']> {
  const handleSize = 1;
  return (Object.keys(handleBySide) as ResourceAppendixAnchorSide[]).map((side) => {
    const handle = handleBySide[side];
    const x = side === 'LEFT' ? 0 : side === 'RIGHT' ? width - handleSize : (width - handleSize) / 2;
    const y = side === 'TOP' ? 0 : side === 'BOTTOM' ? height - handleSize : (height - handleSize) / 2;
    return {
      id: handle.id,
      type: 'target' as const,
      position: handle.position,
      x,
      y,
      width: handleSize,
      height: handleSize,
    };
  });
}

export function ResourceAppendixAnchorNode() {
  return <div className="resource-appendix-anchor-node" aria-hidden="true">
    {(Object.keys(handleBySide) as ResourceAppendixAnchorSide[]).map((side) => {
      const handle = handleBySide[side];
      return <Handle key={handle.id} type="target" id={handle.id} position={handle.position} />;
    })}
  </div>;
}

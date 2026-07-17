import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ManualRouteEditor } from './ManualRouteEditor';

const points = [
  { x: 0, y: 0 },
  { x: 24, y: 0 },
  { x: 24, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 120 },
];

describe('ManualRouteEditor', () => {
  it('renders only interior draggable route segments', () => {
    render(<ManualRouteEditor points={points} conflict={false} onMoveSegment={vi.fn()} screenToFlowPosition={({ x, y }) => ({ x, y })} />);

    expect(screen.getByRole('button', { name: '拖动连线段 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: '拖动连线段 2' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '拖动连线端点 0' })).not.toBeInTheDocument();
  });

  it('moves a horizontal segment on its perpendicular axis and snaps to the canvas grid', () => {
    const onMoveSegment = vi.fn();
    render(<ManualRouteEditor points={points} conflict={false} onMoveSegment={onMoveSegment} screenToFlowPosition={({ x, y }) => ({ x, y })} />);
    const handle = screen.getByRole('button', { name: '拖动连线段 2' });

    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 173 });
    fireEvent.pointerUp(window);

    expect(onMoveSegment).toHaveBeenLastCalledWith(2, 180);
  });

  it('keeps a shortest direct route until the user drags its virtual segment', () => {
    const onMoveSegment = vi.fn();
    render(<ManualRouteEditor points={[{ x: 240, y: 52 }, { x: 360, y: 52 }]} conflict={false} onMoveSegment={onMoveSegment} screenToFlowPosition={({ x, y }) => ({ x, y })} />);
    const handle = screen.getByRole('button', { name: '拖动连线段 1' });

    fireEvent.pointerDown(handle, { clientX: 300, clientY: 52 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 132 });
    fireEvent.pointerUp(window);

    expect(onMoveSegment).toHaveBeenLastCalledWith(0, 140);
  });

  it('shows a conflict status while the draft route is blocked', () => {
    render(<ManualRouteEditor points={points} conflict onMoveSegment={vi.fn()} screenToFlowPosition={({ x, y }) => ({ x, y })} />);

    expect(screen.getByRole('status')).toHaveTextContent('手动路线被节点阻挡');
  });
});

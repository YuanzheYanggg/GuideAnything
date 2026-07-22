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
  it('renders draggable nodes on interior route segments', () => {
    render(<ManualRouteEditor points={points} conflict={false} onMoveSegment={vi.fn()} screenToFlowPosition={({ x, y }) => ({ x, y })} />);

    expect(screen.getByRole('button', { name: '拖动连线节点 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: '拖动连线节点 2' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '拖动连线段 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拖动连线端点 0' })).not.toBeInTheDocument();
  });

  it('places route nodes in screen coordinates when rendered above the canvas', () => {
    render(
      <ManualRouteEditor
        points={points}
        conflict={false}
        onMoveSegment={vi.fn()}
        screenToFlowPosition={({ x, y }) => ({ x, y })}
        flowToScreenPosition={({ x, y }) => ({ x: x + 120, y: y + 40 })}
      />,
    );

    const node = screen.getByRole('button', { name: '拖动连线节点 1' });
    expect(node.style.left).toBe('144px');
    expect(node.style.top).toBe('90px');
  });

  it('moves a horizontal segment on its perpendicular axis and snaps to the canvas grid', () => {
    const onMoveSegment = vi.fn();
    const onFinishSegment = vi.fn();
    render(<ManualRouteEditor points={points} conflict={false} onMoveSegment={onMoveSegment} onFinishSegment={onFinishSegment} screenToFlowPosition={({ x, y }) => ({ x, y })} />);
    const handle = screen.getByRole('button', { name: '拖动连线节点 2' });

    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 173 });
    fireEvent.pointerUp(window);

    expect(onMoveSegment).toHaveBeenLastCalledWith(2, 180);
    expect(onFinishSegment).toHaveBeenCalledWith(2, 180);
  });

  it('keeps a shortest direct route until the user drags its virtual segment', () => {
    const onMoveSegment = vi.fn();
    render(<ManualRouteEditor points={[{ x: 240, y: 52 }, { x: 360, y: 52 }]} conflict={false} onMoveSegment={onMoveSegment} screenToFlowPosition={({ x, y }) => ({ x, y })} />);
    const handle = screen.getByRole('button', { name: '拖动连线节点 1' });

    fireEvent.pointerDown(handle, { clientX: 300, clientY: 52 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 132 });
    fireEvent.pointerUp(window);

    expect(onMoveSegment).toHaveBeenLastCalledWith(0, 140);
  });

  it('shows a conflict status while the draft route is blocked', () => {
    render(<ManualRouteEditor points={points} conflict onMoveSegment={vi.fn()} screenToFlowPosition={({ x, y }) => ({ x, y })} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('手动路线被节点阻挡');
    expect(status.parentElement).toHaveClass('border-glow');
  });
});

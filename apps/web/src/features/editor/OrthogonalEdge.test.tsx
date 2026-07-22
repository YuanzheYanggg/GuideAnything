import { fireEvent, render } from '@testing-library/react';
import type { EdgeProps } from '@xyflow/react';
import { Position } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { baseEdge } = vi.hoisted(() => ({ baseEdge: vi.fn() }));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    ...actual,
    BaseEdge: (props: Record<string, unknown>) => {
      baseEdge(props);
      return <path data-testid="base-edge" />;
    },
    EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

import { OrthogonalEdge, labelOffsetAtPoint, labelPointAtOffset, orthogonalPath, syncEdgeUpdaterCoordinates } from './OrthogonalEdge';

describe('OrthogonalEdge', () => {
  beforeEach(() => baseEdge.mockReset());

  it('places a label by distance along the complete route', () => {
    expect(labelPointAtOffset([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 0.75)).toEqual({ x: 100, y: 50 });
  });

  it('converts a dragged point back to a stable route offset', () => {
    expect(labelOffsetAtPoint([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { x: 100, y: 50 })).toBeCloseTo(0.75);
  });

  it('draws an upward bridge when a horizontal route crosses another edge', () => {
    expect(orthogonalPath([{ x: 0, y: 100 }, { x: 200, y: 100 }], 12, [{ x: 100, y: 100 }])).toContain('Q 100 88 108 100');
  });

  it('keeps React Flow reconnect circles on the custom route endpoints', () => {
    const { container } = render(<svg><g className="react-flow__edge" data-id="edge-1"><circle className="react-flow__edgeupdater-source" cx="0" cy="0" /><circle className="react-flow__edgeupdater-target" cx="0" cy="0" /></g></svg>);

    syncEdgeUpdaterCoordinates('edge-1', [{ x: 24, y: 36 }, { x: 180, y: 36 }], container);

    expect(container.querySelector('.react-flow__edgeupdater-source')).toHaveAttribute('cx', '24');
    expect(container.querySelector('.react-flow__edgeupdater-source')).toHaveAttribute('cy', '36');
    expect(container.querySelector('.react-flow__edgeupdater-target')).toHaveAttribute('cx', '180');
    expect(container.querySelector('.react-flow__edgeupdater-target')).toHaveAttribute('cy', '36');
  });

  it('forwards both markers and the constrained SVG style to BaseEdge', () => {
    const props = {
      id: 'edge-1',
      source: 'source',
      target: 'target',
      type: 'orthogonal',
      data: {},
      selected: false,
      selectable: true,
      deletable: true,
      animated: false,
      sourceX: 0,
      sourceY: 0,
      targetX: 160,
      targetY: 80,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      markerStart: 'url(#arrow-start)',
      markerEnd: 'url(#arrow-end)',
      style: { stroke: 'var(--ga-edge-red)', strokeWidth: 4, strokeDasharray: '1 5' },
    } as EdgeProps;

    render(<svg><OrthogonalEdge {...props} /></svg>);

    expect(baseEdge.mock.calls[0]?.[0]).toMatchObject({
      id: 'edge-1',
      markerStart: 'url(#arrow-start)',
      markerEnd: 'url(#arrow-end)',
      style: { stroke: 'var(--ga-edge-red)', strokeWidth: 4, strokeDasharray: '1 5' },
    });
  });

  it('uses small passive endpoint dots until the edge enters reconnect mode', () => {
    const props = {
      id: 'edge-1',
      source: 'source',
      target: 'target',
      type: 'orthogonal',
      data: { route: { points: [{ x: 24, y: 36 }, { x: 180, y: 36 }] }, endpointMode: 'idle' },
      selected: false,
      selectable: true,
      deletable: true,
      animated: false,
      sourceX: 24,
      sourceY: 36,
      targetX: 180,
      targetY: 36,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {},
    } as EdgeProps;

    const { container, rerender } = render(<svg><OrthogonalEdge {...props} /></svg>);
    expect(container.querySelector('.orthogonal-edge-endpoint.is-source')).toHaveAttribute('r', '3.5');
    expect(container.querySelector('.orthogonal-edge-endpoint.is-target')).toHaveAttribute('r', '3.5');

    rerender(<svg><OrthogonalEdge {...props} data={{ ...props.data, endpointMode: 'active' }} /></svg>);
    expect(container.querySelector('.orthogonal-edge-endpoint.is-source')).toHaveAttribute('r', '8');
    expect(container.querySelector('.orthogonal-edge-endpoint.is-target')).toHaveAttribute('r', '8');
  });

  it('renders a persisted label font size and commits a dragged label offset', () => {
    vi.useFakeTimers();
    const onLabelOffsetChange = vi.fn();
    const onLabelDoubleClick = vi.fn();
    const props = {
      id: 'edge-1',
      source: 'source',
      target: 'target',
      type: 'orthogonal',
      data: {
        route: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] },
        labelOffset: 0.5,
        labelFontSize: 18,
        onLabelOffsetChange,
        onLabelDoubleClick,
        screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      },
      selected: false,
      selectable: true,
      deletable: true,
      animated: false,
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 100,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      label: '审核',
      style: {},
    } as EdgeProps;

    render(<svg><OrthogonalEdge {...props} /></svg>);
    const label = document.querySelector('.orthogonal-edge-label') as HTMLElement;
    expect(label).toHaveStyle({ fontSize: '18px' });
    fireEvent.pointerDown(label, { clientX: 50, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 50, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 50, pointerId: 1, button: 0 });
    vi.advanceTimersByTime(250);
    expect(onLabelOffsetChange).toHaveBeenCalledWith(expect.closeTo(0.75, 5));
    fireEvent.doubleClick(label, { clientX: 100, clientY: 50 });
    expect(onLabelDoubleClick).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

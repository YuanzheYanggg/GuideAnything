import { render } from '@testing-library/react';
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

import { OrthogonalEdge, syncEdgeUpdaterCoordinates } from './OrthogonalEdge';

describe('OrthogonalEdge', () => {
  beforeEach(() => baseEdge.mockReset());

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
});

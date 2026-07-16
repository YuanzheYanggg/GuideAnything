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

import { OrthogonalEdge } from './OrthogonalEdge';

describe('OrthogonalEdge', () => {
  beforeEach(() => baseEdge.mockReset());

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

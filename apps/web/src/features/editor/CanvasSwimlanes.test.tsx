import { getStageBounds, type SwimlaneBounds } from '@guideanything/canvas-core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '@guideanything/contracts';

import { CanvasSwimlanes, getCanvasSwimlaneBounds } from './CanvasSwimlanes';

const bounds: SwimlaneBounds[] = [
  { laneId: 'sales', title: '业务', kind: 'ROLE', x: 0, y: -40, width: 320, height: 720 },
  { laneId: null, title: '未分配责任', kind: null, x: 392, y: -40, width: 320, height: 720 },
];

const dragDocument: CanvasDocument = {
  schemaVersion: 1,
  lanes: [
    { id: 'sales', title: '业务', kind: 'ROLE', order: 0 },
    { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
  ],
  nodes: [
    { id: 'sales-a', type: 'process', laneId: 'sales', position: { x: 0, y: 0 }, zIndex: 0, size: { width: 240, height: 104 }, data: { label: '销售节点 A', shape: 'process' } },
    { id: 'sales-b', type: 'process', laneId: 'sales', position: { x: 320, y: 0 }, zIndex: 1, size: { width: 240, height: 104 }, data: { label: '销售节点 B', shape: 'process' } },
    { id: 'erp-a', type: 'process', laneId: 'erp', position: { x: 640, y: 0 }, zIndex: 2, size: { width: 240, height: 104 }, data: { label: '系统节点', shape: 'process' } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  exitNodeIds: [],
};

describe('CanvasSwimlanes', () => {
  it('renders configured and unassigned lane bounds as decorative columns', () => {
    const { container } = render(<CanvasSwimlanes bounds={bounds} />);
    const salesLane = container.querySelector('[data-lane-id="sales"]');
    const unassignedLane = container.querySelector('[data-lane-id="unassigned"]');

    expect(screen.getAllByTestId('canvas-swimlane')).toHaveLength(2);
    expect(salesLane).toHaveAttribute('aria-hidden', 'true');
    expect(salesLane).toHaveAttribute('data-lane-kind', 'ROLE');
    expect(salesLane).toHaveTextContent('业务');
    expect(unassignedLane).toHaveTextContent('未分配责任');
  });

  it('renders no markup when there are no lanes', () => {
    const { container } = render(<CanvasSwimlanes bounds={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('recomputes lane bounds from live node positions like stage bounds', () => {
    const before = getCanvasSwimlaneBounds(dragDocument).find((lane) => lane.laneId === 'sales');
    const moved = getCanvasSwimlaneBounds({
      ...dragDocument,
      nodes: dragDocument.nodes.map((node) => node.id === 'sales-b' ? { ...node, position: { x: 700, y: 0 } } : node),
    }).find((lane) => lane.laneId === 'sales');

    expect(before).toBeDefined();
    expect(moved).toBeDefined();
    expect(moved!.x).toBe(before!.x);
    expect(moved!.width).toBeGreaterThan(before!.width);
  });

  it('uses the full visible stage span for every swimlane height', () => {
    const document: CanvasDocument = {
      ...dragDocument,
      stages: [
        { id: 'intake', title: '受理', order: 0 },
        { id: 'review', title: '复核', order: 1 },
      ],
      nodes: [
        { ...dragDocument.nodes[0]!, id: 'intake-node', stageId: 'intake', laneId: 'sales', position: { x: 0, y: 0 } },
        { ...dragDocument.nodes[1]!, id: 'review-node', stageId: 'review', laneId: 'erp', position: { x: 640, y: 420 } },
      ],
    };
    const stageBounds = getStageBounds(document);
    const expectedTop = Math.min(...stageBounds.map((bound) => bound.y));
    const expectedBottom = Math.max(...stageBounds.map((bound) => bound.y + bound.height));
    const lanes = getCanvasSwimlaneBounds(document);

    expect(lanes).toHaveLength(2);
    lanes.forEach((lane) => {
      expect(lane.y).toBe(expectedTop);
      expect(lane.y + lane.height).toBe(expectedBottom);
    });
  });
});

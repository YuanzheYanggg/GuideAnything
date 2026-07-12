import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasDocument } from '@guideanything/contracts';

import { HierarchyPanel } from './HierarchyPanel';

const hierarchyDocument: CanvasDocument = {
  schemaVersion: 1,
  stages: [{ id: 'entry', title: '订单录入', order: 0 }],
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, stageId: 'entry', data: { label: '开始', shape: 'start' } },
    { id: 'enter-order', type: 'process', position: { x: 320, y: 0 }, zIndex: 1, stageId: 'entry', data: { label: '录入订单', shape: 'process' } },
    { id: 'note', type: 'markdown', position: { x: 600, y: 0 }, zIndex: 2, contentParentId: 'enter-order', data: { markdown: '核对订单字段' } },
    { id: 'loose-note', type: 'markdown', position: { x: 0, y: 220 }, zIndex: 3, data: { markdown: '未归类说明' } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  entryNodeId: 'start',
  exitNodeIds: [],
};

describe('HierarchyPanel', () => {
  it('groups primary flow by stage and leaves unassigned resources visible', () => {
    render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} />);

    expect(screen.getByRole('tree', { name: '流程结构' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择流程节点 录入订单' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择资料 未归类说明' })).toBeVisible();
  });
});

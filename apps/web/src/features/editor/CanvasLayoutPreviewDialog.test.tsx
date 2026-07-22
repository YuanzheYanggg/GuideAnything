import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CanvasDocument } from '@guideanything/contracts';
import { layoutFlowHierarchy } from '@guideanything/canvas-core';

import { CanvasLayoutPreviewDialog } from './CanvasLayoutPreviewDialog';

function layoutPreview() {
  const document: CanvasDocument = {
    schemaVersion: 1,
    stages: [{ id: 'prepare', title: '准备', order: 0 }],
    lanes: [{ id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 0 }],
    nodes: [
      { id: 'start', type: 'start', stageId: 'prepare', laneId: 'erp', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
      { id: 'process', type: 'process', stageId: 'prepare', laneId: 'erp', position: { x: 320, y: 0 }, zIndex: 1, data: { label: '处理', shape: 'process' } },
    ],
    edges: [{ id: 'start-process', source: 'start', target: 'process' }],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [],
    entryNodeId: 'start',
    exitNodeIds: ['process'],
  };
  return layoutFlowHierarchy(document);
}

describe('CanvasLayoutPreviewDialog', () => {
  it('shows the layout rules, core counts, diagnostics, and actions', () => {
    const layout = layoutPreview();
    render(<CanvasLayoutPreviewDialog layout={layout} avoidedEdgeCount={2} onApply={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: '自动整理预览' });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveClass('canvas-layout-preview-panel');
    expect(dialog).not.toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('阶段从上到下')).toBeVisible();
    expect(screen.getByText('子节点向右展开')).toBeVisible();
    expect(screen.getByText('主流程').parentElement).toHaveTextContent(String(layout.report.primaryNodeIds.length));
    expect(screen.getByText('阶段').parentElement).toHaveTextContent(String(layout.report.stageCount));
    expect(screen.getByText('泳道').parentElement).toHaveTextContent(String(layout.report.laneCount));
    expect(screen.getByText('避障 2')).toBeVisible();
    expect(screen.getByRole('button', { name: '应用自动整理' })).toBeVisible();
    expect(screen.getByRole('button', { name: '取消自动整理' })).toBeVisible();
  });

  it('forwards apply and close actions without changing the preview document', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<CanvasLayoutPreviewDialog layout={layoutPreview()} avoidedEdgeCount={0} onApply={onApply} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '应用自动整理' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '取消自动整理' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the panel close action and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CanvasLayoutPreviewDialog layout={layoutPreview()} avoidedEdgeCount={0} onApply={vi.fn()} onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: '关闭自动整理预览' });
    expect(closeButton).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

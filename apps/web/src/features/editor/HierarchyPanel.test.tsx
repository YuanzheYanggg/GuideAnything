import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasDocument } from '@guideanything/contracts';

import { HierarchyPanel } from './HierarchyPanel';

const hierarchyDocument: CanvasDocument = {
  schemaVersion: 1,
  stages: [{ id: 'entry', title: '订单录入', order: 0 }],
  lanes: [{ id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 0 }],
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, stageId: 'entry', data: { label: '开始', shape: 'start' } },
    { id: 'enter-order', type: 'process', position: { x: 320, y: 0 }, zIndex: 1, stageId: 'entry', laneId: 'erp', data: { label: '录入订单', shape: 'process' } },
    { id: 'note', type: 'markdown', position: { x: 600, y: 0 }, zIndex: 2, contentParentId: 'enter-order', data: { markdown: '核对订单字段' } },
    { id: 'loose-note', type: 'markdown', position: { x: 0, y: 220 }, zIndex: 3, data: { markdown: '未归类说明' } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  entryNodeId: 'start',
  exitNodeIds: [],
};

const managerCallbacks = {
  onUpdateStage: vi.fn(),
  onMoveStage: vi.fn(),
  onAddLane: vi.fn(),
  onUpdateLane: vi.fn(),
  onMoveLane: vi.fn(),
  onRequestDeleteStage: vi.fn(),
  onRequestDeleteLane: vi.fn(),
};

describe('HierarchyPanel', () => {
  it('groups primary flow by stage and leaves unassigned resources visible', () => {
    render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    expect(screen.getByRole('tree', { name: '流程结构' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择流程节点 录入订单' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择资料 未归类说明' })).toBeVisible();
  });

  it('renders expanded subguide artifacts only below their pinned reference', () => {
    const document: CanvasDocument = {
      ...hierarchyDocument,
      nodes: [
        ...hierarchyDocument.nodes,
        { id: 'material-check', type: 'subguide', stageId: 'entry', position: { x: 900, y: 0 }, zIndex: 4, data: { guideId: 'child-guide', guideVersionId: 'child-version', title: '物料检查', version: 1, expanded: true } },
        { id: 'expanded-process', type: 'process', position: { x: 1_200, y: 0 }, zIndex: 5, source: { referenceNodeId: 'material-check', sourceGuideId: 'child-guide', sourceVersionId: 'child-version', sourceElementId: 'source-process' }, data: { label: '核对物料', shape: 'process' } },
        { id: 'expanded-note', type: 'markdown', position: { x: 1_500, y: 0 }, zIndex: 6, source: { referenceNodeId: 'material-check', sourceGuideId: 'child-guide', sourceVersionId: 'child-version', sourceElementId: 'source-note' }, data: { markdown: '物料说明' } },
      ],
    };
    render(<HierarchyPanel document={document} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    expect(screen.getByRole('group', { name: '物料检查的子指南内容' })).toHaveTextContent('核对物料');
    expect(screen.getByRole('group', { name: '物料检查的子指南内容' })).toHaveTextContent('物料说明');
    expect(screen.getByRole('button', { name: '选择子指南内容 核对物料' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择子指南内容 物料说明' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '选择流程节点 核对物料' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择资料 物料说明' })).not.toBeInTheDocument();
  });

  it('provides editable business-stage and mixed responsibility-lane managers', () => {
    render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    expect(screen.getByRole('textbox', { name: '业务阶段 订单录入' })).toHaveValue('订单录入');
    expect(screen.getByRole('button', { name: '添加角色泳道' })).toBeVisible();
    expect(screen.getByRole('button', { name: '添加系统泳道' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '责任泳道 ERP' })).toHaveValue('ERP');
    expect(screen.getByText('系统')).toBeVisible();
  });

  it('requests deletion for stages and lanes while respecting the edit lock', () => {
    managerCallbacks.onRequestDeleteStage.mockClear();
    managerCallbacks.onRequestDeleteLane.mockClear();
    const { rerender } = render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    fireEvent.click(screen.getByRole('button', { name: '删除阶段 订单录入' }));
    fireEvent.click(screen.getByRole('button', { name: '删除泳道 ERP' }));
    expect(managerCallbacks.onRequestDeleteStage).toHaveBeenCalledWith('entry');
    expect(managerCallbacks.onRequestDeleteLane).toHaveBeenCalledWith('erp');

    rerender(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} editingLocked />);
    expect(screen.getByRole('button', { name: '删除阶段 订单录入' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除泳道 ERP' })).toBeDisabled();
  });
});

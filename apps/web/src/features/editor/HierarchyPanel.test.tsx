import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  onReorderStage: vi.fn(),
  onAddLane: vi.fn(),
  onUpdateLane: vi.fn(),
  onMoveLane: vi.fn(),
  onReorderLane: vi.fn(),
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

  it('keeps attached resources inside an expandable appendix below their owner', async () => {
    const user = userEvent.setup();
    render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    expect(screen.queryByRole('button', { name: '选择资料 核对订单字段' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开 录入订单 的资料附录' }));

    expect(screen.getByText('资料附录 · 1')).toBeVisible();
    expect(screen.getByRole('button', { name: '选择资料 核对订单字段' })).toBeVisible();
  });

  it('shows semantic codes for child steps, branches, and attached resources', async () => {
    const user = userEvent.setup();
    const document: CanvasDocument = {
      ...hierarchyDocument,
      nodes: [
        { id: 'supplier-check', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, stageId: 'entry', outline: { order: 0, kind: 'STEP' }, data: { label: '确认供应商', shape: 'process' } },
        { id: 'supplier-child', type: 'process', position: { x: 320, y: 0 }, zIndex: 1, stageId: 'entry', outline: { parentId: 'supplier-check', order: 0, kind: 'STEP' }, data: { label: '核对供应商资料', shape: 'process' } },
        { id: 'material-decision', type: 'decision', position: { x: 640, y: 0 }, zIndex: 2, stageId: 'entry', outline: { order: 1, kind: 'STEP' }, data: { label: '原料合格？', shape: 'decision' } },
        { id: 'approved-path', type: 'process', position: { x: 960, y: 0 }, zIndex: 3, stageId: 'entry', outline: { parentId: 'material-decision', order: 0, kind: 'BRANCH' }, data: { label: '进入打样', shape: 'process' } },
        { id: 'material-note', type: 'markdown', position: { x: 1_280, y: 0 }, zIndex: 4, attachment: { ownerNodeId: 'material-decision', order: 0 }, data: { markdown: '原料检验规范' } },
      ],
      entryNodeId: 'supplier-check',
    };
    render(<HierarchyPanel document={document} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    expect(screen.getByRole('button', { name: '选择流程节点 核对供应商资料' })).toHaveTextContent('1.1');
    expect(screen.getByRole('button', { name: '选择流程节点 进入打样' })).toHaveTextContent('2.B1');

    await user.click(screen.getByRole('button', { name: '展开 原料合格？ 的资料附录' }));
    expect(screen.getByRole('button', { name: '选择资料 原料检验规范' })).toHaveTextContent('2.R1');
  });

  it('collapses a stage without changing its semantic tree membership', async () => {
    const user = userEvent.setup();
    render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    await user.click(screen.getByRole('button', { name: '收起阶段 订单录入' }));

    expect(screen.queryByRole('button', { name: '选择流程节点 录入订单' })).not.toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: '订单录入' })).toBeVisible();
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

  it('keeps stage and lane editors out of the main tree until its trigger is opened', async () => {
    const user = userEvent.setup();
    render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    expect(screen.queryByRole('textbox', { name: '业务阶段 订单录入' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '责任泳道 ERP' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '管理业务阶段' }));
    expect(screen.getByRole('region', { name: '业务阶段管理' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '业务阶段 订单录入' })).toHaveValue('订单录入');
    expect(screen.queryByRole('textbox', { name: '责任泳道 ERP' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '管理责任泳道' }));
    expect(screen.getByRole('region', { name: '责任泳道管理' })).toBeVisible();
    expect(screen.getByRole('button', { name: '添加角色泳道' })).toBeVisible();
    expect(screen.getByRole('button', { name: '添加系统泳道' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '责任泳道 ERP' })).toHaveValue('ERP');
    expect(screen.getByText('系统')).toBeVisible();
  });

  it('sends a before-target reorder when a stage is dropped onto a stage row', async () => {
    const user = userEvent.setup();
    managerCallbacks.onReorderStage.mockClear();
    const document: CanvasDocument = {
      ...hierarchyDocument,
      stages: [
        { id: 'entry', title: '订单录入', order: 0 },
        { id: 'sourcing', title: '采购确认', order: 1 },
        { id: 'sampling', title: '打样', order: 2 },
      ],
    };
    render(<HierarchyPanel document={document} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    await user.click(screen.getByRole('button', { name: '管理业务阶段' }));
    fireEvent.dragStart(screen.getByRole('button', { name: '拖动阶段 打样 排序' }));
    fireEvent.drop(screen.getByRole('listitem', { name: '阶段 订单录入' }));

    expect(managerCallbacks.onReorderStage).toHaveBeenCalledWith('sampling', 'entry', 'before');
  });

  it('sends a before-target reorder when a lane is dropped onto a lane row', async () => {
    const user = userEvent.setup();
    managerCallbacks.onReorderLane.mockClear();
    const document: CanvasDocument = {
      ...hierarchyDocument,
      lanes: [
        { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 0 },
        { id: 'crm', title: 'CRM', kind: 'SYSTEM', order: 1 },
      ],
    };
    render(<HierarchyPanel document={document} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    await user.click(screen.getByRole('button', { name: '管理责任泳道' }));
    fireEvent.dragStart(screen.getByRole('button', { name: '拖动泳道 CRM 排序' }));
    fireEvent.drop(screen.getByRole('listitem', { name: '泳道 ERP' }));

    expect(managerCallbacks.onReorderLane).toHaveBeenCalledWith('crm', 'erp', 'before');
  });

  it('requests deletion for stages and lanes while respecting the edit lock', async () => {
    const user = userEvent.setup();
    managerCallbacks.onRequestDeleteStage.mockClear();
    managerCallbacks.onRequestDeleteLane.mockClear();
    const { rerender } = render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} />);

    await user.click(screen.getByRole('button', { name: '管理业务阶段' }));
    fireEvent.click(screen.getByRole('button', { name: '删除阶段 订单录入' }));
    await user.click(screen.getByRole('button', { name: '管理责任泳道' }));
    fireEvent.click(screen.getByRole('button', { name: '删除泳道 ERP' }));
    expect(managerCallbacks.onRequestDeleteStage).toHaveBeenCalledWith('entry');
    expect(managerCallbacks.onRequestDeleteLane).toHaveBeenCalledWith('erp');

    rerender(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} {...managerCallbacks} editingLocked />);
    await user.click(screen.getByRole('button', { name: '管理业务阶段' }));
    expect(screen.getByRole('button', { name: '删除阶段 订单录入' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '管理责任泳道' }));
    expect(screen.getByRole('button', { name: '删除泳道 ERP' })).toBeDisabled();
  });
});

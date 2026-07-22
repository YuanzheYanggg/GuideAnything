import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HierarchyDeletionDialog } from './HierarchyDeletionDialog';

describe('HierarchyDeletionDialog', () => {
  it('explains that only assignments are removed and confirms the requested deletion', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<HierarchyDeletionDialog kind="stage" title="订单录入" affectedNodeCount={2} onConfirm={onConfirm} onCancel={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: '删除业务阶段' });
    expect(dialog).toHaveClass('editor-dialog-surface');
    expect(dialog).toHaveTextContent('将解除 2 个流程节点的归属；节点与连线会保留。');
    await user.click(screen.getByRole('button', { name: '确认删除订单录入' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels with Escape without confirming', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<HierarchyDeletionDialog kind="lane" title="ERP" affectedNodeCount={1} onConfirm={onConfirm} onCancel={onCancel} />);

    await user.keyboard('{Escape}');

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

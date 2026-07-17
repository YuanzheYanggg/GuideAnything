import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NodeDetailDialog } from './NodeDetailDialog';

describe('NodeDetailDialog', () => {
  it('saves multi-line details through Meta+Enter and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const opener = document.createElement('button');
    document.body.append(opener);
    render(<NodeDetailDialog nodeId="process-a" title="操作步骤" value="旧明细" openerRef={{ current: opener }} onSave={onSave} onClose={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: '操作步骤 · 节点明细' });
    await user.clear(input);
    await user.type(input, '第一行\n第二行');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onSave).toHaveBeenCalledWith('第一行\n第二行');
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('cancels unsaved detail edits with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NodeDetailDialog nodeId="process-a" title="操作步骤" value="旧明细" openerRef={{ current: null }} onSave={vi.fn()} onClose={onClose} />);

    await user.type(screen.getByRole('textbox'), ' 不保存');
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

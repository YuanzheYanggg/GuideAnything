import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EditorDialogSurface } from './EditorDialogSurface';

describe('EditorDialogSurface', () => {
  it('uses the shared React Bits surface and closes from its X action', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <EditorDialogSurface ariaLabel="共享编辑弹窗" closeLabel="关闭共享编辑弹窗" onClose={onClose}>
        <p>编辑内容</p>
      </EditorDialogSurface>,
    );

    const dialog = screen.getByRole('dialog', { name: '共享编辑弹窗' });
    expect(dialog).toHaveClass('editor-dialog-surface');
    expect(dialog).toHaveClass('border-glow');
    expect(screen.getByText('编辑内容')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '关闭共享编辑弹窗' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close from the X action while disabled', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <EditorDialogSurface ariaLabel="忙碌弹窗" closeLabel="关闭忙碌弹窗" closeDisabled onClose={onClose}>
        <p>正在处理</p>
      </EditorDialogSurface>,
    );

    await user.click(screen.getByRole('button', { name: '关闭忙碌弹窗' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '关闭忙碌弹窗' })).toBeDisabled();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EdgeToolbar } from './EdgeToolbar';

describe('EdgeToolbar', () => {
  it('keeps choices compact until a trigger opens its own menu', async () => {
    const user = userEvent.setup();
    render(<EdgeToolbar presentation={{}} onChange={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: '选择连线颜色' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '红色连线' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '选择连线颜色' }));

    expect(screen.getByRole('button', { name: '选择连线颜色' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: '连线颜色' })).toBeInTheDocument();
  });

  it('emits one constrained update and closes the chosen menu', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EdgeToolbar presentation={{}} onChange={onChange} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '选择线型' }));
    await user.click(screen.getByRole('button', { name: '点线' }));

    expect(onChange).toHaveBeenCalledWith({ pattern: 'dotted' });
    expect(screen.queryByRole('menu', { name: '线型' })).not.toBeInTheDocument();
  });

  it('marks active choices in their selected menus and can dismiss the toolbar', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<EdgeToolbar presentation={{ color: 'green', width: 2, pattern: 'solid', arrows: 'forward' }} onChange={vi.fn()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '选择连线颜色' }));
    expect(screen.getByRole('button', { name: '绿色连线' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '选择连线粗细' }));
    expect(screen.getByRole('button', { name: '2 像素' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '选择线型' }));
    expect(screen.getByRole('button', { name: '实线' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '选择箭头' }));
    expect(screen.getByRole('button', { name: '正向箭头' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '关闭连线样式' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps style controls from bubbling into the canvas pane', async () => {
    const onCanvasClick = vi.fn();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<div onClick={onCanvasClick}><EdgeToolbar presentation={{}} onChange={onChange} onClose={vi.fn()} /></div>);

    await user.click(screen.getByRole('button', { name: '选择连线颜色' }));
    await user.click(screen.getByRole('button', { name: '紫色连线' }));

    expect(onChange).toHaveBeenCalledWith({ color: 'purple' });
    expect(onCanvasClick).not.toHaveBeenCalled();
  });
});

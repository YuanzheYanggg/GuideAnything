import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EdgeToolbar } from './EdgeToolbar';

describe('EdgeToolbar', () => {
  it('emits one constrained partial update per toolbar choice', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EdgeToolbar presentation={{}} onChange={onChange} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '红色连线' }));
    await user.click(screen.getByRole('button', { name: '4 像素' }));
    await user.click(screen.getByRole('button', { name: '点线' }));
    await user.click(screen.getByRole('button', { name: '双向箭头' }));

    expect(onChange).toHaveBeenNthCalledWith(1, { color: 'red' });
    expect(onChange).toHaveBeenNthCalledWith(2, { width: 4 });
    expect(onChange).toHaveBeenNthCalledWith(3, { pattern: 'dotted' });
    expect(onChange).toHaveBeenNthCalledWith(4, { arrows: 'both' });
  });

  it('marks the active option and can dismiss the toolbar', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<EdgeToolbar presentation={{ color: 'green', width: 2, pattern: 'solid', arrows: 'forward' }} onChange={vi.fn()} onClose={onClose} />);

    expect(screen.getByRole('button', { name: '绿色连线' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2 像素' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '实线' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '正向箭头' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '关闭连线样式' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

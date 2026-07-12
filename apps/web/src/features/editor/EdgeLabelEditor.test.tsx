import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EdgeLabelEditor } from './EdgeLabelEditor';

describe('EdgeLabelEditor', () => {
  it('cancels an in-progress label with Escape', () => {
    const onCancel = vi.fn();
    render(<EdgeLabelEditor position={{ x: 120, y: 80 }} label="是" onSave={vi.fn()} onCancel={onCancel} />);

    expect(screen.getByRole('dialog', { name: '编辑连线标注' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '连线标注' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

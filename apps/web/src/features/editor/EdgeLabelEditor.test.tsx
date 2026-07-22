import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EdgeLabelEditor } from './EdgeLabelEditor';

describe('EdgeLabelEditor', () => {
  it('edits the label text and font size together', async () => {
    const onSave = vi.fn();
    render(<EdgeLabelEditor position={{ x: 120, y: 80 }} label="是" labelFontSize={18} onSave={onSave} onCancel={vi.fn()} />);

    const labelInput = screen.getByRole('textbox', { name: '连线标注' });
    const fontSizeInput = screen.getByRole('spinbutton', { name: '连线标注字号' });
    expect(fontSizeInput).toHaveValue(18);
    fireEvent.change(labelInput, { target: { value: '提交审核' } });
    fireEvent.change(fontSizeInput, { target: { value: '24' } });
    const dialog = screen.getByRole('dialog', { name: '编辑连线标注' });
    expect(dialog.parentElement).toHaveClass('border-glow');
    fireEvent.submit(dialog);

    expect(onSave).toHaveBeenCalledWith({ label: '提交审核', fontSize: 24 });
  });

  it('cancels an in-progress label with Escape', () => {
    const onCancel = vi.fn();
    render(<EdgeLabelEditor position={{ x: 120, y: 80 }} label="是" onSave={vi.fn()} onCancel={onCancel} />);

    expect(screen.getByRole('dialog', { name: '编辑连线标注' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '连线标注' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

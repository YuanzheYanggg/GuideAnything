import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EdgeToolbar } from './EdgeToolbar';

describe('EdgeToolbar', () => {
  it('uses the native system color picker for continuous palette selection', () => {
    render(<EdgeToolbar presentation={{}} onChange={vi.fn()} onClose={vi.fn()} />);

    const colorPicker = screen.getByLabelText('选择连线颜色');
    expect(colorPicker).toHaveAttribute('type', 'color');
    expect(colorPicker).toHaveValue('#0a84ff');
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

    expect(screen.getByLabelText('选择连线颜色')).toHaveValue('#47d57a');
    await user.click(screen.getByRole('button', { name: '选择连线粗细' }));
    expect(screen.getByRole('spinbutton', { name: '连线粗细数值' })).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: '选择线型' }));
    expect(screen.getByRole('button', { name: '实线' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '选择箭头' }));
    expect(screen.getByRole('button', { name: '正向箭头' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '关闭连线样式' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps native color changes in the canvas toolbar and emits the custom hex value', () => {
    const onCanvasClick = vi.fn();
    const onChange = vi.fn();
    render(<div onClick={onCanvasClick}><EdgeToolbar presentation={{}} onChange={onChange} onClose={vi.fn()} /></div>);

    fireEvent.change(screen.getByLabelText('选择连线颜色'), { target: { value: '#1020ff' } });

    expect(onChange).toHaveBeenCalledWith({ color: '#1020ff' });
    expect(onCanvasClick).not.toHaveBeenCalled();
  });

  it('groups related formatting controls so the wider toolbar has clear visual separation', () => {
    render(<EdgeToolbar presentation={{}} onChange={vi.fn()} onClose={vi.fn()} />);

    const toolbar = screen.getByRole('toolbar', { name: '连线样式' });
    const groups = toolbar.querySelectorAll('.edge-toolbar-group');

    expect(groups).toHaveLength(3);
    expect(screen.getByLabelText('选择连线颜色').closest('.edge-toolbar-group')).toBe(groups[0]);
    expect(screen.getByRole('button', { name: '选择连线粗细' }).closest('.edge-toolbar-group')).toBe(groups[1]);
    expect(screen.getByRole('button', { name: '关闭连线样式' }).closest('.edge-toolbar-group')).toHaveClass('edge-toolbar-group-end');
  });

  it('marks the color and width triggers for their independent layout spacing', () => {
    render(<EdgeToolbar presentation={{}} onChange={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByLabelText('选择连线颜色').closest('.edge-toolbar-color-trigger')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择连线粗细' })).toHaveClass('edge-toolbar-trigger-width');
  });

  it('lets authors type a line width beside its live glyph preview', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EdgeToolbar presentation={{ width: 3 }} onChange={onChange} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: '选择连线粗细' }).querySelector('.edge-toolbar-width-preview')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '选择连线粗细' }));

    const input = screen.getByRole('spinbutton', { name: '连线粗细数值' });
    expect(input).toHaveValue(3);
    expect(screen.getByLabelText('连线粗细预览')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '7');

    expect(onChange).toHaveBeenLastCalledWith({ width: 7 });
  });

  it('selects a persisted routing mode separately from the visual line pattern', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EdgeToolbar presentation={{ pattern: 'dashed' }} onChange={onChange} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '选择连线路由' }));
    expect(screen.getByRole('button', { name: '折线' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '直线' }));

    expect(onChange).toHaveBeenLastCalledWith({ routing: 'straight' });
    expect(screen.queryByRole('menu', { name: '连线路由' })).not.toBeInTheDocument();
  });

  it('starts manual route editing and exposes save, cancel, and reset actions', async () => {
    const user = userEvent.setup();
    const onStartRouteEdit = vi.fn();
    const onSaveRouteEdit = vi.fn();
    const onCancelRouteEdit = vi.fn();
    const onResetRoute = vi.fn();
    const props = {
      presentation: { routeMode: 'manual' as const },
      onChange: vi.fn(),
      onClose: vi.fn(),
      onStartRouteEdit,
      onSaveRouteEdit,
      onCancelRouteEdit,
      onResetRoute,
    };

    const { rerender } = render(<EdgeToolbar {...props} />);

    await user.click(screen.getByRole('button', { name: '编辑走向' }));
    expect(onStartRouteEdit).toHaveBeenCalledTimes(1);

    rerender(<EdgeToolbar {...props} routeEditing />);
    await user.click(screen.getByRole('button', { name: '保存走向' }));
    await user.click(screen.getByRole('button', { name: '取消编辑' }));
    await user.click(screen.getByRole('button', { name: '恢复智能路线' }));

    expect(onSaveRouteEdit).toHaveBeenCalledTimes(1);
    expect(onCancelRouteEdit).toHaveBeenCalledTimes(1);
    expect(onResetRoute).toHaveBeenCalledTimes(1);
  });

  it('keeps the route toolbar free of a separate drag handle while editing', () => {
    render(<EdgeToolbar presentation={{ routeMode: 'manual' }} onChange={vi.fn()} onClose={vi.fn()} routeEditing />);

    expect(screen.queryByRole('button', { name: '拖动编辑工具条' })).not.toBeInTheDocument();
  });

  it('prevents saving a manual route while it is blocked by a node', () => {
    render(
      <EdgeToolbar
        presentation={{ routeMode: 'manual' }}
        onChange={vi.fn()}
        onClose={vi.fn()}
        routeEditing
        manualRouteConflict
        onSaveRouteEdit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '保存走向' })).toBeDisabled();
  });
});

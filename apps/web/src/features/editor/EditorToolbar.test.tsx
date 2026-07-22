import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { EditorToolbarProps } from './EditorToolbar';
import { EditorToolbar } from './EditorToolbar';

function toolbarProps(overrides: Partial<EditorToolbarProps> = {}): EditorToolbarProps {
  return {
    layoutPreview: false,
    canUndo: true,
    canRedo: false,
    canCopy: true,
    canPaste: true,
    canAlign: true,
    canPreviewLayout: true,
    canDelete: true,
    onAddNode: vi.fn(),
    onInsertSubguide: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onAlign: vi.fn(),
    onPreviewLayout: vi.fn(),
    onRemoveSelected: vi.fn(),
    ...overrides,
  };
}

describe('EditorToolbar', () => {
  it('keeps the node and edit commands grouped inside React Bits surfaces', () => {
    render(<EditorToolbar {...toolbarProps()} />);

    expect(screen.getByRole('group', { name: '添加节点' })).toHaveClass('editor-toolbar-group', 'editor-toolbar-group--nodes');
    expect(screen.getByRole('group', { name: '添加节点' }).querySelector('.card-spotlight')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '编辑画布' })).toHaveClass('editor-toolbar-group--edit-end');
    expect(screen.getByRole('button', { name: '添加开始节点' })).toHaveTextContent('开始');
    expect(screen.getByRole('button', { name: '添加流程节点' })).toHaveTextContent('流程');
    expect(screen.getByRole('button', { name: '预览自动整理' })).toHaveClass('editor-toolbar-action-layout');
  });

  it('forwards the existing command callbacks and preserves preview disabled states', async () => {
    const user = userEvent.setup();
    const props = toolbarProps();
    const rendered = render(<EditorToolbar {...props} />);

    await user.click(screen.getByRole('button', { name: '预览自动整理' }));
    await user.click(screen.getByRole('button', { name: '添加开始节点' }));
    await user.click(screen.getByRole('button', { name: '插入子指南' }));

    expect(props.onPreviewLayout).toHaveBeenCalledTimes(1);
    expect(props.onAddNode).toHaveBeenCalledWith('start');
    expect(props.onInsertSubguide).toHaveBeenCalledTimes(1);

    const previewProps = toolbarProps({
      layoutPreview: true,
      canUndo: false,
      canRedo: false,
      canPaste: false,
      canAlign: false,
      canDelete: true,
    });
    rendered.rerender(<EditorToolbar {...previewProps} />);

    expect(screen.getByRole('button', { name: '添加开始节点' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '预览自动整理' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除选中项' })).toBeDisabled();

    rendered.rerender(<EditorToolbar {...toolbarProps({ canPreviewLayout: false })} />);
    expect(screen.getByRole('button', { name: '预览自动整理' })).toBeDisabled();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CanvasCreationMenu } from './CanvasCreationMenu';

describe('CanvasCreationMenu', () => {
  it('cancels with Escape and does not offer resources to a non-primary source', () => {
    const onCancel = vi.fn();
    render(<CanvasCreationMenu position={{ x: 120, y: 80 }} allowResources={false} onCreate={vi.fn()} onCancel={onCancel} />);

    expect(screen.getByRole('menu', { name: '创建下一项' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: '创建流程节点' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: '创建说明资料' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

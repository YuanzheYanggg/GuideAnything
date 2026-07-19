import type { CanvasNode } from '@guideanything/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MediaLightbox, type MediaPreview } from './MediaLightbox';

const image: CanvasNode<'image'> = {
  id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0,
  data: { url: 'https://example.com/a.png', alt: 'ERP 页面', annotations: [{ id: 'a', order: 0, title: '字段', shape: 'POINT', region: { x: 0.2, y: 0.2 } }] },
};

describe('MediaLightbox', () => {
  it('closes with Escape and restores focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<><button type="button">来源按钮</button><MediaLightbox preview={{ kind: 'image', node: image }} onClose={onClose} onOpenTarget={vi.fn()} isTargetValid={() => true} /></>);
    await user.click(screen.getByRole('button', { name: '来源按钮' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders linked Markdown and provides a back action for a stacked preview', () => {
    const preview: MediaPreview = { kind: 'markdown', node: { id: 'note', type: 'markdown', position: { x: 0, y: 0 }, zIndex: 0, data: { markdown: '# 字段解释' } } };
    render(<MediaLightbox preview={preview} onClose={vi.fn()} onBack={vi.fn()} onOpenTarget={vi.fn()} isTargetValid={() => true} />);
    expect(screen.getByRole('heading', { name: '字段解释' })).toBeVisible();
    expect(screen.getByRole('button', { name: '返回上一项资料' })).toBeVisible();
  });

  it('renders an annotation supplement as a stackable private media preview', () => {
    const preview: MediaPreview = {
      kind: 'annotation-supplement',
      supplement: { id: 'menu', order: 0, assetId: 'asset-menu', url: 'https://example.com/menu.png', alt: '成衣类型菜单', caption: '选择后的下拉菜单' },
    };
    render(<MediaLightbox preview={preview} onClose={vi.fn()} onBack={vi.fn()} onOpenTarget={vi.fn()} isTargetValid={() => true} />);
    expect(screen.getByRole('dialog', { name: '步骤补充图' })).toBeVisible();
    expect(screen.getByRole('img', { name: '成衣类型菜单' })).toBeVisible();
    expect(screen.getByText('选择后的下拉菜单')).toBeVisible();
    expect(screen.getByRole('button', { name: '返回图片讲解' })).toBeVisible();
  });
});

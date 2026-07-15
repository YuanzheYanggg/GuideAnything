import type { CanvasNode } from '@guideanything/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ImageAnnotationPlayer } from './ImageAnnotationPlayer';

const data: CanvasNode<'image'>['data'] = {
  url: 'https://example.com/a.png', alt: 'ERP 页面',
  annotations: [
    { id: 'first', order: 0, title: '客户字段', body: '填写售达方', shape: 'POINT', region: { x: 0.25, y: 0.4 }, camera: { centerX: 0.3, centerY: 0.4, zoom: 4 }, targetNodeId: 'note' },
    { id: 'second', order: 1, title: '订单区域', shape: 'RECT', region: { x: 0.5, y: 0.2, width: 0.25, height: 0.5 } },
  ],
};

afterEach(() => vi.useRealTimers());

describe('ImageAnnotationPlayer', () => {
  it('starts a walkthrough and supports next, previous, and numbered jumps', async () => {
    const user = userEvent.setup();
    render(<ImageAnnotationPlayer source={data.url} data={data} isTargetValid={() => true} onOpenTarget={vi.fn()} />);

    expect(screen.getByRole('button', { name: '开始图片讲解' })).toBeVisible();
    expect(screen.getByTestId('annotation-camera')).toHaveClass('annotation-image-frame');
    await user.click(screen.getByRole('button', { name: '开始图片讲解' }));
    expect(screen.getByRole('heading', { name: '客户字段' })).toBeVisible();
    expect(screen.getByTestId('annotation-camera')).toHaveStyle({ transformOrigin: '30% 40%' });
    expect(screen.getByTestId('annotation-camera').getAttribute('style')).toContain('scale(4)');

    await user.click(screen.getByRole('button', { name: '下一个标注' }));
    expect(screen.getByRole('heading', { name: '订单区域' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '播放标注 1 客户字段' }));
    expect(screen.getByRole('heading', { name: '客户字段' })).toBeVisible();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('heading', { name: '订单区域' })).toBeVisible();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('heading', { name: '客户字段' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '上一个标注' }));
    expect(screen.getByRole('heading', { name: '客户字段' })).toBeVisible();
  });

  it('opens valid targets and disables missing targets', async () => {
    const user = userEvent.setup();
    const onOpenTarget = vi.fn();
    const { rerender } = render(<ImageAnnotationPlayer source={data.url} data={data} isTargetValid={() => true} onOpenTarget={onOpenTarget} initialIndex={0} />);

    await user.click(screen.getByRole('button', { name: '查看关联资料' }));
    expect(onOpenTarget).toHaveBeenCalledWith('note', 0);

    rerender(<ImageAnnotationPlayer source={data.url} data={data} isTargetValid={() => false} onOpenTarget={onOpenTarget} initialIndex={0} />);
    expect(screen.getByRole('button', { name: '关联资料已失效' })).toBeDisabled();
  });

  it('autoplays only while enabled and stops at the final annotation', async () => {
    vi.useFakeTimers();
    const onOpenTarget = vi.fn();
    render(<ImageAnnotationPlayer source={data.url} data={data} isTargetValid={() => true} onOpenTarget={onOpenTarget} initialIndex={0} />);

    expect(screen.getByRole('button', { name: '自动播放' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '自动播放' }));
    expect(screen.getByRole('button', { name: '自动播放' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(screen.getByRole('heading', { name: '订单区域' })).toBeVisible();
    expect(screen.getByRole('button', { name: '自动播放' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the camera as reduced motion when the system requests it', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    render(<ImageAnnotationPlayer source={data.url} data={data} isTargetValid={() => true} onOpenTarget={vi.fn()} initialIndex={0} />);
    expect(screen.getByTestId('annotation-camera')).toHaveClass('reduce-motion');
  });
});

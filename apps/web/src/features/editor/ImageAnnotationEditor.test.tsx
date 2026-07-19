import type { CanvasNode } from '@guideanything/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ImageAnnotationEditor } from './ImageAnnotationEditor';

const imageNode: CanvasNode<'image'> = {
  id: 'image', type: 'image', position: { x: 0, y: 0 }, zIndex: 0,
  data: { url: 'https://example.com/screen.png', alt: 'ERP 页面', annotations: [] },
};
const target: CanvasNode<'markdown'> = {
  id: 'note', type: 'markdown', position: { x: 400, y: 0 }, zIndex: 1, data: { markdown: '字段解释' },
};

describe('ImageAnnotationEditor', () => {
  it('creates a normalized point and edits its copy, target, and saved camera', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const surface = screen.getByTestId('annotation-surface');
    expect(surface.parentElement).toHaveClass('annotation-image-frame');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 470, width: 800, height: 450, toJSON: () => ({}) });

    await user.click(screen.getByRole('button', { name: '点标注' }));
    fireEvent.click(surface, { clientX: 210, clientY: 245 });

    expect(screen.getByText('标注 1')).toBeVisible();
    expect(screen.getByLabelText('标注 1 标题')).toHaveValue('新标注');
    await user.clear(screen.getByLabelText('标注 1 标题'));
    await user.type(screen.getByLabelText('标注 1 标题'), '客户字段');
    await user.selectOptions(screen.getByLabelText('标注 1 关联目标'), 'note');
    fireEvent.change(screen.getByLabelText('镜头缩放'), { target: { value: '4' } });
    await user.click(screen.getByRole('button', { name: '保存当前镜头' }));

    expect(screen.getByTestId('annotation-state')).toHaveTextContent('0.250,0.500,4');
    await user.click(screen.getByRole('button', { name: '关闭图片标注编辑器' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('commits the active text field before Escape closes the editor', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} initialAnnotations={[
      { id: 'first', order: 0, title: '旧标题', shape: 'POINT', region: { x: 0.2, y: 0.3 } },
    ]} />);

    const title = screen.getByLabelText('标注 1 标题');
    await user.clear(title);
    await user.type(title, '快捷关闭仍保存');
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('annotation-state')).toHaveTextContent('快捷关闭仍保存');
  });

  it('creates a rectangle, reorders annotations, and deletes the selected one', async () => {
    const user = userEvent.setup();
    render(<Harness initialAnnotations={[
      { id: 'first', order: 0, title: '第一个', shape: 'POINT', region: { x: 0.1, y: 0.1 } },
    ]} />);
    const surface = screen.getByTestId('annotation-surface');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) });

    await user.click(screen.getByRole('button', { name: '矩形标注' }));
    fireEvent.pointerDown(surface, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 600, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 600, clientY: 300, pointerId: 1 });

    expect(screen.getByText('标注 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '上移标注 2' }));
    expect(screen.getAllByRole('button', { name: /选择标注/ })[0]).toHaveAccessibleName('选择标注 1 新标注');
    await user.click(screen.getByRole('button', { name: '删除标注 1' }));
    expect(screen.queryByDisplayValue('新标注')).not.toBeInTheDocument();
  });

  it('uploads, captions, reorders, and unlinks image-only supplemental screenshots', async () => {
    const user = userEvent.setup();
    const onUploadSupplement = vi.fn().mockResolvedValue({
      assetId: 'asset-menu', url: '/api/media/asset-menu', alt: '成衣类型菜单',
    });
    render(<Harness initialAnnotations={[
      { id: 'first', order: 0, title: '成衣类型', shape: 'POINT', region: { x: 0.2, y: 0.3 } },
    ]} onUploadSupplement={onUploadSupplement} />);

    await user.upload(screen.getByLabelText('上传步骤补充图'), new File(['menu'], 'menu.png', { type: 'image/png' }));
    expect(onUploadSupplement).toHaveBeenCalledWith(expect.objectContaining({ name: 'menu.png', type: 'image/png' }));
    await waitFor(() => expect(screen.getByTestId('annotation-state')).toHaveTextContent('成衣类型菜单'));
    await user.type(screen.getByLabelText('补充图 1 说明'), '点击字段后的下拉菜单');
    fireEvent.blur(screen.getByLabelText('补充图 1 说明'));
    expect(screen.getByTestId('annotation-state')).toHaveTextContent('点击字段后的下拉菜单');
    await user.click(screen.getByRole('button', { name: '移除补充图 1' }));
    expect(screen.getByTestId('annotation-state')).not.toHaveTextContent('成衣类型菜单');
    expect(onUploadSupplement).toHaveBeenCalledTimes(1);
  });

  it('rejects non-image supplemental uploads without changing the annotation', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onUploadSupplement = vi.fn();
    render(<Harness initialAnnotations={[
      { id: 'first', order: 0, title: '成衣类型', shape: 'POINT', region: { x: 0.2, y: 0.3 } },
    ]} onUploadSupplement={onUploadSupplement} />);

    await user.upload(screen.getByLabelText('上传步骤补充图'), new File(['video'], 'menu.mp4', { type: 'video/mp4' }));
    expect(onUploadSupplement).not.toHaveBeenCalled();
    expect(screen.getByText('仅支持图片文件。')).toBeVisible();
  });
});

function Harness({ onClose = vi.fn(), initialAnnotations = [], onUploadSupplement = vi.fn() }: {
  onClose?: () => void;
  initialAnnotations?: CanvasNode<'image'>['data']['annotations'];
  onUploadSupplement?: (file: File) => Promise<{ assetId: string; url: string; alt: string }>;
}) {
  const [data, setData] = useState<CanvasNode<'image'>['data']>({ ...imageNode.data, annotations: initialAnnotations });
  const annotations = data.annotations ?? [];
  return <>
    <ImageAnnotationEditor node={{ ...imageNode, data }} nodes={[imageNode, target]} onChange={setData} onUploadSupplement={onUploadSupplement} onClose={onClose} />
    <output data-testid="annotation-state">{annotations.map((item) => `${item.title}:${item.region.x.toFixed(3)},${item.region.y.toFixed(3)},${item.camera?.zoom ?? 0}:${item.supplementalImages?.map((image) => image.caption ?? image.alt).join(',') ?? ''}`).join('|')}</output>
  </>;
}

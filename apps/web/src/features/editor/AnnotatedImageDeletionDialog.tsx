import { useEffect } from 'react';

import { EditorDialogSurface } from './EditorDialogSurface';

export function AnnotatedImageDeletionDialog({
  imageCount,
  annotationCount,
  onConfirm,
  onCancel,
}: {
  imageCount: number;
  annotationCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return <EditorDialogSurface
    className="reference-modal annotated-image-deletion-dialog"
    ariaLabel="确认删除带标注的图片"
    closeLabel="关闭删除图片确认"
    onClose={onCancel}
  >
      <span className="eyebrow">PROTECTED IMAGE</span>
      <h2>删除带标注的图片？</h2>
      <p>将删除 {imageCount} 张图片节点及其中 {annotationCount} 条图片标注，并清理相关连线和教学步骤。</p>
      <p>图片文件本身不会被删除；如有误操作，可在草稿历史中恢复。</p>
      <div className="hierarchy-deletion-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>取消删除</button>
        <button className="primary-button" type="button" onClick={onConfirm} aria-label="确认删除">确认删除</button>
      </div>
  </EditorDialogSurface>;
}

import { useEffect } from 'react';

import { EditorDialogSurface } from './EditorDialogSurface';

export function ImageReplacementDialog({
  annotationCount,
  uploading,
  onConfirm,
  onCancel,
}: {
  annotationCount: number;
  uploading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || uploading) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, uploading]);

  return <EditorDialogSurface
    className="reference-modal annotated-image-deletion-dialog"
    ariaLabel="确认替换带标注的图片"
    closeLabel="关闭替换图片确认"
    closeDisabled={uploading}
    onClose={onCancel}
  >
      <span className="eyebrow">REPLACE IMAGE</span>
      <h2>替换图片并清除标注？</h2>
      <p>当前图片有 {annotationCount} 条标注。确认后，新图片不会继承这些标注。</p>
      <p>确认后才会开始上传；取消不会改变当前图片。已保存的旧草稿仍可从草稿历史恢复。</p>
      <div className="hierarchy-deletion-actions">
        <button className="secondary-button" type="button" onClick={onCancel} disabled={uploading}>取消替换</button>
        <button className="primary-button" type="button" onClick={onConfirm} disabled={uploading} aria-label="确认并上传">{uploading ? '正在上传…' : '确认并上传'}</button>
      </div>
  </EditorDialogSurface>;
}

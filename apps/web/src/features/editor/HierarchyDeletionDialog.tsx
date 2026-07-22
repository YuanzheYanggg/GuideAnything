import { useEffect } from 'react';

import { EditorDialogSurface } from './EditorDialogSurface';

export function HierarchyDeletionDialog({
  kind,
  title,
  affectedNodeCount,
  onConfirm,
  onCancel,
}: {
  kind: 'stage' | 'lane';
  title: string;
  affectedNodeCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const heading = kind === 'stage' ? '删除业务阶段' : '删除责任泳道';

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
    className="reference-modal hierarchy-deletion-dialog"
    backdropClassName="hierarchy-deletion-backdrop"
    ariaLabelledBy="hierarchy-deletion-title"
    closeLabel="关闭删除确认"
    onClose={onCancel}
  >
      <span className="eyebrow">REMOVE {kind === 'stage' ? 'STAGE' : 'LANE'}</span>
      <h2 id="hierarchy-deletion-title">{heading}</h2>
      <p>将解除 {affectedNodeCount} 个流程节点的归属；节点与连线会保留。</p>
      <div className="hierarchy-deletion-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>取消删除</button>
        <button className="primary-button" type="button" onClick={onConfirm} aria-label={'确认删除' + title}>确认删除</button>
      </div>
  </EditorDialogSurface>;
}

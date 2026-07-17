import { useEffect, useRef, useState } from 'react';

export function NodeDetailDialog({
  nodeId,
  title,
  value,
  openerRef,
  onSave,
  onClose,
}: {
  nodeId: string;
  title: string;
  value: string;
  openerRef: { current: HTMLElement | null };
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const close = (save: boolean) => {
    if (save && draft !== value) onSave(draft);
    onClose();
    openerRef.current?.focus();
  };

  return <div className="modal-backdrop node-detail-backdrop" role="presentation">
    <section className="node-detail-dialog" role="dialog" aria-modal="true" aria-labelledby={'node-detail-title-' + nodeId}>
      <span className="eyebrow">FLOW DETAIL</span>
      <h2 id={'node-detail-title-' + nodeId}>编辑节点明细</h2>
      <label>{title} · 节点明细
        <textarea
          ref={inputRef}
          className="nodrag nopan nowheel"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close(false);
              return;
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            }
          }}
        />
      </label>
      <div className="node-detail-dialog-actions">
        <button className="secondary-button" type="button" onClick={() => close(false)}>取消</button>
        <button className="primary-button" type="button" onClick={() => close(true)}>保存</button>
      </div>
    </section>
  </div>;
}

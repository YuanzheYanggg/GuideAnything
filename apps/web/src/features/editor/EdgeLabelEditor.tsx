import { useEffect, useState } from 'react';

export function EdgeLabelEditor({ position, label, onSave, onCancel }: { position: { x: number; y: number }; label?: string; onSave: (label: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(label ?? '');
  const save = () => onSave(value.trim());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return <form className="edge-label-editor" role="dialog" aria-label="编辑连线标注" style={{ left: position.x, top: position.y }} onSubmit={(event) => { event.preventDefault(); save(); }}>
    <label>连线标注<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} /></label>
    <div><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="submit">保存标注</button></div>
  </form>;
}

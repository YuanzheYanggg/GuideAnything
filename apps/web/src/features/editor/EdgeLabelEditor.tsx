import { useEffect, useState } from 'react';

import { BorderGlow } from '../../components/reactbits/BorderGlow';

const MIN_LABEL_FONT_SIZE = 10;
const MAX_LABEL_FONT_SIZE = 32;
const DEFAULT_LABEL_FONT_SIZE = 14;

export type EdgeLabelValue = { label: string; fontSize: number };

export function EdgeLabelEditor({ position, label, labelFontSize, onSave, onCancel }: { position: { x: number; y: number }; label?: string; labelFontSize?: number; onSave: (value: EdgeLabelValue) => void; onCancel: () => void }) {
  const [value, setValue] = useState(label ?? '');
  const [fontSize, setFontSize] = useState(String(labelFontSize ?? DEFAULT_LABEL_FONT_SIZE));
  const save = () => {
    const numericFontSize = Number(fontSize);
    onSave({
      label: value.trim(),
      fontSize: Number.isInteger(numericFontSize)
        ? Math.min(MAX_LABEL_FONT_SIZE, Math.max(MIN_LABEL_FONT_SIZE, numericFontSize))
        : DEFAULT_LABEL_FONT_SIZE,
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return <BorderGlow className="edge-label-editor-shell" active tone="accent" style={{ left: position.x, top: position.y }}>
    <form className="edge-label-editor" role="dialog" aria-label="编辑连线标注" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="edge-label-editor-fields">
        <label>连线标注<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} /></label>
        <label>字号（px）<input aria-label="连线标注字号" type="number" min={MIN_LABEL_FONT_SIZE} max={MAX_LABEL_FONT_SIZE} step={1} value={fontSize} onChange={(event) => setFontSize(event.target.value)} /></label>
      </div>
      <div><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="submit">保存标注</button></div>
    </form>
  </BorderGlow>;
}

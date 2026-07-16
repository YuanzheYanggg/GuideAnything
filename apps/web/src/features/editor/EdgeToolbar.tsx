import type { EdgePresentation } from '@guideanything/contracts';

const colorOptions = [
  ['default', '默认色'],
  ['blue', '蓝色连线'],
  ['green', '绿色连线'],
  ['yellow', '黄色连线'],
  ['red', '红色连线'],
  ['purple', '紫色连线'],
] as const;

const widthOptions = [1, 2, 3, 4] as const;

const patternOptions = [
  ['solid', '实线'],
  ['dashed', '虚线'],
  ['dotted', '点线'],
] as const;

const arrowOptions = [
  ['none', '无箭头'],
  ['forward', '正向箭头'],
  ['reverse', '反向箭头'],
  ['both', '双向箭头'],
] as const;

export function EdgeToolbar({
  presentation,
  onChange,
  onClose,
}: {
  presentation: EdgePresentation | undefined;
  onChange: (partial: Partial<EdgePresentation>) => void;
  onClose: () => void;
}) {
  const selectedColor = presentation?.color ?? 'default';
  const selectedWidth = presentation?.width ?? 2;
  const selectedPattern = presentation?.pattern ?? 'solid';
  const selectedArrows = presentation?.arrows ?? 'forward';

  return <section className="edge-toolbar nodrag nopan nowheel" role="toolbar" aria-label="连线样式">
    <fieldset>
      <legend>颜色</legend>
      {colorOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedColor === value} onClick={() => onChange({ color: value })} />)}
    </fieldset>
    <fieldset>
      <legend>粗细</legend>
      {widthOptions.map((value) => <ToolbarOption key={value} label={value + ' 像素'} selected={selectedWidth === value} onClick={() => onChange({ width: value })} />)}
    </fieldset>
    <fieldset>
      <legend>线型</legend>
      {patternOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedPattern === value} onClick={() => onChange({ pattern: value })} />)}
    </fieldset>
    <fieldset>
      <legend>箭头</legend>
      {arrowOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedArrows === value} onClick={() => onChange({ arrows: value })} />)}
    </fieldset>
    <button className="edge-toolbar-close" type="button" aria-label="关闭连线样式" onClick={onClose}>×</button>
  </section>;
}

function ToolbarOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onClick}>{label}</button>;
}

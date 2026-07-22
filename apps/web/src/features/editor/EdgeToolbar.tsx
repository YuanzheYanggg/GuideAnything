import { ArrowRight, LineSegments, Palette, X } from '@phosphor-icons/react';
import { resolveEdgePathStyle, type EdgePathStyle, type EdgePresentation } from '@guideanything/contracts';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { AnimatedList } from '../../components/reactbits/AnimatedList';

const colorInputValueByName = {
  default: '#0a84ff',
  blue: '#4aa6ff',
  green: '#47d57a',
  yellow: '#ffc44c',
  red: '#ff8379',
  purple: '#bc9aff',
} as const;

const MIN_EDGE_WIDTH = 1;
const MAX_EDGE_WIDTH = 24;

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

const pathStyleOptions = [
  ['orthogonal', '折线'],
  ['smooth', '平滑曲线'],
  ['diagonal', '斜线'],
] as const;

type EdgeToolbarMenu = 'width' | 'pattern' | 'pathStyle' | 'arrows' | null;

const menuMeta = {
  width: { trigger: '选择连线粗细', label: '连线粗细' },
  pattern: { trigger: '选择线型', label: '线型' },
  pathStyle: { trigger: '选择画线风格', label: '画线风格' },
  arrows: { trigger: '选择箭头', label: '箭头' },
} as const;

export function EdgeToolbar({
  presentation,
  onChange,
  onClose,
  routeEditing = false,
  manualRouteConflict = false,
  onStartRouteEdit,
  onSaveRouteEdit,
  onCancelRouteEdit,
  onResetRoute,
}: {
  presentation: EdgePresentation | undefined;
  onChange: (partial: Partial<EdgePresentation>) => void;
  onClose: () => void;
  routeEditing?: boolean;
  manualRouteConflict?: boolean;
  onStartRouteEdit?: () => void;
  onSaveRouteEdit?: () => void;
  onCancelRouteEdit?: () => void;
  onResetRoute?: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<EdgeToolbarMenu>(null);
  const selectedColor = presentation?.color ?? 'default';
  const selectedWidth = presentation?.width ?? 2;
  const [widthInput, setWidthInput] = useState(() => String(selectedWidth));
  const selectedPattern = presentation?.pattern ?? 'solid';
  const selectedPathStyle = resolveEdgePathStyle(presentation);
  const selectedArrows = presentation?.arrows ?? 'forward';
  useEffect(() => setWidthInput(String(selectedWidth)), [selectedWidth]);
  const select = (partial: Partial<EdgePresentation>) => {
    onChange(partial);
    setOpenMenu(null);
  };
  const toggleMenu = (menu: Exclude<EdgeToolbarMenu, null>) => setOpenMenu((current) => current === menu ? null : menu);

  return <section
    className="edge-toolbar nodrag nopan nowheel"
    role="toolbar"
    aria-label="连线样式"
    data-size="screen"
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
  >
    <div className="edge-toolbar-group">
      <div className="edge-toolbar-color-trigger edge-toolbar-trigger-color">
        <Palette size={22} weight="bold" aria-hidden="true" />
        <span className="edge-toolbar-trigger-preview"><ColorPreview color={selectedColor} /></span>
        <input aria-label="选择连线颜色" type="color" value={colorPickerValue(selectedColor)} onChange={(event) => onChange({ color: event.target.value })} onKeyDown={(event) => event.stopPropagation()} />
      </div>
    </div>
    <ToolbarDivider />
    <div className="edge-toolbar-group edge-toolbar-group-middle">
      <ToolbarTrigger menu="width" layoutClassName="edge-toolbar-trigger-width" openMenu={openMenu} onToggle={toggleMenu} preview={<WidthPreview width={selectedWidth} />} />
      <ToolbarTrigger menu="pattern" openMenu={openMenu} onToggle={toggleMenu} preview={<span className={`edge-toolbar-pattern-preview is-${selectedPattern}`} aria-hidden="true" />}>
        <LineSegments size={22} weight="bold" aria-hidden="true" />
      </ToolbarTrigger>
    </div>
    <ToolbarDivider />
    <div className="edge-toolbar-group edge-toolbar-group-end">
      <ToolbarTrigger menu="pathStyle" openMenu={openMenu} onToggle={toggleMenu} preview={<PathStylePreview value={selectedPathStyle} />} />
      {routeEditing ? <div className="edge-toolbar-route-actions" role="group" aria-label="编辑连线走向">
        <button type="button" aria-label="保存走向" onClick={onSaveRouteEdit} disabled={manualRouteConflict}>保存</button>
        <button type="button" aria-label="取消编辑" onClick={onCancelRouteEdit}>取消</button>
        <button type="button" aria-label="恢复自动走线" onClick={onResetRoute}>恢复自动</button>
      </div> : <button type="button" className="edge-toolbar-route-edit" aria-label="编辑走向" onClick={onStartRouteEdit}>编辑走向</button>}
      <ToolbarTrigger menu="arrows" openMenu={openMenu} onToggle={toggleMenu} preview={<ArrowPreview value={selectedArrows} />}>
        <ArrowRight size={22} weight="bold" aria-hidden="true" />
      </ToolbarTrigger>
      <button className="edge-toolbar-close" type="button" aria-label="关闭连线样式" onClick={onClose}><X size={22} weight="bold" aria-hidden="true" /></button>
    </div>

    {openMenu === 'width' ? <ToolbarMenu menu="width">
      <label className="edge-toolbar-width-input">
        <WidthPreview width={selectedWidth} label="连线粗细预览" />
        <input
          aria-label="连线粗细数值"
          type="number"
          min={MIN_EDGE_WIDTH}
          max={MAX_EDGE_WIDTH}
          step={1}
          inputMode="numeric"
          value={widthInput}
          onChange={(event) => {
            const next = event.target.value;
            setWidthInput(next);
            const width = Number(next);
            if (next && Number.isInteger(width) && width >= MIN_EDGE_WIDTH && width <= MAX_EDGE_WIDTH) onChange({ width });
          }}
          onBlur={() => {
            const width = Number(widthInput);
            setWidthInput(String(Number.isInteger(width) && width >= MIN_EDGE_WIDTH && width <= MAX_EDGE_WIDTH ? width : selectedWidth));
          }}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <span aria-hidden="true">px</span>
      </label>
    </ToolbarMenu> : null}
    {openMenu === 'pattern' ? <ToolbarMenu menu="pattern">
      {patternOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedPattern === value} onClick={() => select({ pattern: value })}>
        <span className={`edge-toolbar-pattern-preview is-${value}`} aria-hidden="true" />
      </ToolbarOption>)}
    </ToolbarMenu> : null}
    {openMenu === 'pathStyle' ? <ToolbarMenu menu="pathStyle">
      {pathStyleOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedPathStyle === value} onClick={() => select({ pathStyle: value })}>
        <PathStylePreview value={value} />
      </ToolbarOption>)}
    </ToolbarMenu> : null}
    {openMenu === 'arrows' ? <ToolbarMenu menu="arrows">
      {arrowOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedArrows === value} onClick={() => select({ arrows: value })}>
        <ArrowPreview value={value} />
      </ToolbarOption>)}
    </ToolbarMenu> : null}
  </section>;
}

function ToolbarTrigger({ menu, layoutClassName, openMenu, onToggle, preview, children }: {
  menu: Exclude<EdgeToolbarMenu, null>;
  layoutClassName?: string;
  openMenu: EdgeToolbarMenu;
  onToggle: (menu: Exclude<EdgeToolbarMenu, null>) => void;
  preview: ReactNode;
  children?: ReactNode;
}) {
  const meta = menuMeta[menu];
  const isOpen = openMenu === menu;
  return <button
    className={`edge-toolbar-trigger${layoutClassName ? ` ${layoutClassName}` : ''}${isOpen ? ' is-open' : ''}`}
    type="button"
    aria-label={meta.trigger}
    aria-expanded={isOpen}
    aria-controls={`edge-toolbar-menu-${menu}`}
    onClick={() => onToggle(menu)}
  >
    {children}
    <span className="edge-toolbar-trigger-preview">{preview}</span>
  </button>;
}

function ToolbarMenu({ menu, children }: { menu: Exclude<EdgeToolbarMenu, null>; children: ReactNode }) {
  return <div id={`edge-toolbar-menu-${menu}`} className={`edge-toolbar-menu is-${menu}`} role="menu" aria-label={menuMeta[menu].label}>
    <AnimatedList className={`edge-toolbar-menu-list is-${menu}`}>
      {children}
    </AnimatedList>
  </div>;
}

function ToolbarOption({ label, selected, onClick, children }: { label: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} aria-pressed={selected} onClick={onClick}>{children}</button>;
}

function ToolbarDivider() {
  return <span className="edge-toolbar-divider" aria-hidden="true" />;
}

function WidthPreview({ width, label }: { width: number; label?: string }) {
  return <span className="edge-toolbar-width-preview" {...(label ? { 'aria-label': label } : { 'aria-hidden': true })} style={{ '--edge-stroke-width': `${width}px` } as CSSProperties} />;
}

function ColorPreview({ color }: { color: string }) {
  const custom = isCustomColor(color);
  return <span className={`edge-toolbar-color-preview${custom ? ' is-custom' : ` is-${color}`}`} {...(custom ? { style: { backgroundColor: color } } : {})} aria-hidden="true" />;
}

function colorPickerValue(color: string): string {
  return isCustomColor(color) ? color.toLowerCase() : colorInputValueByName[color as keyof typeof colorInputValueByName] ?? colorInputValueByName.default;
}

function isCustomColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}

function ArrowPreview({ value }: { value: typeof arrowOptions[number][0] }) {
  if (value === 'none') return <span className="edge-toolbar-arrow-none" aria-hidden="true" />;
  return <span className={`edge-toolbar-arrow-preview is-${value}`} aria-hidden="true">
    {value === 'both' ? <ArrowRight size={20} weight="bold" className="is-reversed" /> : null}
    <ArrowRight size={20} weight="bold" className={value === 'reverse' ? 'is-reversed' : undefined} />
  </span>;
}

function PathStylePreview({ value }: { value: EdgePathStyle }) {
  const path = value === 'diagonal'
    ? 'M 2 15 L 22 5'
    : value === 'smooth'
      ? 'M 2 15 C 7 15 8 5 13 5 S 18 15 22 5'
      : 'M 2 6 H 10 V 14 H 22';
  return <svg className={`edge-toolbar-path-style-preview is-${value}`} viewBox="0 0 24 20" aria-hidden="true"><path d={path} /></svg>;
}

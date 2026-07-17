import { ArrowRight, LineSegments, Minus, Palette, X } from '@phosphor-icons/react';
import type { EdgePresentation } from '@guideanything/contracts';
import { useState, type ReactNode } from 'react';

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

type EdgeToolbarMenu = 'color' | 'width' | 'pattern' | 'arrows' | null;

const menuMeta = {
  color: { trigger: '选择连线颜色', label: '连线颜色' },
  width: { trigger: '选择连线粗细', label: '连线粗细' },
  pattern: { trigger: '选择线型', label: '线型' },
  arrows: { trigger: '选择箭头', label: '箭头' },
} as const;

export function EdgeToolbar({
  presentation,
  onChange,
  onClose,
}: {
  presentation: EdgePresentation | undefined;
  onChange: (partial: Partial<EdgePresentation>) => void;
  onClose: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<EdgeToolbarMenu>(null);
  const selectedColor = presentation?.color ?? 'default';
  const selectedWidth = presentation?.width ?? 2;
  const selectedPattern = presentation?.pattern ?? 'solid';
  const selectedArrows = presentation?.arrows ?? 'forward';
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
    <ToolbarTrigger menu="color" openMenu={openMenu} onToggle={toggleMenu} preview={<span className={`edge-toolbar-color-preview is-${selectedColor}`} aria-hidden="true" />}>
      <Palette size={22} weight="bold" aria-hidden="true" />
    </ToolbarTrigger>
    <ToolbarDivider />
    <ToolbarTrigger menu="width" openMenu={openMenu} onToggle={toggleMenu} preview={<span className={`edge-toolbar-width-preview is-${selectedWidth}`} aria-hidden="true" />}>
      <Minus size={22} weight="bold" aria-hidden="true" />
    </ToolbarTrigger>
    <ToolbarTrigger menu="pattern" openMenu={openMenu} onToggle={toggleMenu} preview={<span className={`edge-toolbar-pattern-preview is-${selectedPattern}`} aria-hidden="true" />}>
      <LineSegments size={22} weight="bold" aria-hidden="true" />
    </ToolbarTrigger>
    <ToolbarDivider />
    <ToolbarTrigger menu="arrows" openMenu={openMenu} onToggle={toggleMenu} preview={<ArrowPreview value={selectedArrows} />}>
      <ArrowRight size={22} weight="bold" aria-hidden="true" />
    </ToolbarTrigger>
    <button className="edge-toolbar-close" type="button" aria-label="关闭连线样式" onClick={onClose}><X size={22} weight="bold" aria-hidden="true" /></button>

    {openMenu === 'color' ? <ToolbarMenu menu="color">
      {colorOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedColor === value} onClick={() => select({ color: value })}>
        <span className={`edge-toolbar-swatch is-${value}`} aria-hidden="true" />
      </ToolbarOption>)}
    </ToolbarMenu> : null}
    {openMenu === 'width' ? <ToolbarMenu menu="width">
      {widthOptions.map((value) => <ToolbarOption key={value} label={value + ' 像素'} selected={selectedWidth === value} onClick={() => select({ width: value })}>
        <span className={`edge-toolbar-width-preview is-${value}`} aria-hidden="true" />
      </ToolbarOption>)}
    </ToolbarMenu> : null}
    {openMenu === 'pattern' ? <ToolbarMenu menu="pattern">
      {patternOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedPattern === value} onClick={() => select({ pattern: value })}>
        <span className={`edge-toolbar-pattern-preview is-${value}`} aria-hidden="true" />
      </ToolbarOption>)}
    </ToolbarMenu> : null}
    {openMenu === 'arrows' ? <ToolbarMenu menu="arrows">
      {arrowOptions.map(([value, label]) => <ToolbarOption key={value} label={label} selected={selectedArrows === value} onClick={() => select({ arrows: value })}>
        <ArrowPreview value={value} />
      </ToolbarOption>)}
    </ToolbarMenu> : null}
  </section>;
}

function ToolbarTrigger({ menu, openMenu, onToggle, preview, children }: {
  menu: Exclude<EdgeToolbarMenu, null>;
  openMenu: EdgeToolbarMenu;
  onToggle: (menu: Exclude<EdgeToolbarMenu, null>) => void;
  preview: ReactNode;
  children: ReactNode;
}) {
  const meta = menuMeta[menu];
  const isOpen = openMenu === menu;
  return <button
    className={`edge-toolbar-trigger${isOpen ? ' is-open' : ''}`}
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
    {children}
  </div>;
}

function ToolbarOption({ label, selected, onClick, children }: { label: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} aria-pressed={selected} onClick={onClick}>{children}</button>;
}

function ToolbarDivider() {
  return <span className="edge-toolbar-divider" aria-hidden="true" />;
}

function ArrowPreview({ value }: { value: typeof arrowOptions[number][0] }) {
  if (value === 'none') return <span className="edge-toolbar-arrow-none" aria-hidden="true" />;
  return <span className={`edge-toolbar-arrow-preview is-${value}`} aria-hidden="true">
    {value === 'both' ? <ArrowRight size={20} weight="bold" className="is-reversed" /> : null}
    <ArrowRight size={20} weight="bold" className={value === 'reverse' ? 'is-reversed' : undefined} />
  </span>;
}

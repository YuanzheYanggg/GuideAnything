import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AnimatedList } from '../../components/reactbits/AnimatedList';
import { BorderGlow } from '../../components/reactbits/BorderGlow';

export type CanvasCreationKind = 'process' | 'decision' | 'data' | 'end' | 'markdown' | 'image' | 'video';

const primaryChoices: Array<{ kind: CanvasCreationKind; label: string }> = [
  { kind: 'process', label: '创建流程节点' },
  { kind: 'decision', label: '创建判断节点' },
  { kind: 'data', label: '创建数据节点' },
  { kind: 'end', label: '创建结束节点' },
];

const resourceChoices: Array<{ kind: CanvasCreationKind; label: string }> = [
  { kind: 'markdown', label: '创建说明资料' },
  { kind: 'image', label: '创建图片资料' },
  { kind: 'video', label: '创建视频资料' },
];

export function CanvasCreationMenu({ position, allowResources, onCreate, onCancel }: { position: { x: number; y: number }; allowResources: boolean; onCreate: (kind: CanvasCreationKind) => void; onCancel: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'below' | 'above'>('below');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const container = menu?.offsetParent;
    if (!menu || !container) return;
    const nextPlacement = position.y + menu.offsetHeight + 20 > container.clientHeight ? 'above' : 'below';
    const maxLeft = Math.max(8, container.clientWidth - menu.offsetWidth - 8);
    const nextPosition = {
      x: Math.min(Math.max(8, position.x), maxLeft),
      y: nextPlacement === 'above' ? Math.max(position.y, menu.offsetHeight + 24) : Math.max(8, position.y),
    };
    setPlacement((current) => current === nextPlacement ? current : nextPlacement);
    menu.style.left = `${nextPosition.x}px`;
    menu.style.top = `${nextPosition.y}px`;
  }, [allowResources, position.x, position.y]);

  return <BorderGlow ref={menuRef} className={`canvas-creation-menu${placement === 'above' ? ' canvas-creation-menu--above' : ''}`} active tone="accent" role="menu" aria-label="创建下一项" style={{ left: position.x, top: position.y }}>
    <span className="canvas-overlay-title">从这里创建</span>
    <AnimatedList className="canvas-menu-list">
      {primaryChoices.map((choice) => <button type="button" role="menuitem" key={choice.kind} onClick={() => onCreate(choice.kind)}>{choice.label}</button>)}
    </AnimatedList>
    {allowResources ? <><span className="canvas-overlay-divider" /><span className="canvas-overlay-title">引用资料</span><AnimatedList className="canvas-menu-list">
      {resourceChoices.map((choice) => <button type="button" role="menuitem" key={choice.kind} onClick={() => onCreate(choice.kind)}>{choice.label}</button>)}
    </AnimatedList></> : null}
    <button type="button" role="menuitem" className="canvas-menu-cancel" onClick={onCancel}>取消</button>
  </BorderGlow>;
}

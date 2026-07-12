import { useEffect } from 'react';

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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return <div className="canvas-creation-menu" role="menu" aria-label="创建下一项" style={{ left: position.x, top: position.y }}>
    <span className="canvas-overlay-title">从这里创建</span>
    {primaryChoices.map((choice) => <button type="button" role="menuitem" key={choice.kind} onClick={() => onCreate(choice.kind)}>{choice.label}</button>)}
    {allowResources ? <><span className="canvas-overlay-divider" /><span className="canvas-overlay-title">挂靠资料</span>{resourceChoices.map((choice) => <button type="button" role="menuitem" key={choice.kind} onClick={() => onCreate(choice.kind)}>{choice.label}</button>)}</> : null}
    <button type="button" role="menuitem" className="canvas-menu-cancel" onClick={onCancel}>取消</button>
  </div>;
}

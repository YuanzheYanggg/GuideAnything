import { normalizeAnnotationOrder } from '@guideanything/canvas-core';
import type { CanvasNode, ImageAnnotation } from '@guideanything/contracts';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { useMediaSource } from '../nodes/useMediaSource';

type Tool = 'POINT' | 'RECT';

export function ImageAnnotationEditor({ node, nodes, onChange, onClose }: {
  node: CanvasNode<'image'>;
  nodes: CanvasNode[];
  onChange: (data: CanvasNode<'image'>['data']) => void;
  onClose: () => void;
}) {
  const annotations = useMemo(() => normalizeAnnotationOrder(node.data.annotations ?? []), [node.data.annotations]);
  const [selectedId, setSelectedId] = useState<string | null>(annotations[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>('POINT');
  const [zoom, setZoom] = useState(2.5);
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const source = useMediaSource(node.data.url);
  const selectedIndex = annotations.findIndex((annotation) => annotation.id === selectedId);
  const selected = selectedIndex >= 0 ? annotations[selectedIndex]! : null;

  useEffect(() => {
    setTitleDraft(selected?.title ?? '');
    setBodyDraft(selected?.body ?? '');
  }, [selected?.body, selected?.id, selected?.title]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  const updateAnnotations = (next: ImageAnnotation[]) => onChange({ ...node.data, annotations: normalizeAnnotationOrder(next) });
  const updateSelected = (changes: Partial<ImageAnnotation>) => {
    if (!selected) return;
    updateAnnotations(annotations.map((annotation) => annotation.id === selected.id ? { ...annotation, ...changes } as ImageAnnotation : annotation));
  };
  const create = (annotation: ImageAnnotation) => {
    updateAnnotations([...annotations, annotation]);
    setSelectedId(annotation.id);
  };
  const commitText = () => {
    if (!selected) return;
    updateSelected({ title: titleDraft.trim() || '新标注', ...(bodyDraft.trim() ? { body: bodyDraft } : { body: undefined }) });
  };

  const handlePoint = (event: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'POINT' || event.target !== event.currentTarget) return;
    const point = normalizedPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    create({ id: uniqueId('annotation'), order: annotations.length, title: '新标注', shape: 'POINT', region: point });
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'RECT' || event.target !== event.currentTarget) return;
    dragStartRef.current = normalizedPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (tool !== 'RECT' || !start) return;
    const finish = normalizedPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    const x = Math.min(start.x, finish.x);
    const y = Math.min(start.y, finish.y);
    const width = Math.abs(finish.x - start.x);
    const height = Math.abs(finish.y - start.y);
    if (width < 0.01 || height < 0.01) return;
    create({ id: uniqueId('annotation'), order: annotations.length, title: '新标注', shape: 'RECT', region: { x, y, width, height } });
  };

  return <div className="modal-backdrop annotation-editor-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="annotation-editor" role="dialog" aria-modal="true" aria-label="图片标注编辑器">
      <header><div><span className="eyebrow">IMAGE WALKTHROUGH</span><h2>图片标注编辑器</h2></div><button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭图片标注编辑器">×</button></header>
      <div className="annotation-toolbar" role="toolbar" aria-label="标注工具">
        <button type="button" className={tool === 'POINT' ? 'active' : ''} aria-pressed={tool === 'POINT'} onClick={() => setTool('POINT')} aria-label="点标注">编号点</button>
        <button type="button" className={tool === 'RECT' ? 'active' : ''} aria-pressed={tool === 'RECT'} onClick={() => setTool('RECT')} aria-label="矩形标注">矩形区域</button>
        <label>镜头缩放<input aria-label="镜头缩放" type="range" min="1" max="8" step="0.5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      </div>
      <div className="annotation-editor-layout">
        <div className="annotation-stage">
          {source ? <div className="annotation-image-frame">
            <img src={source} alt={node.data.alt} />
            <div data-testid="annotation-surface" className={`annotation-surface tool-${tool.toLowerCase()}`} onClick={handlePoint} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}>
              {annotations.map((annotation, index) => <button
                key={annotation.id}
                type="button"
                className={`annotation-marker shape-${annotation.shape.toLowerCase()}${annotation.id === selectedId ? ' active' : ''}`}
                style={markerStyle(annotation)}
                onClick={(event) => { event.stopPropagation(); setSelectedId(annotation.id); }}
                aria-label={`选择标注 ${index + 1} ${annotation.title}`}
              ><span>{index + 1}</span></button>)}
            </div>
          </div> : <p>图片载入失败</p>}
        </div>
        <aside className="annotation-panel" aria-label="标注列表与属性">
          <div className="annotation-list">
            {annotations.length === 0 ? <p>点击图片添加第一个编号点。</p> : annotations.map((annotation, index) => <div key={annotation.id} className={annotation.id === selectedId ? 'active' : ''}>
              <button type="button" onClick={() => setSelectedId(annotation.id)} aria-label={`选择标注 ${index + 1} ${annotation.title}`}><span>{index + 1}</span>{annotation.title}</button>
              <button type="button" disabled={index === 0} onClick={() => moveAnnotation(annotations, index, -1, updateAnnotations)} aria-label={`上移标注 ${index + 1}`}>↑</button>
              <button type="button" disabled={index === annotations.length - 1} onClick={() => moveAnnotation(annotations, index, 1, updateAnnotations)} aria-label={`下移标注 ${index + 1}`}>↓</button>
            </div>)}
          </div>
          {selected ? <div className="annotation-fields">
            <strong>标注 {selectedIndex + 1}</strong>
            <label>标题<input aria-label={`标注 ${selectedIndex + 1} 标题`} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={commitText} /></label>
            <label>说明<textarea aria-label={`标注 ${selectedIndex + 1} 说明`} value={bodyDraft} onChange={(event) => setBodyDraft(event.target.value)} onBlur={commitText} /></label>
            <label>关联目标<select aria-label={`标注 ${selectedIndex + 1} 关联目标`} value={selected.targetNodeId ?? ''} onChange={(event) => updateSelected({ targetNodeId: event.target.value || undefined })}><option value="">不关联</option>{nodes.filter((candidate) => candidate.id !== node.id && !candidate.hidden).map((candidate) => <option key={candidate.id} value={candidate.id}>{nodeTitle(candidate)}</option>)}</select></label>
            <button type="button" onClick={() => updateSelected({ camera: { centerX: annotationCenter(selected).x, centerY: annotationCenter(selected).y, zoom } })} aria-label="保存当前镜头">保存当前镜头</button>
            {selected.camera ? <button type="button" onClick={() => updateSelected({ camera: undefined })}>清除镜头</button> : null}
            <button className="danger-button" type="button" onClick={() => { const next = annotations.filter((annotation) => annotation.id !== selected.id); updateAnnotations(next); setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id ?? null); }} aria-label={`删除标注 ${selectedIndex + 1}`}>删除标注</button>
          </div> : null}
        </aside>
      </div>
    </section>
  </div>;
}

function normalizedPoint(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

function markerStyle(annotation: ImageAnnotation): CSSProperties {
  const { x, y, width, height } = annotation.region;
  return {
    left: `${x * 100}%`, top: `${y * 100}%`,
    ...(annotation.shape === 'RECT' && width !== undefined && height !== undefined ? { width: `${width * 100}%`, height: `${height * 100}%` } : {}),
  };
}

function annotationCenter(annotation: ImageAnnotation): { x: number; y: number } {
  return { x: annotation.region.x + (annotation.region.width ?? 0) / 2, y: annotation.region.y + (annotation.region.height ?? 0) / 2 };
}

function moveAnnotation(annotations: ImageAnnotation[], index: number, direction: -1 | 1, update: (next: ImageAnnotation[]) => void) {
  const next = [...annotations];
  const target = index + direction;
  if (target < 0 || target >= next.length) return;
  [next[index], next[target]] = [next[target]!, next[index]!];
  update(next.map((annotation, order) => ({ ...annotation, order })));
}

function nodeTitle(node: CanvasNode): string {
  if (node.type === 'markdown') return `说明 · ${node.data.markdown.split('\n')[0]?.replace(/^#+\s*/, '') || node.id}`;
  if (node.type === 'image') return `图片 · ${node.data.caption || node.data.alt}`;
  if (node.type === 'video') return `视频 · ${node.data.caption || node.id}`;
  if (node.type === 'subguide') return `子指南 · ${node.data.title}`;
  return `${node.data.label}`;
}

function uniqueId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

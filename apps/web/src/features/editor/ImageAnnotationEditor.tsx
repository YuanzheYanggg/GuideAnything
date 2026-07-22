import { normalizeAnnotationOrder } from '@guideanything/canvas-core';
import type { CanvasNode, ImageAnnotation, ImageAnnotationSupplement } from '@guideanything/contracts';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { useMediaSource } from '../nodes/useMediaSource';
import { EditorDialogSurface } from './EditorDialogSurface';

type Tool = 'POINT' | 'RECT';

export function ImageAnnotationEditor({ node, nodes, focusAnnotationId, onChange, onUploadSupplement, onClose }: {
  node: CanvasNode<'image'>;
  nodes: CanvasNode[];
  focusAnnotationId?: string;
  onChange: (data: CanvasNode<'image'>['data']) => void;
  onUploadSupplement: (file: File) => Promise<{ assetId: string; url: string; alt: string }>;
  onClose: () => void;
}) {
  const annotations = useMemo(() => normalizeAnnotationOrder(node.data.annotations ?? []), [node.data.annotations]);
  const [selectedId, setSelectedId] = useState<string | null>(() => preferredAnnotationId(annotations, focusAnnotationId));
  const [tool, setTool] = useState<Tool>('POINT');
  const [zoom, setZoom] = useState(2.5);
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [supplementError, setSupplementError] = useState('');
  const [supplementUploading, setSupplementUploading] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const source = useMediaSource(node.data.url);
  const selectedIndex = annotations.findIndex((annotation) => annotation.id === selectedId);
  const selected = selectedIndex >= 0 ? annotations[selectedIndex]! : null;

  onCloseRef.current = onClose;

  useEffect(() => {
    setTitleDraft(selected?.title ?? '');
    setBodyDraft(selected?.body ?? '');
  }, [selected?.body, selected?.id, selected?.title]);

  useEffect(() => {
    const preferred = preferredAnnotationId(annotations, focusAnnotationId);
    if (focusAnnotationId && preferred) setSelectedId(preferred);
  }, [annotations, focusAnnotationId]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus();
    };
  }, []);

  const updateAnnotations = (next: ImageAnnotation[]) => onChange({ ...node.data, annotations: normalizeAnnotationOrder(next) });
  const updateSelected = (changes: Partial<ImageAnnotation>) => {
    if (!selected) return;
    updateAnnotations(annotations.map((annotation) => annotation.id === selected.id ? { ...annotation, ...changes } as ImageAnnotation : annotation));
  };
  const updateSelectedSupplements = (supplements: ImageAnnotationSupplement[]) => {
    updateSelected({ supplementalImages: normalizeSupplements(supplements) });
  };
  const create = (annotation: ImageAnnotation) => {
    updateAnnotations([...annotations, annotation]);
    setSelectedId(annotation.id);
  };
  const commitText = () => {
    if (!selected) return;
    updateSelected({ title: titleDraft.trim() || '新标注', ...(bodyDraft.trim() ? { body: bodyDraft } : { body: undefined }) });
  };
  const uploadSupplement = async (file: File | undefined) => {
    if (!file || !selected || supplementUploading) return;
    if (!file.type.startsWith('image/')) {
      setSupplementError('仅支持图片文件。');
      return;
    }
    const current = normalizeSupplements(selected.supplementalImages ?? []);
    if (current.length >= 8) {
      setSupplementError('每条标注最多上传 8 张补充图。');
      return;
    }
    setSupplementUploading(true);
    setSupplementError('');
    try {
      const media = await onUploadSupplement(file);
      updateSelectedSupplements([...current, {
        id: uniqueId('annotation-supplement'),
        order: current.length,
        assetId: media.assetId,
        url: media.url,
        alt: media.alt,
      }]);
    } catch (reason) {
      setSupplementError(reason instanceof Error ? reason.message : '补充图上传失败');
    } finally {
      setSupplementUploading(false);
    }
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

  return <EditorDialogSurface
    className="annotation-editor"
    backdropClassName="annotation-editor-backdrop"
    ariaLabel="图片标注编辑器"
    closeLabel="关闭图片标注编辑器"
    closeButtonRef={closeButtonRef}
    closeOnBackdrop
    onClose={onClose}
  >
      <header><div><span className="eyebrow">IMAGE WALKTHROUGH</span><h2>图片标注编辑器</h2></div></header>
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
            <section className="annotation-supplements" aria-label="步骤补充图">
              <div><strong>步骤补充图</strong><span>{selected.supplementalImages?.length ?? 0} / 8</span></div>
              <label className="annotation-supplement-upload">上传步骤补充图<input aria-label="上传步骤补充图" type="file" accept="image/*" disabled={supplementUploading || (selected.supplementalImages?.length ?? 0) >= 8} onChange={(event) => { void uploadSupplement(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
              {supplementError ? <p className="error-message" role="alert">{supplementError}</p> : null}
              {normalizeSupplements(selected.supplementalImages ?? []).map((supplement, index, supplements) => <article key={supplement.id} className="annotation-supplement-item">
                <AnnotationSupplementThumbnail supplement={supplement} />
                <div>
                  <label>说明<textarea aria-label={`补充图 ${index + 1} 说明`} defaultValue={supplement.caption ?? ''} onBlur={(event) => updateSelectedSupplements(supplements.map((item) => item.id === supplement.id ? { ...item, ...(event.target.value.trim() ? { caption: event.target.value } : { caption: undefined }) } : item))} /></label>
                  <div className="annotation-supplement-actions">
                    <button type="button" disabled={index === 0} onClick={() => updateSelectedSupplements(moveSupplement(supplements, index, -1))} aria-label={`上移补充图 ${index + 1}`}>↑</button>
                    <button type="button" disabled={index === supplements.length - 1} onClick={() => updateSelectedSupplements(moveSupplement(supplements, index, 1))} aria-label={`下移补充图 ${index + 1}`}>↓</button>
                    <button type="button" onClick={() => updateSelectedSupplements(supplements.filter((item) => item.id !== supplement.id))} aria-label={`移除补充图 ${index + 1}`}>移除</button>
                  </div>
                </div>
              </article>)}
            </section>
            <button className="danger-button" type="button" onClick={() => { const next = annotations.filter((annotation) => annotation.id !== selected.id); updateAnnotations(next); setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id ?? null); }} aria-label={`删除标注 ${selectedIndex + 1}`}>删除标注</button>
          </div> : null}
        </aside>
      </div>
  </EditorDialogSurface>;
}

function normalizedPoint(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

function preferredAnnotationId(annotations: ImageAnnotation[], focusAnnotationId?: string): string | null {
  if (focusAnnotationId && annotations.some((annotation) => annotation.id === focusAnnotationId)) return focusAnnotationId;
  return annotations[0]?.id ?? null;
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

function normalizeSupplements(supplements: ImageAnnotationSupplement[]): ImageAnnotationSupplement[] {
  return [...supplements]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((supplement, order) => ({ ...supplement, order }));
}

function moveSupplement(supplements: ImageAnnotationSupplement[], index: number, direction: -1 | 1): ImageAnnotationSupplement[] {
  const next = [...supplements];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return normalizeSupplements(next);
}

function AnnotationSupplementThumbnail({ supplement }: { supplement: ImageAnnotationSupplement }) {
  const source = useMediaSource(supplement.url);
  return source ? <img src={source} alt={supplement.alt} /> : <span className="annotation-supplement-loading">载入图片…</span>;
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

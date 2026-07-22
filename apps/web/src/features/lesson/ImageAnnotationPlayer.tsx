import { cameraForAnnotation, normalizeAnnotationOrder } from '@guideanything/canvas-core';
import type { CanvasNode, ImageAnnotationSupplement } from '@guideanything/contracts';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { useMediaSource } from '../nodes/useMediaSource';

export function ImageAnnotationPlayer({ source, data, initialIndex, initialAnnotationId, isTargetValid, onOpenTarget, onOpenSupplement }: {
  source: string;
  data: CanvasNode<'image'>['data'];
  initialIndex?: number;
  initialAnnotationId?: string;
  isTargetValid: (targetNodeId: string) => boolean;
  onOpenTarget: (targetNodeId: string, annotationIndex: number) => void;
  onOpenSupplement?: (supplement: ImageAnnotationSupplement, annotationIndex: number) => void;
}) {
  const annotations = useMemo(() => normalizeAnnotationOrder(data.annotations ?? []), [data.annotations]);
  const initialAnnotationIndex = useMemo(() => {
    if (initialAnnotationId !== undefined) {
      const index = annotations.findIndex((annotation) => annotation.id === initialAnnotationId);
      return index >= 0 ? index : null;
    }
    return initialIndex !== undefined && initialIndex >= 0 && initialIndex < annotations.length ? initialIndex : null;
  }, [annotations, initialAnnotationId, initialIndex]);
  const [activeIndex, setActiveIndex] = useState<number | null>(() => initialAnnotationIndex);
  const [autoplay, setAutoplay] = useState(false);
  const reducedMotion = useReducedMotion();
  const active = activeIndex === null ? null : annotations[activeIndex] ?? null;
  const camera = active ? cameraForAnnotation(active) : { centerX: 0.5, centerY: 0.5, zoom: 1 };

  useEffect(() => {
    setActiveIndex(initialAnnotationIndex);
    setAutoplay(false);
  }, [initialAnnotationIndex]);

  useEffect(() => {
    if (!autoplay || activeIndex === null) return undefined;
    if (activeIndex >= annotations.length - 1) {
      setAutoplay(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setActiveIndex((index) => index === null ? 0 : Math.min(annotations.length - 1, index + 1)), 4_000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, annotations.length, autoplay]);

  const navigate = (index: number) => {
    setAutoplay(false);
    setActiveIndex(Math.max(0, Math.min(annotations.length - 1, index)));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeIndex === null || annotations.length === 0) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigate(activeIndex - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigate(activeIndex + 1);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, annotations.length]);

  return <div className="image-annotation-player">
    <div className="annotation-player-viewport">
      <div
        data-testid="annotation-camera"
        className={`annotation-player-camera annotation-image-frame${reducedMotion ? ' reduce-motion' : ''}`}
        style={cameraStyle(camera)}
      >
        <img src={source} alt={data.alt} />
      </div>
      {annotations.length > 0 && activeIndex === null ? <button className="annotation-start" type="button" onClick={() => setActiveIndex(0)} aria-label="开始图片讲解">开始讲解 · {annotations.length} 个标注</button> : null}
    </div>
    {active ? <aside className="annotation-player-card" aria-live="polite">
      <div><span>讲解 {activeIndex! + 1} / {annotations.length}</span><button type="button" aria-pressed={autoplay} onClick={() => setAutoplay((value) => !value)} aria-label="自动播放">自动播放</button></div>
      <h3>{active.title}</h3>
      {active.body ? <p>{active.body}</p> : null}
      {active.supplementalImages?.length ? <div className="annotation-player-supplements" aria-label="步骤补充图">
        {active.supplementalImages
          .slice()
          .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
          .map((supplement) => <button key={supplement.id} type="button" onClick={() => onOpenSupplement?.(supplement, activeIndex!)} aria-label={`打开补充图 ${supplement.alt}`}>
            <AnnotationSupplementThumbnail supplement={supplement} />
            <span>{supplement.caption || supplement.alt}</span>
          </button>)}
      </div> : null}
      {active.targetNodeId ? isTargetValid(active.targetNodeId)
        ? <button className="primary-button" type="button" onClick={() => onOpenTarget(active.targetNodeId!, activeIndex!)} aria-label="查看关联资料">查看关联资料</button>
        : <button type="button" disabled aria-label="关联资料已失效">关联资料已失效</button>
        : null}
      <div className="annotation-player-navigation"><button type="button" disabled={activeIndex === 0} onClick={() => navigate(activeIndex! - 1)} aria-label="上一个标注">上一个</button><button type="button" disabled={activeIndex === annotations.length - 1} onClick={() => navigate(activeIndex! + 1)} aria-label="下一个标注">下一个</button></div>
    </aside> : data.caption ? <p className="media-lightbox-caption">{data.caption}</p> : null}
  </div>;
}

function cameraStyle(camera: { centerX: number; centerY: number; zoom: number }): CSSProperties {
  const translateX = ((0.5 - camera.centerX) * 100) / camera.zoom;
  const translateY = ((0.5 - camera.centerY) * 100) / camera.zoom;
  return {
    transformOrigin: `${camera.centerX * 100}% ${camera.centerY * 100}%`,
    transform: `scale(${camera.zoom}) translate(${translateX}%, ${translateY}%)`,
  };
}

function AnnotationSupplementThumbnail({ supplement }: { supplement: ImageAnnotationSupplement }) {
  const source = useMediaSource(supplement.url);
  return source ? <img src={source} alt={supplement.alt} /> : <span aria-hidden="true">载入中…</span>;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

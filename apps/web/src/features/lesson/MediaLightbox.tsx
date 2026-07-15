import type { CanvasNode } from '@guideanything/contracts';
import { useEffect, useRef } from 'react';

import { MarkdownNodeView } from '../nodes/MarkdownNode';
import { VideoNodeView } from '../nodes/VideoNode';
import { useMediaSource } from '../nodes/useMediaSource';
import { ImageAnnotationPlayer } from './ImageAnnotationPlayer';

export type MediaPreview =
  | { kind: 'image'; node: CanvasNode<'image'>; initialAnnotationIndex?: number }
  | { kind: 'video'; node: CanvasNode<'video'> }
  | { kind: 'markdown'; node: CanvasNode<'markdown'> }
  | { kind: 'flow'; node: CanvasNode<'start' | 'end' | 'process' | 'decision' | 'data'> }
  | { kind: 'subguide'; node: CanvasNode<'subguide'> };

export function MediaLightbox({ preview, onClose, onBack, onOpenTarget, isTargetValid, onActivateNode }: {
  preview: MediaPreview;
  onClose: () => void;
  onBack?: () => void;
  onOpenTarget: (targetNodeId: string, annotationIndex: number) => void;
  isTargetValid: (targetNodeId: string) => boolean;
  onActivateNode?: (node: CanvasNode) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return <div className="media-lightbox-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="media-lightbox" role="dialog" aria-modal="true" aria-label="资料预览">
      <div className="media-lightbox-actions">{onBack ? <button type="button" onClick={onBack} aria-label="返回上一项资料">←</button> : null}<button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭资料预览">×</button></div>
      <PreviewContent preview={preview} onOpenTarget={onOpenTarget} isTargetValid={isTargetValid} {...(onActivateNode ? { onActivateNode } : {})} />
    </div>
  </div>;
}

function PreviewContent({ preview, onOpenTarget, isTargetValid, onActivateNode }: {
  preview: MediaPreview;
  onOpenTarget: (targetNodeId: string, annotationIndex: number) => void;
  isTargetValid: (targetNodeId: string) => boolean;
  onActivateNode?: (node: CanvasNode) => void;
}) {
  if (preview.kind === 'image') return <ImagePreview preview={preview} onOpenTarget={onOpenTarget} isTargetValid={isTargetValid} />;
  if (preview.kind === 'video') return <VideoPreview node={preview.node} />;
  if (preview.kind === 'markdown') return <div className="linked-resource-preview"><MarkdownNodeView data={preview.node.data} /></div>;
  if (preview.kind === 'subguide') return <div className="linked-resource-preview"><span className="eyebrow">PINNED SUBGUIDE</span><h3>{preview.node.data.title}</h3><p>固定发布版本 v{preview.node.data.version}</p>{onActivateNode ? <button className="primary-button" type="button" onClick={() => onActivateNode(preview.node)}>打开子指南</button> : null}</div>;
  return <div className="linked-resource-preview"><span className="eyebrow">FLOW STEP</span><h3>{preview.node.data.label}</h3>{preview.node.data.description ? <p>{preview.node.data.description}</p> : null}{onActivateNode ? <button className="primary-button" type="button" onClick={() => onActivateNode(preview.node)}>前往对应步骤</button> : null}</div>;
}

function ImagePreview({ preview, onOpenTarget, isTargetValid }: {
  preview: Extract<MediaPreview, { kind: 'image' }>;
  onOpenTarget: (targetNodeId: string, annotationIndex: number) => void;
  isTargetValid: (targetNodeId: string) => boolean;
}) {
  const source = useMediaSource(preview.node.data.url);
  if (!source) return <p className="error-message">图片载入失败</p>;
  if ((preview.node.data.annotations?.length ?? 0) === 0) return <figure className="plain-image-preview"><img src={source} alt={preview.node.data.alt} />{preview.node.data.caption ? <figcaption>{preview.node.data.caption}</figcaption> : null}</figure>;
  return <ImageAnnotationPlayer source={source} data={preview.node.data} {...(preview.initialAnnotationIndex !== undefined ? { initialIndex: preview.initialAnnotationIndex } : {})} isTargetValid={isTargetValid} onOpenTarget={onOpenTarget} />;
}

function VideoPreview({ node }: { node: CanvasNode<'video'> }) {
  return <VideoNodeView data={node.data} />;
}

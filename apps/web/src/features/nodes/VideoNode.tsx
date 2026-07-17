import type { CanvasNode } from '@guideanything/contracts';
import type { NodeProps } from '@xyflow/react';
import { memo, useRef, type ReactNode } from 'react';

import { NodeChrome } from './NodeChrome';
import { InlineNodeTextEditor } from './InlineNodeTextEditor';
import { useMediaSource } from './useMediaSource';

export function VideoNodeView({ data, onKeypoint, captionContent, onOpenPreview, mediaSource }: {
  data: CanvasNode<'video'>['data'];
  onKeypoint?: (id: string) => void;
  captionContent?: ReactNode;
  onOpenPreview?: (source: string) => void;
  mediaSource?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const resolvedSource = useMediaSource(data.url);
  const source = mediaSource ?? resolvedSource;
  const seek = (id: string, seconds: number) => {
    if (videoRef.current) videoRef.current.currentTime = seconds;
    onKeypoint?.(id);
  };
  return <div className="video-content">
    <video ref={videoRef} src={source} controls preload="metadata" aria-label={data.caption || '教学视频'} onClick={() => { if (source) onOpenPreview?.(source); }} />
    {captionContent ?? (data.caption ? <p>{data.caption}</p> : null)}
    <div className="keypoint-list">{data.keypoints.map((point) => <button key={point.id} type="button" onClick={() => seek(point.id, point.timeSeconds)} aria-label={`跳转到 ${formatTime(point.timeSeconds)}`}><span>{formatTime(point.timeSeconds)}</span>{point.title}</button>)}</div>
  </div>;
}

export const VideoNode = memo(function VideoNode({ id, data, selected, width, height }: NodeProps) {
  const value = data as CanvasNode<'video'>['data'];
  const label = value.caption || '教学视频';
  return <NodeChrome nodeId={id} selected={selected} tone="video" width={width} height={height}><span className="node-kicker">VIDEO</span><VideoNodeView data={value} captionContent={<InlineNodeTextEditor nodeId={id} field="videoCaption" value={value.caption ?? ''} label={`${label} · 视频说明`} multiline placeholder="双击添加视频说明" showPlaceholder={Boolean(selected)}>{value.caption ? <p>{value.caption}</p> : null}</InlineNodeTextEditor>} /></NodeChrome>;
});

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remaining = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remaining}`;
}

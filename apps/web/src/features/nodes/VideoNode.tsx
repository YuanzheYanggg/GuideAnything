import type { CanvasNode } from '@guideanything/contracts';
import type { NodeProps } from '@xyflow/react';
import { memo, useRef } from 'react';

import { NodeChrome } from './NodeChrome';
import { useMediaSource } from './useMediaSource';

export function VideoNodeView({ data, onKeypoint }: { data: CanvasNode<'video'>['data']; onKeypoint?: (id: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = useMediaSource(data.url);
  const seek = (id: string, seconds: number) => {
    if (videoRef.current) videoRef.current.currentTime = seconds;
    onKeypoint?.(id);
  };
  return <div className="video-content">
    <video ref={videoRef} src={source} controls preload="metadata" aria-label={data.caption || '教学视频'} />
    {data.caption ? <p>{data.caption}</p> : null}
    <div className="keypoint-list">{data.keypoints.map((point) => <button key={point.id} type="button" onClick={() => seek(point.id, point.timeSeconds)} aria-label={`跳转到 ${formatTime(point.timeSeconds)}`}><span>{formatTime(point.timeSeconds)}</span>{point.title}</button>)}</div>
  </div>;
}

export const VideoNode = memo(function VideoNode({ data, selected }: NodeProps) {
  return <NodeChrome selected={selected} tone="video"><span className="node-kicker">VIDEO</span><VideoNodeView data={data as CanvasNode<'video'>['data']} /></NodeChrome>;
});

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remaining = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remaining}`;
}

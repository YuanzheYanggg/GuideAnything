import type { CanvasNode } from '@guideanything/contracts';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { NodeChrome } from './NodeChrome';
import { useMediaSource } from './useMediaSource';

export const ImageNode = memo(function ImageNode({ data, selected, width, height }: NodeProps) {
  const value = data as CanvasNode<'image'>['data'];
  const source = useMediaSource(value.url);
  return <NodeChrome selected={selected} tone="image" width={width} height={height}><span className="node-kicker">IMAGE</span>{source ? <img src={source} alt={value.alt} loading="lazy" /> : <p>图片载入失败</p>}{value.caption ? <p>{value.caption}</p> : null}</NodeChrome>;
});

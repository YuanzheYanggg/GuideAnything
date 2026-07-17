import type { CanvasNode } from '@guideanything/contracts';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { NodeChrome } from './NodeChrome';
import { InlineNodeTextEditor } from './InlineNodeTextEditor';
import { useMediaSource } from './useMediaSource';

export const ImageNode = memo(function ImageNode({ id, data, selected, width, height }: NodeProps) {
  const value = data as CanvasNode<'image'>['data'];
  const source = useMediaSource(value.url);
  const summary = imageAnnotationSummary(value);
  return <NodeChrome nodeId={id} selected={selected} tone="image" width={width} height={height}><span className="node-kicker">IMAGE</span>{source ? <img src={source} alt={value.alt} loading="lazy" /> : <p>图片载入失败</p>}<InlineNodeTextEditor nodeId={id} field="imageCaption" value={value.caption ?? ''} label={`${value.alt} · 图片说明`} multiline placeholder="双击添加图片说明" showPlaceholder={Boolean(selected)}>{value.caption ? <p>{value.caption}</p> : null}</InlineNodeTextEditor>{summary ? <small className="image-annotation-summary">{summary}</small> : null}</NodeChrome>;
});

export function imageAnnotationSummary(data: CanvasNode<'image'>['data']): string {
  const annotations = data.annotations ?? [];
  if (annotations.length === 0) return '';
  const linked = annotations.filter((annotation) => annotation.targetNodeId).length;
  return `${annotations.length} 个标注 · ${linked} 个关联资料`;
}

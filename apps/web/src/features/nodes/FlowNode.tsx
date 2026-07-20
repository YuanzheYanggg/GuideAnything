import type { NodeProps } from '@xyflow/react';
import { memo, type MouseEvent as ReactMouseEvent } from 'react';

import { SanitizedMarkdown } from '../markdown/SanitizedMarkdown';
import { NodeChrome } from './NodeChrome';
import { InlineNodeTextEditor } from './InlineNodeTextEditor';
import { useNodeDetailPresentation } from './NodeDetailPresentation';

export const FlowNode = memo(function FlowNode({ data, selected, type, width, height, id }: NodeProps) {
  const value = data as { label?: string; description?: string; detailExpanded?: boolean; responsibility?: { title: string; kind: 'ROLE' | 'SYSTEM' }; semanticCode?: string };
  const detailPresentation = useNodeDetailPresentation();
  const label = value.label ?? '未命名流程';
  const description = value.description ?? '';
  const descriptionPreview = description.split('\n')[0] ?? '';
  const expanded = detailPresentation.expandedNodeIds.has(id);
  const openDetailEditor = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    detailPresentation.onOpenEditor(id, event.currentTarget);
  };
  return <NodeChrome nodeId={id} selected={selected} tone={type ?? 'process'} width={width} height={height} expanded={expanded}>
    <span className="node-kicker">{value.semanticCode ? `${flowLabel(type)} · ${value.semanticCode}` : flowLabel(type)}</span>
    <InlineNodeTextEditor nodeId={id} field="label" value={value.label ?? ''} label={`${label} · 节点标题`} required>
      <strong>{label}</strong>
    </InlineNodeTextEditor>
    <button
      type="button"
      className="flow-detail-trigger nodrag nopan nowheel"
      aria-label={`编辑${label} · 节点明细`}
      onClick={openDetailEditor}
      onDoubleClick={openDetailEditor}
    >{description
      ? <SanitizedMarkdown className={`flow-description flow-description-markdown${expanded ? ' flow-description-expanded' : ''}`} testId={`flow-description-${id}`}>{expanded ? description : descriptionPreview}</SanitizedMarkdown>
      : selected ? <span className="inline-node-text-placeholder">双击添加节点明细</span> : null}
    </button>
    {description ? <button className="flow-detail-toggle flow-detail-toggle-compact nodrag nopan nowheel" type="button" onClick={(event) => { event.stopPropagation(); detailPresentation.onToggleExpanded(id); }}>{expanded ? '收起' : '详情'}</button> : null}
    {value.responsibility ? <span className={`node-responsibility node-responsibility-${value.responsibility.kind.toLowerCase()}`}>{value.responsibility.title}<em>{value.responsibility.kind === 'ROLE' ? '角色' : '系统'}</em></span> : null}
  </NodeChrome>;
});

function flowLabel(type?: string): string {
  return { start: 'START', end: 'END', process: 'PROCESS', decision: 'DECISION', data: 'DATA' }[type ?? 'process'] ?? 'PROCESS';
}

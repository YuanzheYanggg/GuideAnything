import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { NodeChrome } from './NodeChrome';
import { InlineNodeTextEditor } from './InlineNodeTextEditor';

export const FlowNode = memo(function FlowNode({ data, selected, type, width, height, id }: NodeProps) {
  const value = data as { label?: string; description?: string; responsibility?: { title: string; kind: 'ROLE' | 'SYSTEM' } };
  return <NodeChrome selected={selected} tone={type ?? 'process'} width={width} height={height}>
    <span className="node-kicker">{flowLabel(type)}</span>
    <InlineNodeTextEditor nodeId={id} field="label" value={value.label ?? ''} label={`${value.label ?? '未命名流程'} · 节点标题`} required>
      <strong>{value.label ?? '未命名流程'}</strong>
    </InlineNodeTextEditor>
    <InlineNodeTextEditor nodeId={id} field="description" value={value.description ?? ''} label={`${value.label ?? '未命名流程'} · 节点明细`} multiline placeholder="双击添加节点明细" showPlaceholder={Boolean(selected)}>
      {value.description ? <p className="flow-description" data-testid={`flow-description-${id}`}>{value.description}</p> : null}
    </InlineNodeTextEditor>
    {value.responsibility ? <span className={`node-responsibility node-responsibility-${value.responsibility.kind.toLowerCase()}`}>{value.responsibility.title}<em>{value.responsibility.kind === 'ROLE' ? '角色' : '系统'}</em></span> : null}
  </NodeChrome>;
});

function flowLabel(type?: string): string {
  return { start: 'START', end: 'END', process: 'PROCESS', decision: 'DECISION', data: 'DATA' }[type ?? 'process'] ?? 'PROCESS';
}

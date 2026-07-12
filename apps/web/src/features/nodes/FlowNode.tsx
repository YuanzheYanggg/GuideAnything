import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { NodeChrome } from './NodeChrome';

export const FlowNode = memo(function FlowNode({ data, selected, type, width, height, id }: NodeProps) {
  const value = data as { label?: string; description?: string; responsibility?: { title: string; kind: 'ROLE' | 'SYSTEM' } };
  return <NodeChrome selected={selected} tone={type ?? 'process'} width={width} height={height}>
    <span className="node-kicker">{flowLabel(type)}</span>
    <strong>{value.label ?? '未命名流程'}</strong>
    {value.description ? <p className="flow-description" data-testid={`flow-description-${id}`}>{value.description}</p> : null}
    {value.responsibility ? <span className={`node-responsibility node-responsibility-${value.responsibility.kind.toLowerCase()}`}>{value.responsibility.title}<em>{value.responsibility.kind === 'ROLE' ? '角色' : '系统'}</em></span> : null}
  </NodeChrome>;
});

function flowLabel(type?: string): string {
  return { start: 'START', end: 'END', process: 'PROCESS', decision: 'DECISION', data: 'DATA' }[type ?? 'process'] ?? 'PROCESS';
}

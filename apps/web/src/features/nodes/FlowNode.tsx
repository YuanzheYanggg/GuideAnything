import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { NodeChrome } from './NodeChrome';

export const FlowNode = memo(function FlowNode({ data, selected, type, width, height }: NodeProps) {
  const value = data as { label?: string; description?: string };
  return <NodeChrome selected={selected} tone={type ?? 'process'} width={width} height={height}>
    <span className="node-kicker">{flowLabel(type)}</span>
    <strong>{value.label ?? '未命名流程'}</strong>
    {value.description ? <p>{value.description}</p> : null}
  </NodeChrome>;
});

function flowLabel(type?: string): string {
  return { start: 'START', end: 'END', process: 'PROCESS', decision: 'DECISION', data: 'DATA' }[type ?? 'process'] ?? 'PROCESS';
}

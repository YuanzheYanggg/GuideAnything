import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { ReactNode } from 'react';

export function NodeChrome({ selected, tone, children }: { selected?: boolean; tone: string; children: ReactNode }) {
  return <div className={`canvas-node canvas-node-${tone}`}>
    <NodeResizer minWidth={180} minHeight={90} isVisible={Boolean(selected)} />
    <Handle type="target" position={Position.Left} id="in" aria-label="输入端口" />
    {children}
    <Handle type="source" position={Position.Right} id="out" aria-label="输出端口" />
    <Handle type="source" position={Position.Bottom} id="no" aria-label="否分支端口" />
    <Handle type="source" position={Position.Top} id="yes" aria-label="是分支端口" />
  </div>;
}


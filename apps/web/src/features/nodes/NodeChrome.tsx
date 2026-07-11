import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { CSSProperties, ReactNode } from 'react';

export function nodeChromeStyle(width?: number, height?: number): CSSProperties {
  return width !== undefined && height !== undefined ? { width: '100%', height: '100%' } : {};
}

export function NodeChrome({ selected, tone, children, width, height }: { selected?: boolean; tone: string; children: ReactNode; width?: number | undefined; height?: number | undefined }) {
  return <div className={`canvas-node canvas-node-${tone}`} style={nodeChromeStyle(width, height)}>
    <NodeResizer minWidth={180} minHeight={90} isVisible={Boolean(selected)} />
    <Handle type="target" position={Position.Left} id="in" aria-label="输入端口" />
    {children}
    <Handle type="source" position={Position.Right} id="out" aria-label="输出端口" />
    <Handle type="source" position={Position.Bottom} id="no" aria-label="否分支端口" />
    <Handle type="source" position={Position.Top} id="yes" aria-label="是分支端口" />
  </div>;
}

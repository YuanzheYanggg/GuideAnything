import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { CSSProperties, ReactNode } from 'react';

export function nodeChromeStyle(width?: number, height?: number): CSSProperties {
  return width !== undefined && height !== undefined ? { width: '100%', height: '100%' } : {};
}

export function nodeHandleConfig(tone: string): Array<{ id: string; label: string; position: Position }> {
  return tone === 'decision'
    ? [
      { id: 'yes', label: '是分支端口', position: Position.Right },
      { id: 'no', label: '否分支端口', position: Position.Bottom },
    ]
    : [{ id: 'out', label: '输出端口', position: Position.Right }];
}

export function NodeChrome({ selected, tone, children, width, height }: { selected?: boolean; tone: string; children: ReactNode; width?: number | undefined; height?: number | undefined }) {
  return <div className={`canvas-node canvas-node-${tone}`} style={nodeChromeStyle(width, height)}>
    <NodeResizer minWidth={180} minHeight={90} isVisible={Boolean(selected)} />
    <Handle type="target" position={Position.Left} id="in" aria-label="输入端口" />
    {children}
    {nodeHandleConfig(tone).map((handle) => <Handle key={handle.id} type="source" position={handle.position} id={handle.id} aria-label={handle.label} />)}
  </div>;
}

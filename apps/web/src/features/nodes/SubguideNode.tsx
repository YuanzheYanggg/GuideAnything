import type { CanvasNode } from '@guideanything/contracts';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { NodeChrome } from './NodeChrome';

export const SubguideNode = memo(function SubguideNode({ data, selected }: NodeProps) {
  const value = data as CanvasNode<'subguide'>['data'];
  return <NodeChrome selected={selected} tone="subguide"><span className="node-kicker">PINNED GUIDE · v{value.version}</span><strong>{value.title}</strong><p>{value.expanded ? '已展开到当前画布' : '折叠引用，点击后可拼接完整流程'}</p></NodeChrome>;
});


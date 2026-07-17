import { Handle, NodeResizer, Position, type HandleType } from '@xyflow/react';
import { Trash } from '@phosphor-icons/react';
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';

type NodeActionContextValue = {
  enabled: boolean;
  onDeleteNode?: ((nodeId: string) => void) | undefined;
};

export type NodeAnchorHandle = {
  id: string;
  type: HandleType;
  side: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT';
  offset?: number;
  continuous?: boolean;
};

type NodeAnchorPresentationValue = {
  handlesByNodeId: ReadonlyMap<string, NodeAnchorHandle[]>;
};

const NodeActionContext = createContext<NodeActionContextValue | null>(null);
const NodeAnchorPresentationContext = createContext<NodeAnchorPresentationValue>({ handlesByNodeId: new Map() });

const edgeSides = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as const;
const positionBySide = { TOP: Position.Top, RIGHT: Position.Right, BOTTOM: Position.Bottom, LEFT: Position.Left } as const;

export function NodeAnchorPresentationProvider({ children, handlesByNodeId }: { children: ReactNode; handlesByNodeId: ReadonlyMap<string, NodeAnchorHandle[]> }) {
  return <NodeAnchorPresentationContext.Provider value={{ handlesByNodeId }}>{children}</NodeAnchorPresentationContext.Provider>;
}

export function NodeActionProvider({ children, enabled = true, onDeleteNode }: { children: ReactNode; enabled?: boolean; onDeleteNode?: (nodeId: string) => void }) {
  return <NodeActionContext.Provider value={{ enabled, onDeleteNode }}>{children}</NodeActionContext.Provider>;
}

export function nodeChromeStyle(width?: number, height?: number, expanded = false): CSSProperties {
  if (width === undefined || height === undefined) return {};
  return expanded ? { width: '100%' } : { width: '100%', height: '100%' };
}

export function nodeHandleConfig(tone: string): Array<{ id: string; label: string; position: Position }> {
  return tone === 'decision'
    ? [
      { id: 'yes', label: '是分支端口', position: Position.Right },
      { id: 'no', label: '否分支端口', position: Position.Bottom },
    ]
    : [{ id: 'out', label: '输出端口', position: Position.Right }];
}

function continuousAnchorHandles(): NodeAnchorHandle[] {
  return edgeSides.flatMap((side) => [
    { id: `anchor-source-${side}`, type: 'source' as const, side, continuous: true },
    { id: `anchor-target-${side}`, type: 'target' as const, side, continuous: true },
  ]);
}

function anchorHandleStyle(handle: NodeAnchorHandle): CSSProperties {
  if (handle.continuous) {
    const source = handle.type === 'source';
    if (handle.side === 'TOP') return { left: '50%', width: 'calc(100% - 20px)', height: 14, transform: source ? 'translate(-50%, 100%)' : 'translate(-50%, 0)' };
    if (handle.side === 'BOTTOM') return { left: '50%', width: 'calc(100% - 20px)', height: 14, transform: source ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' };
    if (handle.side === 'LEFT') return { top: '50%', width: 14, height: 'calc(100% - 20px)', transform: source ? 'translate(100%, -50%)' : 'translate(0, -50%)' };
    return { top: '50%', width: 14, height: 'calc(100% - 20px)', transform: source ? 'translate(0, -50%)' : 'translate(-100%, -50%)' };
  }
  const offset = `${Math.max(0, Math.min(1, handle.offset ?? 0.5)) * 100}%`;
  return handle.side === 'TOP' || handle.side === 'BOTTOM'
    ? { left: offset }
    : { top: offset };
}

export function NodeChrome({ nodeId, selected, tone, children, width, height, expanded = false }: { nodeId?: string; selected?: boolean; tone: string; children: ReactNode; width?: number | undefined; height?: number | undefined; expanded?: boolean }) {
  const actions = useContext(NodeActionContext);
  const anchorPresentation = useContext(NodeAnchorPresentationContext);
  const canDelete = Boolean(nodeId && actions?.enabled && actions.onDeleteNode);
  const anchorHandles = [...continuousAnchorHandles(), ...(nodeId ? anchorPresentation.handlesByNodeId.get(nodeId) ?? [] : [])];
  return <div className={`canvas-node canvas-node-${tone}${expanded ? ' is-detail-expanded' : ''}`} style={nodeChromeStyle(width, height, expanded)}>
    <NodeResizer minWidth={180} minHeight={90} isVisible={Boolean(selected && !expanded)} />
    <Handle type="target" position={Position.Left} id="in" aria-label="输入端口" />
    {anchorHandles.map((handle) => <Handle
      key={handle.id}
      type={handle.type}
      position={positionBySide[handle.side]}
      id={handle.id}
      className={handle.continuous ? 'continuous-anchor-handle' : 'edge-anchor-handle'}
      style={anchorHandleStyle(handle)}
      {...(handle.continuous
        ? { 'aria-label': `${handle.type === 'source' ? '起点' : '终点'}连接面 ${handle.side}` }
        : { 'aria-hidden': true })}
    />)}
    {canDelete ? <button
      className="canvas-node-delete nodrag nopan nowheel"
      type="button"
      tabIndex={selected ? 0 : -1}
      aria-label="删除节点"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (nodeId) actions?.onDeleteNode?.(nodeId);
      }}
    ><Trash size={14} weight="bold" aria-hidden="true" /></button> : null}
    {children}
    {nodeHandleConfig(tone).map((handle) => <Handle key={handle.id} type="source" position={handle.position} id={handle.id} aria-label={handle.label} />)}
  </div>;
}

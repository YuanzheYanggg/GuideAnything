import { Handle, NodeResizer, Position, useUpdateNodeInternals, type HandleType } from '@xyflow/react';
import { Eye, EyeSlash, X } from '@phosphor-icons/react';
import type { CanvasResourceVisibility } from '@guideanything/contracts';
import { createContext, useContext, useLayoutEffect, type CSSProperties, type ReactNode } from 'react';

import { BorderGlow } from '../../components/reactbits/BorderGlow';
import { SpotlightCard } from '../../components/reactbits/SpotlightCard';

type NodeActionContextValue = {
  enabled: boolean;
  onDeleteNode?: ((nodeId: string) => void) | undefined;
  onToggleResourceVisibility?: ((nodeId: string) => void) | undefined;
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
const spotlightColorByTone: Record<string, string> = {
  decision: 'rgba(255, 159, 10, 0.22)',
  image: 'rgba(10, 132, 255, 0.18)',
  markdown: 'rgba(188, 154, 255, 0.18)',
  process: 'rgba(10, 132, 255, 0.2)',
  start: 'rgba(48, 209, 88, 0.2)',
  end: 'rgba(255, 105, 97, 0.2)',
  subguide: 'rgba(71, 213, 122, 0.18)',
  video: 'rgba(74, 166, 255, 0.2)',
};

export function NodeAnchorPresentationProvider({ children, handlesByNodeId }: { children: ReactNode; handlesByNodeId: ReadonlyMap<string, NodeAnchorHandle[]> }) {
  return <NodeAnchorPresentationContext.Provider value={{ handlesByNodeId }}>{children}</NodeAnchorPresentationContext.Provider>;
}

export function NodeActionProvider({ children, enabled = true, onDeleteNode, onToggleResourceVisibility }: { children: ReactNode; enabled?: boolean; onDeleteNode?: (nodeId: string) => void; onToggleResourceVisibility?: (nodeId: string) => void }) {
  return <NodeActionContext.Provider value={{ enabled, onDeleteNode, onToggleResourceVisibility }}>{children}</NodeActionContext.Provider>;
}

export function nodeChromeStyle(width?: number, height?: number, expanded = false): CSSProperties {
  if (width === undefined) return {};
  if (height === undefined || expanded) return { width: '100%' };
  return { width: '100%', minHeight: height };
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

export function NodeChrome({ nodeId, selected, tone, children, width, height, expanded = false, resourceVisibility }: { nodeId?: string; selected?: boolean; tone: string; children: ReactNode; width?: number | undefined; height?: number | undefined; expanded?: boolean; resourceVisibility?: CanvasResourceVisibility | undefined }) {
  const actions = useContext(NodeActionContext);
  const anchorPresentation = useContext(NodeAnchorPresentationContext);
  const updateNodeInternals = useUpdateNodeInternals();
  const canDelete = Boolean(nodeId && actions?.enabled && actions.onDeleteNode);
  const resourceIsHidden = resourceVisibility === 'HIDDEN';
  const canToggleResourceVisibility = Boolean(nodeId && resourceVisibility && actions?.enabled && actions.onToggleResourceVisibility);
  const anchorHandles = [...continuousAnchorHandles(), ...(nodeId ? anchorPresentation.handlesByNodeId.get(nodeId) ?? [] : [])];
  const anchorSignature = anchorHandles
    .map((handle) => `${handle.id}:${handle.type}:${handle.side}:${handle.offset ?? 0.5}:${handle.continuous ? 1 : 0}`)
    .sort()
    .join('|');

  useLayoutEffect(() => {
    if (nodeId) updateNodeInternals(nodeId);
  }, [anchorSignature, expanded, height, nodeId, selected, updateNodeInternals, width]);

  return <div className={`canvas-node canvas-node-${tone}${expanded ? ' is-detail-expanded' : ''}${resourceIsHidden ? ' is-resource-hidden' : ''}`} style={nodeChromeStyle(width, height, expanded)}>
    <NodeResizer minWidth={180} minHeight={90} isVisible={false} />
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
    {canToggleResourceVisibility ? <button
      className="canvas-node-visibility nodrag nopan nowheel"
      type="button"
      tabIndex={selected ? 0 : -1}
      aria-label={resourceIsHidden ? '显示资料' : '隐藏资料'}
      aria-pressed={resourceIsHidden}
      title={resourceIsHidden ? '显示资料' : '隐藏资料'}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (nodeId) actions?.onToggleResourceVisibility?.(nodeId);
      }}
    >{resourceIsHidden ? <EyeSlash size={14} weight="bold" aria-hidden="true" /> : <Eye size={14} weight="bold" aria-hidden="true" />}</button> : null}
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
    ><X className="canvas-node-delete-icon" size={14} weight="bold" aria-hidden="true" /></button> : null}
    {resourceIsHidden ? <span className="canvas-node-visibility-status" aria-label="资料已隐藏">已隐藏</span> : null}
    <BorderGlow
      active={Boolean(selected)}
      tone={tone === 'decision' ? 'warning' : 'accent'}
      className="canvas-node-glow"
    >
      <SpotlightCard
        className="canvas-node-surface"
        spotlightColor={spotlightColorByTone[tone] ?? 'rgba(10, 132, 255, 0.2)'}
      >
        {children}
      </SpotlightCard>
    </BorderGlow>
    {nodeHandleConfig(tone).map((handle) => <Handle key={handle.id} type="source" position={handle.position} id={handle.id} aria-label={handle.label} />)}
  </div>;
}

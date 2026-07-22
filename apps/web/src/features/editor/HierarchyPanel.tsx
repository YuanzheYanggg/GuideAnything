import type { CanvasDocument, CanvasNode, FlowLane, FlowStage } from '@guideanything/contracts';
import { deriveSemanticFlow, isContentNode, isPrimaryFlowNode } from '@guideanything/canvas-core';
import { useState, type DragEvent, type KeyboardEvent } from 'react';

import { BorderGlow } from '../../components/reactbits/BorderGlow';
import { SpotlightCard } from '../../components/reactbits/SpotlightCard';
import type { HierarchyDropPlacement } from './hierarchy-order';

export interface HierarchyPanelProps {
  document: CanvasDocument;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onAddStage: () => void;
  onUpdateStage: (stageId: string, title: string) => void;
  onMoveStage: (stageId: string, direction: -1 | 1) => void;
  onReorderStage: (stageId: string, targetId: string, placement: HierarchyDropPlacement) => void;
  onRequestDeleteStage: (stageId: string) => void;
  onAddLane: (kind: FlowLane['kind']) => void;
  onUpdateLane: (laneId: string, title: string) => void;
  onMoveLane: (laneId: string, direction: -1 | 1) => void;
  onReorderLane: (laneId: string, targetId: string, placement: HierarchyDropPlacement) => void;
  onRequestDeleteLane: (laneId: string) => void;
  editingLocked?: boolean;
}

export function HierarchyPanel({
  document,
  selectedIds,
  onSelect,
  onAddStage,
  onUpdateStage,
  onMoveStage,
  onReorderStage,
  onRequestDeleteStage,
  onAddLane,
  onUpdateLane,
  onMoveLane,
  onReorderLane,
  onRequestDeleteLane,
  editingLocked = false,
}: HierarchyPanelProps) {
  const [stageDrafts, setStageDrafts] = useState<Record<string, string>>({});
  const [laneDrafts, setLaneDrafts] = useState<Record<string, string>>({});
  const [activeManager, setActiveManager] = useState<'stage' | 'lane' | null>(null);
  const [collapsedStageIds, setCollapsedStageIds] = useState<Record<string, boolean>>({});
  const [expandedAppendixIds, setExpandedAppendixIds] = useState<Set<string>>(() => new Set());
  const semanticFlow = deriveSemanticFlow(document);
  const semanticOrder = new Map(semanticFlow.items.map((item, index) => [item.nodeId, index]));
  const semanticCode = new Map(semanticFlow.items.map((item) => [item.nodeId, item.code]));
  const primary = document.nodes.filter(isPrimaryFlowNode).sort((left, right) => (semanticOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (semanticOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  const content = document.nodes.filter(isContentNode);
  const derivedByReference = new Map<string, CanvasNode[]>();
  document.nodes.forEach((node) => {
    if (node.hidden || !node.source?.referenceNodeId) return;
    const derived = derivedByReference.get(node.source.referenceNodeId);
    if (derived) derived.push(node);
    else derivedByReference.set(node.source.referenceNodeId, [node]);
  });
  const stages = [...(document.stages ?? [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const lanes = [...(document.lanes ?? [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const updateStageTitle = (stageId: string, title: string) => {
    setStageDrafts((current) => ({ ...current, [stageId]: title }));
    if (!title.trim()) return;
    onUpdateStage(stageId, title);
    setStageDrafts((current) => {
      const { [stageId]: _draft, ...rest } = current;
      return rest;
    });
  };
  const updateLaneTitle = (laneId: string, title: string) => {
    setLaneDrafts((current) => ({ ...current, [laneId]: title }));
    if (!title.trim()) return;
    onUpdateLane(laneId, title);
    setLaneDrafts((current) => {
      const { [laneId]: _draft, ...rest } = current;
      return rest;
    });
  };
  const clearStageDraft = (stageId: string) => {
    setStageDrafts((current) => {
      if (!(stageId in current)) return current;
      const { [stageId]: _draft, ...rest } = current;
      return rest;
    });
  };
  const clearLaneDraft = (laneId: string) => {
    setLaneDrafts((current) => {
      if (!(laneId in current)) return current;
      const { [laneId]: _draft, ...rest } = current;
      return rest;
    });
  };
  const toggleStage = (stageId: string) => {
    setCollapsedStageIds((current) => ({ ...current, [stageId]: !current[stageId] }));
  };
  const toggleAppendix = (nodeId: string) => {
    setExpandedAppendixIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return <>
    <aside className="hierarchy-panel" aria-label="流程结构">
    <div className="hierarchy-heading"><div><span className="eyebrow">FLOW STRUCTURE</span><strong>业务流程</strong><small>{semanticFlow.lessonSteps.length} 个教学步骤</small></div></div>
    <div className="hierarchy-panel-scroll">
      <div className="hierarchy-management-triggers" aria-label="流程结构管理">
        <SpotlightCard className="hierarchy-management-card" spotlightColor="rgba(10, 132, 255, 0.18)">
          <button type="button" aria-label="管理业务阶段" aria-expanded={activeManager === 'stage'} aria-controls="hierarchy-stage-manager" onClick={() => setActiveManager((current) => current === 'stage' ? null : 'stage')}><span>业务阶段</span><strong>{stages.length}</strong><span aria-hidden="true">管理 ›</span></button>
        </SpotlightCard>
        <SpotlightCard className="hierarchy-management-card" spotlightColor="rgba(71, 213, 122, 0.16)">
          <button type="button" aria-label="管理责任泳道" aria-expanded={activeManager === 'lane'} aria-controls="hierarchy-lane-manager" onClick={() => setActiveManager((current) => current === 'lane' ? null : 'lane')}><span>责任泳道</span><strong>{lanes.length}</strong><span aria-hidden="true">管理 ›</span></button>
        </SpotlightCard>
      </div>
      <div role="tree" aria-label="流程结构">
        {stages.map((stage) => <HierarchyStage key={stage.id} stage={stage} primary={primary.filter((node) => node.stageId === stage.id)} content={content} semanticOrder={semanticOrder} semanticCode={semanticCode} derivedByReference={derivedByReference} selectedIds={selectedIds} onSelect={onSelect} collapsed={Boolean(collapsedStageIds[stage.id])} onToggle={() => toggleStage(stage.id)} expandedAppendixIds={expandedAppendixIds} onToggleAppendix={toggleAppendix} />)}
        <HierarchyStage stage={{ id: '__none__', title: '未分阶段', order: Number.MAX_SAFE_INTEGER }} primary={primary.filter((node) => !node.stageId)} content={content} semanticOrder={semanticOrder} semanticCode={semanticCode} derivedByReference={derivedByReference} selectedIds={selectedIds} onSelect={onSelect} collapsed={Boolean(collapsedStageIds.__none__)} onToggle={() => toggleStage('__none__')} expandedAppendixIds={expandedAppendixIds} onToggleAppendix={toggleAppendix} />
        <LooseContent content={content.filter((node) => !(node.attachment?.ownerNodeId ?? node.contentParentId))} semanticCode={semanticCode} selectedIds={selectedIds} onSelect={onSelect} />
      </div>
    </div>
    </aside>
    {activeManager === 'stage' ? <HierarchyManagerDrawer id="hierarchy-stage-manager" kind="stage" items={stages} drafts={stageDrafts} editingLocked={editingLocked} onClose={() => setActiveManager(null)} onUpdate={updateStageTitle} onClearDraft={clearStageDraft} onMove={onMoveStage} onReorder={onReorderStage} onDelete={onRequestDeleteStage} onAddStage={onAddStage} /> : null}
    {activeManager === 'lane' ? <HierarchyManagerDrawer id="hierarchy-lane-manager" kind="lane" items={lanes} drafts={laneDrafts} editingLocked={editingLocked} onClose={() => setActiveManager(null)} onUpdate={updateLaneTitle} onClearDraft={clearLaneDraft} onMove={onMoveLane} onReorder={onReorderLane} onDelete={onRequestDeleteLane} onAddLane={onAddLane} /> : null}
  </>;
}

interface HierarchyManagerDrawerProps {
  id: string;
  kind: 'stage' | 'lane';
  items: Array<FlowStage | FlowLane>;
  drafts: Record<string, string>;
  editingLocked: boolean;
  onClose: () => void;
  onUpdate: (id: string, title: string) => void;
  onClearDraft: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onReorder: (id: string, targetId: string, placement: HierarchyDropPlacement) => void;
  onDelete: (id: string) => void;
  onAddStage?: () => void;
  onAddLane?: (kind: FlowLane['kind']) => void;
}

function HierarchyManagerDrawer({ id, kind, items, drafts, editingLocked, onClose, onUpdate, onClearDraft, onMove, onReorder, onDelete, onAddStage, onAddLane }: HierarchyManagerDrawerProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; placement: HierarchyDropPlacement } | null>(null);
  const title = kind === 'stage' ? '业务阶段' : '责任泳道';
  const itemLabel = kind === 'stage' ? '阶段' : '泳道';

  const beginDrag = (event: DragEvent<HTMLButtonElement>, itemId: string) => {
    if (editingLocked) {
      event.preventDefault();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `${kind}:${itemId}`);
    }
    setDraggedId(itemId);
  };
  const updateDropTarget = (event: DragEvent<HTMLLIElement>, itemId: string) => {
    if (!draggedId || draggedId === itemId || editingLocked) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({ id: itemId, placement: event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before' });
  };
  const completeDrop = (event: DragEvent<HTMLLIElement>, itemId: string) => {
    event.preventDefault();
    if (!draggedId || draggedId === itemId || editingLocked) {
      setDraggedId(null);
      setDropTarget(null);
      return;
    }
    const placement = dropTarget?.id === itemId ? dropTarget.placement : 'before';
    onReorder(draggedId, itemId, placement);
    setDraggedId(null);
    setDropTarget(null);
  };
  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, itemId: string) => {
    if (!event.altKey || editingLocked) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(itemId, -1);
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(itemId, 1);
    }
  };

  return <BorderGlow id={id} className="hierarchy-manager-drawer" active tone="neutral" role="region" aria-label={`${title}管理`}>
    <div className="hierarchy-manager-drawer-heading"><div><span className="eyebrow">STRUCTURE ORDER</span><strong>{title}</strong><p>拖动排序；按住 Alt + ↑/↓ 可键盘调整。</p></div><button type="button" aria-label={`关闭${title}管理`} onClick={onClose}>×</button></div>
    <ul className="hierarchy-manager-list" aria-label={`${title}排序`}>
      {items.map((item) => {
        const isLane = kind === 'lane' && 'kind' in item;
        const placement = dropTarget?.id === item.id ? dropTarget.placement : null;
        return <li key={item.id} aria-label={`${itemLabel} ${item.title}`} data-dragging={draggedId === item.id || undefined} data-drop-placement={placement ?? undefined} onDragOver={(event) => updateDropTarget(event, item.id)} onDrop={(event) => completeDrop(event, item.id)}>
          <button className="hierarchy-drag-handle" type="button" draggable={!editingLocked} aria-label={`拖动${itemLabel} ${item.title} 排序`} onDragStart={(event) => beginDrag(event, item.id)} onDragEnd={() => { setDraggedId(null); setDropTarget(null); }} onKeyDown={(event) => moveWithKeyboard(event, item.id)} disabled={editingLocked}><span aria-hidden="true">⋮⋮</span></button>
          <input aria-label={`${title} ${item.title}`} value={drafts[item.id] ?? item.title} disabled={editingLocked} onChange={(event) => onUpdate(item.id, event.target.value)} onBlur={() => onClearDraft(item.id)} />
          {isLane ? <span className={`lane-kind-badge lane-kind-${item.kind.toLowerCase()}`}>{item.kind === 'ROLE' ? '角色' : '系统'}</span> : null}
          <button className="hierarchy-manager-delete" type="button" aria-label={`删除${itemLabel} ${item.title}`} onClick={() => onDelete(item.id)} disabled={editingLocked}>×</button>
        </li>;
      })}
    </ul>
    {items.length === 0 ? <p className="hierarchy-manager-empty">{kind === 'stage' ? '添加阶段后，流程会按从上到下的业务顺序组织。' : '添加责任泳道后，可将流程节点分配给角色或系统。'}</p> : null}
    {kind === 'stage' ? <button className="hierarchy-manager-add" type="button" aria-label="添加阶段" onClick={onAddStage} disabled={editingLocked}>＋ 添加阶段</button> : <div className="hierarchy-lane-actions"><button type="button" onClick={() => onAddLane?.('ROLE')} disabled={editingLocked}>添加角色泳道</button><button type="button" onClick={() => onAddLane?.('SYSTEM')} disabled={editingLocked}>添加系统泳道</button></div>}
  </BorderGlow>;
}

function HierarchyStage({ stage, primary, content, semanticOrder, semanticCode, derivedByReference, selectedIds, onSelect, collapsed, onToggle, expandedAppendixIds, onToggleAppendix }: { stage: FlowStage; primary: CanvasNode[]; content: CanvasNode[]; semanticOrder: Map<string, number>; semanticCode: Map<string, string>; derivedByReference: Map<string, CanvasNode[]>; selectedIds: string[]; onSelect: (ids: string[]) => void; collapsed: boolean; onToggle: () => void; expandedAppendixIds: Set<string>; onToggleAppendix: (nodeId: string) => void }) {
  return <section className="hierarchy-stage" role="treeitem" aria-label={stage.title} aria-expanded={!collapsed}>
    <button className="hierarchy-stage-title" type="button" aria-label={`${collapsed ? '展开' : '收起'}阶段 ${stage.title}`} aria-expanded={!collapsed} onClick={onToggle}><span>{stage.title}</span><small>{primary.length}</small><span aria-hidden="true">{collapsed ? '›' : '⌄'}</span></button>
    {!collapsed ? <div role="group">
      {primary.map((node) => {
        const attached = content.filter((item) => (item.attachment?.ownerNodeId ?? item.contentParentId) === node.id).sort((left, right) => (semanticOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (semanticOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));
        const appendixExpanded = expandedAppendixIds.has(node.id);
        return <div className="hierarchy-flow" key={node.id}>
          <SelectNode node={node} code={semanticCode.get(node.id)} selected={selectedIds.includes(node.id)} onSelect={onSelect} />
          {attached.length > 0 ? <div className="hierarchy-appendix"><button className="hierarchy-appendix-toggle" type="button" aria-label={`${appendixExpanded ? '收起' : '展开'} ${nodeLabel(node)} 的资料附录`} aria-expanded={appendixExpanded} onClick={() => onToggleAppendix(node.id)}><span aria-hidden="true">{appendixExpanded ? '⌄' : '›'}</span><span>资料附录 · {attached.length}</span></button>{appendixExpanded ? <div role="group" aria-label={`${nodeLabel(node)}的资料附录`}>{attached.map((item) => <SelectNode key={item.id} node={item} code={semanticCode.get(item.id)} selected={selectedIds.includes(item.id)} onSelect={onSelect} />)}</div> : null}</div> : null}
          {node.type === 'subguide' && node.data.expanded ? <DerivedSubguideContent reference={node} derived={derivedByReference.get(node.id) ?? []} selectedIds={selectedIds} onSelect={onSelect} /> : null}
        </div>;
      })}
      {primary.length === 0 ? <p className="hierarchy-empty">还没有流程节点</p> : null}
    </div> : null}
  </section>;
}

function DerivedSubguideContent({ reference, derived, selectedIds, onSelect }: { reference: CanvasNode<'subguide'>; derived: CanvasNode[]; selectedIds: string[]; onSelect: (ids: string[]) => void }) {
  if (derived.length === 0) return null;
  return <div className="hierarchy-derived" role="group" aria-label={`${nodeLabel(reference)}的子指南内容`}>
    <span>子指南内容</span>
    {derived.map((node) => <SelectNode key={node.id} node={node} selected={selectedIds.includes(node.id)} onSelect={onSelect} kind="子指南内容" />)}
  </div>;
}

function LooseContent({ content, semanticCode, selectedIds, onSelect }: { content: CanvasNode[]; semanticCode: Map<string, string>; selectedIds: string[]; onSelect: (ids: string[]) => void }) {
  return <section className="hierarchy-stage hierarchy-loose-content" role="treeitem" aria-label="未挂靠资料">
    <div className="hierarchy-stage-title">未挂靠资料<span>{content.length}</span></div>
    <div role="group">
      {content.map((node) => <SelectNode key={node.id} node={node} code={semanticCode.get(node.id)} selected={selectedIds.includes(node.id)} onSelect={onSelect} />)}
      {content.length === 0 ? <p className="hierarchy-empty">所有资料都已挂靠</p> : null}
    </div>
  </section>;
}

function SelectNode({ node, code, selected, onSelect, kind }: { node: CanvasNode; code?: string | undefined; selected: boolean; onSelect: (ids: string[]) => void; kind?: '子指南内容' }) {
  const primary = isPrimaryFlowNode(node);
  const label = nodeLabel(node);
  const type = kind ?? (primary ? '流程节点' : '资料');
  return <button className={kind ? 'hierarchy-derived-node' : primary ? 'hierarchy-node' : 'hierarchy-resource'} type="button" aria-pressed={selected} aria-label={`选择${type} ${label}`} onClick={() => onSelect([node.id])}>{code != null ? <span className="hierarchy-sequence" aria-hidden="true">{code}</span> : null}<span>{label}</span></button>;
}

function nodeLabel(node: CanvasNode): string {
  if (node.type === 'markdown') return node.data.markdown.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 80) || 'Markdown 说明';
  if (node.type === 'image') return node.data.caption || node.data.alt;
  if (node.type === 'video') return node.data.caption || '视频资料';
  if (node.type === 'subguide') return node.data.title;
  return node.data.label;
}

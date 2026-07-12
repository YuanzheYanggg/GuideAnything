import type { CanvasDocument, CanvasNode, FlowLane, FlowStage } from '@guideanything/contracts';
import { isContentNode, isPrimaryFlowNode } from '@guideanything/canvas-core';

export interface HierarchyPanelProps {
  document: CanvasDocument;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onAddStage: () => void;
  onUpdateStage: (stageId: string, title: string) => void;
  onMoveStage: (stageId: string, direction: -1 | 1) => void;
  onAddLane: (kind: FlowLane['kind']) => void;
  onUpdateLane: (laneId: string, title: string) => void;
  onMoveLane: (laneId: string, direction: -1 | 1) => void;
  editingLocked?: boolean;
}

export function HierarchyPanel({
  document,
  selectedIds,
  onSelect,
  onAddStage,
  onUpdateStage,
  onMoveStage,
  onAddLane,
  onUpdateLane,
  onMoveLane,
  editingLocked = false,
}: HierarchyPanelProps) {
  const primary = document.nodes.filter(isPrimaryFlowNode);
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

  return <aside className="hierarchy-panel" aria-label="流程结构">
    <div className="hierarchy-heading"><div><span className="eyebrow">FLOW STRUCTURE</span><strong>业务流程</strong></div></div>
    <section className="hierarchy-manager" aria-label="业务阶段管理">
      <div className="hierarchy-manager-heading"><strong>业务阶段</strong><button type="button" onClick={onAddStage} disabled={editingLocked}>添加阶段</button></div>
      {stages.map((stage, index) => <div className="hierarchy-manager-row" key={stage.id}>
        <input aria-label={`业务阶段 ${stage.title}`} value={stage.title} disabled={editingLocked} onChange={(event) => onUpdateStage(stage.id, event.target.value)} />
        <div className="hierarchy-manager-actions"><button type="button" aria-label={`上移阶段 ${stage.title}`} onClick={() => onMoveStage(stage.id, -1)} disabled={editingLocked || index === 0}>↑</button><button type="button" aria-label={`下移阶段 ${stage.title}`} onClick={() => onMoveStage(stage.id, 1)} disabled={editingLocked || index === stages.length - 1}>↓</button></div>
      </div>)}
      {stages.length === 0 ? <p className="hierarchy-manager-empty">添加阶段后，流程会按从上到下的业务顺序组织。</p> : null}
    </section>
    <section className="hierarchy-manager" aria-label="责任泳道管理">
      <div className="hierarchy-manager-heading"><strong>责任泳道</strong><span>角色或系统</span></div>
      {lanes.map((lane, index) => <div className="hierarchy-manager-row" key={lane.id}>
        <input aria-label={`责任泳道 ${lane.title}`} value={lane.title} disabled={editingLocked} onChange={(event) => onUpdateLane(lane.id, event.target.value)} />
        <span className={`lane-kind-badge lane-kind-${lane.kind.toLowerCase()}`}>{lane.kind === 'ROLE' ? '角色' : '系统'}</span>
        <div className="hierarchy-manager-actions"><button type="button" aria-label={`上移泳道 ${lane.title}`} onClick={() => onMoveLane(lane.id, -1)} disabled={editingLocked || index === 0}>↑</button><button type="button" aria-label={`下移泳道 ${lane.title}`} onClick={() => onMoveLane(lane.id, 1)} disabled={editingLocked || index === lanes.length - 1}>↓</button></div>
      </div>)}
      <div className="hierarchy-lane-actions"><button type="button" onClick={() => onAddLane('ROLE')} disabled={editingLocked}>添加角色泳道</button><button type="button" onClick={() => onAddLane('SYSTEM')} disabled={editingLocked}>添加系统泳道</button></div>
    </section>
    <div role="tree" aria-label="流程结构">
      {stages.map((stage) => <HierarchyStage key={stage.id} stage={stage} primary={primary.filter((node) => node.stageId === stage.id)} content={content} derivedByReference={derivedByReference} selectedIds={selectedIds} onSelect={onSelect} />)}
      <HierarchyStage stage={{ id: '__none__', title: '未分阶段', order: Number.MAX_SAFE_INTEGER }} primary={primary.filter((node) => !node.stageId)} content={content} derivedByReference={derivedByReference} selectedIds={selectedIds} onSelect={onSelect} />
      <LooseContent content={content.filter((node) => !node.contentParentId)} selectedIds={selectedIds} onSelect={onSelect} />
    </div>
  </aside>;
}

function HierarchyStage({ stage, primary, content, derivedByReference, selectedIds, onSelect }: { stage: FlowStage; primary: CanvasNode[]; content: CanvasNode[]; derivedByReference: Map<string, CanvasNode[]>; selectedIds: string[]; onSelect: (ids: string[]) => void }) {
  return <section className="hierarchy-stage" role="treeitem" aria-label={stage.title}>
    <div className="hierarchy-stage-title">{stage.title}<span>{primary.length}</span></div>
    <div role="group">
      {primary.map((node) => <div className="hierarchy-flow" key={node.id}>
        <SelectNode node={node} selected={selectedIds.includes(node.id)} onSelect={onSelect} />
        {content.filter((item) => item.contentParentId === node.id).map((item) => <SelectNode key={item.id} node={item} selected={selectedIds.includes(item.id)} onSelect={onSelect} />)}
        {node.type === 'subguide' && node.data.expanded ? <DerivedSubguideContent reference={node} derived={derivedByReference.get(node.id) ?? []} selectedIds={selectedIds} onSelect={onSelect} /> : null}
      </div>)}
      {primary.length === 0 ? <p className="hierarchy-empty">还没有流程节点</p> : null}
    </div>
  </section>;
}

function DerivedSubguideContent({ reference, derived, selectedIds, onSelect }: { reference: CanvasNode<'subguide'>; derived: CanvasNode[]; selectedIds: string[]; onSelect: (ids: string[]) => void }) {
  if (derived.length === 0) return null;
  return <div className="hierarchy-derived" role="group" aria-label={`${nodeLabel(reference)}的子指南内容`}>
    <span>子指南内容</span>
    {derived.map((node) => <SelectNode key={node.id} node={node} selected={selectedIds.includes(node.id)} onSelect={onSelect} kind="子指南内容" />)}
  </div>;
}

function LooseContent({ content, selectedIds, onSelect }: { content: CanvasNode[]; selectedIds: string[]; onSelect: (ids: string[]) => void }) {
  return <section className="hierarchy-stage hierarchy-loose-content" role="treeitem" aria-label="未挂靠资料">
    <div className="hierarchy-stage-title">未挂靠资料<span>{content.length}</span></div>
    <div role="group">
      {content.map((node) => <SelectNode key={node.id} node={node} selected={selectedIds.includes(node.id)} onSelect={onSelect} />)}
      {content.length === 0 ? <p className="hierarchy-empty">所有资料都已挂靠</p> : null}
    </div>
  </section>;
}

function SelectNode({ node, selected, onSelect, kind }: { node: CanvasNode; selected: boolean; onSelect: (ids: string[]) => void; kind?: '子指南内容' }) {
  const primary = isPrimaryFlowNode(node);
  const label = nodeLabel(node);
  const type = kind ?? (primary ? '流程节点' : '资料');
  return <button className={kind ? 'hierarchy-derived-node' : primary ? 'hierarchy-node' : 'hierarchy-resource'} type="button" aria-pressed={selected} aria-label={`选择${type} ${label}`} onClick={() => onSelect([node.id])}>{label}</button>;
}

function nodeLabel(node: CanvasNode): string {
  if (node.type === 'markdown') return node.data.markdown.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 80) || 'Markdown 说明';
  if (node.type === 'image') return node.data.caption || node.data.alt;
  if (node.type === 'video') return node.data.caption || '视频资料';
  if (node.type === 'subguide') return node.data.title;
  return node.data.label;
}

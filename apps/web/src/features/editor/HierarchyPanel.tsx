import type { CanvasDocument, CanvasNode, FlowStage } from '@guideanything/contracts';
import { isContentNode, isPrimaryFlowNode } from '@guideanything/canvas-core';

export interface HierarchyPanelProps {
  document: CanvasDocument;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onAddStage: () => void;
  editingLocked?: boolean;
}

export function HierarchyPanel({ document, selectedIds, onSelect, onAddStage, editingLocked = false }: HierarchyPanelProps) {
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

  return <aside className="hierarchy-panel" aria-label="流程结构">
    <div className="hierarchy-heading"><div><span className="eyebrow">FLOW STRUCTURE</span><strong>业务流程</strong></div><button type="button" onClick={onAddStage} disabled={editingLocked}>添加阶段</button></div>
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

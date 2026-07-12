import type { CanvasDocument, CanvasNode, FlowStage } from '@guideanything/contracts';
import { isContentNode, isPrimaryFlowNode } from '@guideanything/canvas-core';

export interface HierarchyPanelProps {
  document: CanvasDocument;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onAddStage: () => void;
}

export function HierarchyPanel({ document, selectedIds, onSelect, onAddStage }: HierarchyPanelProps) {
  const primary = document.nodes.filter(isPrimaryFlowNode);
  const content = document.nodes.filter(isContentNode);
  const stages = [...(document.stages ?? [])].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  return <aside className="hierarchy-panel" aria-label="流程结构">
    <div className="hierarchy-heading"><div><span className="eyebrow">FLOW STRUCTURE</span><strong>业务流程</strong></div><button type="button" onClick={onAddStage}>添加阶段</button></div>
    <div role="tree" aria-label="流程结构">
      {stages.map((stage) => <HierarchyStage key={stage.id} stage={stage} primary={primary.filter((node) => node.stageId === stage.id)} content={content} selectedIds={selectedIds} onSelect={onSelect} />)}
      <HierarchyStage stage={{ id: '__none__', title: '未分阶段', order: Number.MAX_SAFE_INTEGER }} primary={primary.filter((node) => !node.stageId)} content={content} selectedIds={selectedIds} onSelect={onSelect} />
      <LooseContent content={content.filter((node) => !node.contentParentId)} selectedIds={selectedIds} onSelect={onSelect} />
    </div>
  </aside>;
}

function HierarchyStage({ stage, primary, content, selectedIds, onSelect }: { stage: FlowStage; primary: CanvasNode[]; content: CanvasNode[]; selectedIds: string[]; onSelect: (ids: string[]) => void }) {
  return <section className="hierarchy-stage" role="treeitem" aria-label={stage.title}>
    <div className="hierarchy-stage-title">{stage.title}<span>{primary.length}</span></div>
    <div role="group">
      {primary.map((node) => <div className="hierarchy-flow" key={node.id}>
        <SelectNode node={node} selected={selectedIds.includes(node.id)} onSelect={onSelect} />
        {content.filter((item) => item.contentParentId === node.id).map((item) => <SelectNode key={item.id} node={item} selected={selectedIds.includes(item.id)} onSelect={onSelect} />)}
      </div>)}
      {primary.length === 0 ? <p className="hierarchy-empty">还没有流程节点</p> : null}
    </div>
  </section>;
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

function SelectNode({ node, selected, onSelect }: { node: CanvasNode; selected: boolean; onSelect: (ids: string[]) => void }) {
  const primary = isPrimaryFlowNode(node);
  const label = nodeLabel(node);
  return <button className={primary ? 'hierarchy-node' : 'hierarchy-resource'} type="button" aria-pressed={selected} aria-label={`选择${primary ? '流程节点' : '资料'} ${label}`} onClick={() => onSelect([node.id])}>{label}</button>;
}

function nodeLabel(node: CanvasNode): string {
  if (node.type === 'markdown') return node.data.markdown.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 80) || 'Markdown 说明';
  if (node.type === 'image') return node.data.caption || node.data.alt;
  if (node.type === 'video') return node.data.caption || '视频资料';
  if (node.type === 'subguide') return node.data.title;
  return node.data.label;
}

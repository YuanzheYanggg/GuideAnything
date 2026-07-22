import {
  AlignLeft,
  ArrowUUpLeft,
  ArrowUUpRight,
  BookOpen,
  Clipboard,
  Copy,
  Database,
  FlowArrow,
  GitBranch,
  Image,
  PlayCircle,
  Sparkle,
  TextT,
  VideoCamera,
  X,
} from '@phosphor-icons/react';
import type { CanvasNode } from '@guideanything/contracts';

import { BorderGlow } from '../../components/reactbits/BorderGlow';
import { ShinyText } from '../../components/reactbits/ShinyText';
import { SpotlightCard } from '../../components/reactbits/SpotlightCard';

export type EditorToolbarNodeType = Extract<CanvasNode['type'], 'start' | 'process' | 'decision' | 'data' | 'markdown' | 'image' | 'video'>;

export interface EditorToolbarProps {
  layoutPreview: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canAlign: boolean;
  canPreviewLayout: boolean;
  canDelete: boolean;
  onAddNode: (type: EditorToolbarNodeType) => void;
  onInsertSubguide: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onAlign: () => void;
  onPreviewLayout: () => void;
  onRemoveSelected: () => void;
}

const nodeCommands = [
  { type: 'start', label: '开始', ariaLabel: '添加开始节点', className: 'is-start', Icon: PlayCircle },
  { type: 'process', label: '流程', ariaLabel: '添加流程节点', className: 'is-process', Icon: FlowArrow },
  { type: 'decision', label: '判断', ariaLabel: '添加判断节点', className: 'is-decision', Icon: GitBranch },
  { type: 'data', label: '数据', ariaLabel: '添加数据节点', className: 'is-data', Icon: Database },
  { type: 'markdown', label: 'Markdown', ariaLabel: '添加 Markdown 节点', className: 'is-markdown', Icon: TextT },
  { type: 'image', label: '图片', ariaLabel: '添加图片节点', className: 'is-image', Icon: Image },
  { type: 'video', label: '视频', ariaLabel: '添加视频节点', className: 'is-video', Icon: VideoCamera },
] as const;

export function EditorToolbar({
  layoutPreview,
  canUndo,
  canRedo,
  canCopy,
  canPaste,
  canAlign,
  canPreviewLayout,
  canDelete,
  onAddNode,
  onInsertSubguide,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onAlign,
  onPreviewLayout,
  onRemoveSelected,
}: EditorToolbarProps) {
  return <div className="editor-toolbar" aria-label="画布工具栏" data-testid="editor-toolbar">
    <BorderGlow className="editor-toolbar-group editor-toolbar-group--nodes" tone="neutral" role="group" aria-label="添加节点">
      <SpotlightCard className="editor-toolbar-group-surface" spotlightColor="rgba(10, 132, 255, 0.16)">
        <span className="editor-toolbar-group-label"><ShinyText disabled={layoutPreview}>节点</ShinyText><small>创建流程元素</small></span>
        <div className="editor-toolbar-group-actions">
          {nodeCommands.map(({ type, label, ariaLabel, className, Icon }) => <button
            key={type}
            className={`editor-toolbar-command ${className}`}
            type="button"
            onClick={() => onAddNode(type)}
            disabled={layoutPreview}
            aria-label={ariaLabel}
            title={ariaLabel}
          ><Icon size={15} weight="bold" aria-hidden="true" /><span>{label}</span></button>)}
          <button className="editor-toolbar-command editor-toolbar-node-subguide" type="button" onClick={onInsertSubguide} disabled={layoutPreview} aria-label="插入子指南" title="插入子指南">
            <BookOpen size={15} weight="bold" aria-hidden="true" /><span>子指南</span>
          </button>
        </div>
      </SpotlightCard>
    </BorderGlow>
    <span className="toolbar-divider" aria-hidden="true" />
    <BorderGlow className="editor-toolbar-group editor-toolbar-group--edit editor-toolbar-group--edit-end" tone="neutral" role="group" aria-label="编辑画布">
      <SpotlightCard className="editor-toolbar-group-surface" spotlightColor="rgba(10, 132, 255, 0.2)">
        <span className="editor-toolbar-group-label"><ShinyText disabled={layoutPreview}>编辑</ShinyText><small>整理与修改</small></span>
        <div className="editor-toolbar-group-actions">
          <button className="editor-toolbar-command editor-toolbar-command--icon" type="button" onClick={onUndo} disabled={layoutPreview || !canUndo} aria-label="撤销" title="撤销"><ArrowUUpLeft size={16} weight="bold" aria-hidden="true" /><span>撤销</span></button>
          <button className="editor-toolbar-command editor-toolbar-command--icon" type="button" onClick={onRedo} disabled={layoutPreview || !canRedo} aria-label="重做" title="重做"><ArrowUUpRight size={16} weight="bold" aria-hidden="true" /><span>重做</span></button>
          <button className="editor-toolbar-command" type="button" onClick={onCopy} disabled={!canCopy} aria-label="复制选中节点" title="复制选中节点"><Copy size={15} weight="bold" aria-hidden="true" /><span>复制</span></button>
          <button className="editor-toolbar-command" type="button" onClick={onPaste} disabled={layoutPreview || !canPaste} aria-label="粘贴节点" title="粘贴节点"><Clipboard size={15} weight="bold" aria-hidden="true" /><span>粘贴</span></button>
          <button className="editor-toolbar-command" type="button" onClick={onAlign} disabled={layoutPreview || !canAlign} aria-label="左对齐选中节点" title="左对齐选中节点"><AlignLeft size={15} weight="bold" aria-hidden="true" /><span>左对齐</span></button>
          <button className="editor-toolbar-command editor-toolbar-action-layout" type="button" onClick={onPreviewLayout} disabled={layoutPreview || !canPreviewLayout} aria-label="预览自动整理" title="预览自动整理"><Sparkle size={15} weight="fill" aria-hidden="true" /><span>自动整理</span></button>
          <button className="editor-toolbar-command editor-toolbar-action-delete" type="button" onClick={onRemoveSelected} disabled={layoutPreview || !canDelete} aria-label="删除选中项" title="删除选中项"><X size={15} weight="bold" aria-hidden="true" /><span>删除</span></button>
        </div>
      </SpotlightCard>
    </BorderGlow>
  </div>;
}

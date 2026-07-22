import { ArrowRight, GitBranch, Sparkle, Stack, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';

import type { HierarchyLayoutResult } from '@guideanything/canvas-core';

import { BorderGlow } from '../../components/reactbits/BorderGlow';
import { SpotlightCard } from '../../components/reactbits/SpotlightCard';

export function CanvasLayoutPreviewDialog({ layout, avoidedEdgeCount, onApply, onClose }: { layout: HierarchyLayoutResult; avoidedEdgeCount: number; onApply: () => void; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const report = layout.report;
  const coreStats = [
    { label: '主流程', value: report.primaryNodeIds.length, icon: GitBranch },
    { label: '阶段', value: report.stageCount, icon: Stack },
    { label: '泳道', value: report.laneCount, icon: Stack },
    { label: '资料', value: report.attachedContentIds.length + report.unassignedContentIds.length, icon: Stack },
  ];
  const diagnostics = [
    { label: '孤立节点', value: report.unconnectedPrimaryIds.length },
    { label: '循环', value: report.cycleNodeIds.length },
    { label: '回流', value: report.backEdgeIds.length },
    { label: '避障', value: avoidedEdgeCount },
  ];

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return <BorderGlow
    className="canvas-layout-preview-panel"
    active
    tone="accent"
    role="dialog"
    aria-labelledby="canvas-layout-preview-title"
  >
      <button ref={closeButtonRef} className="modal-close" type="button" onClick={onClose} aria-label="关闭自动整理预览">
        <X size={17} weight="bold" aria-hidden="true" />
      </button>
      <div className="canvas-layout-preview-heading">
        <span className="canvas-layout-preview-icon"><Sparkle size={17} weight="fill" aria-hidden="true" /></span>
        <div>
          <span className="eyebrow">LAYOUT PREVIEW</span>
          <h2 id="canvas-layout-preview-title">自动整理预览</h2>
        </div>
      </div>
      <p className="canvas-layout-preview-intro">先审阅新的流程位置，确认后才会写入草稿。当前节点内容、阶段和泳道不会被改变。</p>

      <SpotlightCard className="canvas-layout-preview-rule-card" spotlightColor="rgba(10, 132, 255, 0.18)">
        <span className="canvas-layout-preview-section-label">整理规则</span>
        <div className="canvas-layout-preview-rules">
          <span><ArrowRight size={14} weight="bold" aria-hidden="true" />阶段从上到下</span>
          <span><ArrowRight size={14} weight="bold" aria-hidden="true" />子节点向右展开</span>
        </div>
      </SpotlightCard>

      <div className="canvas-layout-preview-stats" aria-label="整理结果">
        {coreStats.map(({ icon: Icon, label, value }) => <SpotlightCard className="canvas-layout-preview-stat" key={label} spotlightColor="rgba(10, 132, 255, 0.14)">
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
          <strong>{value}</strong>
        </SpotlightCard>)}
      </div>

      <div className="canvas-layout-preview-diagnostics" role="status" aria-label="整理诊断">
        <span className="canvas-layout-preview-section-label"><WarningCircle size={14} aria-hidden="true" />诊断</span>
        <div>
          {diagnostics.map(({ label, value }) => <span className={value > 0 ? 'is-warning' : ''} key={label}>{label} {value}</span>)}
        </div>
      </div>

      <div className="canvas-layout-preview-actions">
        <button className="secondary-button" type="button" onClick={onClose} aria-label="取消自动整理">取消</button>
        <button className="primary-button" type="button" onClick={onApply}>应用自动整理</button>
      </div>
  </BorderGlow>;
}

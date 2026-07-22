import type { CanvasDocument } from '@guideanything/contracts';
import type { HierarchyLayoutResult, StageBounds, SwimlaneBounds } from '@guideanything/canvas-core';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ViewportPortal,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { NodeAnchorHandle } from '../nodes/NodeChrome';
import { InlineNodeEditingProvider } from '../nodes/InlineNodeTextEditor';
import { NodeActionProvider, NodeAnchorPresentationProvider } from '../nodes/NodeChrome';
import { NodeDetailPresentationProvider } from '../nodes/NodeDetailPresentation';
import { CanvasSwimlanes } from './CanvasSwimlanes';

export interface LayoutCompareAppendixGroup {
  ownerId: string;
  ownerTitle: string;
  resourceIds: string[];
  allHidden: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutComparePanePresentation {
  document: CanvasDocument;
  nodes: Node[];
  edges: Edge[];
  nodeAnchorHandles: ReadonlyMap<string, NodeAnchorHandle[]>;
  stageBounds: StageBounds[];
  swimlaneBounds: SwimlaneBounds[];
  appendixGroups: LayoutCompareAppendixGroup[];
}

type PaneId = 'original' | 'result';
type Viewport = CanvasDocument['viewport'];

const hiddenDetailPresentation = {
  enabled: false,
  expandedNodeIds: new Set<string>(),
  onOpenEditor: () => undefined,
  onToggleExpanded: () => undefined,
};

export function relativeViewport(sourceBase: Viewport, targetBase: Viewport, sourceCurrent: Viewport): Viewport {
  return {
    x: targetBase.x + sourceCurrent.x - sourceBase.x,
    y: targetBase.y + sourceCurrent.y - sourceBase.y,
    zoom: targetBase.zoom * (sourceCurrent.zoom / sourceBase.zoom),
  };
}

export function CanvasLayoutComparePreview({
  original,
  result,
  layout,
  nodeTypes,
  edgeTypes,
  onSelectedIdsChange,
  onApply,
  onClose,
}: {
  original: LayoutComparePanePresentation;
  result: LayoutComparePanePresentation;
  layout: HierarchyLayoutResult;
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  onSelectedIdsChange: (ids: string[]) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const instancesRef = useRef<Record<PaneId, ReactFlowInstance<Node, Edge> | null>>({ original: null, result: null });
  const baselineRef = useRef<Record<PaneId, Viewport> | null>(null);
  const syncingPaneRef = useRef<PaneId | null>(null);
  const clearSyncTimerRef = useRef<number | null>(null);

  const movedNodeCount = useMemo(() => {
    const originalPositions = new Map(original.document.nodes.map((node) => [node.id, node.position]));
    return result.document.nodes.filter((node) => {
      const source = originalPositions.get(node.id);
      return source && (source.x !== node.position.x || source.y !== node.position.y);
    }).length;
  }, [original.document.nodes, result.document.nodes]);

  const close = useCallback(() => {
    onClose();
    window.setTimeout(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
    }, 0);
  }, [onClose]);

  useEffect(() => {
    rootRef.current?.focus();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('keydown', onKeydown);
      if (clearSyncTimerRef.current !== null) window.clearTimeout(clearSyncTimerRef.current);
    };
  }, [close]);

  const resetBaselines = useCallback(() => {
    const originalInstance = instancesRef.current.original;
    const resultInstance = instancesRef.current.result;
    if (!originalInstance || !resultInstance) return;
    baselineRef.current = {
      original: originalInstance.getViewport(),
      result: resultInstance.getViewport(),
    };
  }, []);

  const registerInstance = useCallback((pane: PaneId, instance: ReactFlowInstance<Node, Edge>) => {
    instancesRef.current[pane] = instance;
    resetBaselines();
    window.requestAnimationFrame?.(() => resetBaselines());
  }, [resetBaselines]);

  const syncViewport = useCallback((from: PaneId, viewport: Viewport) => {
    if (syncingPaneRef.current) return;
    const baseline = baselineRef.current;
    if (!baseline) return;
    const to: PaneId = from === 'original' ? 'result' : 'original';
    const target = instancesRef.current[to];
    if (!target) return;
    syncingPaneRef.current = from;
    void Promise.resolve(target.setViewport(relativeViewport(baseline[from], baseline[to], viewport))).finally(() => {
      if (clearSyncTimerRef.current !== null) window.clearTimeout(clearSyncTimerRef.current);
      clearSyncTimerRef.current = window.setTimeout(() => { syncingPaneRef.current = null; }, 0);
    });
  }, []);

  const selectNodes = useCallback(({ nodes }: { nodes: Node[] }) => {
    onSelectedIdsChange(nodes
      .map((node) => node.id)
      .filter((id) => !id.startsWith('resource-appendix-anchor:')));
  }, [onSelectedIdsChange]);

  const report = layout.report;

  return <section ref={rootRef} className="canvas-layout-compare" aria-label="自动整理对照" tabIndex={-1}>
    <header className="canvas-layout-compare-header">
      <div>
        <span className="eyebrow">LAYOUT DIFF</span>
        <h1>自动整理对照</h1>
        <p>拖动画布或缩放其中一侧，另一侧会按相同视角同步；点击节点可在两边对照同一项。</p>
      </div>
      <div className="canvas-layout-compare-actions">
        <button className="secondary-button" type="button" onClick={close} aria-label="取消自动整理">取消</button>
        <button className="primary-button" type="button" onClick={onApply}>应用自动整理</button>
      </div>
    </header>
    <output className="canvas-layout-compare-status" aria-label="自动整理差异摘要">
      <span>位置变化 {movedNodeCount}</span>
      <span className={report.unconnectedPrimaryIds.length > 0 ? 'is-warning' : ''}>孤立节点 {report.unconnectedPrimaryIds.length}</span>
      <span className={report.unassignedContentIds.length > 0 ? 'is-warning' : ''}>未归类资料 {report.unassignedContentIds.length}</span>
      <span className={report.backEdgeIds.length > 0 ? 'is-warning' : ''}>回流 {report.backEdgeIds.length}</span>
    </output>
    <div className="canvas-layout-compare-panes">
      <ComparePane
        pane="original"
        title="原始画布"
        presentation={original}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={registerInstance}
        onMove={syncViewport}
        onSelectionChange={selectNodes}
      />
      <ComparePane
        pane="result"
        title="自动整理结果"
        presentation={result}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={registerInstance}
        onMove={syncViewport}
        onSelectionChange={selectNodes}
      />
    </div>
    <p className="canvas-layout-compare-footnote">对照期间不会改动草稿；只有“应用自动整理”才会写入新的节点位置。</p>
  </section>;
}

function ComparePane({
  pane,
  title,
  presentation,
  nodeTypes,
  edgeTypes,
  onInit,
  onMove,
  onSelectionChange,
}: {
  pane: PaneId;
  title: string;
  presentation: LayoutComparePanePresentation;
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  onInit: (pane: PaneId, instance: ReactFlowInstance<Node, Edge>) => void;
  onMove: (pane: PaneId, viewport: Viewport) => void;
  onSelectionChange: (selection: { nodes: Node[] }) => void;
}) {
  return <section className={`canvas-layout-compare-pane canvas-layout-compare-pane--${pane}`} aria-label={title}>
    <div className="canvas-layout-compare-pane-heading">
      <h2>{title}</h2>
      <span>{pane === 'original' ? '未改动' : '建议位置'}</span>
    </div>
    <NodeAnchorPresentationProvider handlesByNodeId={presentation.nodeAnchorHandles}>
      <NodeDetailPresentationProvider value={hiddenDetailPresentation}>
        <NodeActionProvider enabled={false}>
          <InlineNodeEditingProvider value={{ enabled: false, updateText: () => undefined }}>
            <ReactFlow
              className={`layout-compare-flow layout-compare-flow--${pane}`}
              nodes={presentation.nodes}
              edges={presentation.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultViewport={presentation.document.viewport}
              fitView
              fitViewOptions={{ padding: 0.16, minZoom: 0.1, maxZoom: 1.5 }}
              minZoom={0.1}
              maxZoom={2.5}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              edgesFocusable={false}
              elementsSelectable
              selectionOnDrag={false}
              panOnDrag
              onInit={(instance) => onInit(pane, instance)}
              onMove={(_event, viewport) => onMove(pane, viewport)}
              onSelectionChange={onSelectionChange}
            >
              <ViewportPortal>
                <CanvasSwimlanes bounds={presentation.swimlaneBounds} />
                {presentation.appendixGroups.map((group) => <div
                  key={group.ownerId}
                  className={`resource-appendix${group.allHidden ? ' is-all-hidden' : ''}`}
                  style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
                ><span>{group.allHidden ? `${group.ownerTitle} · 节点资料 ×${group.resourceIds.length}（已隐藏）` : `资料附录 · ${group.resourceIds.length}`}</span></div>)}
                {presentation.stageBounds.map((bound) => <div
                  key={bound.stageId ?? 'none'}
                  className="stage-lane"
                  data-stage-id={bound.stageId ?? 'none'}
                  style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height }}
                ><span className="stage-lane-label">{bound.title}</span></div>)}
              </ViewportPortal>
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--ga-border-strong)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </InlineNodeEditingProvider>
        </NodeActionProvider>
      </NodeDetailPresentationProvider>
    </NodeAnchorPresentationProvider>
  </section>;
}

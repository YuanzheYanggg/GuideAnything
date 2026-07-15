import { ArtifactV1Schema, type ArtifactV1 } from '@guideanything/contracts';
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { ArrowRight, GitDiff, Info, WarningCircle } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router-dom';

import { appendSafeReturnTo } from '../../lib/navigation';
import { SanitizedMarkdown } from '../markdown/SanitizedMarkdown';

export function ArtifactViewer({ artifact }: { artifact: ArtifactV1 }) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const parsed = ArtifactV1Schema.safeParse(artifact);
  if (!parsed.success) return <div className="artifact-invalid" role="alert"><WarningCircle size={20} />这个产物未通过结构校验，无法安全展示。</div>;
  const value = parsed.data;
  if (value.kind === 'REPORT') return <article className="artifact-report">
    <ArtifactHeading artifact={value} label="分析报告" />
    {value.summary ? <p className="artifact-summary">{value.summary}</p> : null}
    {value.sections.map((section) => <section key={section.title}><h3>{section.title}</h3><SanitizedMarkdown>{section.markdown}</SanitizedMarkdown></section>)}
  </article>;
  if (value.kind === 'DIAGRAM') return <article className="artifact-diagram">
    <ArtifactHeading artifact={value} label="结构图" />
    <div className="artifact-diagram-canvas" aria-label={`结构图 ${value.title}`}>
      <ReactFlow
        nodes={diagramNodes(value)}
        edges={diagramEdges(value)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        fitView
        minZoom={0.25}
        maxZoom={1.2}
      ><Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--workspace-line-strong)" /><Controls showInteractive={false} /></ReactFlow>
    </div>
  </article>;
  if (value.kind === 'FLOW_PROPOSAL') return <article className="artifact-flow-proposal">
    <ArtifactHeading artifact={value} label="流程建议 · 不会自动应用" />
    <div className="artifact-proposal-notice"><Info size={18} /><span>这是与正式指南分离的只读建议。当前页面没有“应用”或写回操作。</span></div>
    <p className="artifact-summary">{value.summary}</p>
    <ol>{value.changes.map((change) => <li key={change.id}><span><GitDiff size={16} />{flowChangeLabel(change.kind)}</span><p>{change.summary}</p></li>)}</ol>
  </article>;
  return <article className="artifact-reference-collection">
    <ArtifactHeading artifact={value} label="引用集合" />
    <div>{value.references.map((reference) => reference.href ? <Link key={reference.referenceId} to={appendSafeReturnTo(reference.href, returnTo)}>
      <span><strong>{reference.title}</strong><small>{reference.summary}</small></span><ArrowRight size={16} />
    </Link> : <div className="is-invalid" key={reference.referenceId}><span><strong>{reference.title}</strong><small>{reference.invalidReason}</small></span></div>)}</div>
  </article>;
}

function ArtifactHeading({ artifact, label }: { artifact: ArtifactV1; label: string }) {
  return <header><span className="page-kicker">{label}</span><h2>{artifact.title}</h2><time dateTime={artifact.createdAt}>{formatDateTime(artifact.createdAt)}</time></header>;
}

function diagramNodes(artifact: Extract<ArtifactV1, { kind: 'DIAGRAM' }>): Node[] {
  const horizontal = artifact.direction === 'LR';
  const columns = horizontal ? Math.min(4, artifact.nodes.length) : Math.min(3, artifact.nodes.length);
  return artifact.nodes.map((node, index) => ({
    id: node.id,
    position: horizontal
      ? { x: (index % columns) * 260, y: Math.floor(index / columns) * 150 }
      : { x: (index % columns) * 260, y: Math.floor(index / columns) * 170 },
    data: { label: <div className="artifact-diagram-node"><strong>{node.label}</strong>{node.summary ? <span>{node.summary}</span> : null}</div> },
    style: { width: 210, border: '1px solid var(--workspace-line-strong)', borderRadius: 0, color: 'var(--workspace-text)', background: 'var(--workspace-panel-strong)', padding: 12 },
  }));
}

function diagramEdges(artifact: Extract<ArtifactV1, { kind: 'DIAGRAM' }>): Edge[] {
  return artifact.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#4d91f3' },
    style: { stroke: '#4d91f3', strokeWidth: 1.5 },
    ...(edge.label ? { label: edge.label, labelStyle: { fill: 'var(--workspace-muted)', fontSize: 11 } } : {}),
  }));
}

function flowChangeLabel(kind: Extract<ArtifactV1, { kind: 'FLOW_PROPOSAL' }>['changes'][number]['kind']) {
  return {
    ADD_NODE: '新增节点', UPDATE_NODE: '更新节点', REMOVE_NODE: '移除节点',
    ADD_EDGE: '新增连线', UPDATE_EDGE: '更新连线', REMOVE_EDGE: '移除连线',
  }[kind];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

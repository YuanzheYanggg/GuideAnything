import type { CanvasNode } from '@guideanything/contracts';
import type { CSSProperties, JSX } from 'react';

import { MarkdownNodeView } from '../nodes/MarkdownNode';
import { renderRoutePath, routeLabelPoint } from '../editor/OrthogonalEdge';
import { resolveEdgeVisuals } from '../editor/edge-presentation';
import { isPublicVideoUrl, type PreparedGuidePdfMedia } from './export-media';
import type { GuidePdfExportModel, GuidePdfOverviewNode, GuidePdfResource } from './export-model';

export function GuidePdfExportDocument({
  model,
  media,
}: {
  model: GuidePdfExportModel;
  media: PreparedGuidePdfMedia;
}): JSX.Element {
  const warnings = media.warnings;
  return <main className="pdf-export-document" data-testid="pdf-export-document">
    {warnings.length > 0 ? <WarningPanel warnings={warnings.map((warning) => warning.message)} /> : null}
    <CoverPage model={model} />
    <OverviewPage model={model} />
    {model.steps.map((step) => <StepPage key={step.code} model={model} media={media} stepCode={step.code} />)}
  </main>;
}

function WarningPanel({ warnings }: { warnings: string[] }): JSX.Element {
  return <aside className="pdf-export-warning" data-testid="pdf-export-warning" role="note">
    <strong>导出提醒</strong>
    <ul>{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
  </aside>;
}

function CoverPage({ model }: { model: GuidePdfExportModel }): JSX.Element {
  const { cover } = model;
  return <section className="pdf-export-page pdf-export-cover" data-testid="pdf-export-cover" aria-labelledby="pdf-export-cover-title">
    <p className="pdf-export-kicker">GUIDEANYTHING / PDF EXPORT</p>
    <h1 id="pdf-export-cover-title">{cover.title}</h1>
    {cover.summary ? <p className="pdf-export-cover-summary">{cover.summary}</p> : null}
    {cover.tags.length > 0 ? <div className="pdf-export-tag-list" aria-label="指南标签">{cover.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
    <dl className="pdf-export-cover-meta">
      <div><dt>状态</dt><dd>{cover.status === 'PUBLISHED' ? `已发布 v${cover.publishedVersion ?? 1}` : '草稿'}</dd></div>
      <div><dt>Revision</dt><dd>{cover.revision}</dd></div>
      <div><dt>生成时间</dt><dd>{formatGeneratedAt(cover.generatedAt)}</dd></div>
    </dl>
    <div className="pdf-export-count-grid" aria-label="导出内容统计">
      <Count value={cover.counts.steps} label="步骤" />
      <Count value={cover.counts.markdown} label="Markdown" />
      <Count value={cover.counts.images} label="图片" />
      <Count value={cover.counts.videos} label="视频" />
    </div>
    <p className="pdf-export-cover-note">本文件来自当前已保存草稿。视频内容通过公开地址和二维码访问。</p>
  </section>;
}

function Count({ value, label }: { value: number; label: string }): JSX.Element {
  return <div className="pdf-export-count"><strong>{value}</strong><span>{label}</span></div>;
}

function OverviewPage({ model }: { model: GuidePdfExportModel }): JSX.Element {
  const layout = overviewLayout(model.overview.nodes, model.overview.stageBounds);
  const nodesById = new Map(model.overview.nodes.map((node) => [node.id, node]));
  const resourcesByNodeId = new Map(model.steps.map((step) => [step.node.id, step.resources]));
  const laneTitles = [...new Set(model.overview.nodes.map((node) => node.laneTitle).filter((title): title is string => Boolean(title)))];
  return <section className="pdf-export-page pdf-export-overview" data-testid="pdf-export-overview" aria-labelledby="pdf-export-overview-title">
    <div className="pdf-export-section-heading">
      <div><p className="pdf-export-kicker">01 / FLOW</p><h2 id="pdf-export-overview-title">流程总览</h2></div>
      {laneTitles.length > 0 ? <div className="pdf-export-overview-lanes" aria-label="责任泳道">{laneTitles.map((title) => <span key={title}>泳道 · {title}</span>)}</div> : null}
    </div>
    {model.overview.hasFlow ? <div className="pdf-export-overview-graph" style={{ aspectRatio: `${layout.width} / ${layout.height}` }}>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" role="img" aria-label="流程连线总览">
        <defs>
          <marker id="pdf-export-arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker>
          <marker id="pdf-export-arrow-start" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker>
        </defs>
        <g transform={`translate(${layout.offsetX} ${layout.offsetY})`}>
          {model.overview.stageBounds.map((stage) => <g key={stage.stageId ?? 'unassigned'}>
            <rect className="pdf-export-stage-background" x={stage.x} y={stage.y} width={stage.width} height={stage.height} rx="16" />
            <text className="pdf-export-stage-label" x={stage.x + 16} y={stage.y + 24}>{stage.title}</text>
          </g>)}
          {model.overview.edges.map((edge) => {
            const source = nodesById.get(edge.source);
            const target = nodesById.get(edge.target);
            if (!source || !target) return null;
            const fallback = fallbackEdgePoints(source, target);
            const path = renderRoutePath(edge.route, fallback);
            const visuals = resolveEdgeVisuals(edge.presentation);
            const labelPoint = routeLabelPoint(edge.route?.points ?? fallback);
            return <g key={edge.id} className="pdf-export-edge">
              <path d={path} fill="none" style={visuals.style} markerStart={visuals.markerStart ? 'url(#pdf-export-arrow-start)' : undefined} markerEnd={visuals.markerEnd ? 'url(#pdf-export-arrow-end)' : undefined} />
              {edge.label ? <text className="pdf-export-edge-label" x={labelPoint.x} y={labelPoint.y}>{edge.label}</text> : null}
            </g>;
          })}
        </g>
      </svg>
      {model.overview.nodes.map((node) => <OverviewNodeCard key={node.id} node={node} resources={resourcesByNodeId.get(node.id) ?? []} layout={layout} />)}
    </div> : <div className="pdf-export-empty">没有可展示的流程总览。请先在画布中添加流程节点。</div>}
  </section>;
}

function OverviewNodeCard({ node, resources, layout }: { node: GuidePdfOverviewNode; resources: GuidePdfResource[]; layout: OverviewLayout }): JSX.Element {
  const resourceLabels = [
    resources.filter((resource) => resource.kind === 'markdown').length > 0 ? `Markdown ${resources.filter((resource) => resource.kind === 'markdown').length}` : '',
    resources.filter((resource) => resource.kind === 'image').length > 0 ? `图片 ${resources.filter((resource) => resource.kind === 'image').length}` : '',
    resources.filter((resource) => resource.kind === 'video').length > 0 ? `视频 ${resources.filter((resource) => resource.kind === 'video').length}` : '',
  ].filter(Boolean);
  const style: CSSProperties = {
    left: `${((node.position.x + layout.offsetX) / layout.width) * 100}%`,
    top: `${((node.position.y + layout.offsetY) / layout.height) * 100}%`,
    width: `${(node.size.width / layout.width) * 100}%`,
    height: `${(node.size.height / layout.height) * 100}%`,
  };
  return <article className="pdf-export-overview-node" style={style} aria-label={`${node.code} ${node.title}`}>
    <span className="pdf-export-node-code">{node.code}</span>
    <strong>{node.title}</strong>
    {node.stageTitle || node.laneTitle ? <small>{[node.stageTitle, node.laneTitle].filter(Boolean).join(' · ')}</small> : null}
    {node.summary ? <p>{node.summary}</p> : null}
    {resourceLabels.length > 0 ? <span className="pdf-export-resource-summary">{resourceLabels.join(' · ')}</span> : null}
  </article>;
}

function StepPage({ model, media, stepCode }: { model: GuidePdfExportModel; media: PreparedGuidePdfMedia; stepCode: string }): JSX.Element {
  const step = model.steps.find((candidate) => candidate.code === stepCode)!;
  return <section className="pdf-export-page pdf-export-step" data-testid={`pdf-export-step-${step.code}`} aria-labelledby={`pdf-export-step-title-${step.code}`}>
    <div className="pdf-export-section-heading">
      <div><p className="pdf-export-kicker">02 / STEP {step.code}</p><h2 id={`pdf-export-step-title-${step.code}`}>{step.title}</h2></div>
      <span className="pdf-export-step-badge">{step.node.type.toUpperCase()}</span>
    </div>
    {step.stageTitle || step.laneTitle ? <p className="pdf-export-context">{[step.stageTitle, step.laneTitle].filter(Boolean).join(' · ')}</p> : null}
    {step.description ? <div className="pdf-export-step-description">{step.description}</div> : <p className="pdf-export-step-description is-empty">此步骤没有填写详细说明。</p>}
    {step.relatedEdgeLabels.length > 0 ? <div className="pdf-export-edge-notes"><strong>流程条件</strong>{step.relatedEdgeLabels.map((label) => <span key={label}>{label}</span>)}</div> : null}
    <div className="pdf-export-resource-list">
      {step.resources.map((resource) => <ResourceBlock key={resource.id} resource={resource} media={media} />)}
    </div>
  </section>;
}

function ResourceBlock({ resource, media }: { resource: GuidePdfResource; media: PreparedGuidePdfMedia }): JSX.Element {
  if (resource.kind === 'markdown') return <article className="pdf-export-media-card pdf-export-markdown-resource"><p className="pdf-export-resource-code">{resource.code} / MARKDOWN</p><MarkdownNodeView data={{ markdown: resource.markdown }} /></article>;
  if (resource.kind === 'image') return <ImageResource resource={resource} media={media} />;
  return <VideoResource resource={resource} media={media} />;
}

function ImageResource({ resource, media }: { resource: Extract<GuidePdfResource, { kind: 'image' }>; media: PreparedGuidePdfMedia }): JSX.Element {
  const source = media.imageSourceByUrl.get(resource.url) ?? resource.url;
  return <figure className="pdf-export-image-resource pdf-export-media-card" data-testid={`pdf-export-image-${resource.id}`}>
    <p className="pdf-export-resource-code">{resource.code} / IMAGE</p>
    <div className="pdf-export-image-frame">
      <img src={source} alt={resource.alt} />
      {resource.annotations.map((annotation, index) => <span
        className={`pdf-export-annotation-marker is-${annotation.shape.toLowerCase()}`}
        data-testid={`pdf-export-annotation-${annotation.id}`}
        key={annotation.id}
        style={annotationStyle(annotation)}
        title={`${index + 1}. ${annotation.title}`}
      ><b>{index + 1}</b></span>)}
    </div>
    <figcaption>{resource.caption ? <strong>{resource.caption}</strong> : null}<ol className="pdf-export-annotation-list">{resource.annotations.map((annotation, index) => <li key={annotation.id}><strong>{index + 1}. {annotation.title}</strong>{annotation.body ? <span>{annotation.body}</span> : null}{annotation.supplementalImages?.map((supplement) => <img key={supplement.id} src={media.imageSourceByUrl.get(supplement.url) ?? supplement.url} alt={supplement.alt} />)}</li>)}</ol></figcaption>
  </figure>;
}

function annotationStyle(annotation: Extract<GuidePdfResource, { kind: 'image' }>['annotations'][number]): CSSProperties {
  const style: CSSProperties = {
    left: `${annotation.region.x * 100}%`,
    top: `${annotation.region.y * 100}%`,
  };
  if (annotation.shape === 'POINT') {
    style.transform = 'translate(-50%, -50%)';
  } else {
    style.width = `${(annotation.region.width ?? 0) * 100}%`;
    style.height = `${(annotation.region.height ?? 0) * 100}%`;
  }
  return style;
}

function VideoResource({ resource, media }: { resource: Extract<GuidePdfResource, { kind: 'video' }>; media: PreparedGuidePdfMedia }): JSX.Element {
  const qrDataUrl = media.qrDataUrlByVideoId.get(resource.id);
  const isPublic = isPublicVideoUrl(resource.url);
  return <article className="pdf-export-video-resource pdf-export-media-card" data-testid={`pdf-export-video-${resource.id}`}>
    <p className="pdf-export-resource-code">{resource.code} / VIDEO</p>
    <div className="pdf-export-video-card">
      <div className="pdf-export-video-icon" aria-hidden="true">▶</div>
      <div className="pdf-export-video-copy"><h3>{resource.caption || '视频资料'}</h3>{resource.caption ? <p>{resource.caption}</p> : null}<ul className="pdf-export-keypoints">{resource.keypoints.map((keypoint) => <li key={keypoint.id}><time>{formatVideoTime(keypoint.timeSeconds)}</time><span>{keypoint.title}</span></li>)}</ul></div>
      {qrDataUrl ? <img className="pdf-export-video-qr" src={qrDataUrl} alt={`${resource.caption || '视频'}二维码`} /> : <div className="pdf-export-video-qr-empty">二维码不可用</div>}
    </div>
    <p className="pdf-export-video-url">{isPublic ? <a href={resource.url} target="_blank" rel="noreferrer">{resource.url}</a> : <code>{resource.url}</code>}</p>
  </article>;
}

interface OverviewLayout {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

function overviewLayout(nodes: GuidePdfOverviewNode[], stages: GuidePdfExportModel['overview']['stageBounds']): OverviewLayout {
  const minX = Math.min(0, ...nodes.map((node) => node.position.x), ...stages.map((stage) => stage.x));
  const minY = Math.min(0, ...nodes.map((node) => node.position.y), ...stages.map((stage) => stage.y));
  const maxX = Math.max(720, ...nodes.map((node) => node.position.x + node.size.width), ...stages.map((stage) => stage.x + stage.width));
  const maxY = Math.max(360, ...nodes.map((node) => node.position.y + node.size.height), ...stages.map((stage) => stage.y + stage.height));
  const padding = 48;
  return { width: maxX - minX + padding * 2, height: maxY - minY + padding * 2, offsetX: padding - minX, offsetY: padding - minY };
}

function fallbackEdgePoints(source: GuidePdfOverviewNode, target: GuidePdfOverviewNode) {
  return [
    { x: source.position.x + source.size.width, y: source.position.y + source.size.height / 2 },
    { x: target.position.x, y: target.position.y + target.size.height / 2 },
  ];
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatVideoTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

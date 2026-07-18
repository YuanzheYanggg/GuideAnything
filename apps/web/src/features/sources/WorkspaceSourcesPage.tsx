import { useEffect, useRef, useState } from 'react';
import {
  ArrowSquareOut,
  CheckCircle,
  File,
  FlowArrow,
  GlobeHemisphereWest,
  UploadSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import type { KnowledgeHealth } from '../knowledge/types';
import type { WorkspaceApi, WorkspaceFolder } from '../workspace/types';
import type { FlowSnapshotSummary, SourcesApi, WorkspaceSource, WorkspaceSourcesResult } from './types';

export function WorkspaceSourcesPage({ api, workspaceApi }: { api: SourcesApi; workspaceApi: WorkspaceApi }) {
  const { workspaceId } = useParams();
  const [searchParams] = useSearchParams();
  const [sources, setSources] = useState<WorkspaceSourcesResult | null>(null);
  const [snapshots, setSnapshots] = useState<FlowSnapshotSummary[]>([]);
  const [vault, setVault] = useState<KnowledgeHealth | null>(null);
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [folderId, setFolderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const targetRowRef = useRef<HTMLElement>(null);
  const rawTargetDocumentId = searchParams.get('document');
  const targetRequested = rawTargetDocumentId !== null;
  const targetDocumentId = readLocatorParam(rawTargetDocumentId);
  const targetFragment = readLocatorParam(searchParams.get('fragment'));
  const targetSource = targetDocumentId
    ? sources?.items.find((source) => source.documentId === targetDocumentId)
    : undefined;

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([api.list(workspaceId), api.listFlowSnapshots(workspaceId), api.santexwellStatus(), workspaceApi.listFolders(workspaceId)])
      .then(([nextSources, nextSnapshots, nextVault, nextFolders]) => {
        if (!active) return;
        setSources(nextSources);
        setSnapshots(nextSnapshots);
        setVault(nextVault);
        setFolders(nextFolders);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '资料源载入失败');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, workspaceApi, workspaceId]);

  useEffect(() => {
    if (loading || !targetSource) return;
    const target = targetRowRef.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'center' });
  }, [loading, targetSource]);

  const upload = async (file: File) => {
    if (!workspaceId || !sources?.capabilities.canUploadPersistentSource || uploading) return;
    setUploading(true);
    setError('');
    try {
      const created = folderId
        ? await api.upload(workspaceId, file, folderId)
        : await api.upload(workspaceId, file);
      setSources((current) => current ? { ...current, items: [created, ...current.items.filter((item) => item.sourceId !== created.sourceId)] } : current);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '资料上传失败');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (loading) return <div className="workspace-loading" role="status"><span className="spinner" /><span>正在整理工作区资料…</span></div>;
  if (!workspaceId || !sources) return <section className="page-stack"><p className="workspace-error" role="alert">{error || '工作区不存在'}</p></section>;

  return <section className="workspace-sources page-stack">
    <header className="page-heading">
      <div><span className="page-kicker">WORKSPACE SOURCES</span><h1>资料源</h1><p>Agent 会先读取这里的流程快照和工作区文档，再按本轮开关决定是否补充 Santexwell。</p></div>
      {sources.capabilities.canUploadPersistentSource ? <div className="source-upload-controls"><select aria-label="上传到文件夹" value={folderId} disabled={uploading} onChange={(event) => setFolderId(event.target.value)}><option value="">未归类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder, new Map(folders.map((item) => [item.id, item])))}</option>)}</select><label className={`workspace-create-button source-upload-button${uploading ? ' is-busy' : ''}`}>
        <UploadSimple size={18} /><span>{uploading ? '正在处理…' : '上传资料'}</span>
        <input ref={inputRef} aria-label="上传工作区资料" type="file" accept=".md,.txt,.pdf,.docx" disabled={uploading} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }} />
      </label></div> : <span className="source-readonly-note">当前权限仅支持查看</span>}
    </header>

    {error ? <p className="workspace-error" role="alert">{error}</p> : null}
    {targetRequested ? targetSource
      ? <p className="source-reference-notice" role="status">已定位引用资料：{targetSource.title}</p>
      : <p className="workspace-error" role="alert">引用资料不存在或当前不可访问</p>
      : null}

    <div className="source-health-grid">
      <article className="source-health-card">
        <span className="source-health-icon"><GlobeHemisphereWest size={22} /></span>
        <div><span className="page-kicker">GLOBAL VAULT</span><h2>{vault?.status === 'READY' ? 'Santexwell 可用' : vault?.status === 'DEGRADED' ? 'Santexwell 使用旧索引' : 'Santexwell 不可用'}</h2><p>{vault ? `${vault.indexedDocuments.toLocaleString('zh-CN')} 个知识页面 · ${vault.indexedFragments.toLocaleString('zh-CN')} 个证据片段` : '未获取到索引状态'}</p></div>
        <span className={`source-state is-${vault?.status.toLowerCase() ?? 'unavailable'}`}>{vault?.status ?? 'UNAVAILABLE'}</span>
      </article>
      <article className="source-health-card">
        <span className="source-health-icon is-flow"><FlowArrow size={22} /></span>
        <div><span className="page-kicker">FLOW SNAPSHOTS</span><h2>{snapshots.length} 份可读流程</h2><p>保存与发布后的画布会编译成 Agent 可定位的节点、阶段、泳道和邻域。</p></div>
        <span className="source-state is-ready">READ ONLY</span>
      </article>
    </div>

    <section aria-labelledby="source-flow-heading">
      <div className="section-title"><div><span className="page-kicker">FLOW KNOWLEDGE</span><h2 id="source-flow-heading">流程快照</h2></div><span className="page-count">{snapshots.length}</span></div>
      {snapshots.length === 0 ? <div className="workspace-empty compact"><strong>还没有流程快照</strong><span>指南保存或发布后会自动生成。</span></div> : <div className="flow-snapshot-grid">
        {snapshots.map((snapshot) => <FlowSnapshotCard key={snapshot.snapshotId} snapshot={snapshot} />)}
      </div>}
    </section>

    <section aria-labelledby="source-documents-heading">
      <div className="section-title"><div><span className="page-kicker">DOCUMENTS</span><h2 id="source-documents-heading">工作区文档</h2></div><span className="page-count">{sources.items.length}</span></div>
      {sources.items.length === 0 ? <div className="workspace-empty"><strong>尚未添加工作区资料</strong><span>作者或编辑者可以上传 Markdown、文本、PDF 或 DOCX。</span></div> : <div className="source-document-list">
        {sources.items.map((source) => {
          const targeted = source.documentId === targetDocumentId;
          return <SourceDocumentRow
            key={source.sourceId}
            source={source}
            targeted={targeted}
            targetFragment={targeted ? targetFragment : undefined}
            targetRef={targeted ? targetRowRef : undefined}
            folderName={source.folderId ? folderPath(folders.find((folder) => folder.id === source.folderId), new Map(folders.map((item) => [item.id, item]))) : undefined}
          />;
        })}
      </div>}
    </section>
  </section>;
}

function FlowSnapshotCard({ snapshot }: { snapshot: FlowSnapshotSummary }) {
  const content = <>
    <div><span className="flow-snapshot-icon"><FlowArrow size={20} /></span><span className={`source-state is-${snapshot.status.toLowerCase()}`}>{snapshot.status}</span></div>
    <h3>{snapshot.guideTitle}</h3>
    <p>{snapshot.origin.kind === 'PUBLISHED' ? `已发布 v${snapshot.origin.version}` : `草稿修订 ${snapshot.origin.revision}`} · {snapshot.nodeCount} 个可定位节点</p>
    {snapshot.href ? <span className="knowledge-open-label">打开流程 <ArrowSquareOut size={15} /></span> : <span className="source-invalid">当前快照不可导航</span>}
  </>;
  return snapshot.href ? <Link className="flow-snapshot-card" to={snapshot.href}>{content}</Link> : <article className="flow-snapshot-card is-invalid">{content}</article>;
}

function SourceDocumentRow({
  source,
  targeted = false,
  targetFragment,
  targetRef,
  folderName,
}: {
  source: WorkspaceSource;
  targeted?: boolean;
  targetFragment?: string | undefined;
  targetRef?: React.RefObject<HTMLElement | null> | undefined;
  folderName?: string | undefined;
}) {
  const ready = source.status === 'READY' && source.parseStatus === 'READY';
  return <article
    ref={targetRef}
    className={`source-document-row${targeted ? ' is-target' : ''}`}
    aria-label={`资料 ${source.title}`}
    tabIndex={targeted ? -1 : undefined}
    data-target-fragment={targetFragment}
  >
    <span className="source-document-icon"><File size={20} /></span>
    <div><strong>{source.title}</strong><span>{folderName ? `${folderName} · ` : ''}{formatBytes(source.size)} · 更新于 {formatDateTime(source.updatedAt)}</span>{source.failureMessage ? <small>{source.failureMessage}</small> : null}</div>
    <span className={`source-state is-${source.status.toLowerCase()}`}>{ready ? <><CheckCircle size={14} />可检索</> : <><WarningCircle size={14} />{source.status === 'FAILED' ? '处理失败' : '处理中'}</>}</span>
  </article>;
}

function formatBytes(size: number) {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1_024).toFixed(1)} KiB`;
  return `${(size / 1_048_576).toFixed(1)} MiB`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function readLocatorParam(value: string | null): string | undefined {
  if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) return undefined;
  return value;
}

function folderPath(folder: WorkspaceFolder | undefined, foldersById: Map<string, WorkspaceFolder>): string {
  if (!folder) return '未归类';
  const names = [folder.name];
  const visited = new Set([folder.id]);
  let parentId = folder.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = foldersById.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(' / ');
}

import type { ArtifactV1, ConversationSummaryV1 } from '@guideanything/contracts';
import { Archive, ChatCircleDots, FileText } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { ArtifactViewer } from './ArtifactViewer';
import type { ArtifactsApi } from './types';

export function WorkspaceArtifactsPage({ api }: { api: ArtifactsApi }) {
  const { workspaceId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [artifacts, setArtifacts] = useState<ArtifactV1[]>([]);
  const [conversations, setConversations] = useState<ConversationSummaryV1[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tab = searchParams.get('tab') === 'conversations' ? 'conversations' : 'artifacts';
  const artifactId = searchParams.get('artifact');
  const selected = artifacts.find((artifact) => artifact.id === artifactId) ?? artifacts[0] ?? null;

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setLoading(true);
    Promise.all([api.listWorkspace(workspaceId), api.listWorkspaceConversations(workspaceId)])
      .then(([nextArtifacts, nextConversations]) => {
        if (!active) return;
        setArtifacts(nextArtifacts);
        setConversations(nextConversations);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '会话与产物载入失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, workspaceId]);

  const setTab = (nextTab: 'artifacts' | 'conversations') => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    next.delete('artifact');
    setSearchParams(next);
  };
  const selectArtifact = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'artifacts');
    next.set('artifact', id);
    setSearchParams(next);
  };

  if (loading) return <div className="workspace-loading" role="status"><span className="spinner" /><span>正在载入会话与产物…</span></div>;
  if (!workspaceId) return <p className="workspace-error" role="alert">工作区不存在</p>;
  return <section className="workspace-artifacts page-stack">
    <header className="page-heading"><div><span className="page-kicker">PRIVATE OUTPUTS</span><h1>会话与产物</h1><p>这里保存你自己的知识问答与经过结构校验的报告、结构图、流程建议和引用集合。</p></div></header>
    {error ? <p className="workspace-error" role="alert">{error}</p> : null}
    <div className="artifact-tabs" role="tablist" aria-label="会话与产物视图">
      <button type="button" role="tab" aria-selected={tab === 'artifacts'} onClick={() => setTab('artifacts')}><Archive size={17} />产物 <span>{artifacts.length}</span></button>
      <button type="button" role="tab" aria-selected={tab === 'conversations'} onClick={() => setTab('conversations')}><ChatCircleDots size={17} />会话 <span>{conversations.length}</span></button>
    </div>
    {tab === 'artifacts' ? artifacts.length === 0 ? <div className="workspace-empty"><strong>还没有产物</strong><span>Agent 生成并验证报告或结构图后会显示在这里。</span></div> : <div className="artifact-workbench">
      <nav aria-label="产物列表">{artifacts.map((artifact) => <button type="button" className={artifact.id === selected?.id ? 'is-selected' : undefined} key={artifact.id} onClick={() => selectArtifact(artifact.id)}><FileText size={17} /><span><strong>{artifact.title}</strong><small>{artifactKindLabel(artifact.kind)}</small></span></button>)}</nav>
      <div className="artifact-viewer">{selected ? <ArtifactViewer artifact={selected} /> : null}</div>
    </div> : <ConversationList items={conversations} workspaceId={workspaceId} />}
  </section>;
}

function ConversationList({ items, workspaceId }: { items: ConversationSummaryV1[]; workspaceId: string }) {
  if (items.length === 0) return <div className="workspace-empty"><strong>还没有私有会话</strong><span>从 Agent 页面开始一次问答。</span></div>;
  return <div className="artifact-conversation-list">{items.map((conversation) => <Link key={conversation.id} to={`/workspaces/${encodeURIComponent(workspaceId)}/agents?conversation=${encodeURIComponent(conversation.id)}`}><ChatCircleDots size={18} /><span><strong>{conversation.title}</strong><small>{conversation.lastMessagePreview ?? '打开会话'}</small></span><time dateTime={conversation.updatedAt}>{formatDate(conversation.updatedAt)}</time></Link>)}</div>;
}

function artifactKindLabel(kind: ArtifactV1['kind']) {
  return { REPORT: '报告', DIAGRAM: '结构图', FLOW_PROPOSAL: '流程建议', REFERENCE_COLLECTION: '引用集合' }[kind];
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

import { useEffect, useState } from 'react';
import { ArrowRight, FileText } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';

import type { WorkspaceApi, WorkspaceSummary } from './types';

export function WorkspaceDirectoryPage({ workspaceApi }: { workspaceApi: WorkspaceApi }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    workspaceApi.list()
      .then((items) => { if (active) setWorkspaces(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '工作区载入失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceApi]);

  return <div className="workspace-directory page-stack">
    <header className="page-heading">
      <div><span className="page-kicker">KNOWLEDGE DOMAINS</span><h1>工作区</h1><p>进入有明确业务边界、负责人和权限的知识空间。</p></div>
      <span className="page-count">{workspaces.length} 个工作区</span>
    </header>
    {loading ? <LoadingState label="正在载入工作区…" /> : null}
    {error ? <p className="workspace-error" role="alert">{error}</p> : null}
    {!loading && !error && workspaces.length === 0 ? <div className="workspace-empty"><strong>还没有可访问的工作区</strong><span>请联系工作区所有者添加成员权限。</span></div> : null}
    {!loading && !error && workspaces.length > 0 ? <div className="workspace-directory-grid">
      {workspaces.map((workspace) => <Link className={`workspace-card domain-card-${workspace.colorKey}`} to={`/workspaces/${workspace.id}`} key={workspace.id}>
        <span className="workspace-card-icon"><FileText size={23} /></span>
        <div className="workspace-card-title"><h2>{workspace.name}</h2><ArrowRight size={20} /></div>
        <p>{workspace.description || '这个工作区暂未补充业务范围说明。'}</p>
        <dl>
          <div><dt>负责人</dt><dd>{workspace.ownerName}</dd></div>
          <div><dt>权限</dt><dd>{permissionLabel(workspace.permission)}</dd></div>
          <div><dt>内容</dt><dd>{workspace.guideCount} 条指南</dd></div>
          <div><dt>更新</dt><dd>{formatDate(workspace.updatedAt)}</dd></div>
        </dl>
      </Link>)}
    </div> : null}
  </div>;
}

function permissionLabel(permission: WorkspaceSummary['permission']) {
  return { OWNER: '所有者', EDIT: '可编辑', VIEW: '可查看' }[permission];
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function LoadingState({ label }: { label: string }) {
  return <div className="workspace-loading" role="status"><span className="spinner" /><span>{label}</span></div>;
}

import { useEffect, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BookOpen,
  ChatCircleDots,
  Database,
  Lightbulb,
  Star,
} from '@phosphor-icons/react';
import { Link, useOutletContext, useParams } from 'react-router-dom';

import type { WorkspaceActivity, WorkspaceApi, WorkspaceItemKind, WorkspaceItemSummary, WorkspaceSummary } from './types';
import type { WorkspaceOutletContext } from './WorkspaceShell';

type Counts = Record<WorkspaceItemKind, number>;

interface OverviewData {
  workspace: WorkspaceSummary;
  counts: Counts;
  activity: WorkspaceActivity[];
  items: WorkspaceItemSummary[];
}

const moduleDefinitions = [
  { key: 'GUIDE', label: '指南', route: 'guides', icon: BookOpen },
  { key: 'SOURCE', label: '资料源', route: 'sources', icon: Database },
  { key: 'AGENT', label: 'Agent', route: 'agents', icon: ChatCircleDots },
  { key: 'ARTIFACT', label: '会话与产物', route: 'artifacts', icon: Archive },
] as const;

export function WorkspaceOverviewPage({ workspaceApi }: { workspaceApi: WorkspaceApi }) {
  const { user } = useOutletContext<WorkspaceOutletContext>();
  const { workspaceId } = useParams();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setData(null);
    setError('');
    Promise.all([
      workspaceApi.get(workspaceId),
      workspaceApi.activity(workspaceId),
      workspaceApi.listItems(workspaceId, 'GUIDE'),
    ]).then(([detail, activity, items]) => {
      if (active) setData({ ...detail, activity, items });
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '工作区概览载入失败');
    });
    return () => { active = false; };
  }, [workspaceApi, workspaceId]);

  if (error) return <div className="workspace-overview"><p className="workspace-error" role="alert">{error}</p></div>;
  if (!data) return <div className="workspace-loading" role="status"><span className="spinner" /><span>正在载入工作区概览…</span></div>;

  const favorites = data.items.filter((item) => item.favorite);
  return <section className="workspace-overview">
    <WorkspaceHero workspace={data.workspace} canCreate={user.role === 'AUTHOR' || user.role === 'EDITOR'} />
    <ModuleGrid counts={data.counts} workspace={data.workspace} />
    <RecentActivity items={data.activity} />
    <FavoriteResources items={favorites} />
  </section>;
}

function WorkspaceHero({ workspace, canCreate }: { workspace: WorkspaceSummary; canCreate: boolean }) {
  return <header className={`workspace-hero domain-card-${workspace.colorKey}`}>
    <div>
      <span className="page-kicker">工作区概览</span><h1>{workspace.name}</h1>
      <p>{workspace.description || '这个工作区暂未补充业务范围说明。'}</p>
      {canCreate && workspace.permission !== 'VIEW' ? <Link className="workspace-create-button workspace-hero-create" to={`/workspaces/${workspace.id}/guides?create=1`}><span aria-hidden="true">+</span>新建指南</Link> : null}
    </div>
    <dl><div><dt>负责人</dt><dd>{workspace.ownerName}</dd></div><div><dt>我的权限</dt><dd>{permissionLabel(workspace.permission)}</dd></div><div><dt>最近更新</dt><dd>{formatDate(workspace.updatedAt)}</dd></div></dl>
  </header>;
}

function ModuleGrid({ counts, workspace }: { counts: Counts; workspace: WorkspaceSummary }) {
  const modules = [
    ...moduleDefinitions,
    ...(workspace.permission === 'OWNER' || workspace.permission === 'EDIT'
      ? [{ key: 'EDITORIAL', label: '知识演进', route: 'knowledge-evolution', icon: Lightbulb }]
      : []),
  ];
  return <section aria-labelledby="module-heading">
    <div className="section-title"><div><span className="page-kicker">MODULES</span><h2 id="module-heading">知识模块</h2></div></div>
    <div className="module-grid">
      {modules.map(({ key, label, route, icon: IconComponent }) => {
        const count = moduleCount(counts, key);
        return <Link key={key} to={`/workspaces/${workspace.id}/${route}`} className="module-card">
          <span className="module-icon"><IconComponent size={23} /></span>
          <div><strong>{label}</strong><span>{count === undefined ? '编辑专属' : `${count} 项`}</span></div>
          <ArrowRight size={18} />
        </Link>;
      })}
    </div>
  </section>;
}

function moduleCount(counts: Counts, key: string): number | undefined {
  if (key === 'ARTIFACT') return counts.ARTIFACT + counts.CONVERSATION;
  if (key === 'EDITORIAL') return undefined;
  return counts[key as WorkspaceItemKind];
}

function RecentActivity({ items }: { items: WorkspaceActivity[] }) {
  return <section className="overview-panel" aria-labelledby="activity-heading">
    <div className="section-title"><div><span className="page-kicker">RECENT</span><h2 id="activity-heading">最近更新</h2></div></div>
    {items.length === 0 ? <div className="workspace-empty compact"><strong>还没有活动记录</strong><span>创建或更新指南后，真实活动会显示在这里。</span></div> : <ol className="activity-list">
      {items.slice(0, 6).map((item) => <li key={item.id}><span className="activity-dot" /><div><strong>{item.actorName}</strong><span>{activityLabel(item.action)}</span></div><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></li>)}
    </ol>}
  </section>;
}

function FavoriteResources({ items }: { items: WorkspaceItemSummary[] }) {
  return <section className="overview-panel" aria-labelledby="favorite-heading">
    <div className="section-title"><div><span className="page-kicker">PINNED</span><h2 id="favorite-heading">常用资源</h2></div></div>
    {items.length === 0 ? <div className="workspace-empty compact"><strong>尚未收藏本工作区资源</strong><span>收藏的真实指南会集中显示在这里。</span></div> : <div className="favorite-resource-list">
      {items.slice(0, 5).map((item) => <FavoriteResource key={item.id} item={item} />)}
    </div>}
  </section>;
}

function FavoriteResource({ item }: { item: WorkspaceItemSummary }) {
  const route = favoriteRoute(item);
  const content = <><Star size={18} weight="fill" /><div><strong>{item.title}</strong><span>{item.summary || '暂无摘要'}</span></div></>;
  return route
    ? <Link className="favorite-resource-item" to={route}>{content}</Link>
    : <article className="favorite-resource-item">{content}</article>;
}

function favoriteRoute(item: WorkspaceItemSummary): string | null {
  if (item.kind !== 'GUIDE') return null;
  if (item.canEdit) return `/guides/${item.entityId}/edit`;
  if (item.publishedVersionId) return `/versions/${item.publishedVersionId}/learn`;
  return null;
}

function permissionLabel(permission: WorkspaceSummary['permission']) {
  return { OWNER: '所有者', EDIT: '可编辑', VIEW: '可查看' }[permission];
}

function activityLabel(action: WorkspaceActivity['action']) {
  return {
    GUIDE_CREATED: '创建了指南', GUIDE_UPDATED: '更新了指南', GUIDE_PUBLISHED: '发布了指南',
    COLLABORATOR_ADDED: '添加了协作者', ITEM_TRASHED: '将资源移到回收站', ITEM_RESTORED: '恢复了资源',
  }[action];
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';

import { ResourceTable } from '../resources/ResourceTable';
import type { WorkspaceOutletContext } from '../workspace/WorkspaceShell';
import type { PersonalApi, WorkspaceItemSummary } from '../workspace/types';

type PersonalPageKind = 'favorites' | 'recent' | 'shared' | 'trash';

const pageConfig = {
  favorites: ['收藏夹', '保存的常用资源', '还没有收藏任何资源'],
  recent: ['最近查看', '继续上次的工作', '还没有查看记录'],
  shared: ['与我共享', '别人明确邀请你协作的资源', '还没有共享给你的资源'],
  trash: ['回收站', '恢复或永久移除资源', '回收站为空'],
} as const;

interface PersonalResourcePageProps {
  kind: PersonalPageKind;
  api?: PersonalApi;
  onOpen?: (item: WorkspaceItemSummary) => void;
}

export function PersonalResourcePage({ kind, api: apiProp, onOpen: onOpenProp }: PersonalResourcePageProps) {
  if (apiProp) return <PersonalResourcePageContent kind={kind} api={apiProp} onOpen={onOpenProp ?? (() => undefined)} />;
  return <RoutedPersonalResourcePage kind={kind} />;
}

function RoutedPersonalResourcePage({ kind }: { kind: PersonalPageKind }) {
  const { personalApi } = useOutletContext<WorkspaceOutletContext>();
  const navigate = useNavigate();
  return <PersonalResourcePageContent kind={kind} api={personalApi} onOpen={(item) => {
    const route = resourceRoute(item);
    if (route) navigate(route);
  }} />;
}

function PersonalResourcePageContent({ kind, api, onOpen }: {
  kind: PersonalPageKind;
  api: PersonalApi;
  onOpen: (item: WorkspaceItemSummary) => void;
}) {
  const [items, setItems] = useState<WorkspaceItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, description, emptyCopy] = pageConfig[kind];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const loader = {
      favorites: api.listFavorites,
      recent: api.listRecent,
      shared: api.listShared,
      trash: api.listTrash,
    }[kind];
    loader()
      .then((result) => { if (active) setItems(result); })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason, '资源载入失败')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, kind]);

  const mutate = async (item: WorkspaceItemSummary, operation: () => Promise<unknown>, update: () => void) => {
    setError('');
    try {
      await operation();
      update();
    } catch (reason) {
      setError(errorMessage(reason, '操作失败'));
      throw reason;
    }
  };

  const remove = (id: string) => setItems((current) => current.filter((item) => item.id !== id));
  return <section className="personal-resource-page page-stack">
    <header className="page-heading">
      <div><span className="page-kicker">PERSONAL</span><h1>{title}</h1><p>{description}</p></div>
      {!loading ? <span className="page-count">{items.length} 项</span> : null}
    </header>

    {error ? <p className="workspace-error" role="alert">{error}</p> : null}
    {loading ? <div className="workspace-loading" role="status"><span className="spinner" /><span>正在载入{title}…</span></div> : null}
    {!loading && !error && items.length === 0 ? <div className="workspace-empty"><strong>{emptyCopy}</strong><span>{emptyHint(kind)}</span></div> : null}
    {!loading && items.length > 0 ? <ResourceTable
      mode={kind}
      items={items}
      onOpen={onOpen}
      onFavorite={(item, favorite) => mutate(item, () => favorite ? api.favorite(item.id) : api.unfavorite(item.id), () => {
        if (kind === 'favorites' && !favorite) remove(item.id);
        else setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, favorite } : currentItem));
      })}
      onTrash={(item) => mutate(item, () => api.trashItem(item.id), () => remove(item.id))}
      onRestore={(item) => mutate(item, () => api.restoreItem(item.id), () => remove(item.id))}
      onPermanentRemove={(item) => mutate(item, () => api.permanentlyRemoveItem(item.id), () => remove(item.id))}
    /> : null}
  </section>;
}

function resourceRoute(item: WorkspaceItemSummary): string | null {
  if (item.kind !== 'GUIDE') return null;
  if ((item.permission === 'OWNER' || item.permission === 'EDIT') && !item.publishedVersionId) return `/guides/${item.entityId}/edit`;
  if (item.publishedVersionId) return `/versions/${item.publishedVersionId}/learn`;
  return null;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function emptyHint(kind: PersonalPageKind): string {
  return {
    favorites: '收藏常用资源后，它们会集中显示在这里。',
    recent: '打开指南后，可从这里继续上次的工作。',
    shared: '明确邀请你协作的资源会显示在这里。',
    trash: '移除的资源会暂时保留在这里。',
  }[kind];
}

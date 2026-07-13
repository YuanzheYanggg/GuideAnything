import { type FormEvent, useEffect, useState } from 'react';

import type { AuthUser } from '../auth/types';
import { AppearanceToggle } from '../theme/AppearanceToggle';

export interface SearchItem {
  versionId: string;
  guideId: string;
  title: string;
  summary: string;
  tags: string[];
  version: number;
  authorName: string;
}

export interface DraftItem {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  status: string;
  revision: number;
}

export interface LibraryApi {
  listDrafts: () => Promise<DraftItem[]>;
  search: (query: string) => Promise<SearchItem[]>;
  createGuide: () => Promise<{ id: string }>;
}

interface LibraryPageProps {
  user: AuthUser;
  api: LibraryApi;
  onEdit: (guideId: string) => void;
  onLearn: (versionId: string) => void;
  onLogout?: () => void;
}

export function LibraryPage({ user, api, onEdit, onLearn, onLogout }: LibraryPageProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(user.role !== 'LEARNER');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user.role === 'LEARNER') return;
    let active = true;
    api.listDrafts()
      .then((items) => { if (active) setDrafts(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '草稿载入失败'); })
      .finally(() => { if (active) setLoadingDrafts(false); });
    return () => { active = false; };
  }, [api, user.role]);

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      setResults(await api.search(query.trim()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '检索失败，请稍后重试');
    } finally {
      setSearching(false);
    }
  };

  const create = async () => {
    setError('');
    try {
      const guide = await api.createGuide();
      onEdit(guide.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建指南失败');
    }
  };

  return (
    <main className="library-page">
      <header className="app-header">
        <a className="brand" href="/" aria-label="GuideAnything 资料库"><span className="brand-mark">G</span><span>GuideAnything</span></a>
        <div className="user-chip">
          <AppearanceToggle />
          <span><strong>{user.displayName}</strong><small>{roleLabel(user.role)}</small></span>
          {onLogout ? <button type="button" onClick={onLogout}>退出</button> : null}
        </div>
      </header>

      <section className="library-hero">
        <div><span className="eyebrow">GUIDE LIBRARY</span><h1>找到答案，再沿着流程走一遍。</h1><p>检索已发布的 ERP 教学，把成熟流程直接复用到新的画布。</p></div>
        {user.role === 'AUTHOR' ? <button className="primary-button" type="button" onClick={create}>新建指南</button> : null}
      </section>

      <section className="search-panel" aria-labelledby="search-heading">
        <div><h2 id="search-heading">检索已发布指南</h2><p className="muted">标题、摘要、标签与节点内容都会参与检索。</p></div>
        <form className="search-form" onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="guide-search">关键词</label>
          <input id="guide-search" type="search" placeholder="例如：销售订单、物料主数据、VA01" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="primary-button" type="submit" disabled={searching || !query.trim()}>搜索指南</button>
        </form>
        {searching ? <p className="status-line">正在检索已发布指南…</p> : null}
        {error ? <p className="error-message" role="alert">{error}</p> : null}
        {!searching && results?.length === 0 ? <div className="empty-state"><strong>没有找到匹配的已发布指南</strong><span>换一个业务对象、事务码或字段名称试试。</span></div> : null}
        {results && results.length > 0 ? <div className="guide-grid">{results.map((item) => (
          <article className="guide-card" key={item.versionId}>
            <div className="guide-meta"><span>v{item.version}</span><span>{item.authorName}</span></div>
            <h3>{item.title}</h3><p>{item.summary || '暂无摘要'}</p>
            <div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <button className="secondary-button" type="button" onClick={() => onLearn(item.versionId)} aria-label={`开始学习 ${item.title}`}>开始学习</button>
          </article>
        ))}</div> : null}
      </section>

      {user.role !== 'LEARNER' ? <section className="draft-section" aria-labelledby="draft-heading">
        <div className="section-heading"><div><span className="eyebrow">WORKSPACE</span><h2 id="draft-heading">我的草稿与协作</h2></div><span>{drafts.length} 个指南</span></div>
        {loadingDrafts ? <p className="status-line">正在载入工作区…</p> : null}
        {!loadingDrafts && drafts.length === 0 ? <div className="empty-state"><strong>还没有可编辑的指南</strong><span>创建第一条 ERP 教学流程开始。</span></div> : null}
        <div className="draft-list">{drafts.map((draft) => <article key={draft.id}>
          <div><span className={`status-badge status-${draft.status.toLowerCase()}`}>{draft.status === 'PUBLISHED' ? '已发布' : '草稿'}</span><h3>{draft.title}</h3><p>{draft.summary || '等待补充摘要'}</p></div>
          <button className="secondary-button" type="button" onClick={() => onEdit(draft.id)} aria-label={`编辑 ${draft.title}`}>编辑</button>
        </article>)}</div>
      </section> : null}
    </main>
  );
}

function roleLabel(role: AuthUser['role']): string {
  return { AUTHOR: '作者', EDITOR: '编辑者', LEARNER: '学习者' }[role];
}

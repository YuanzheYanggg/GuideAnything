import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookOpen,
  BookmarkSimple,
  CaretDown,
  ChartLineUp,
  ClockCounterClockwise,
  Cube,
  DotsThree,
  FileText,
  Gear,
  MagnifyingGlass,
  Play,
  Question,
  SlidersHorizontal,
  SquaresFour,
  Trash,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';

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
  publishedAt?: string;
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

type GuideKind = 'finance' | 'materials' | 'sales' | 'production' | 'people' | 'general';

const primaryNav: Array<{ label: string; icon: Icon }> = [
  { label: '指南库', icon: BookOpen },
  { label: '收藏夹', icon: BookmarkSimple },
  { label: '最近查看', icon: ClockCounterClockwise },
  { label: '与我共享', icon: UsersThree },
  { label: '回收站', icon: Trash },
];

const workspaceNav: Array<{ label: string; icon: Icon; kind: GuideKind }> = [
  { label: '财务管理', icon: ChartLineUp, kind: 'finance' },
  { label: '物料管理', icon: FileText, kind: 'materials' },
  { label: '销售与分销', icon: ChartLineUp, kind: 'sales' },
  { label: '生产计划', icon: SquaresFour, kind: 'production' },
  { label: '人力资源', icon: UsersThree, kind: 'people' },
];

export function LibraryPage({ user, api, onEdit, onLearn, onLogout }: LibraryPageProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [published, setPublished] = useState<SearchItem[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [filter, setFilter] = useState('全部');
  const [loadingPublished, setLoadingPublished] = useState(true);
  const [loadingDrafts, setLoadingDrafts] = useState(user.role !== 'LEARNER');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.search('')
      .then((items) => { if (active) setPublished(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '指南载入失败'); })
      .finally(() => { if (active) setLoadingPublished(false); });
    return () => { active = false; };
  }, [api]);

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
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    setError('');
    setFilter('全部');
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

  const activeItems = results ?? published;
  const filterOptions = useMemo(() => ['全部', ...Array.from(new Set(activeItems.flatMap((item) => item.tags))).slice(0, 5)], [activeItems]);
  const visibleItems = filter === '全部' ? activeItems : activeItems.filter((item) => item.tags.includes(filter) || item.title.includes(filter));
  const countLabel = visibleItems.length;

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-topbar-leading">
          <a className="workspace-brand" href="/" aria-label="GuideAnything 资料库">
            <span className="workspace-brand-mark"><Cube size={24} weight="fill" /></span>
            <span>GuideAnything</span>
          </a>
          <span className="workspace-topbar-divider" aria-hidden="true" />
          <span className="workspace-topbar-hint">找到答案，再沿着流程走一遍。</span>
        </div>
        <div className="workspace-topbar-actions">
          <button className="workspace-icon-button" type="button" aria-label="聚焦搜索" onClick={() => document.getElementById('guide-search')?.focus()}><MagnifyingGlass size={22} /></button>
          <button className="workspace-icon-button" type="button" aria-label="通知"><Bell size={22} /></button>
          <button className="workspace-icon-button" type="button" aria-label="帮助"><Question size={22} /></button>
          <div className="workspace-account">
            <button className="workspace-avatar" type="button" aria-label={`账户 ${user.displayName}`} aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>{user.displayName.slice(0, 1)}</button>
            <button className="workspace-icon-button workspace-account-chevron" type="button" aria-label="打开账户菜单" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}><CaretDown size={16} /></button>
            {accountMenuOpen ? <div className="workspace-account-menu" role="menu">
              <div className="workspace-account-meta"><strong>{user.displayName}</strong><span>{roleLabel(user.role)}</span></div>
              {onLogout ? <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onLogout(); }}>退出登录</button> : null}
            </div> : null}
          </div>
        </div>
      </header>

      <aside className="workspace-sidebar" aria-label="工作区导航">
        <nav className="workspace-nav">
          {primaryNav.map(({ label, icon: IconComponent }) => (
            <button key={label} className={`workspace-nav-item ${label === '指南库' ? 'is-active' : ''}`} type="button" aria-current={label === '指南库' ? 'page' : undefined}>
              <IconComponent size={21} weight="regular" /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="workspace-sidebar-rule" />
        <span className="workspace-sidebar-label">工作区</span>
        <nav className="workspace-nav workspace-domain-nav" aria-label="业务领域">
          {workspaceNav.map(({ label, icon: IconComponent, kind }) => (
            <button key={label} className="workspace-nav-item" type="button">
              <span className={`workspace-domain-icon domain-${kind}`}><IconComponent size={18} weight="bold" /></span><span>{label}</span>
            </button>
          ))}
          <button className="workspace-nav-item" type="button"><SquaresFour size={21} weight="regular" /><span>查看全部</span></button>
        </nav>
        <div className="workspace-sidebar-footer">
          <button className="workspace-nav-item" type="button"><Gear size={21} weight="regular" /><span>设置</span></button>
          <AppearanceToggle />
        </div>
      </aside>

      <section className="workspace-content" aria-labelledby="library-heading">
        <div className="workspace-heading">
          <h1 id="library-heading">指南库</h1>
          {user.role === 'AUTHOR' ? <button className="workspace-create-button" type="button" onClick={create}><span aria-hidden="true">+</span>新建指南</button> : null}
        </div>

        <div className="workspace-search-wrap">
          <form className="workspace-search" onSubmit={submitSearch}>
            <button className="workspace-search-submit" type="submit" aria-label="搜索指南" disabled={searching}><MagnifyingGlass size={22} /></button>
            <label className="sr-only" htmlFor="guide-search">搜索指南</label>
            <input id="guide-search" type="search" placeholder="搜索指南" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button className={`workspace-filter-button ${filterOpen ? 'is-open' : ''}`} type="button" aria-label="筛选指南" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><SlidersHorizontal size={20} /></button>
          </form>
          {filterOpen ? <div className="workspace-filter-popover" role="dialog" aria-label="指南筛选">
            {filterOptions.map((option) => <button key={option} className={filter === option ? 'is-selected' : ''} type="button" onClick={() => { setFilter(option); setFilterOpen(false); }}>{option}</button>)}
          </div> : null}
        </div>

        <section className="workspace-list-section" aria-labelledby="published-heading">
          <div className="workspace-section-heading"><h2 id="published-heading" aria-label="已发布指南"><BookOpen size={21} />已发布指南 <span>{countLabel}</span></h2></div>
          {loadingPublished ? <p className="workspace-status">正在载入指南…</p> : null}
          {searching ? <p className="workspace-status">正在检索已发布指南…</p> : null}
          {error ? <p className="error-message" role="alert">{error}</p> : null}
          {!loadingPublished && !searching && visibleItems.length === 0 ? <div className="empty-state"><strong>{results ? '没有找到匹配的已发布指南' : '还没有已发布指南'}</strong><span>换一个业务对象、事务码或字段名称试试。</span></div> : null}
          {!loadingPublished && !searching && visibleItems.length > 0 ? <div className="guide-table" role="list">
            <div className="guide-table-head" aria-hidden="true"><span>名称</span><span>领域</span><span>更新者</span><span>更新时间</span><span /></div>
            {visibleItems.map((item) => <GuideTableRow key={item.versionId} item={item} onLearn={onLearn} />)}
          </div> : null}
        </section>

        {user.role !== 'LEARNER' ? <section className="workspace-list-section workspace-drafts" aria-labelledby="draft-heading">
          <div className="workspace-section-heading"><h2 id="draft-heading" aria-label="我的草稿与协作"><FileText size={21} />草稿 <span>{drafts.length}</span></h2></div>
          {loadingDrafts ? <p className="workspace-status">正在载入工作区…</p> : null}
          {!loadingDrafts && drafts.length === 0 ? <div className="empty-state"><strong>还没有可编辑的指南</strong><span>创建第一条 ERP 教学流程开始。</span></div> : null}
          {!loadingDrafts && drafts.length > 0 ? <div className="guide-table draft-table" role="list">{drafts.map((draft) => <DraftTableRow key={draft.id} draft={draft} onEdit={onEdit} />)}</div> : null}
        </section> : null}
      </section>
    </main>
  );
}

function GuideTableRow({ item, onLearn }: { item: SearchItem; onLearn: (versionId: string) => void }) {
  const kind = guideKind(item);
  const IconComponent = guideIcon(kind);
  return <article className="guide-table-row" role="listitem">
    <div className="guide-row-title">
      <span className={`guide-kind-icon kind-${kind}`}><IconComponent size={20} weight="regular" /></span>
      <div><button className="guide-title-button" type="button" onClick={() => onLearn(item.versionId)} aria-label={`开始学习 ${item.title}`}>{item.title}</button><p>{item.summary || '暂无摘要'}</p></div>
    </div>
    <span className={`guide-domain-pill domain-${kind}`}>{item.tags[0] ?? 'ERP'}</span>
    <span className="guide-owner"><span className={`guide-owner-avatar avatar-${kind}`}>{item.authorName.slice(0, 1)}</span>{item.authorName}</span>
    <time dateTime={item.publishedAt}>{formatPublishedDate(item.publishedAt)}</time>
    <button className="guide-row-menu" type="button" aria-label={`更多操作 ${item.title}`}><DotsThree size={22} weight="bold" /></button>
  </article>;
}

function DraftTableRow({ draft, onEdit }: { draft: DraftItem; onEdit: (guideId: string) => void }) {
  const kind = guideKind({ title: draft.title, tags: draft.tags });
  const IconComponent = guideIcon(kind);
  return <article className="guide-table-row draft-row" role="listitem">
    <div className="guide-row-title"><span className={`guide-kind-icon kind-${kind} draft-kind`}><IconComponent size={20} weight="regular" /></span><div><button className="guide-title-button" type="button" onClick={() => onEdit(draft.id)} aria-label={`打开草稿 ${draft.title}`}>{draft.title} <span className="draft-suffix">（草稿）</span></button><p>{draft.summary || '等待补充摘要'}</p></div></div>
    <span className={`guide-domain-pill domain-${kind}`}>{draft.tags[0] ?? 'ERP'}</span>
    <span className="guide-owner"><span className={`guide-owner-avatar avatar-${kind}`}>A</span> {draft.status === 'PUBLISHED' ? '已发布' : 'Alex Chen'}</span>
    <time>{draft.revision ? `修订 ${draft.revision}` : '—'}</time>
    <button className="guide-row-menu" type="button" aria-label={`编辑 ${draft.title}`} onClick={() => onEdit(draft.id)}><DotsThree size={22} weight="bold" /></button>
  </article>;
}

function guideKind(item: Pick<SearchItem, 'title' | 'tags'>): GuideKind {
  const value = `${item.title} ${item.tags.join(' ')}`;
  if (/物料|主数据/u.test(value)) return 'materials';
  if (/销售|订单|分销/u.test(value)) return 'sales';
  if (/生产|计划|供应/u.test(value)) return 'production';
  if (/人力|员工|入职/u.test(value)) return 'people';
  if (/财务|结账|发票/u.test(value)) return 'finance';
  return 'general';
}

function guideIcon(kind: GuideKind): Icon {
  if (kind === 'sales') return Play;
  if (kind === 'materials') return FileText;
  if (kind === 'production') return BookmarkSimple;
  if (kind === 'people') return Play;
  if (kind === 'finance') return FileText;
  return BookOpen;
}

function formatPublishedDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function roleLabel(role: AuthUser['role']): string {
  return { AUTHOR: '作者', EDITOR: '编辑者', LEARNER: '学习者' }[role];
}

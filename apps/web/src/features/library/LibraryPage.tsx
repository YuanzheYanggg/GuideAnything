import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, MagnifyingGlass, SlidersHorizontal } from '@phosphor-icons/react';

import type { AuthUser } from '../auth/types';
import { ResourceTable } from '../resources/ResourceTable';
import type { PersonalApi, WorkspaceItemSummary, WorkspaceSummary } from '../workspace/types';

export interface SearchItem {
  versionId: string;
  guideId: string;
  workspaceId: string;
  workspaceItemId: string;
  workspaceName: string;
  favorite: boolean;
  canManageLifecycle: boolean;
  title: string;
  summary: string;
  tags: string[];
  version: number;
  authorName: string;
  publishedAt?: string;
}

export interface DraftItem {
  id: string;
  workspaceId: string;
  workspaceItemId: string;
  title: string;
  summary: string;
  tags: string[];
  status: string;
  revision: number;
  authorName: string;
  updatedAt: string;
  favorite: boolean;
  canManageLifecycle: boolean;
}

export interface LibraryApi {
  listDrafts: (workspaceId?: string) => Promise<DraftItem[]>;
  search: (query: string, workspaceId?: string) => Promise<SearchItem[]>;
  createGuide: (workspaceId: string) => Promise<{ id: string }>;
  listEditableWorkspaces: () => Promise<WorkspaceSummary[]>;
}

interface LibraryPageProps {
  user: AuthUser;
  api: LibraryApi;
  personalApi: PersonalApi;
  workspaceId?: string;
  createRequested?: boolean;
  onCreateIntentConsumed?: () => void;
  onEdit: (guideId: string) => void;
  onLearn: (versionId: string) => void;
}

export function LibraryPage({
  user,
  api,
  personalApi,
  workspaceId,
  createRequested = false,
  onCreateIntentConsumed,
  onEdit,
  onLearn,
}: LibraryPageProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [published, setPublished] = useState<SearchItem[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [editableWorkspaces, setEditableWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState('全部');
  const [loadingPublished, setLoadingPublished] = useState(true);
  const [loadingDrafts, setLoadingDrafts] = useState(user.role !== 'LEARNER');
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [pendingCreateIntent, setPendingCreateIntent] = useState<string | null>(null);
  const createIntentHandled = useRef(false);
  const initialGenerationRef = useRef(0);
  const searchGenerationRef = useRef(0);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const roleCanCreate = user.role === 'AUTHOR' || user.role === 'EDITOR';

  const loadEditableWorkspaces = useCallback(async () => {
    setWorkspaceLoadError('');
    try {
      const items = (await api.listEditableWorkspaces()).filter((item) => item.permission !== 'VIEW');
      setEditableWorkspaces(items);
      setWorkspacesLoaded(true);
      return items;
    } catch (reason) {
      setWorkspacesLoaded(false);
      setWorkspaceLoadError(errorMessage(reason, '工作区载入失败'));
      throw reason;
    }
  }, [api]);

  useEffect(() => {
    void loadEditableWorkspaces().catch(() => undefined);
  }, [loadEditableWorkspaces]);

  const loadPublished = useCallback(() => {
    const generation = ++initialGenerationRef.current;
    searchGenerationRef.current += 1;
    setResults(null);
    setSearching(false);
    setLoadingPublished(true);
    api.search('', workspaceId)
      .then((items) => { if (initialGenerationRef.current === generation) setPublished(items); })
      .catch((reason: unknown) => { if (initialGenerationRef.current === generation) setError(errorMessage(reason, '指南载入失败')); })
      .finally(() => { if (initialGenerationRef.current === generation) setLoadingPublished(false); });
  }, [api, workspaceId]);

  useEffect(() => {
    loadPublished();
    return () => { initialGenerationRef.current += 1; };
  }, [loadPublished]);

  useEffect(() => {
    if (user.role === 'LEARNER') return;
    let active = true;
    setLoadingDrafts(true);
    api.listDrafts(workspaceId)
      .then((items) => { if (active) setDrafts(items); })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason, '草稿载入失败')); })
      .finally(() => { if (active) setLoadingDrafts(false); });
    return () => { active = false; };
  }, [api, user.role, workspaceId]);

  const createInside = useCallback(async (targetWorkspaceId: string, fromPicker = false) => {
    if (!fromPicker) setPickerOpen(false);
    setCreating(true);
    setError('');
    try {
      const guide = await api.createGuide(targetWorkspaceId);
      setPickerOpen(false);
      onEdit(guide.id);
    } catch (reason) {
      setError(errorMessage(reason, '创建指南失败'));
    } finally {
      setCreating(false);
    }
  }, [api, onEdit]);

  const create = async () => {
    if (!roleCanCreate) {
      setError('当前账户角色不能创建指南');
      return;
    }
    if (workspaceId) {
      if (!workspacesLoaded) {
        setError(workspaceLoadError || '正在确认当前工作区的创建权限');
        return;
      }
      if (!editableWorkspaces.some((item) => item.id === workspaceId)) {
        setError('当前工作区不可创建指南');
        return;
      }
      await createInside(workspaceId);
      return;
    }
    let candidates = editableWorkspaces;
    if (!workspacesLoaded) {
      try {
        candidates = await loadEditableWorkspaces();
      } catch (reason) {
        setError(errorMessage(reason, '工作区载入失败'));
        return;
      }
    }
    if (candidates.length === 1) {
      await createInside(candidates[0]!.id);
      return;
    }
    if (candidates.length > 1) {
      setPickerOpen(true);
      return;
    }
    setError('没有可创建指南的工作区');
  };

  useEffect(() => {
    if (!createRequested) {
      createIntentHandled.current = false;
      return;
    }
    if (!workspaceId || createIntentHandled.current) return;
    createIntentHandled.current = true;
    onCreateIntentConsumed?.();
    setPendingCreateIntent(workspaceId);
  }, [createRequested, workspaceId, onCreateIntentConsumed]);

  useEffect(() => {
    if (!pendingCreateIntent) return;
    if (workspaceLoadError) {
      setPendingCreateIntent(null);
      return;
    }
    if (!workspacesLoaded) return;
    setPendingCreateIntent(null);
    if (!roleCanCreate || !editableWorkspaces.some((item) => item.id === pendingCreateIntent)) {
      setError('当前工作区不可创建指南');
      return;
    }
    void createInside(pendingCreateIntent);
  }, [createInside, editableWorkspaces, pendingCreateIntent, roleCanCreate, workspaceLoadError, workspacesLoaded]);

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) {
      loadPublished();
      return;
    }
    initialGenerationRef.current += 1;
    setLoadingPublished(false);
    setSearching(true);
    const generation = ++searchGenerationRef.current;
    setError('');
    setFilter('全部');
    try {
      const items = await api.search(query.trim(), workspaceId);
      if (searchGenerationRef.current === generation) setResults(items);
    } catch (reason) {
      if (searchGenerationRef.current === generation) setError(errorMessage(reason, '检索失败，请稍后重试'));
    } finally {
      if (searchGenerationRef.current === generation) setSearching(false);
    }
  };

  const activeItems = results ?? published;
  const filterOptions = useMemo(() => ['全部', ...Array.from(new Set(activeItems.flatMap((item) => item.tags))).slice(0, 5)], [activeItems]);
  const visibleItems = filter === '全部' ? activeItems : activeItems.filter((item) => item.tags.includes(filter) || item.title.includes(filter));
  const workspaceMap = useMemo(() => new Map(editableWorkspaces.map((item) => [item.id, item])), [editableWorkspaces]);
  const publishedResources = visibleItems.map((item): WorkspaceItemSummary => ({
    id: item.workspaceItemId,
    workspaceId: item.workspaceId,
    workspaceName: item.workspaceName,
    kind: 'GUIDE',
    entityId: item.guideId,
    title: item.title,
    summary: item.summary,
    updatedAt: item.publishedAt ?? '',
    favorite: item.favorite,
    permission: workspaceMap.get(item.workspaceId)?.permission ?? 'VIEW',
    canManageLifecycle: item.canManageLifecycle,
    authorName: item.authorName,
    publishedVersionId: item.versionId,
  }));
  const draftResources = drafts.map((draft): WorkspaceItemSummary => ({
    id: draft.workspaceItemId,
    workspaceId: draft.workspaceId,
    workspaceName: workspaceMap.get(draft.workspaceId)?.name ?? '工作区',
    kind: 'GUIDE',
    entityId: draft.id,
    title: draft.title,
    summary: draft.summary,
    updatedAt: draft.updatedAt,
    favorite: draft.favorite,
    permission: workspaceMap.get(draft.workspaceId)?.permission ?? 'EDIT',
    canManageLifecycle: draft.canManageLifecycle,
    authorName: draft.authorName,
  }));

  const removeResource = (item: WorkspaceItemSummary) => {
    setPublished((current) => current.filter((entry) => entry.workspaceItemId !== item.id));
    setResults((current) => current?.filter((entry) => entry.workspaceItemId !== item.id) ?? null);
    setDrafts((current) => current.filter((entry) => entry.workspaceItemId !== item.id));
  };
  const updateFavorite = (item: WorkspaceItemSummary, favorite: boolean) => {
    const update = (entries: SearchItem[]) => entries.map((entry) => entry.workspaceItemId === item.id ? { ...entry, favorite } : entry);
    setPublished(update);
    setResults((current) => current ? update(current) : current);
    setDrafts((current) => current.map((entry) => entry.workspaceItemId === item.id ? { ...entry, favorite } : entry));
  };
  const mutate = async (operation: () => Promise<unknown>, update: () => void) => {
    setError('');
    try {
      await operation();
      update();
    } catch (reason) {
      setError(errorMessage(reason, '操作失败'));
      throw reason;
    }
  };
  const tableProps = {
    mode: 'default' as const,
    onOpen: (item: WorkspaceItemSummary) => item.publishedVersionId ? onLearn(item.publishedVersionId) : onEdit(item.entityId),
    onFavorite: (item: WorkspaceItemSummary, favorite: boolean) => mutate(
      () => favorite ? personalApi.favorite(item.id) : personalApi.unfavorite(item.id),
      () => updateFavorite(item, favorite),
    ),
    onTrash: (item: WorkspaceItemSummary) => mutate(() => personalApi.trashItem(item.id), () => removeResource(item)),
    onRestore: async () => undefined,
    onPermanentRemove: async () => undefined,
  };

  return <div className="library-workspace-page" aria-labelledby="library-heading">
    <div className="workspace-heading">
      <h1 id="library-heading">指南库</h1>
      {roleCanCreate && (!workspaceId || (workspacesLoaded && editableWorkspaces.some((item) => item.id === workspaceId))) ? <button ref={createTriggerRef} className="workspace-create-button" type="button" disabled={creating} onClick={() => void create()}><span aria-hidden="true">+</span>{creating && !pickerOpen ? '正在创建指南…' : '新建指南'}</button> : null}
      {roleCanCreate && workspaceId && !workspacesLoaded && !workspaceLoadError ? <span className="workspace-status" role="status">正在确认创建权限…</span> : null}
    </div>

    <div className="workspace-search-wrap">
      <form className="workspace-search" onSubmit={submitSearch}>
        <button className="workspace-search-submit" type="submit" aria-label="搜索指南"><MagnifyingGlass size={22} /></button>
        <label className="sr-only" htmlFor="guide-search">搜索指南</label>
        <input id="guide-search" type="search" placeholder="搜索指南" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className={`workspace-filter-button ${filterOpen ? 'is-open' : ''}`} type="button" aria-label="筛选指南" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><SlidersHorizontal size={20} /></button>
      </form>
      {filterOpen ? <div className="workspace-filter-popover" role="dialog" aria-label="指南筛选">{filterOptions.map((option) => <button key={option} className={filter === option ? 'is-selected' : ''} type="button" onClick={() => { setFilter(option); setFilterOpen(false); }}>{option}</button>)}</div> : null}
    </div>

    <section className="workspace-list-section" aria-labelledby="published-heading">
      <div className="workspace-section-heading"><h2 id="published-heading" aria-label="已发布指南"><BookOpen size={21} />已发布指南 <span>{publishedResources.length}</span></h2></div>
      {loadingPublished ? <p className="workspace-status">正在载入指南…</p> : null}
      {searching ? <p className="workspace-status">正在检索已发布指南…</p> : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      {!loadingPublished && !searching && publishedResources.length === 0 ? <div className="empty-state"><strong>{results ? '没有找到匹配的已发布指南' : '还没有已发布指南'}</strong><span>换一个业务对象、事务码或字段名称试试。</span></div> : null}
      {!loadingPublished && !searching && publishedResources.length > 0 ? <ResourceTable {...tableProps} items={publishedResources} /> : null}
    </section>

    {user.role !== 'LEARNER' ? <section className="workspace-list-section workspace-drafts" aria-labelledby="draft-heading">
      <div className="workspace-section-heading"><h2 id="draft-heading" aria-label="我的草稿与协作"><FileText size={21} />草稿 <span>{draftResources.length}</span></h2></div>
      {loadingDrafts ? <p className="workspace-status">正在载入工作区…</p> : null}
      {!loadingDrafts && draftResources.length === 0 ? <div className="empty-state"><strong>还没有可编辑的指南</strong><span>创建第一条 ERP 教学流程开始。</span></div> : null}
      {!loadingDrafts && draftResources.length > 0 ? <ResourceTable {...tableProps} items={draftResources} /> : null}
    </section> : null}

    {workspaceLoadError ? <div className="workspace-error" role="alert"><span>{workspaceLoadError}</span><button type="button" onClick={() => void loadEditableWorkspaces().catch(() => undefined)}>重试载入工作区</button></div> : null}

    {pickerOpen ? <WorkspacePickerDialog
      workspaces={editableWorkspaces}
      pending={creating}
      onSelect={(id) => void createInside(id, true)}
      onClose={() => {
        if (creating) return;
        setPickerOpen(false);
        createTriggerRef.current?.focus();
      }}
    /> : null}
  </div>;
}

function WorkspacePickerDialog({ workspaces, pending, onSelect, onClose }: {
  workspaces: WorkspaceSummary[];
  pending: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => { if (pending) dialogRef.current?.focus(); }, [pending]);
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (!pending) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    if (pending) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === firstRef.current) {
      event.preventDefault();
      cancelRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === cancelRef.current) {
      event.preventDefault();
      firstRef.current?.focus();
    }
  };
  return <div className="confirm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <section ref={dialogRef} className="workspace-picker-dialog" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="workspace-picker-title" onKeyDown={keyDown}>
      <h2 id="workspace-picker-title">选择创建位置</h2>
      <p>{pending ? '正在创建指南…' : '新指南将继承所选工作区的成员与权限。'}</p>
      <div>{workspaces.map((item, index) => <button ref={index === 0 ? firstRef : undefined} key={item.id} disabled={pending} type="button" onClick={() => onSelect(item.id)}>在{item.name}中新建</button>)}</div>
      <button ref={cancelRef} className="secondary-button" type="button" disabled={pending} onClick={onClose}>取消</button>
    </section>
  </div>;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

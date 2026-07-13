import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Archive,
  ArrowCounterClockwise,
  BookOpen,
  BracketsCurly,
  ChatCircleDots,
  Database,
  DotsThree,
  Robot,
  Star,
  Trash,
  type Icon,
} from '@phosphor-icons/react';

import type { WorkspaceItemKind, WorkspaceItemSummary } from '../workspace/types';

export interface ResourceTableProps {
  mode: 'default' | 'favorites' | 'recent' | 'shared' | 'trash';
  items: WorkspaceItemSummary[];
  onOpen: (item: WorkspaceItemSummary) => void;
  onFavorite: (item: WorkspaceItemSummary, favorite: boolean) => Promise<void>;
  onTrash: (item: WorkspaceItemSummary) => Promise<void>;
  onRestore: (item: WorkspaceItemSummary) => Promise<void>;
  onPermanentRemove: (item: WorkspaceItemSummary) => Promise<void>;
}

type ConfirmAction = { type: 'trash' | 'remove'; item: WorkspaceItemSummary };

const kindMeta: Record<WorkspaceItemKind, { label: string; icon: Icon }> = {
  GUIDE: { label: '指南', icon: BookOpen },
  SOURCE: { label: '资料源', icon: Database },
  AGENT: { label: 'Agent', icon: Robot },
  ONTOLOGY: { label: 'Ontology', icon: BracketsCurly },
  CONVERSATION: { label: '会话', icon: ChatCircleDots },
  ARTIFACT: { label: '产物', icon: Archive },
};

export function ResourceTable({
  mode,
  items,
  onOpen,
  onFavorite,
  onTrash,
  onRestore,
  onPermanentRemove,
}: ResourceTableProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const requestConfirmation = (action: ConfirmAction) => {
    setOpenMenuId(null);
    setConfirmAction(action);
  };

  const confirm = async () => {
    if (!confirmAction) return;
    setPendingId(confirmAction.item.id);
    try {
      if (confirmAction.type === 'trash') await onTrash(confirmAction.item);
      else await onPermanentRemove(confirmAction.item);
      setConfirmAction(null);
    } catch {
      // The page owns the visible server error and keeps the item in local state.
      setConfirmAction(null);
    } finally {
      setPendingId(null);
    }
  };

  return <>
    <div className="resource-table" role="list" aria-label="资源列表">
      <div className="resource-table-head" aria-hidden="true">
        <span>资源</span><span>工作区</span><span>类型</span><span>更新时间</span><span>操作</span>
      </div>
      {items.map((item) => <ResourceRow
        key={item.id}
        item={item}
        mode={mode}
        menuOpen={openMenuId === item.id}
        pending={pendingId === item.id}
        onToggleMenu={() => setOpenMenuId((current) => current === item.id ? null : item.id)}
        onCloseMenu={() => setOpenMenuId(null)}
        onOpen={onOpen}
        onFavorite={onFavorite}
        onRestore={onRestore}
        onConfirm={requestConfirmation}
      />)}
    </div>
    {confirmAction ? <ConfirmDialog
      action={confirmAction}
      pending={pendingId === confirmAction.item.id}
      onCancel={() => setConfirmAction(null)}
      onConfirm={confirm}
    /> : null}
  </>;
}

function ResourceRow({
  item,
  mode,
  menuOpen,
  pending,
  onToggleMenu,
  onCloseMenu,
  onOpen,
  onFavorite,
  onRestore,
  onConfirm,
}: {
  item: WorkspaceItemSummary;
  mode: ResourceTableProps['mode'];
  menuOpen: boolean;
  pending: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpen: ResourceTableProps['onOpen'];
  onFavorite: ResourceTableProps['onFavorite'];
  onRestore: ResourceTableProps['onRestore'];
  onConfirm: (action: ConfirmAction) => void;
}) {
  const meta = kindMeta[item.kind];
  const KindIcon = meta.icon;
  const openLabel = resourceOpenLabel(item);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [directPending, setDirectPending] = useState(false);
  const busy = pending || directPending;
  const runDirect = async (operation: () => Promise<void>) => {
    setDirectPending(true);
    try { await operation(); } catch { /* The page renders the server error. */ }
    finally { setDirectPending(false); }
  };
  const actionMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseMenu();
      menuButtonRef.current?.focus();
    }
  };

  return <article className="resource-row" role="listitem">
    <div className="resource-identity">
      <span className={`resource-kind resource-kind-${item.kind.toLowerCase()}`} title={meta.label}><KindIcon size={20} /></span>
      <div>
        {openLabel ? <button className="resource-title" type="button" onClick={() => onOpen(item)}>{item.title}</button> : <strong className="resource-title-static">{item.title}</strong>}
        <span>{item.summary || '暂无摘要'}</span>
      </div>
    </div>
    <span className="resource-workspace">{item.workspaceName}</span>
    <span className="resource-type">{meta.label}</span>
    <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
    <div className="resource-actions">
      {openLabel ? <button className="resource-action-button" type="button" onClick={() => onOpen(item)}>{openLabel} {item.title}</button> : null}
      {mode === 'trash'
        ? <button className="resource-icon-action" type="button" disabled={busy} aria-label={`恢复 ${item.title}`} onClick={() => { void runDirect(() => onRestore(item)); }}><ArrowCounterClockwise size={18} /></button>
        : <button className={`resource-icon-action${item.favorite ? ' is-active' : ''}`} type="button" disabled={busy} aria-label={`${item.favorite ? '取消收藏' : '收藏'} ${item.title}`} onClick={() => { void runDirect(() => onFavorite(item, !item.favorite)); }}><Star size={18} weight={item.favorite ? 'fill' : 'regular'} /></button>}
      <div className="action-menu" onKeyDown={actionMenuKeyDown}>
        <button ref={menuButtonRef} className="resource-icon-action" type="button" disabled={busy} aria-label={`更多操作 ${item.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={onToggleMenu}><DotsThree size={20} weight="bold" /></button>
        {menuOpen ? <div className="action-menu-popover" role="menu">
          {mode === 'trash'
            ? <button autoFocus type="button" role="menuitem" onClick={() => onConfirm({ type: 'remove', item })}>永久移除</button>
            : <button autoFocus type="button" role="menuitem" onClick={() => onConfirm({ type: 'trash', item })}><Trash size={16} />移到回收站</button>}
        </div> : null}
      </div>
    </div>
  </article>;
}

function ConfirmDialog({ action, pending, onCancel, onConfirm }: {
  action: ConfirmAction;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const permanent = action.type === 'remove';
  const title = permanent ? `永久移除${action.item.title}？` : `将${action.item.title}移到回收站？`;

  useEffect(() => { cancelRef.current?.focus(); }, []);

  return <div className="confirm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section
      className="confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-confirm-title"
      onKeyDown={(event) => { if (event.key === 'Escape' && !pending) onCancel(); }}
    >
      <span className="confirm-dialog-icon"><Trash size={22} /></span>
      <h2 id="resource-confirm-title">{title}</h2>
      <p>{permanent
        ? '此资源将无法恢复；已发布快照仍会保留，供已固定该版本的引用继续使用。'
        : '资源会移到回收站，可在回收站中恢复。'}</p>
      <div>
        <button ref={cancelRef} className="secondary-button" type="button" disabled={pending} onClick={onCancel}>取消</button>
        <button className="primary-button confirm-danger" type="button" disabled={pending} onClick={() => void onConfirm()}>{pending ? '处理中…' : permanent ? '确认永久移除' : '确认移到回收站'}</button>
      </div>
    </section>
  </div>;
}

function resourceOpenLabel(item: WorkspaceItemSummary): '编辑' | '学习' | null {
  if (item.kind !== 'GUIDE') return null;
  if ((item.permission === 'OWNER' || item.permission === 'EDIT') && !item.publishedVersionId) return '编辑';
  if (item.publishedVersionId) return '学习';
  return null;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

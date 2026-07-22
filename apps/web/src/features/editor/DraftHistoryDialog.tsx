import type { GuideDraftHistorySnapshot } from '@guideanything/contracts';
import { useEffect, useState } from 'react';

import { EditorDialogSurface } from './EditorDialogSurface';

export function DraftHistoryDialog({
  items,
  currentRevision,
  loading = false,
  error,
  onRestore,
  onClose,
}: {
  items: GuideDraftHistorySnapshot[];
  currentRevision: number;
  loading?: boolean;
  error?: string;
  onRestore: (revision: number) => Promise<void>;
  onClose: () => void;
}) {
  const [pendingRevision, setPendingRevision] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const pending = items.find((item) => item.revision === pendingRevision) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (pendingRevision !== null) setPendingRevision(null);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, pendingRevision]);

  const confirmRestore = async () => {
    if (!pending || restoring) return;
    setRestoring(true);
    setRestoreError('');
    try {
      await onRestore(pending.revision);
    } catch (reason) {
      setRestoreError(reason instanceof Error ? reason.message : '草稿恢复失败');
      setRestoring(false);
    }
  };

  return <EditorDialogSurface className="reference-modal draft-history-dialog" ariaLabel="草稿历史" closeLabel="关闭草稿历史" onClose={onClose}>
      <span className="eyebrow">SERVER DRAFT HISTORY</span>
      <h2>草稿历史</h2>
      <p>恢复会生成新的当前草稿，不会删除任何已有历史。</p>
      {loading ? <p className="status-line">正在载入草稿历史…</p> : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? <p className="muted">还没有可恢复的已保存草稿。</p> : null}
      <div className="draft-history-list">
        {items.map((item) => <article key={item.revision} className="draft-history-item">
          <div>
            <strong>revision {item.revision}</strong>
            {item.revision === currentRevision ? <span className="draft-history-current">当前版本</span> : null}
            <p className="draft-history-change"><span className="draft-history-change-label">本版变更</span><span className="draft-history-change-text">{item.changeSummary}</span></p>
            <small>{formatSavedAt(item.savedAt)} · {item.savedBy.displayName}</small>
          </div>
          {item.revision !== currentRevision ? <button className="secondary-button" type="button" onClick={() => { setPendingRevision(item.revision); setRestoreError(''); }} aria-label={`恢复 revision ${item.revision}`}>恢复此版</button> : null}
        </article>)}
      </div>
      {pending ? <div className="draft-history-confirm" role="dialog" aria-modal="true" aria-label="确认恢复草稿">
        <h3>恢复 revision {pending.revision}？</h3>
        <p>它会成为新的当前草稿；当前版本与这份历史都会保留。</p>
        <p className="draft-history-confirm-change"><strong>本版变更：</strong>{pending.changeSummary}</p>
        {restoreError ? <p className="error-message" role="alert">{restoreError}</p> : null}
        <div className="hierarchy-deletion-actions">
          <button className="secondary-button" type="button" onClick={() => setPendingRevision(null)} disabled={restoring}>取消</button>
          <button className="primary-button" type="button" onClick={() => void confirmRestore()} disabled={restoring} aria-label="确认恢复">{restoring ? '恢复中…' : '确认恢复'}</button>
        </div>
      </div> : null}
  </EditorDialogSurface>;
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

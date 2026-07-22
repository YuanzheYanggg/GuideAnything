import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { Check, FileText, PencilSimple } from '@phosphor-icons/react';

import { EditorDialogSurface } from './EditorDialogSurface';

export interface GuideSummaryDialogProps {
  summary: string;
  disabled: boolean;
  openerRef: RefObject<HTMLButtonElement | null>;
  onSummaryChange: (value: string) => void;
  onClose: () => void;
}

export function GuideSummaryDialog({ summary, disabled, openerRef, onSummaryChange, onClose }: GuideSummaryDialogProps) {
  const [editing, setEditing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  const close = useCallback(() => {
    setEditing(false);
    onClose();
    requestAnimationFrame(() => openerRef.current?.focus());
  }, [onClose, openerRef]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      return;
    }
    focusableElements(dialogRef.current)[0]?.focus();
  }, [editing]);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || disabled) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [close, disabled]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex]?.focus();
  };

  return <EditorDialogSurface
    ref={dialogRef}
    className="reference-modal guide-summary-dialog"
    backdropClassName="guide-summary-backdrop"
    ariaLabelledBy={titleId}
    closeLabel="关闭摘要"
    closeDisabled={disabled}
    closeOnBackdrop
    onKeyDown={trapFocus}
    onClose={close}
  >
      <span className="guide-summary-dialog-kicker"><FileText size={15} aria-hidden="true" />摘要</span>
      <h2 id={titleId}>指南摘要</h2>
      {editing ? <label className="guide-summary-dialog-editor" htmlFor="guide-summary-dialog-editor">
        <span>编辑摘要</span>
        <textarea ref={inputRef} id="guide-summary-dialog-editor" aria-label="摘要" value={summary} disabled={disabled} onChange={(event) => onSummaryChange(event.target.value)} />
      </label> : <p className="guide-summary-dialog-copy">{summary || '暂无摘要，请点击编辑补充。'}</p>}
      <div className="guide-summary-dialog-actions">
        <button className="secondary-button" type="button" onClick={() => setEditing((current) => !current)} disabled={disabled} aria-label={editing ? '完成摘要编辑' : '编辑摘要'}>
          {editing ? <Check size={16} aria-hidden="true" /> : <PencilSimple size={16} aria-hidden="true" />}
          {editing ? '完成' : '编辑摘要'}
        </button>
        <button className="primary-button" type="button" onClick={close} disabled={disabled}>关闭</button>
      </div>
  </EditorDialogSurface>;
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]') ?? [])]
    .filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true');
}

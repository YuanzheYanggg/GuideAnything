import { X } from '@phosphor-icons/react';
import { forwardRef, type KeyboardEventHandler, type PropsWithChildren, type Ref } from 'react';

import { BorderGlow } from '../../components/reactbits/BorderGlow';

type EditorDialogSurfaceProps = PropsWithChildren<{
  className?: string;
  backdropClassName?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
  closeButtonRef?: Ref<HTMLButtonElement>;
  closeOnBackdrop?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onClose?: () => void;
}>;

export const EditorDialogSurface = forwardRef<HTMLDivElement, EditorDialogSurfaceProps>(function EditorDialogSurface({
  children,
  className = '',
  backdropClassName = '',
  ariaLabel,
  ariaLabelledBy,
  closeLabel = '关闭弹窗',
  closeDisabled = false,
  closeButtonRef,
  closeOnBackdrop = false,
  onKeyDown,
  onClose,
}, ref) {
  const dialogLabelProps = ariaLabelledBy
    ? { 'aria-labelledby': ariaLabelledBy }
    : ariaLabel
      ? { 'aria-label': ariaLabel }
      : {};

  return <div
    className={`modal-backdrop editor-dialog-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`}
    role="presentation"
    onMouseDown={(event) => {
      if (closeOnBackdrop && event.target === event.currentTarget && !closeDisabled) onClose?.();
    }}
  >
    <BorderGlow
      ref={ref}
      className={`editor-dialog-surface${className ? ` ${className}` : ''}`}
      active
      tone="accent"
      role="dialog"
      aria-modal="true"
      onKeyDown={onKeyDown}
      {...dialogLabelProps}
    >
      {onClose ? <button
        ref={closeButtonRef}
        className="modal-close editor-dialog-close"
        type="button"
        onClick={onClose}
        disabled={closeDisabled}
        aria-label={closeLabel}
      >
        <X size={18} aria-hidden="true" />
      </button> : null}
      {children}
    </BorderGlow>
  </div>;
});

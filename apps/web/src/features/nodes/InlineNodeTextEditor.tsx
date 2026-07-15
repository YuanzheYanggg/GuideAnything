import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type InlineTextField = 'label' | 'description' | 'markdown' | 'imageCaption' | 'videoCaption';

interface InlineNodeEditingValue {
  enabled: boolean;
  updateText: (nodeId: string, field: InlineTextField, value: string) => void;
}

const InlineNodeEditingContext = createContext<InlineNodeEditingValue>({
  enabled: false,
  updateText: () => undefined,
});

export const InlineNodeEditingProvider = InlineNodeEditingContext.Provider;

export function useInlineNodeEditing(): InlineNodeEditingValue {
  return useContext(InlineNodeEditingContext);
}

export function InlineNodeTextEditor({
  nodeId,
  field,
  value,
  label,
  multiline = false,
  required = false,
  placeholder = '双击编辑',
  showPlaceholder = false,
  children,
}: {
  nodeId: string;
  field: InlineTextField;
  value: string;
  label: string;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  showPlaceholder?: boolean;
  children?: ReactNode;
}) {
  const { enabled, updateText } = useInlineNodeEditing();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const ignoreBlurRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    if (!multiline && inputRef.current instanceof HTMLInputElement) inputRef.current.select();
  }, [editing, multiline]);

  const startEditing = () => {
    if (!enabled) return;
    ignoreBlurRef.current = false;
    setDraft(value);
    setError('');
    setEditing(true);
  };

  const commit = () => {
    const next = required ? draft.trim() : draft;
    if (required && !next) {
      setError('标题不能为空');
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    setError('');
    setEditing(false);
    if (next !== value) updateText(nodeId, field, next);
  };

  const cancel = () => {
    ignoreBlurRef.current = true;
    setDraft(value);
    setError('');
    setEditing(false);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'Enter') return;
    if (multiline && !event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    commit();
  };

  if (editing && enabled) {
    const common = {
      ref: inputRef as never,
      className: `inline-node-text-input nodrag nopan nowheel${error ? ' is-invalid' : ''}`,
      'aria-label': label,
      'aria-invalid': error ? true : undefined,
      value: draft,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
      onBlur: () => {
        if (ignoreBlurRef.current) {
          ignoreBlurRef.current = false;
          return;
        }
        commit();
      },
      onKeyDown: onEditorKeyDown,
      onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
      onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(),
      onWheel: (event: React.WheelEvent) => event.stopPropagation(),
    };
    return <div className="inline-node-text-editor">
      {multiline ? <textarea {...common} rows={field === 'markdown' ? 8 : 3} /> : <input {...common} type="text" />}
      {error ? <small className="inline-node-text-error" role="alert" aria-live="polite">{error}</small> : null}
    </div>;
  }

  const content = children ?? (showPlaceholder ? <span className="inline-node-text-placeholder">{placeholder}</span> : null);
  if (!content) return null;
  if (!enabled) return <>{children}</>;

  return <div
    className="inline-node-text"
    role="button"
    tabIndex={0}
    aria-label={`编辑${label}`}
    onDoubleClick={(event) => { event.stopPropagation(); startEditing(); }}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== 'F2') return;
      event.preventDefault();
      event.stopPropagation();
      startEditing();
    }}
  >{content}</div>;
}

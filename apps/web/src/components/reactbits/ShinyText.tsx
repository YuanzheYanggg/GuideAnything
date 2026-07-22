import type { PropsWithChildren } from 'react';

export function ShinyText({ children, className = '', disabled = false }: PropsWithChildren<{ className?: string; disabled?: boolean }>) {
  return <span className={`shiny-text${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`}>{children}</span>;
}

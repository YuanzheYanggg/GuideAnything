import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

export function SanitizedMarkdown({ children, className }: { children: string; className?: string }) {
  return <div className={`sanitized-markdown${className ? ` ${className}` : ''}`}>
    <ReactMarkdown
      rehypePlugins={[rehypeSanitize]}
      remarkPlugins={[remarkGfm]}
      components={{
        a: SafeLink,
      }}
    >{children}</ReactMarkdown>
  </div>;
}

function SafeLink({ href, children, ...props }: ComponentProps<'a'>) {
  const safeHref = href?.startsWith('/') && !href.startsWith('//') ? href : undefined;
  return safeHref
    ? <a {...props} href={safeHref}>{children}</a>
    : <span>{children}</span>;
}

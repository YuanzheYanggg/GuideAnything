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
        img: SafeImage,
      }}
    >{children}</ReactMarkdown>
  </div>;
}

function SafeLink({ href, children, node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) {
  const safeHref = safeInternalUrl(href);
  return safeHref
    ? <a {...props} href={safeHref}>{children}</a>
    : <span>{children}</span>;
}

function SafeImage({ src, alt, node: _node, ...props }: ComponentProps<'img'> & { node?: unknown }) {
  const safeSrc = safeInternalUrl(src);
  return safeSrc
    ? <img {...props} src={safeSrc} alt={alt ?? ''} />
    : <span className="sanitized-markdown-image-blocked">{alt || '外部图片已阻止'}</span>;
}

function safeInternalUrl(value: string | undefined): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) {
    return undefined;
  }
  try {
    const url = new URL(value, 'https://guideanything.local');
    if (url.origin !== 'https://guideanything.local' || url.hash || `${url.pathname}${url.search}` !== value) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

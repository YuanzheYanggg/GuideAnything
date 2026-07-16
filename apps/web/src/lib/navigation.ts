const productOrigin = 'https://guideanything.local';

export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) {
    return null;
  }
  try {
    const url = new URL(value, productOrigin);
    if (url.origin !== productOrigin || url.hash || `${url.pathname}${url.search}` !== value) return null;
    return value;
  } catch {
    return null;
  }
}

export function appendSafeReturnTo(href: string, returnTo: string | null | undefined): string {
  const target = safeInternalPath(href) ?? '/library';
  const safeReturn = safeInternalPath(returnTo) ?? '/library';
  const separator = target.includes('?') ? '&' : '?';
  return `${target}${separator}returnTo=${encodeURIComponent(safeReturn)}`;
}

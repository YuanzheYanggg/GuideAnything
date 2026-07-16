const FILE_URL = /(^|[^A-Za-z0-9_])file:(?:\/\/)?[^\r\n]*/iu;
const WINDOWS_DRIVE_PATH = /(^|[^A-Za-z0-9_])[A-Za-z]:[\\/][^\r\n]*/u;
const WINDOWS_UNC_PATH = /(^|[^A-Za-z0-9_:])\\\\[^\\\r\n]+\\[^\r\n]*/u;
const POSIX_ABSOLUTE_PATH = /(^|[^A-Za-z0-9_:/])\/(?!\/)(?=[A-Za-z0-9._~-])[^\r\n]*/u;
const POSIX_UNICODE_ROOT_PATH = /(^|[\s([{"'=,;:：，。])\/(?!\/)[^\r\n]*/u;
const INTERNAL_RELATIVE_PATH = /(^|[^A-Za-z0-9_])(?:\.\.?[\\/])*(?:raw|wiki_v2)[\\/][^\r\n]*/iu;
const CANONICAL_RELATIVE_PATH = /(^|[^A-Za-z0-9_])(?:\.\.[\\/])+(?:moc|indexes|concepts|sources|procedures|cases|analysis)[\\/][^\r\n]*/iu;

export function sanitizeVaultControlledText(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
    .map((line) => stripPathSuffix(line).trimEnd())
    .join('\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

export function sanitizeVaultControlledList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const sanitized = sanitizeVaultControlledText(value);
    if (!sanitized || seen.has(sanitized)) continue;
    seen.add(sanitized);
    result.push(sanitized);
  }
  return result;
}

function stripPathSuffix(value: string): string {
  let result = value;
  for (const pattern of [
    FILE_URL,
    WINDOWS_DRIVE_PATH,
    WINDOWS_UNC_PATH,
    POSIX_ABSOLUTE_PATH,
    POSIX_UNICODE_ROOT_PATH,
    INTERNAL_RELATIVE_PATH,
    CANONICAL_RELATIVE_PATH,
  ]) {
    result = result.replace(pattern, '$1');
  }
  return result;
}

const MAX_QUERY_TOKENS = 24;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
const WORD_RUN = /[\p{Letter}\p{Number}]+/gu;
const SINGLE_CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;

export function normalizeKnowledgeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim();
}

export function buildSearchTokens(value: string): string[] {
  const normalized = normalizeKnowledgeText(value);
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (token: string) => {
    const trimmed = token.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    tokens.push(trimmed);
  };

  for (const match of normalized.matchAll(WORD_RUN)) {
    const run = match[0];
    if ([...run].some((character) => SINGLE_CJK.test(character))) continue;
    push(run);
  }
  for (const match of normalized.matchAll(CJK_RUN)) {
    const characters = [...match[0]];
    if (characters.length === 1) push(characters[0]!);
    for (let index = 0; index + 1 < characters.length; index += 1) {
      push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return tokens.slice(0, MAX_QUERY_TOKENS);
}

export function buildSearchText(values: readonly string[]): string {
  const normalized = values.map(normalizeKnowledgeText).filter(Boolean);
  const tokens = values.flatMap(buildSearchTokens);
  return [...new Set([...normalized, ...tokens])].join(' ').slice(0, 2_000_000);
}

export function compileFtsQuery(query: string): string | null {
  const normalized = normalizeKnowledgeText(query);
  if (SINGLE_CJK.test(normalized)) return null;
  const tokens = buildSearchTokens(normalized).filter((token) => !SINGLE_CJK.test(token));
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
}

export function isSingleCjkQuery(query: string): boolean {
  return SINGLE_CJK.test(normalizeKnowledgeText(query));
}

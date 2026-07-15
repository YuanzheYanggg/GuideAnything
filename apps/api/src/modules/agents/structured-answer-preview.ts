const DEFAULT_MAX_CONCLUSION_LENGTH = 20_000;
const MAX_STRUCTURED_OUTPUT_PREFIX = 2_000_000;

/**
 * Extracts only the public `conclusion` string from a partial structured ANSWER.
 * Other JSON fields can contain internal evidence locators, so raw model deltas
 * must never be forwarded to the public SSE stream.
 */
export class StructuredAnswerPreviewDecoder {
  readonly #maxConclusionLength: number;
  #buffer = '';
  #valueStart: number | null = null;
  #emitted = '';
  #conclusionClosed = false;

  constructor(maxConclusionLength = DEFAULT_MAX_CONCLUSION_LENGTH) {
    if (!Number.isSafeInteger(maxConclusionLength) || maxConclusionLength < 1) {
      throw new Error('预览结论长度上限无效');
    }
    this.#maxConclusionLength = maxConclusionLength;
  }

  push(rawDelta: string): string {
    if (!rawDelta || this.#conclusionClosed) return '';
    this.#buffer += rawDelta;
    if (this.#buffer.length > MAX_STRUCTURED_OUTPUT_PREFIX) {
      throw new Error('结构化输出前缀超过安全长度');
    }
    this.#valueStart ??= findTopLevelStringValue(this.#buffer, 'conclusion');
    if (this.#valueStart === null) return '';

    const scanned = scanJsonStringPrefix(this.#buffer, this.#valueStart);
    const decoded = JSON.parse(`"${scanned.rawPrefix}"`) as unknown;
    if (typeof decoded !== 'string') throw new Error('结构化回答预览不是字符串');
    if (decoded.length > this.#maxConclusionLength) throw new Error('预览结论超过允许长度');
    if (!decoded.startsWith(this.#emitted)) throw new Error('结构化回答预览顺序无效');

    const delta = decoded.slice(this.#emitted.length);
    this.#emitted = decoded;
    this.#conclusionClosed = scanned.closed;
    return delta;
  }

  finalize(validatedConclusion: string): string {
    if (validatedConclusion.length > this.#maxConclusionLength) {
      throw new Error('验证后的结论超过允许长度');
    }
    if (!validatedConclusion.startsWith(this.#emitted)) {
      throw new Error('流式预览与验证后的结论不一致');
    }
    const delta = validatedConclusion.slice(this.#emitted.length);
    this.#emitted = validatedConclusion;
    this.#conclusionClosed = true;
    return delta;
  }
}

function findTopLevelStringValue(json: string, property: string): number | null {
  let depth = 0;
  let index = 0;
  while (index < json.length) {
    const character = json[index]!;
    if (character === '"') {
      const end = findJsonStringEnd(json, index);
      if (end === null) return null;
      if (depth === 1) {
        const afterString = skipWhitespace(json, end + 1);
        if (json[afterString] === ':') {
          const key = JSON.parse(json.slice(index, end + 1)) as unknown;
          if (key === property) {
            const valueStart = skipWhitespace(json, afterString + 1);
            if (valueStart >= json.length) return null;
            if (json[valueStart] !== '"') throw new Error(`结构化回答字段 ${property} 必须是字符串`);
            return valueStart;
          }
        }
      }
      index = end + 1;
      continue;
    }
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth -= 1;
    if (depth < 0) throw new Error('结构化回答 JSON 层级无效');
    index += 1;
  }
  return null;
}

function findJsonStringEnd(json: string, start: number): number | null {
  let index = start + 1;
  while (index < json.length) {
    const character = json[index]!;
    if (character === '"') return index;
    if (character === '\\') {
      index += 1;
      if (index >= json.length) return null;
      if (json[index] === 'u') {
        if (index + 4 >= json.length) return null;
        const digits = json.slice(index + 1, index + 5);
        if (!/^[0-9A-Fa-f]{4}$/u.test(digits)) throw new Error('结构化回答包含无效 Unicode 转义');
        index += 4;
      } else if (!/^["\\/bfnrt]$/u.test(json[index]!)) {
        throw new Error('结构化回答包含无效字符串转义');
      }
    } else if (character.charCodeAt(0) < 0x20) {
      throw new Error('结构化回答包含无效控制字符');
    }
    index += 1;
  }
  return null;
}

function scanJsonStringPrefix(
  json: string,
  start: number,
): { rawPrefix: string; closed: boolean } {
  let index = start + 1;
  let safeEnd = index;
  while (index < json.length) {
    const character = json[index]!;
    if (character === '"') {
      return { rawPrefix: json.slice(start + 1, index), closed: true };
    }
    if (character === '\\') {
      if (index + 1 >= json.length) break;
      const escape = json[index + 1]!;
      if (escape === 'u') {
        if (index + 5 >= json.length) break;
        const digits = json.slice(index + 2, index + 6);
        if (!/^[0-9A-Fa-f]{4}$/u.test(digits)) throw new Error('结构化回答包含无效 Unicode 转义');
        index += 6;
      } else {
        if (!/^["\\/bfnrt]$/u.test(escape)) throw new Error('结构化回答包含无效字符串转义');
        index += 2;
      }
      safeEnd = index;
      continue;
    }
    if (character.charCodeAt(0) < 0x20) throw new Error('结构化回答包含无效控制字符');
    index += 1;
    safeEnd = index;
  }
  return { rawPrefix: json.slice(start + 1, safeEnd), closed: false };
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && /\s/u.test(value[index]!)) index += 1;
  return index;
}

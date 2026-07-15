import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { basename, extname } from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';

const MiB = 1024 * 1024;
const MAX_EXTRACTED_CHARS = 2_000_000;
const MAX_DOCX_ARCHIVE_ENTRIES = 10_000;
const MAX_DOCX_COMPRESSED_BYTES = 20 * MiB;
const MAX_DOCX_ENTRY_BYTES = 32 * MiB;
const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * MiB;
const MAX_PDF_OBJECTS = 50_000;
const MAX_PDF_STREAMS = 10_000;
const MAX_PDF_CONTAINER_ITEMS = 10_000;
const MAX_PDF_NESTING = 64;
const MAX_PDF_PAGES = 1_000;
const MAX_PDF_STREAM_BYTES = 16 * MiB;
const MAX_PDF_EXPANDED_BYTES = 64 * MiB;
const MAX_PDF_IMAGE_PIXELS = 4_000_000;
const BIDI_AND_CONTROL = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

interface DocumentRule {
  extension: '.md' | '.txt' | '.pdf' | '.docx';
  mimeTypes: readonly string[];
  maximumBytes: number;
}

const RULES: Record<string, DocumentRule> = {
  '.md': { extension: '.md', mimeTypes: ['text/markdown'], maximumBytes: 5 * MiB },
  '.txt': { extension: '.txt', mimeTypes: ['text/plain'], maximumBytes: 5 * MiB },
  '.pdf': { extension: '.pdf', mimeTypes: ['application/pdf'], maximumBytes: 20 * MiB },
  '.docx': {
    extension: '.docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    maximumBytes: 20 * MiB,
  },
};

export class DocumentExtractionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DocumentExtractionError';
  }
}

export interface ExtractedWorkspaceDocument {
  extension: DocumentRule['extension'];
  mimeType: string;
  displayName: string;
  text: string;
  size: number;
}

export async function extractWorkspaceDocument(input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<ExtractedWorkspaceDocument> {
  const displayName = sanitizeUploadName(input.filename);
  const extension = extname(displayName).toLocaleLowerCase('en-US');
  const rule = RULES[extension];
  if (!rule || !rule.mimeTypes.includes(input.mimeType)) {
    throw new DocumentExtractionError('DOCUMENT_TYPE_MISMATCH', '扩展名与声明的文件类型不一致');
  }
  if (input.bytes.length === 0) throw new DocumentExtractionError('DOCUMENT_EMPTY', '上传文件不能为空');
  if (input.bytes.length > rule.maximumBytes) {
    throw new DocumentExtractionError('DOCUMENT_TOO_LARGE', '上传文件超过大小限制');
  }

  let text: string;
  if (rule.extension === '.md' || rule.extension === '.txt') {
    text = decodeText(input.bytes);
  } else if (rule.extension === '.pdf') {
    if (input.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new DocumentExtractionError('DOCUMENT_SIGNATURE_MISMATCH', 'PDF 文件签名无效');
    }
    validatePdfStructureAndExpansion(input.bytes);
    text = await extractPdfText(input.bytes);
  } else {
    validateDocxArchive(input.bytes);
    try {
      text = (await mammoth.extractRawText({ buffer: input.bytes })).value;
    } catch {
      throw new DocumentExtractionError('DOCUMENT_EXTRACTION_FAILED', 'DOCX 文本解析失败');
    }
  }
  text = normalizeExtractedText(text);
  if (!text) throw new DocumentExtractionError('DOCUMENT_NO_TEXT', '文档中没有可检索文本');
  if (countCodePointsUpTo(text, MAX_EXTRACTED_CHARS) > MAX_EXTRACTED_CHARS) {
    throw new DocumentExtractionError('DOCUMENT_TEXT_TOO_LARGE', '文档提取文本超过限制');
  }
  return { extension: rule.extension, mimeType: input.mimeType, displayName, text, size: input.bytes.length };
}

export function sanitizeUploadName(value: string): string {
  const normalizedSeparators = value.replaceAll('\\', '/');
  const clean = basename(normalizedSeparators)
    .normalize('NFC')
    .replace(BIDI_AND_CONTROL, '')
    .trim();
  const characters = [...clean].slice(0, 255);
  const result = characters.join('').replace(/^\.+$/u, '');
  if (!result) throw new DocumentExtractionError('DOCUMENT_NAME_INVALID', '文件名无效');
  return result;
}

function decodeText(bytes: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentExtractionError('DOCUMENT_INVALID_UTF8', '文本文件不是有效 UTF-8');
  }
  if (text.startsWith('\ufeff')) text = text.slice(1);
  if (text.includes('\u0000')) throw new DocumentExtractionError('DOCUMENT_NUL', '文本文件包含 NUL');
  return text;
}

function normalizeExtractedText(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\u0000/gu, '').trim();
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({
    data: bytes,
    stopAtErrors: true,
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    canvasMaxAreaInBytes: 16 * MiB,
    isEvalSupported: false,
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
  });
  try {
    const documentInfo = await parser.getText({ partial: [0], pageJoiner: '' });
    if (!Number.isSafeInteger(documentInfo.total) || documentInfo.total < 1) {
      throw new DocumentExtractionError('DOCUMENT_PDF_STRUCTURE_INVALID', 'PDF 页面结构无效');
    }
    if (documentInfo.total > MAX_PDF_PAGES) {
      throw new DocumentExtractionError('DOCUMENT_PDF_PAGE_LIMIT', 'PDF 页数超过安全限制');
    }
    const pages: string[] = [];
    let extractedCharacters = 0;
    for (let pageNumber = 1; pageNumber <= documentInfo.total; pageNumber += 1) {
      const page = await parser.getText({ partial: [pageNumber], pageJoiner: '' });
      const remainingCharacters = MAX_EXTRACTED_CHARS - extractedCharacters;
      const pageCharacters = countCodePointsUpTo(page.text, remainingCharacters);
      if (pageCharacters > remainingCharacters) {
        throw new DocumentExtractionError('DOCUMENT_TEXT_TOO_LARGE', '文档提取文本超过限制');
      }
      extractedCharacters += pageCharacters;
      pages.push(page.text);
    }
    return pages.join('');
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError('DOCUMENT_EXTRACTION_FAILED', 'PDF 文本解析失败');
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

type PdfValue =
  | { kind: 'name'; value: string }
  | { kind: 'integer'; value: number }
  | { kind: 'reference'; objectNumber: number; generation: number }
  | { kind: 'array'; items: PdfValue[] }
  | { kind: 'dictionary'; entries: PdfDictionary }
  | { kind: 'word'; value: string }
  | { kind: 'other' };

type PdfDictionary = Map<string, PdfValue>;

function validatePdfStructureAndExpansion(bytes: Buffer): void {
  const source = bytes.toString('latin1');
  let cursor = 0;
  let objectCount = 0;
  let streamCount = 0;
  let totalExpandedBytes = 0;
  let pageTreeDeclarations = 0;
  while (cursor < source.length) {
    const object = findNextPdfObject(source, cursor);
    if (!object) break;
    pageTreeDeclarations += validatePdfSyntaxBounds(source.slice(cursor, object.start));
    objectCount += 1;
    if (objectCount > MAX_PDF_OBJECTS) throwPdfStructureLimit('PDF 对象数量超过安全限制');

    const terminator = findPdfObjectTerminator(source, object.bodyStart);
    if (terminator.kind === 'endobj') {
      pageTreeDeclarations += validatePdfSyntaxBounds(source.slice(object.bodyStart, terminator.start));
      cursor = terminator.end;
      continue;
    }

    streamCount += 1;
    if (streamCount > MAX_PDF_STREAMS) throwPdfStructureLimit('PDF 流数量超过安全限制');
    pageTreeDeclarations += validatePdfDictionaryBounds(terminator.entries);
    const streamLength = readPdfStreamLength(terminator.entries);
    if (streamLength > MAX_PDF_STREAM_BYTES) throwPdfExpansionLimit();
    const dataStart = pdfStreamDataStart(source, terminator.keywordEnd);
    const dataEnd = dataStart + streamLength;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > bytes.length) throwPdfStructureInvalid();
    const endStream = skipPdfLineEnding(source, dataEnd);
    if (!source.startsWith('endstream', endStream)) throwPdfStructureInvalid();

    const filters = readPdfFilters(terminator.entries);
    rejectUnboundedPdfDecodeParameters(terminator.entries);
    let expandedBytes = streamLength;
    let decodedStream: Buffer | null = filters.length === 0 ? bytes.subarray(dataStart, dataEnd) : null;
    if (filters.length > 0) {
      if (filters.length === 1 && ['FlateDecode', 'Fl'].includes(filters[0]!)) {
        const remaining = Math.min(MAX_PDF_STREAM_BYTES, MAX_PDF_EXPANDED_BYTES - totalExpandedBytes);
        if (remaining < 0) throwPdfExpansionLimit();
        try {
          decodedStream = inflateSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: remaining + 1 });
          expandedBytes = decodedStream.length;
        } catch (error) {
          if (hasErrorCode(error, 'ERR_BUFFER_TOO_LARGE')) throwPdfExpansionLimit();
          throwPdfStructureInvalid();
        }
      } else if (filters.length === 1 && ['DCTDecode', 'DCT', 'CCITTFaxDecode', 'CCF'].includes(filters[0]!)) {
        validateBoundedPdfImage(terminator.entries);
      } else {
        throwPdfFilterUnsupported();
      }
    }
    totalExpandedBytes += expandedBytes;
    if (expandedBytes > MAX_PDF_STREAM_BYTES || totalExpandedBytes > MAX_PDF_EXPANDED_BYTES) {
      throwPdfExpansionLimit();
    }
    if (pdfNameValue(terminator.entries.get('Type')) === 'ObjStm') {
      if (!decodedStream) throwPdfStructureInvalid();
      const objectStream = validatePdfObjectStream(
        terminator.entries,
        decodedStream,
        MAX_PDF_OBJECTS - objectCount,
      );
      objectCount += objectStream.objectCount;
      pageTreeDeclarations += objectStream.pageTreeDeclarations;
      if (objectCount > MAX_PDF_OBJECTS) throwPdfStructureLimit('PDF 对象数量超过安全限制');
    }

    const endObjectStart = skipPdfWhitespaceAndComments(source, endStream + 'endstream'.length);
    const endObject = readPdfBareToken(source, endObjectStart);
    if (endObject.value !== 'endobj') throwPdfStructureInvalid();
    cursor = endObject.end;
  }
  if (objectCount === 0) throwPdfStructureInvalid();
  pageTreeDeclarations += validatePdfSyntaxBounds(source.slice(cursor));
  if (pageTreeDeclarations === 0) throwPdfStructureInvalid();
}

function findNextPdfObject(source: string, start: number): { start: number; bodyStart: number } | null {
  let index = start;
  while (index < source.length) {
    index = skipPdfWhitespaceAndComments(source, index);
    if (index >= source.length) return null;
    if (source.startsWith('<<', index)) {
      index = parsePdfDictionaryAt(source, index, 0).end;
      continue;
    }
    if (source[index] === '(') {
      index = skipPdfLiteralString(source, index);
      continue;
    }
    if (source[index] === '<') {
      index = skipPdfHexString(source, index);
      continue;
    }
    if (source[index] === '[') {
      index = parsePdfArray(source, index, 0).end;
      continue;
    }
    if (source[index] === '/') {
      index = readPdfName(source, index).end;
      continue;
    }
    const first = readPdfBareToken(source, index);
    if (/^\d{1,10}$/u.test(first.value)) {
      const secondStart = skipPdfWhitespaceAndComments(source, first.end);
      const second = tryReadPdfBareToken(source, secondStart);
      if (second && /^\d{1,10}$/u.test(second.value)) {
        const markerStart = skipPdfWhitespaceAndComments(source, second.end);
        const marker = tryReadPdfBareToken(source, markerStart);
        if (marker?.value === 'obj') return { start: index, bodyStart: marker.end };
      }
    }
    index = first.end;
  }
  return null;
}

function findPdfObjectTerminator(source: string, bodyStart: number):
  | { kind: 'endobj'; start: number; end: number }
  | { kind: 'stream'; entries: PdfDictionary; keywordEnd: number } {
  let index = bodyStart;
  while (index < source.length) {
    index = skipPdfWhitespaceAndComments(source, index);
    if (source.startsWith('<<', index)) {
      const dictionary = parsePdfDictionaryAt(source, index, 0);
      const following = skipPdfWhitespaceAndComments(source, dictionary.end);
      const token = readPdfBareToken(source, following);
      if (token.value === 'stream') {
        return { kind: 'stream', entries: dictionary.entries, keywordEnd: token.end };
      }
      index = dictionary.end;
      continue;
    }
    if (source[index] === '(') {
      index = skipPdfLiteralString(source, index);
      continue;
    }
    if (source[index] === '<') {
      index = skipPdfHexString(source, index);
      continue;
    }
    if (source[index] === '[') {
      index = parsePdfArray(source, index, 0).end;
      continue;
    }
    if (source[index] === '/') {
      index = readPdfName(source, index).end;
      continue;
    }
    const token = readPdfBareToken(source, index);
    if (token.value === 'endobj') return { kind: 'endobj', start: index, end: token.end };
    if (token.value === 'stream' || token.end <= index) throwPdfStructureInvalid();
    index = token.end;
  }
  throwPdfStructureInvalid();
}

function validatePdfSyntaxBounds(syntax: string): number {
  validatePdfXrefTables(syntax);
  let declarations = 0;
  let index = 0;
  while (index < syntax.length) {
    if (syntax[index] === '%') {
      index = skipPdfComment(syntax, index);
    } else if (syntax[index] === '(') {
      index = skipPdfLiteralString(syntax, index);
    } else if (syntax.startsWith('<<', index)) {
      const dictionary = parsePdfDictionaryAt(syntax, index, 0);
      declarations += validatePdfDictionaryBounds(dictionary.entries);
      index = dictionary.end;
    } else if (syntax[index] === '<') {
      index = skipPdfHexString(syntax, index);
    } else {
      index += 1;
    }
  }
  return declarations;
}

function validatePdfXrefTables(syntax: string): void {
  let index = 0;
  while (index < syntax.length) {
    index = skipPdfWhitespaceAndComments(syntax, index);
    if (index >= syntax.length) return;
    if (syntax.startsWith('<<', index)) {
      index = parsePdfDictionaryAt(syntax, index, 0).end;
      continue;
    }
    if (syntax[index] === '(') {
      index = skipPdfLiteralString(syntax, index);
      continue;
    }
    if (syntax[index] === '<') {
      index = skipPdfHexString(syntax, index);
      continue;
    }
    if (syntax[index] === '[') {
      index = parsePdfArray(syntax, index, 0).end;
      continue;
    }
    if (syntax[index] === '/') {
      index = readPdfName(syntax, index).end;
      continue;
    }
    const token = readPdfBareToken(syntax, index);
    index = token.end;
    if (token.value !== 'xref') continue;

    let tableEntries = 0;
    while (index < syntax.length) {
      index = skipPdfWhitespaceAndComments(syntax, index);
      const first = readPdfBareToken(syntax, index);
      if (first.value === 'trailer') {
        index = first.end;
        break;
      }
      const countStart = skipPdfWhitespaceAndComments(syntax, first.end);
      const countToken = readPdfBareToken(syntax, countStart);
      if (!/^\d{1,10}$/u.test(first.value) || !/^\d{1,10}$/u.test(countToken.value)) {
        throwPdfStructureInvalid();
      }
      const firstObject = Number(first.value);
      const count = Number(countToken.value);
      if (!Number.isSafeInteger(firstObject) || !Number.isSafeInteger(count) || count < 1
        || firstObject + count > MAX_PDF_OBJECTS + 1
        || tableEntries + count > MAX_PDF_OBJECTS + 1) {
        throwPdfStructureLimit('PDF 交叉引用数量超过安全限制');
      }
      tableEntries += count;
      index = countToken.end;
      for (let entry = 0; entry < count; entry += 1) {
        const offset = readNextPdfToken(syntax, index);
        const generation = readNextPdfToken(syntax, offset.end);
        const kind = readNextPdfToken(syntax, generation.end);
        if (!/^\d{1,10}$/u.test(offset.value) || !/^\d{1,5}$/u.test(generation.value)
          || !['f', 'n'].includes(kind.value)) throwPdfStructureInvalid();
        index = kind.end;
      }
    }
  }
}

function readNextPdfToken(source: string, start: number): { value: string; end: number } {
  return readPdfBareToken(source, skipPdfWhitespaceAndComments(source, start));
}

function validatePdfDictionaryBounds(entries: PdfDictionary): number {
  if (entries.has('Encrypt')) {
    throw new DocumentExtractionError('DOCUMENT_PDF_ENCRYPTED', '不支持加密 PDF');
  }
  const size = entries.get('Size');
  if (size) {
    const value = pdfIntegerValue(size);
    if (value === null || value < 1 || value > MAX_PDF_OBJECTS + 1) {
      throwPdfStructureLimit('PDF 交叉引用数量超过安全限制');
    }
  }
  let declarations = 0;
  const type = pdfNameValue(entries.get('Type'));
  if (type === 'Pages') {
    const count = pdfIntegerValue(entries.get('Count'));
    if (count === null || count < 1) throwPdfStructureInvalid();
    if (count > MAX_PDF_PAGES) {
      throw new DocumentExtractionError('DOCUMENT_PDF_PAGE_LIMIT', 'PDF 页数超过安全限制');
    }
    const kids = entries.get('Kids');
    if (!kids || kids.kind !== 'array' || kids.items.length > MAX_PDF_PAGES
      || kids.items.some((item) => !['reference', 'dictionary'].includes(item.kind))) {
      throwPdfStructureInvalid();
    }
    declarations += 1;
  }
  if (type === 'XRef') validatePdfXrefStreamDictionary(entries);
  for (const value of entries.values()) declarations += validateNestedPdfValueBounds(value);
  return declarations;
}

function validatePdfXrefStreamDictionary(entries: PdfDictionary): void {
  const size = pdfIntegerValue(entries.get('Size'));
  const widths = entries.get('W');
  if (size === null || size < 1 || size > MAX_PDF_OBJECTS + 1
    || !widths || widths.kind !== 'array' || widths.items.length !== 3) {
    throwPdfStructureInvalid();
  }
  const widthValues = widths.items.map(pdfIntegerValue);
  if (widthValues.some((value) => value === null || value < 0 || value > 8)
    || (widthValues as number[]).reduce((sum, value) => sum + value, 0) > 16) {
    throwPdfStructureLimit('PDF 交叉引用字段超过安全限制');
  }
  const ranges = entries.get('Index') ?? {
    kind: 'array' as const,
    items: [
      { kind: 'integer' as const, value: 0 },
      { kind: 'integer' as const, value: size },
    ],
  };
  if (ranges.kind !== 'array' || ranges.items.length === 0 || ranges.items.length % 2 !== 0) {
    throwPdfStructureInvalid();
  }
  let total = 0;
  for (let index = 0; index < ranges.items.length; index += 2) {
    const first = pdfIntegerValue(ranges.items[index]);
    const count = pdfIntegerValue(ranges.items[index + 1]);
    if (first === null || first < 0 || count === null || count < 0
      || first + count > MAX_PDF_OBJECTS + 1 || total + count > MAX_PDF_OBJECTS + 1) {
      throwPdfStructureLimit('PDF 交叉引用数量超过安全限制');
    }
    total += count;
  }
}

function validateNestedPdfValueBounds(value: PdfValue): number {
  if (value.kind === 'dictionary') return validatePdfDictionaryBounds(value.entries);
  if (value.kind === 'array') {
    return value.items.reduce((total, item) => total + validateNestedPdfValueBounds(item), 0);
  }
  return 0;
}

function validatePdfObjectStream(entries: PdfDictionary, decoded: Buffer, remainingObjects: number): {
  objectCount: number;
  pageTreeDeclarations: number;
} {
  const count = pdfIntegerValue(entries.get('N'));
  const first = pdfIntegerValue(entries.get('First'));
  if (count === null || count < 1 || count > remainingObjects
    || first === null || first < 1 || first > decoded.length) {
    throwPdfStructureInvalid();
  }
  const header = decoded.subarray(0, first).toString('ascii').trim().split(/[\x00\t\n\f\r ]+/u);
  if (header.length !== count * 2 || header.some((value) => !/^\d{1,10}$/u.test(value))) {
    throwPdfStructureInvalid();
  }
  let previousOffset = -1;
  for (let index = 1; index < header.length; index += 2) {
    const objectOffset = Number(header[index]);
    if (!Number.isSafeInteger(objectOffset) || objectOffset < previousOffset || first + objectOffset > decoded.length) {
      throwPdfStructureInvalid();
    }
    previousOffset = objectOffset;
  }
  return {
    objectCount: count,
    pageTreeDeclarations: validatePdfSyntaxBounds(decoded.subarray(first).toString('latin1')),
  };
}

function readPdfStreamLength(entries: PdfDictionary): number {
  const value = pdfIntegerValue(entries.get('Length'));
  if (value === null || value < 0) throwPdfStructureInvalid();
  return value;
}

function pdfStreamDataStart(source: string, keywordEnd: number): number {
  if (source.startsWith('\r\n', keywordEnd)) return keywordEnd + 2;
  if (source[keywordEnd] === '\r' || source[keywordEnd] === '\n') return keywordEnd + 1;
  throwPdfStructureInvalid();
}

function skipPdfLineEnding(source: string, offset: number): number {
  if (source.startsWith('\r\n', offset)) return offset + 2;
  if (source[offset] === '\r' || source[offset] === '\n') return offset + 1;
  return offset;
}

function readPdfFilters(entries: PdfDictionary): string[] {
  const value = entries.get('Filter');
  if (!value) return [];
  if (value.kind === 'name') return [value.value];
  if (value.kind === 'array' && value.items.length > 0 && value.items.every((item) => item.kind === 'name')) {
    return value.items.map((item) => (item as Extract<PdfValue, { kind: 'name' }>).value);
  }
  throwPdfFilterUnsupported();
}

function rejectUnboundedPdfDecodeParameters(entries: PdfDictionary): void {
  const full = entries.get('DecodeParms');
  const abbreviated = entries.get('DP');
  if (full && abbreviated) throwPdfFilterUnsupported();
  const value = full ?? abbreviated;
  if (!value) return;
  if (value.kind === 'word' && value.value === 'null') return;
  if (value.kind === 'array'
    && value.items.every((item) => item.kind === 'word' && item.value === 'null')) return;
  throwPdfFilterUnsupported();
}

function validateBoundedPdfImage(entries: PdfDictionary): void {
  if (pdfNameValue(entries.get('Subtype')) !== 'Image') throwPdfStructureInvalid();
  const width = pdfIntegerValue(entries.get('Width'));
  const height = pdfIntegerValue(entries.get('Height'));
  if (width === null || width < 1 || height === null || height < 1
    || width * height > MAX_PDF_IMAGE_PIXELS) {
    throw new DocumentExtractionError('DOCUMENT_PDF_IMAGE_LIMIT', 'PDF 图像尺寸超过安全限制');
  }
}

function parsePdfDictionaryAt(source: string, start: number, depth: number): {
  entries: PdfDictionary;
  end: number;
} {
  if (depth > MAX_PDF_NESTING || !source.startsWith('<<', start)) throwPdfStructureInvalid();
  const entries: PdfDictionary = new Map();
  let index = start + 2;
  while (index < source.length) {
    index = skipPdfWhitespaceAndComments(source, index);
    if (source.startsWith('>>', index)) return { entries, end: index + 2 };
    const key = readPdfName(source, index);
    index = skipPdfWhitespaceAndComments(source, key.end);
    const parsed = parsePdfValue(source, index, depth + 1);
    if (entries.has(key.value) || entries.size >= MAX_PDF_CONTAINER_ITEMS) throwPdfStructureInvalid();
    entries.set(key.value, parsed.value);
    index = parsed.end;
  }
  throwPdfStructureInvalid();
}

function parsePdfValue(source: string, start: number, depth: number): { value: PdfValue; end: number } {
  if (depth > MAX_PDF_NESTING) throwPdfStructureInvalid();
  if (source.startsWith('<<', start)) {
    const dictionary = parsePdfDictionaryAt(source, start, depth);
    return { value: { kind: 'dictionary', entries: dictionary.entries }, end: dictionary.end };
  }
  if (source[start] === '[') {
    const array = parsePdfArray(source, start, depth);
    return { value: { kind: 'array', items: array.items }, end: array.end };
  }
  if (source[start] === '/') {
    const name = readPdfName(source, start);
    return { value: { kind: 'name', value: name.value }, end: name.end };
  }
  if (source[start] === '(') return { value: { kind: 'other' }, end: skipPdfLiteralString(source, start) };
  if (source[start] === '<') return { value: { kind: 'other' }, end: skipPdfHexString(source, start) };

  const first = readPdfBareToken(source, start);
  if (/^[+-]?\d+$/u.test(first.value)) {
    const integer = Number(first.value);
    if (!Number.isSafeInteger(integer)) throwPdfStructureInvalid();
    const secondStart = skipPdfWhitespaceAndComments(source, first.end);
    const second = tryReadPdfBareToken(source, secondStart);
    if (second && /^\d+$/u.test(second.value)) {
      const referenceEnd = skipPdfWhitespaceAndComments(source, second.end);
      const marker = tryReadPdfBareToken(source, referenceEnd);
      if (marker?.value === 'R') {
        const generation = Number(second.value);
        if (integer < 0 || !Number.isSafeInteger(generation)) throwPdfStructureInvalid();
        return {
          value: { kind: 'reference', objectNumber: integer, generation },
          end: marker.end,
        };
      }
    }
    return { value: { kind: 'integer', value: integer }, end: first.end };
  }
  return { value: { kind: 'word', value: first.value }, end: first.end };
}

function parsePdfArray(source: string, start: number, depth: number): { items: PdfValue[]; end: number } {
  if (depth > MAX_PDF_NESTING || source[start] !== '[') throwPdfStructureInvalid();
  const items: PdfValue[] = [];
  let index = start + 1;
  while (index < source.length) {
    index = skipPdfWhitespaceAndComments(source, index);
    if (source[index] === ']') return { items, end: index + 1 };
    if (items.length >= MAX_PDF_CONTAINER_ITEMS) throwPdfStructureInvalid();
    const parsed = parsePdfValue(source, index, depth + 1);
    items.push(parsed.value);
    index = parsed.end;
  }
  throwPdfStructureInvalid();
}

function readPdfName(source: string, start: number): { value: string; end: number } {
  if (source[start] !== '/') throwPdfStructureInvalid();
  let value = '';
  let index = start + 1;
  while (index < source.length && !isPdfDelimiter(source[index]!)) {
    if (source[index] === '#') {
      const escaped = source.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/u.test(escaped)) throwPdfStructureInvalid();
      value += String.fromCharCode(Number.parseInt(escaped, 16));
      index += 3;
    } else {
      value += source[index];
      index += 1;
    }
  }
  if (!value || value.length > 1_024) throwPdfStructureInvalid();
  return { value, end: index };
}

function readPdfBareToken(source: string, start: number): { value: string; end: number } {
  let end = start;
  while (end < source.length && !isPdfDelimiter(source[end]!)) end += 1;
  if (end === start) throwPdfStructureInvalid();
  return { value: source.slice(start, end), end };
}

function tryReadPdfBareToken(source: string, start: number): { value: string; end: number } | null {
  return start < source.length && !isPdfDelimiter(source[start]!)
    ? readPdfBareToken(source, start)
    : null;
}

function skipPdfWhitespaceAndComments(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    while (index < source.length && isPdfWhitespace(source[index]!)) index += 1;
    if (source[index] !== '%') return index;
    index = skipPdfComment(source, index);
  }
  return index;
}

function skipPdfComment(source: string, start: number): number {
  let index = start;
  while (index < source.length && source[index] !== '\r' && source[index] !== '\n') index += 1;
  return index;
}

function skipPdfLiteralString(source: string, start: number): number {
  if (source[start] !== '(') throwPdfStructureInvalid();
  let depth = 1;
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
    } else if (source[index] === '(') {
      depth += 1;
      if (depth > MAX_PDF_NESTING) throwPdfStructureInvalid();
    } else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throwPdfStructureInvalid();
}

function skipPdfHexString(source: string, start: number): number {
  if (source[start] !== '<' || source.startsWith('<<', start)) throwPdfStructureInvalid();
  const end = source.indexOf('>', start + 1);
  if (end < 0) throwPdfStructureInvalid();
  return end + 1;
}

function isPdfWhitespace(value: string): boolean {
  return value === '\u0000' || value === '\t' || value === '\n'
    || value === '\f' || value === '\r' || value === ' ';
}

function isPdfDelimiter(value: string): boolean {
  return isPdfWhitespace(value) || '()<>[]{}/%'.includes(value);
}

function pdfIntegerValue(value: PdfValue | undefined): number | null {
  return value?.kind === 'integer' ? value.value : null;
}

function pdfNameValue(value: PdfValue | undefined): string | null {
  return value?.kind === 'name' ? value.value : null;
}

function throwPdfStructureInvalid(): never {
  throw new DocumentExtractionError('DOCUMENT_PDF_STRUCTURE_INVALID', 'PDF 流结构无效');
}

function throwPdfStructureLimit(message: string): never {
  throw new DocumentExtractionError('DOCUMENT_PDF_STRUCTURE_LIMIT', message);
}

function throwPdfFilterUnsupported(): never {
  throw new DocumentExtractionError('DOCUMENT_PDF_FILTER_UNSUPPORTED', 'PDF 包含未受安全边界支持的过滤参数');
}

function throwPdfExpansionLimit(): never {
  throw new DocumentExtractionError('DOCUMENT_PDF_EXPANSION_LIMIT', 'PDF 解压内容超过安全限制');
}

interface ValidatedDocxEntry {
  method: number;
  compressedSize: number;
  declaredSize: number;
  dataStart: number;
  dataEnd: number;
  rangeStart: number;
  rangeEnd: number;
}

function validateDocxArchive(bytes: Buffer): void {
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new DocumentExtractionError('DOCUMENT_SIGNATURE_MISMATCH', 'DOCX 文件签名无效');
  }
  const endOffset = findZipEndOfCentralDirectory(bytes);
  if (endOffset < 0) throwArchiveInvalid();
  const diskNumber = bytes.readUInt16LE(endOffset + 4);
  const centralDisk = bytes.readUInt16LE(endOffset + 6);
  const diskEntries = bytes.readUInt16LE(endOffset + 8);
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount
    || entryCount === 0xffff || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff
    || centralOffset + centralSize !== endOffset) {
    throwArchiveInvalid();
  }
  if (entryCount > MAX_DOCX_ARCHIVE_ENTRIES) throwArchiveLimit();

  const names = new Set<string>();
  const entries: ValidatedDocxEntry[] = [];
  let offset = centralOffset;
  let totalDeclaredBytes = 0;
  let totalCompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || bytes.readUInt32LE(offset) !== 0x02014b50) throwArchiveInvalid();
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const declaredSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nameEnd = offset + 46 + nameLength;
    const entryEnd = nameEnd + extraLength + commentLength;
    if (entryEnd > endOffset || flags & 0x1 || ![0, 8].includes(method)
      || compressedSize === 0xffff_ffff || declaredSize === 0xffff_ffff || localOffset === 0xffff_ffff
      || ((externalAttributes >>> 16) & 0xf000) === 0xa000) {
      throwArchiveInvalid();
    }
    if (declaredSize > MAX_DOCX_ENTRY_BYTES || totalDeclaredBytes + declaredSize > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throwArchiveLimit();
    }
    const rawName = bytes.subarray(offset + 46, nameEnd);
    const name = decodeArchiveName(rawName, Boolean(flags & 0x800));
    if (!isSafeArchiveEntry(name) || names.has(name)) throwArchiveInvalid();

    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) throwArchiveInvalid();
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localCrc = bytes.readUInt32LE(localOffset + 14);
    const localCompressedSize = bytes.readUInt32LE(localOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (localFlags !== flags || localMethod !== method || localNameEnd > centralOffset || dataEnd > centralOffset
      || !bytes.subarray(localNameStart, localNameEnd).equals(rawName)) {
      throwArchiveInvalid();
    }
    let recordEnd = dataEnd;
    if (flags & 0x8) {
      let descriptor = dataEnd;
      if (descriptor + 4 <= centralOffset && bytes.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
      if (descriptor + 12 > centralOffset
        || bytes.readUInt32LE(descriptor) !== crc
        || bytes.readUInt32LE(descriptor + 4) !== compressedSize
        || bytes.readUInt32LE(descriptor + 8) !== declaredSize) {
        throwArchiveInvalid();
      }
      recordEnd = descriptor + 12;
    } else if (localCrc !== crc || localCompressedSize !== compressedSize || localUncompressedSize !== declaredSize) {
      throwArchiveInvalid();
    }

    totalDeclaredBytes += declaredSize;
    totalCompressedBytes += compressedSize;
    if (totalCompressedBytes > MAX_DOCX_COMPRESSED_BYTES) throwArchiveLimit();
    names.add(name);
    entries.push({
      method,
      compressedSize,
      declaredSize,
      dataStart,
      dataEnd,
      rangeStart: localOffset,
      rangeEnd: recordEnd,
    });
    offset = entryEnd;
  }
  if (offset !== centralOffset + centralSize) throwArchiveInvalid();
  entries.sort((left, right) => left.rangeStart - right.rangeStart);
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.rangeEnd > entries[index]!.rangeStart) throwArchiveInvalid();
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) {
    throwArchiveInvalid();
  }

  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const remainingBytes = Math.min(
      MAX_DOCX_ENTRY_BYTES,
      MAX_DOCX_UNCOMPRESSED_BYTES - totalUncompressedBytes,
    );
    let actualSize: number;
    if (entry.method === 0) {
      actualSize = entry.compressedSize;
    } else {
      try {
        actualSize = inflateRawSync(bytes.subarray(entry.dataStart, entry.dataEnd), {
          maxOutputLength: remainingBytes + 1,
        }).length;
      } catch (error) {
        if (hasErrorCode(error, 'ERR_BUFFER_TOO_LARGE')) throwArchiveLimit();
        throwArchiveInvalid();
      }
    }
    if (actualSize > MAX_DOCX_ENTRY_BYTES || totalUncompressedBytes + actualSize > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throwArchiveLimit();
    }
    if (actualSize !== entry.declaredSize
      || (entry.method === 0 && entry.compressedSize !== entry.declaredSize)) throwArchiveInvalid();
    totalUncompressedBytes += actualSize;
  }
}

function findZipEndOfCentralDirectory(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50
      && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) return offset;
  }
  return -1;
}

function decodeArchiveName(bytes: Buffer, utf8: boolean): string {
  if (!utf8 && bytes.some((value) => value > 0x7f)) throwArchiveInvalid();
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'ascii', { fatal: true }).decode(bytes).normalize('NFC');
  } catch {
    throwArchiveInvalid();
  }
}

function throwArchiveInvalid(): never {
  throw new DocumentExtractionError('DOCUMENT_ARCHIVE_INVALID', 'DOCX 压缩目录无效');
}

function throwArchiveLimit(): never {
  throw new DocumentExtractionError('DOCUMENT_ARCHIVE_LIMIT', 'DOCX 解压内容超过安全限制');
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function countCodePointsUpTo(value: string, limit: number): number {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > limit) return count;
  }
  return count;
}

function isSafeArchiveEntry(name: string): boolean {
  return name.length > 0
    && !name.startsWith('/')
    && !name.includes('\\')
    && !name.split('/').some((part) => part === '..' || part === '.')
    && !/\p{Cc}/u.test(name);
}

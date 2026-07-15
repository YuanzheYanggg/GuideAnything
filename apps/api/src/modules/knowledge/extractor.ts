import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { basename, extname } from 'node:path';

const MiB = 1024 * 1024;
const MAX_EXTRACTED_CHARS = 2_000_000;
const MAX_DOCX_ARCHIVE_ENTRIES = 10_000;
const MAX_DOCX_ENTRY_BYTES = 32 * MiB;
const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * MiB;
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
    const parser = new PDFParse({ data: input.bytes });
    try {
      text = (await parser.getText()).text;
    } catch {
      throw new DocumentExtractionError('DOCUMENT_EXTRACTION_FAILED', 'PDF 文本解析失败');
    } finally {
      await parser.destroy().catch(() => undefined);
    }
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
  if ([...text].length > MAX_EXTRACTED_CHARS) {
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

function validateDocxArchive(bytes: Buffer): void {
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new DocumentExtractionError('DOCUMENT_SIGNATURE_MISMATCH', 'DOCX 文件签名无效');
  }
  const names = new Set<string>();
  let offset = 0;
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  while (offset + 46 <= bytes.length) {
    const signature = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset);
    if (signature < 0) break;
    if (signature + 46 > bytes.length) break;
    const flags = bytes.readUInt16LE(signature + 8);
    const method = bytes.readUInt16LE(signature + 10);
    const compressedSize = bytes.readUInt32LE(signature + 20);
    const uncompressedSize = bytes.readUInt32LE(signature + 24);
    const nameLength = bytes.readUInt16LE(signature + 28);
    const extraLength = bytes.readUInt16LE(signature + 30);
    const commentLength = bytes.readUInt16LE(signature + 32);
    const nameEnd = signature + 46 + nameLength;
    const entryEnd = nameEnd + extraLength + commentLength;
    entryCount += 1;
    totalUncompressedBytes += uncompressedSize;
    if (nameEnd > bytes.length || entryEnd > bytes.length || flags & 0x1 || ![0, 8].includes(method)) {
      throw new DocumentExtractionError('DOCUMENT_ARCHIVE_INVALID', 'DOCX 压缩目录无效');
    }
    if (entryCount > MAX_DOCX_ARCHIVE_ENTRIES
      || compressedSize === 0xffff_ffff
      || uncompressedSize === 0xffff_ffff
      || uncompressedSize > MAX_DOCX_ENTRY_BYTES
      || totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new DocumentExtractionError('DOCUMENT_ARCHIVE_LIMIT', 'DOCX 解压内容超过安全限制');
    }
    const name = bytes.subarray(signature + 46, nameEnd).toString('utf8').normalize('NFC');
    if (!isSafeArchiveEntry(name)) {
      throw new DocumentExtractionError('DOCUMENT_ARCHIVE_INVALID', 'DOCX 包含不安全条目');
    }
    names.add(name);
    offset = entryEnd;
  }
  if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) {
    throw new DocumentExtractionError('DOCUMENT_ARCHIVE_INVALID', 'DOCX 缺少必要文档条目');
  }
}

function isSafeArchiveEntry(name: string): boolean {
  return name.length > 0
    && !name.startsWith('/')
    && !name.includes('\\')
    && !name.split('/').some((part) => part === '..' || part === '.')
    && !/\p{Cc}/u.test(name);
}

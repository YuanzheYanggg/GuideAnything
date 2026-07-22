import type { MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';

const MiB = 1024 * 1024;

interface MediaRule {
  kind: 'IMAGE' | 'VIDEO';
  extension: string;
  maxBytes: number;
  signature: (bytes: Buffer) => boolean;
}

const rules: Record<string, MediaRule> = {
  'image/png': { kind: 'IMAGE', extension: '.png', maxBytes: 10 * MiB, signature: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { kind: 'IMAGE', extension: '.jpg', maxBytes: 10 * MiB, signature: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { kind: 'IMAGE', extension: '.gif', maxBytes: 10 * MiB, signature: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')) },
  'image/webp': { kind: 'IMAGE', extension: '.webp', maxBytes: 10 * MiB, signature: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  'video/mp4': { kind: 'VIDEO', extension: '.mp4', maxBytes: 200 * MiB, signature: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
  'video/quicktime': { kind: 'VIDEO', extension: '.mov', maxBytes: 200 * MiB, signature: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
  'video/webm': { kind: 'VIDEO', extension: '.webm', maxBytes: 200 * MiB, signature: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
};

export interface MediaAsset {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  mimeType: string;
  size: number;
  originalName: string;
  url: string;
  createdAt: string;
}

interface MediaRow {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  mime_type: string;
  size: number;
  storage_path: string;
  original_name: string;
  created_at: string;
}

export async function storeMedia(
  database: DatabaseSync,
  uploadDir: string,
  ownerId: string,
  file: MultipartFile,
): Promise<MediaAsset> {
  const rule = rules[file.mimetype];
  if (!rule) throw httpError(415, 'UNSUPPORTED_MEDIA_TYPE', '仅支持 JPEG、PNG、WebP、GIF、MP4、MOV 和 WebM');
  const bytes = await readWithLimit(file, rule.maxBytes);
  if (!rule.signature(bytes)) {
    throw httpError(415, 'MEDIA_SIGNATURE_MISMATCH', '文件内容与声明的媒体类型不一致');
  }

  mkdirSync(uploadDir, { recursive: true });
  const id = randomUUID();
  const storagePath = join(uploadDir, `${id}${rule.extension}`);
  const originalName = basename(file.filename).slice(0, 255) || `upload${rule.extension}`;
  const createdAt = new Date().toISOString();
  writeFileSync(storagePath, bytes, { flag: 'wx' });
  try {
    database.prepare(
      `INSERT INTO media_assets (
        id, owner_id, kind, mime_type, size, storage_path, original_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ownerId, rule.kind, file.mimetype, bytes.length, storagePath, originalName, createdAt);
  } catch (error) {
    unlinkSync(storagePath);
    throw error;
  }
  return { id, kind: rule.kind, mimeType: file.mimetype, size: bytes.length, originalName, url: `/api/media/${id}`, createdAt };
}

export function openMedia(database: DatabaseSync, assetId: string) {
  const row = database.prepare(
    `SELECT id, kind, mime_type, size, storage_path, original_name, created_at
     FROM media_assets WHERE id = ?`,
  ).get(assetId) as unknown as MediaRow | undefined;
  if (!row) throw httpError(404, 'MEDIA_NOT_FOUND', '媒体文件不存在');
  return {
    asset: {
      id: row.id,
      kind: row.kind,
      mimeType: row.mime_type,
      size: row.size,
      originalName: row.original_name,
      url: `/api/media/${row.id}`,
      createdAt: row.created_at,
    } satisfies MediaAsset,
    stream: createReadStream(row.storage_path),
  };
}

async function readWithLimit(file: MultipartFile, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of file.file) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximum) {
      file.file.destroy();
      throw httpError(413, 'MEDIA_TOO_LARGE', `文件超过 ${maximum / MiB} MiB 限制`);
    }
    chunks.push(buffer);
  }
  if (size === 0) throw httpError(400, 'EMPTY_MEDIA', '上传文件不能为空');
  return Buffer.concat(chunks, size);
}

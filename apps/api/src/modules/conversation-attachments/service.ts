import type { MultipartFile } from '@fastify/multipart';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import { getWorkspacePermission } from '../workspaces/repository';
import {
  DocumentExtractionError,
  extractWorkspaceDocument,
  sanitizeUploadName,
} from '../knowledge/extractor';
import {
  countReadyConversationAttachments,
  insertConversationAttachmentRecords,
  listConversationAttachmentStorageKeys,
} from './repository';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const STORABLE_FAILURE_CODES = new Set([
  'DOCUMENT_EXTRACTION_FAILED',
  'DOCUMENT_NO_TEXT',
  'DOCUMENT_INVALID_UTF8',
  'DOCUMENT_NUL',
]);
const GENERATED_STORAGE_KEY = /^conversations\/[0-9a-f]{32}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:md|txt|pdf|docx)$/u;

export interface ConversationAttachmentFileSystem {
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  rename: typeof rename;
  unlink: typeof unlink;
}

interface ConversationAttachmentServiceOptions {
  fileSystem?: ConversationAttachmentFileSystem;
  now?: () => Date;
}

const nodeFileSystem: ConversationAttachmentFileSystem = { mkdir, writeFile, rename, unlink };

export class ConversationAttachmentService {
  private readonly fileSystem: ConversationAttachmentFileSystem;
  private readonly now: () => Date;

  constructor(
    private readonly database: DatabaseSync,
    private readonly uploadRoot: string,
    options: ConversationAttachmentServiceOptions = {},
  ) {
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.now = options.now ?? (() => new Date());
  }

  async upload(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    file: MultipartFile,
  ) {
    this.requireUploadAccess(ownerId, workspaceId, conversationId);
    const bytes = await readUpload(file, MAX_UPLOAD_BYTES);
    let displayName: string;
    try {
      displayName = sanitizeUploadName(file.filename);
      if (displayName.length > 255) {
        throw new DocumentExtractionError('DOCUMENT_NAME_INVALID', '文件名超过长度限制');
      }
    } catch (error) {
      throw extractionHttpError(error);
    }

    let text: string | undefined;
    let failureCode: string | undefined;
    try {
      text = (await extractWorkspaceDocument({
        filename: displayName,
        mimeType: file.mimetype,
        bytes,
      })).text;
    } catch (error) {
      if (!(error instanceof DocumentExtractionError) || !STORABLE_FAILURE_CODES.has(error.code)) {
        throw extractionHttpError(error);
      }
      failureCode = error.code;
    }

    // Streaming and extraction can be slow; authorization is deliberately fresh here.
    this.requireUploadAccess(ownerId, workspaceId, conversationId);
    const attachmentId = randomUUID();
    const sourceId = randomUUID();
    const documentId = randomUUID();
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const extension = extname(displayName).toLocaleLowerCase('en-US');
    const conversationDirectory = createHash('sha256').update(conversationId).digest('hex').slice(0, 32);
    const storageKey = `conversations/${conversationDirectory}/${attachmentId}${extension}`;
    const targetDirectory = join(this.uploadRoot, 'conversations', conversationDirectory);
    const temporaryPath = join(targetDirectory, `.tmp-${randomUUID()}`);
    const finalPath = this.resolveGeneratedStoragePath(storageKey);

    await this.fileSystem.mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    try {
      await this.fileSystem.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
      await this.fileSystem.rename(temporaryPath, finalPath);
      // A membership or conversation-owner change after rename must still fail closed.
      this.requireUploadAccess(ownerId, workspaceId, conversationId);
      const now = this.now();
      return insertConversationAttachmentRecords({
        database: this.database,
        attachmentId,
        sourceId,
        documentId,
        conversationId,
        ownerId,
        originalName: displayName,
        mimeType: file.mimetype,
        size: bytes.length,
        storageKey,
        checksum,
        ...(text !== undefined ? { text } : {}),
        ...(failureCode ? { failureCode } : {}),
        now,
        expiresAt: new Date(now.getTime() + ATTACHMENT_TTL_MS),
      });
    } catch (error) {
      await this.fileSystem.unlink(temporaryPath).catch(() => undefined);
      await this.fileSystem.unlink(finalPath).catch(() => undefined);
      throw error;
    }
  }

  requireReadyForMessage(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    attachmentIds: readonly string[],
  ): void {
    this.requireUploadAccess(ownerId, workspaceId, conversationId);
    const uniqueIds = [...new Set(attachmentIds)];
    if (uniqueIds.length !== attachmentIds.length) {
      throw httpError(400, 'ATTACHMENT_IDS_DUPLICATED', '附件 ID 不能重复');
    }
    if (uniqueIds.length === 0) return;
    const ready = countReadyConversationAttachments(this.database, {
      conversationId,
      ownerId,
      attachmentIds: uniqueIds,
      now: this.now(),
    });
    if (ready !== uniqueIds.length) {
      throw httpError(400, 'ATTACHMENT_NOT_READY', '一个或多个会话附件不存在、未就绪或已过期');
    }
  }

  storageKeysForConversation(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
  ): string[] {
    this.requireConversationAccess(ownerId, workspaceId, conversationId, false);
    return listConversationAttachmentStorageKeys(this.database, conversationId, ownerId);
  }

  /**
   * Database cascades intentionally cannot remove files. A conversation-deletion flow must collect
   * storage keys before deleting the row, commit the database transaction, then call this method.
   */
  async removeStoredFiles(storageKeys: readonly string[]): Promise<void> {
    for (const storageKey of storageKeys) {
      const path = this.resolveGeneratedStoragePath(storageKey);
      await this.fileSystem.unlink(path).catch((error: unknown) => {
        if (!isNodeError(error, 'ENOENT')) throw error;
      });
    }
  }

  private requireUploadAccess(ownerId: string, workspaceId: string, conversationId: string): void {
    this.requireConversationAccess(ownerId, workspaceId, conversationId, true);
  }

  private requireConversationAccess(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    requireActive: boolean,
  ): void {
    if (!getWorkspacePermission(this.database, workspaceId, ownerId)) {
      throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    }
    const conversation = this.database.prepare(
      `SELECT 1
       FROM conversations
       WHERE id = ?
         AND owner_id = ?
         AND scope = 'WORKSPACE'
         AND workspace_id = ?
         AND (? = 0 OR status = 'ACTIVE')`,
    ).get(conversationId, ownerId, workspaceId, requireActive ? 1 : 0);
    if (!conversation) throw httpError(404, 'CONVERSATION_NOT_FOUND', '会话不存在');
  }

  private resolveGeneratedStoragePath(storageKey: string): string {
    if (isAbsolute(storageKey) || !GENERATED_STORAGE_KEY.test(storageKey)) {
      throw new Error('会话附件 storage key 无效');
    }
    const root = resolve(this.uploadRoot);
    const path = resolve(root, storageKey);
    if (!path.startsWith(`${root}${sep}`)) throw new Error('会话附件 storage key 越界');
    return path;
  }
}

async function readUpload(file: MultipartFile, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of file.file) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximum) {
      file.file.destroy();
      throw httpError(413, 'DOCUMENT_TOO_LARGE', '上传文件超过 20 MiB 限制');
    }
    chunks.push(bytes);
  }
  if (size === 0) throw httpError(400, 'DOCUMENT_EMPTY', '上传文件不能为空');
  return Buffer.concat(chunks, size);
}

function extractionHttpError(error: unknown) {
  if (!(error instanceof DocumentExtractionError)) {
    return httpError(400, 'DOCUMENT_INVALID', '文档无效');
  }
  const status = error.code === 'DOCUMENT_TOO_LARGE'
    ? 413
    : ['DOCUMENT_TYPE_MISMATCH', 'DOCUMENT_SIGNATURE_MISMATCH'].includes(error.code)
      ? 415
      : 400;
  return httpError(status, error.code, error.message);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === code;
}

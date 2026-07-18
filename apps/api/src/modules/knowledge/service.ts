import type { MultipartFile } from '@fastify/multipart';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import { getWorkspaceFolder, getWorkspacePermission } from '../workspaces/repository';
import { DocumentExtractionError, extractWorkspaceDocument, sanitizeUploadName } from './extractor';
import { listReadableFlowSnapshots } from './flow-indexer';
import {
  getKnowledgeDocument,
  getSantexwellOverview,
  getSantexwellHealth,
  insertWorkspaceDocument,
  listWorkspaceSources,
  searchKnowledge,
} from './repository';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export class KnowledgeService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly uploadRoot: string,
  ) {}

  santexwellStatus() {
    return getSantexwellHealth(this.database);
  }

  santexwellOverview() {
    return getSantexwellOverview(this.database);
  }

  searchSantexwell(query: string, limit: number) {
    return searchKnowledge(this.database, query, { sourceKinds: ['SANTEXWELL'], limit });
  }

  readSantexwellDocument(documentId: string) {
    const document = getKnowledgeDocument(this.database, documentId, { sourceKinds: ['SANTEXWELL'] });
    if (!document) throw httpError(404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND', '知识页面不存在');
    return document;
  }

  workspaceSources(user: { id: string; role: string }, workspaceId: string) {
    const permission = this.requireWorkspaceRead(user.id, workspaceId);
    return {
      workspaceId,
      workspacePermission: permission,
      capabilities: {
        canUploadPersistentSource: ['AUTHOR', 'EDITOR'].includes(user.role)
          && ['OWNER', 'EDIT'].includes(permission),
      },
      items: listWorkspaceSources(this.database, workspaceId),
    };
  }

  flowSnapshots(user: { id: string; role: string }, workspaceId: string) {
    this.requireWorkspaceRead(user.id, workspaceId);
    return listReadableFlowSnapshots(this.database, workspaceId, user.id);
  }

  async uploadWorkspaceSource(
    user: { id: string; role: string },
    workspaceId: string,
    file: MultipartFile,
    folderId?: string,
  ) {
    this.requirePersistentUpload(user, workspaceId);
    if (folderId && !getWorkspaceFolder(this.database, workspaceId, folderId)) {
      throw httpError(400, 'FOLDER_NOT_FOUND', '目标文件夹不存在或不属于当前工作区');
    }
    const bytes = await readUpload(file, MAX_UPLOAD_BYTES);
    let displayName: string;
    try {
      displayName = sanitizeUploadName(file.filename);
    } catch (error) {
      throw extractionHttpError(error);
    }
    const extension = extname(displayName).toLocaleLowerCase('en-US');
    const storageKey = `${randomUUID()}${extension}`;
    const targetDirectory = join(this.uploadRoot, 'knowledge');
    const temporaryKey = `.tmp-${randomUUID()}`;
    const temporaryPath = join(targetDirectory, temporaryKey);
    const finalPath = join(targetDirectory, storageKey);
    const checksum = createHash('sha256').update(bytes).digest('hex');

    let text: string | undefined;
    let failureCode: string | undefined;
    try {
      text = (await extractWorkspaceDocument({
        filename: displayName,
        mimeType: file.mimetype,
        bytes,
      })).text;
    } catch (error) {
      if (!(error instanceof DocumentExtractionError)) throw error;
      if (!['DOCUMENT_EXTRACTION_FAILED', 'DOCUMENT_NO_TEXT', 'DOCUMENT_INVALID_UTF8', 'DOCUMENT_NUL'].includes(error.code)) {
        throw extractionHttpError(error);
      }
      failureCode = error.code;
    }

    await mkdir(targetDirectory, { recursive: true });
    try {
      await writeFile(temporaryPath, bytes, { flag: 'wx' });
      this.requirePersistentUpload(user, workspaceId);
      await rename(temporaryPath, finalPath);
      this.requirePersistentUpload(user, workspaceId);
      return insertWorkspaceDocument({
        database: this.database,
        workspaceId,
        userId: user.id,
        ...(folderId ? { folderId } : {}),
        title: displayName,
        originalName: displayName,
        mimeType: file.mimetype,
        size: bytes.length,
        storageKey,
        checksum,
        ...(text !== undefined ? { text } : {}),
        ...(failureCode ? { failureCode } : {}),
      });
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      await unlink(finalPath).catch(() => undefined);
      throw error;
    }
  }

  private requireWorkspaceRead(userId: string, workspaceId: string) {
    const permission = getWorkspacePermission(this.database, workspaceId, userId);
    if (!permission) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    return permission;
  }

  private requirePersistentUpload(user: { id: string; role: string }, workspaceId: string): void {
    const permission = this.requireWorkspaceRead(user.id, workspaceId);
    if (!['AUTHOR', 'EDITOR'].includes(user.role) || !['OWNER', 'EDIT'].includes(permission)) {
      throw httpError(403, 'FORBIDDEN', '只有工作区作者或编辑者可以上传持久资料');
    }
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
  if (!(error instanceof DocumentExtractionError)) return httpError(400, 'DOCUMENT_INVALID', '文档无效');
  const status = error.code === 'DOCUMENT_TOO_LARGE'
    ? 413
    : ['DOCUMENT_TYPE_MISMATCH', 'DOCUMENT_SIGNATURE_MISMATCH'].includes(error.code)
      ? 415
      : 400;
  return httpError(status, error.code, error.message);
}

import {
  ConversationAttachmentSummaryV1Schema,
  type ConversationAttachmentSummaryV1,
} from '@guideanything/contracts';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { buildSearchText } from '../knowledge/search-text';

export interface InsertConversationAttachmentRecordsInput {
  database: DatabaseSync;
  attachmentId: string;
  sourceId: string;
  documentId: string;
  conversationId: string;
  ownerId: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  checksum: string;
  text?: string;
  failureCode?: string;
  now: Date;
  expiresAt: Date;
}

interface AttachmentRow {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  status: ConversationAttachmentSummaryV1['status'];
  metadata_json: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export function insertConversationAttachmentRecords(
  input: InsertConversationAttachmentRecordsInput,
): ConversationAttachmentSummaryV1 {
  if ((input.text === undefined) === (input.failureCode === undefined)) {
    throw new Error('会话附件必须且只能包含提取文本或失败代码');
  }
  const now = input.now.toISOString();
  const expiresAt = input.expiresAt.toISOString();
  const ready = input.text !== undefined;
  const status = ready ? 'READY' : 'FAILED';
  const metadata = {
    sourceKind: 'SESSION_ATTACHMENT',
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
  };
  const summary = attachmentSummary({
    id: input.attachmentId,
    original_name: input.originalName,
    mime_type: input.mimeType,
    size: input.size,
    status,
    metadata_json: JSON.stringify(metadata),
    expires_at: expiresAt,
    created_at: now,
    updated_at: now,
  }, input.now);

  input.database.exec('BEGIN IMMEDIATE');
  try {
    input.database.prepare(
      `INSERT INTO knowledge_sources (
        id, scope, kind, workspace_id, conversation_id, created_by,
        status, revision, config_json, created_at, updated_at
      ) VALUES (?, 'SESSION', 'SESSION_ATTACHMENT', NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.sourceId,
      input.conversationId,
      input.ownerId,
      status,
      input.checksum,
      JSON.stringify({ storageKey: input.storageKey }),
      now,
      now,
    );
    input.database.prepare(
      `INSERT INTO knowledge_documents (
        id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
        parse_status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.documentId,
      input.sourceId,
      input.storageKey,
      input.originalName,
      input.checksum,
      input.checksum,
      status,
      JSON.stringify(metadata),
      now,
      now,
    );
    if (ready) {
      insertSessionAttachmentFragments(input.database, {
        attachmentId: input.attachmentId,
        conversationId: input.conversationId,
        documentId: input.documentId,
        title: input.originalName,
        revision: input.checksum,
        text: input.text!,
        now,
      });
    }
    input.database.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, source_id, original_name, mime_type,
        size, storage_key, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.attachmentId,
      input.conversationId,
      input.ownerId,
      input.sourceId,
      input.originalName,
      input.mimeType,
      input.size,
      input.storageKey,
      status,
      expiresAt,
      now,
      now,
    );
    input.database.exec('COMMIT');
  } catch (error) {
    input.database.exec('ROLLBACK');
    throw error;
  }
  return summary;
}

export function listConversationAttachments(
  database: DatabaseSync,
  conversationId: string,
  ownerId: string,
  now = new Date(),
): ConversationAttachmentSummaryV1[] {
  const rows = database.prepare(
    `SELECT attachment.id, attachment.original_name, attachment.mime_type,
            attachment.size, attachment.status,
            (
              SELECT document.metadata_json
              FROM knowledge_documents AS document
              WHERE document.source_id = attachment.source_id
              ORDER BY document.updated_at DESC, document.id DESC
              LIMIT 1
            ) AS metadata_json,
            attachment.expires_at, attachment.created_at, attachment.updated_at
     FROM conversation_attachments AS attachment
     WHERE attachment.conversation_id = ? AND attachment.owner_id = ?
     ORDER BY attachment.created_at ASC, attachment.id ASC`,
  ).all(conversationId, ownerId) as unknown as AttachmentRow[];
  return rows.map((row) => attachmentSummary(row, now));
}

export function countReadyConversationAttachments(
  database: DatabaseSync,
  input: {
    conversationId: string;
    ownerId: string;
    attachmentIds: readonly string[];
    now?: Date;
  },
): number {
  const attachmentIds = [...new Set(input.attachmentIds)];
  if (attachmentIds.length === 0) return 0;
  const placeholders = attachmentIds.map(() => '?').join(', ');
  const row = database.prepare(
    `SELECT COUNT(*) AS count
     FROM conversation_attachments
     WHERE id IN (${placeholders})
       AND conversation_id = ?
       AND owner_id = ?
       AND status = 'READY'
       AND expires_at > ?`,
  ).get(
    ...attachmentIds,
    input.conversationId,
    input.ownerId,
    (input.now ?? new Date()).toISOString(),
  ) as { count: number };
  return row.count;
}

export function listConversationAttachmentStorageKeys(
  database: DatabaseSync,
  conversationId: string,
  ownerId: string,
): string[] {
  const rows = database.prepare(
    `SELECT storage_key
     FROM conversation_attachments
     WHERE conversation_id = ? AND owner_id = ?
     ORDER BY created_at ASC, id ASC`,
  ).all(conversationId, ownerId) as unknown as Array<{ storage_key: string }>;
  return rows.map((row) => row.storage_key);
}

function insertSessionAttachmentFragments(
  database: DatabaseSync,
  input: {
    attachmentId: string;
    conversationId: string;
    documentId: string;
    title: string;
    revision: string;
    text: string;
    now: string;
  },
): void {
  const characters = [...input.text];
  const insert = database.prepare(
    `INSERT INTO knowledge_fragments (
      id, document_id, ordinal, title, heading, content, search_text,
      internal_locator_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  for (let offset = 0, ordinal = 0; offset < characters.length; offset += 4_000, ordinal += 1) {
    const content = characters.slice(offset, offset + 4_000).join('').trim();
    if (!content) continue;
    const fragmentId = opaqueFragmentId(input.documentId, ordinal);
    insert.run(
      fragmentId,
      input.documentId,
      ordinal,
      input.title,
      content,
      buildSearchText([input.title, content]),
      JSON.stringify({
        kind: 'SESSION_ATTACHMENT',
        attachmentId: input.attachmentId,
        conversationId: input.conversationId,
        documentId: input.documentId,
        revision: input.revision,
        fragmentId,
      }),
      input.now,
      input.now,
    );
  }
}

function attachmentSummary(row: AttachmentRow, now: Date): ConversationAttachmentSummaryV1 {
  const status = ['READY', 'FAILED'].includes(row.status) && row.expires_at <= now.toISOString()
    ? 'EXPIRED'
    : row.status;
  const failureCode = readFailureCode(row.metadata_json);
  return ConversationAttachmentSummaryV1Schema.parse({
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    status,
    ...(status === 'FAILED' && failureCode
      ? { failureMessage: publicFailureMessage(failureCode) }
      : {}),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function readFailureCode(metadataJson: string | null): string | null {
  if (!metadataJson) return null;
  try {
    const metadata = JSON.parse(metadataJson) as { failureCode?: unknown };
    return typeof metadata.failureCode === 'string' ? metadata.failureCode : null;
  } catch {
    return null;
  }
}

function publicFailureMessage(code: string): string {
  return ({
    DOCUMENT_EXTRACTION_FAILED: '文档解析失败，请检查文件是否完整。',
    DOCUMENT_NO_TEXT: '文档中没有可检索文本。',
    DOCUMENT_INVALID_UTF8: '文本文件编码无效，请转换为 UTF-8。',
    DOCUMENT_NUL: '文本文件包含不支持的控制字符。',
  } as Record<string, string>)[code] ?? '文档暂时无法建立索引。';
}

function opaqueFragmentId(documentId: string, ordinal: number): string {
  return `fragment-${createHash('sha256')
    .update(`${documentId}\u0000${ordinal}`)
    .digest('hex')
    .slice(0, 32)}`;
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestContext,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';
import { searchKnowledge } from '../knowledge/repository';
import {
  countReadyConversationAttachments,
  insertConversationAttachmentRecords,
  listConversationAttachments,
  listConversationAttachmentStorageKeys,
} from './repository';

describe('conversation attachment repository', () => {
  let context: TestContext;
  const workspaceId = 'workspace-attachments';
  const conversationId = 'conversation-attachments';

  beforeEach(async () => {
    context = await createTestContext();
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId,
      slug: 'attachments',
      name: '附件工作区',
    });
    seedConversation(context, conversationId, workspaceId, context.userIds.author);
  });

  afterEach(async () => context.close());

  it('atomically persists a READY session source, document, fragments, and attachment without a workspace item', () => {
    const attachment = insertConversationAttachmentRecords({
      database: context.database,
      attachmentId: 'attachment-ready',
      sourceId: 'source-ready',
      documentId: 'document-ready',
      conversationId,
      ownerId: context.userIds.author,
      originalName: '会话资料.md',
      mimeType: 'text/markdown',
      size: 31,
      storageKey: 'conversations/0123456789abcdef/attachment-ready.md',
      checksum: 'checksum-ready',
      text: '# 会话资料\n花式纱质量标准。',
      now: new Date('2026-07-15T00:00:00.000Z'),
      expiresAt: new Date('2099-07-22T00:00:00.000Z'),
    });

    expect(attachment).toMatchObject({
      id: 'attachment-ready',
      originalName: '会话资料.md',
      status: 'READY',
      expiresAt: '2099-07-22T00:00:00.000Z',
    });
    expect(context.database.prepare(
      `SELECT scope, kind, workspace_id, conversation_id, created_by, status
       FROM knowledge_sources WHERE id = 'source-ready'`,
    ).get()).toEqual({
      scope: 'SESSION',
      kind: 'SESSION_ATTACHMENT',
      workspace_id: null,
      conversation_id: conversationId,
      created_by: context.userIds.author,
      status: 'READY',
    });
    expect(context.database.prepare(
      `SELECT parse_status, relative_locator FROM knowledge_documents WHERE id = 'document-ready'`,
    ).get()).toEqual({
      parse_status: 'READY',
      relative_locator: 'conversations/0123456789abcdef/attachment-ready.md',
    });
    expect(context.database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_fragments WHERE document_id = 'document-ready'`,
    ).get()).toEqual({ count: 1 });
    expect(context.database.prepare(
      `SELECT COUNT(*) AS count FROM workspace_items WHERE workspace_id = ? AND kind = 'SOURCE'`,
    ).get(workspaceId)).toEqual({ count: 0 });

    expect(searchKnowledge(context.database, '花式纱', {
      sourceKinds: ['SESSION_ATTACHMENT'],
      conversationId,
      userId: context.userIds.author,
    })).toHaveLength(1);
    expect(searchKnowledge(context.database, '花式纱', {
      sourceKinds: ['SESSION_ATTACHMENT'],
      conversationId,
      userId: context.userIds.otherAuthor,
    })).toEqual([]);
    context.database.prepare(
      'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    ).run(workspaceId, context.userIds.author);
    expect(searchKnowledge(context.database, '花式纱', {
      sourceKinds: ['SESSION_ATTACHMENT'],
      conversationId,
      userId: context.userIds.author,
    })).toEqual([]);
  });

  it('keeps supported extraction failures explicit and out of retrieval', () => {
    const attachment = insertConversationAttachmentRecords({
      database: context.database,
      attachmentId: 'attachment-failed',
      sourceId: 'source-failed',
      documentId: 'document-failed',
      conversationId,
      ownerId: context.userIds.author,
      originalName: '坏编码.txt',
      mimeType: 'text/plain',
      size: 2,
      storageKey: 'conversations/0123456789abcdef/attachment-failed.txt',
      checksum: 'checksum-failed',
      failureCode: 'DOCUMENT_INVALID_UTF8',
      now: new Date('2026-07-15T00:00:00.000Z'),
      expiresAt: new Date('2026-07-22T00:00:00.000Z'),
    });

    expect(attachment).toMatchObject({
      status: 'FAILED',
      failureMessage: '文本文件编码无效，请转换为 UTF-8。',
    });
    expect(context.database.prepare(
      `SELECT status FROM knowledge_sources WHERE id = 'source-failed'`,
    ).get()).toEqual({ status: 'FAILED' });
    expect(context.database.prepare(
      `SELECT parse_status FROM knowledge_documents WHERE id = 'document-failed'`,
    ).get()).toEqual({ parse_status: 'FAILED' });
    expect(context.database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_fragments WHERE document_id = 'document-failed'`,
    ).get()).toEqual({ count: 0 });
    expect(searchKnowledge(context.database, '坏编码', {
      sourceKinds: ['SESSION_ATTACHMENT'],
      conversationId,
      userId: context.userIds.author,
    })).toEqual([]);
  });

  it('excludes FAILED and expired attachments from message use and reports expiration in summaries', () => {
    insertConversationAttachmentRecords({
      database: context.database,
      attachmentId: 'attachment-expired',
      sourceId: 'source-expired',
      documentId: 'document-expired',
      conversationId,
      ownerId: context.userIds.author,
      originalName: '过期资料.md',
      mimeType: 'text/markdown',
      size: 12,
      storageKey: 'conversations/0123456789abcdef/attachment-expired.md',
      checksum: 'checksum-expired',
      text: '过期证据不得使用',
      now: new Date('2026-07-01T00:00:00.000Z'),
      expiresAt: new Date('2026-07-08T00:00:00.000Z'),
    });
    insertConversationAttachmentRecords({
      database: context.database,
      attachmentId: 'attachment-failed',
      sourceId: 'source-failed',
      documentId: 'document-failed',
      conversationId,
      ownerId: context.userIds.author,
      originalName: '失败资料.txt',
      mimeType: 'text/plain',
      size: 2,
      storageKey: 'conversations/0123456789abcdef/attachment-failed.txt',
      checksum: 'checksum-failed',
      failureCode: 'DOCUMENT_INVALID_UTF8',
      now: new Date('2026-07-15T00:00:00.000Z'),
      expiresAt: new Date('2026-07-22T00:00:00.000Z'),
    });

    const checkedAt = new Date('2026-07-15T01:00:00.000Z');
    expect(countReadyConversationAttachments(context.database, {
      conversationId,
      ownerId: context.userIds.author,
      attachmentIds: ['attachment-expired'],
      now: checkedAt,
    })).toBe(0);
    expect(countReadyConversationAttachments(context.database, {
      conversationId,
      ownerId: context.userIds.author,
      attachmentIds: ['attachment-failed'],
      now: checkedAt,
    })).toBe(0);
    expect(listConversationAttachments(
      context.database,
      conversationId,
      context.userIds.author,
      checkedAt,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'attachment-expired', status: 'EXPIRED' }),
      expect.objectContaining({ id: 'attachment-failed', status: 'FAILED' }),
    ]));
    expect(searchKnowledge(context.database, '过期证据', {
      sourceKinds: ['SESSION_ATTACHMENT'],
      conversationId,
      userId: context.userIds.author,
    })).toEqual([]);
  });

  it('cascades session index metadata on conversation deletion while exposing storage keys for explicit file cleanup', () => {
    insertConversationAttachmentRecords({
      database: context.database,
      attachmentId: 'attachment-delete',
      sourceId: 'source-delete',
      documentId: 'document-delete',
      conversationId,
      ownerId: context.userIds.author,
      originalName: '待删除.md',
      mimeType: 'text/markdown',
      size: 12,
      storageKey: 'conversations/0123456789abcdef/attachment-delete.md',
      checksum: 'checksum-delete',
      text: '需要级联清理的片段',
      now: new Date('2026-07-15T00:00:00.000Z'),
      expiresAt: new Date('2026-07-22T00:00:00.000Z'),
    });
    expect(listConversationAttachmentStorageKeys(
      context.database,
      conversationId,
      context.userIds.author,
    )).toEqual(['conversations/0123456789abcdef/attachment-delete.md']);

    context.database.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);

    for (const table of ['conversation_attachments', 'knowledge_sources', 'knowledge_documents', 'knowledge_fragments']) {
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get())
        .toEqual({ count: 0 });
    }
    expect(context.database.prepare(
      'SELECT COUNT(*) AS count FROM knowledge_fragment_search',
    ).get()).toEqual({ count: 0 });
    expect(context.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

function seedConversation(
  context: TestContext,
  conversationId: string,
  workspaceId: string,
  ownerId: string,
): void {
  const now = new Date('2026-07-15T00:00:00.000Z').toISOString();
  context.database.prepare(
    `INSERT INTO conversations (
      id, scope, workspace_id, owner_id, title, status, created_at, updated_at
    ) VALUES (?, 'WORKSPACE', ?, ?, '附件测试', 'ACTIVE', ?, ?)`,
  ).run(conversationId, workspaceId, ownerId, now, now);
}

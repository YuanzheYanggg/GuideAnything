import type { MultipartFile } from '@fastify/multipart';
import { mkdir, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  createTestContext,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';
import {
  ConversationAttachmentService,
  type ConversationAttachmentFileSystem,
} from './service';

describe('ConversationAttachmentService', () => {
  let context: TestContext;
  let uploadRoot: string;
  const workspaceId = 'workspace-session-files';
  const conversationId = 'conversation-session-files';

  beforeEach(async () => {
    uploadRoot = await mkdtemp(join(tmpdir(), 'guideanything-session-files-'));
    context = await createTestContext();
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId,
      slug: 'session-files',
      name: '会话附件工作区',
    });
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.learner, 'VIEW');
    seedConversation(context, conversationId, workspaceId, context.userIds.learner);
  });

  afterEach(async () => {
    await context.close();
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it('allows a VIEW learner to upload only to their own active workspace conversation', async () => {
    const service = new ConversationAttachmentService(context.database, uploadRoot);
    const attachment = await service.upload(
      context.userIds.learner,
      workspaceId,
      conversationId,
      multipartFile('学习笔记.md', 'text/markdown', ['# 学习笔记\n质量检查。']),
    );
    expect(attachment).toMatchObject({ originalName: '学习笔记.md', status: 'READY' });
    const [storedFile] = await allStoredFiles(uploadRoot);
    expect((await stat(join(uploadRoot, storedFile!))).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(join(uploadRoot, storedFile!)))).mode & 0o777).toBe(0o700);

    await expect(service.upload(
      context.userIds.author,
      workspaceId,
      conversationId,
      multipartFile('越权.md', 'text/markdown', ['不得写入']),
    )).rejects.toMatchObject({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' });

    seedConversation(context, 'global-conversation', null, context.userIds.learner, 'GLOBAL_SANTEXWELL');
    await expect(service.upload(
      context.userIds.learner,
      workspaceId,
      'global-conversation',
      multipartFile('全局.md', 'text/markdown', ['不得写入']),
    )).rejects.toMatchObject({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' });
  });

  it('re-authorizes after slow streaming and extraction before writing metadata', async () => {
    const service = new ConversationAttachmentService(context.database, uploadRoot);
    const stream = Readable.from((async function* () {
      yield Buffer.from('# 撤权附件\n');
      context.database.prepare(
        'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      ).run(workspaceId, context.userIds.learner);
      yield Buffer.from('不得创建任何附件记录。');
    })());

    await expect(service.upload(
      context.userIds.learner,
      workspaceId,
      conversationId,
      multipartFileFromStream('撤权.md', 'text/markdown', stream),
    )).rejects.toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
    expect(await allStoredFiles(uploadRoot)).toEqual([]);
    expect(attachmentTableCounts(context)).toEqual({ attachments: 0, sources: 0, documents: 0, fragments: 0 });
  });

  it('re-authorizes after rename and removes the final file when access was revoked', async () => {
    const fileSystem: ConversationAttachmentFileSystem = {
      mkdir,
      writeFile,
      async rename(source, target) {
        await rename(source, target);
        context.database.prepare(
          'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
        ).run(workspaceId, context.userIds.learner);
      },
      unlink,
    };
    const service = new ConversationAttachmentService(context.database, uploadRoot, { fileSystem });

    await expect(service.upload(
      context.userIds.learner,
      workspaceId,
      conversationId,
      multipartFile('撤权后.md', 'text/markdown', ['rename 后不得落库']),
    )).rejects.toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
    expect(await allStoredFiles(uploadRoot)).toEqual([]);
    expect(attachmentTableCounts(context)).toEqual({ attachments: 0, sources: 0, documents: 0, fragments: 0 });
  });

  it('removes temporary and final files when the atomic database write fails', async () => {
    context.database.exec(`CREATE TRIGGER reject_session_attachment_record
      BEFORE INSERT ON conversation_attachments
      BEGIN SELECT RAISE(ABORT, 'test attachment failure'); END`);
    const service = new ConversationAttachmentService(context.database, uploadRoot);

    await expect(service.upload(
      context.userIds.learner,
      workspaceId,
      conversationId,
      multipartFile('落库失败.md', 'text/markdown', ['不能遗留文件']),
    )).rejects.toThrow('test attachment failure');
    expect(await allStoredFiles(uploadRoot)).toEqual([]);
    expect(attachmentTableCounts(context)).toEqual({ attachments: 0, sources: 0, documents: 0, fragments: 0 });
  });

  it('preserves supported parse failures but rejects FAILED and expired IDs for message use', async () => {
    let clock = new Date('2026-07-15T00:00:00.000Z');
    const service = new ConversationAttachmentService(context.database, uploadRoot, {
      now: () => clock,
    });
    const failed = await service.upload(
      context.userIds.learner,
      workspaceId,
      conversationId,
      multipartFile('坏编码.txt', 'text/plain', [Buffer.from([0xc3, 0x28])]),
    );
    expect(failed).toMatchObject({
      status: 'FAILED',
      failureMessage: expect.any(String),
      expiresAt: '2026-07-22T00:00:00.000Z',
    });
    expect(context.database.prepare(
      'SELECT COUNT(*) AS count FROM knowledge_fragments',
    ).get()).toEqual({ count: 0 });
    expect(() => service.requireReadyForMessage(
      context.userIds.learner,
      workspaceId,
      conversationId,
      [failed.id],
    )).toThrow(expect.objectContaining({ statusCode: 400, code: 'ATTACHMENT_NOT_READY' }));

    const ready = await service.upload(
      context.userIds.learner,
      workspaceId,
      conversationId,
      multipartFile('正常.md', 'text/markdown', ['可用附件']),
    );
    expect(() => service.requireReadyForMessage(
      context.userIds.learner,
      workspaceId,
      conversationId,
      [ready.id],
    )).not.toThrow();
    clock = new Date('2026-07-23T00:00:00.000Z');
    expect(() => service.requireReadyForMessage(
      context.userIds.learner,
      workspaceId,
      conversationId,
      [ready.id],
    )).toThrow(expect.objectContaining({ statusCode: 400, code: 'ATTACHMENT_NOT_READY' }));
  });

  it('leaves physical deletion explicit after database cascade and safely removes collected keys', async () => {
    const service = new ConversationAttachmentService(context.database, uploadRoot);
    await service.upload(
      context.userIds.learner,
      workspaceId,
      conversationId,
      multipartFile('清理.md', 'text/markdown', ['需要显式清理']),
    );
    context.database.prepare(
      `UPDATE conversations SET status = 'ARCHIVED' WHERE id = ?`,
    ).run(conversationId);
    const storageKeys = service.storageKeysForConversation(
      context.userIds.learner,
      workspaceId,
      conversationId,
    );
    expect(storageKeys).toHaveLength(1);
    expect(await allStoredFiles(uploadRoot)).toHaveLength(1);

    context.database.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    expect(await allStoredFiles(uploadRoot)).toHaveLength(1);
    await service.removeStoredFiles(storageKeys);
    expect(await allStoredFiles(uploadRoot)).toEqual([]);
  });
});

function multipartFile(
  filename: string,
  mimetype: string,
  chunks: Array<string | Buffer>,
): MultipartFile {
  return multipartFileFromStream(filename, mimetype, Readable.from(
    chunks.map((chunk) => typeof chunk === 'string' ? Buffer.from(chunk) : chunk),
  ));
}

function multipartFileFromStream(filename: string, mimetype: string, stream: Readable): MultipartFile {
  return { filename, mimetype, file: stream } as unknown as MultipartFile;
}

function seedConversation(
  context: TestContext,
  conversationId: string,
  workspaceId: string | null,
  ownerId: string,
  scope: 'WORKSPACE' | 'GLOBAL_SANTEXWELL' = 'WORKSPACE',
): void {
  const now = new Date('2026-07-15T00:00:00.000Z').toISOString();
  context.database.prepare(
    `INSERT INTO conversations (
      id, scope, workspace_id, owner_id, title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '附件测试', 'ACTIVE', ?, ?)`,
  ).run(conversationId, scope, workspaceId, ownerId, now, now);
}

async function allStoredFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else result.push(fullPath.slice(root.length + 1));
    }
  }
  await visit(root);
  return result.sort();
}

function attachmentTableCounts(context: TestContext) {
  const count = (table: string) => (context.database.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).get() as { count: number }).count;
  return {
    attachments: count('conversation_attachments'),
    sources: count('knowledge_sources'),
    documents: count('knowledge_documents'),
    fragments: count('knowledge_fragments'),
  };
}

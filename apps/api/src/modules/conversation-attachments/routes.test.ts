import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addTestWorkspaceMember,
  authorization,
  createTestContext,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';

describe('conversation attachment upload route', () => {
  let context: TestContext;
  let root: string;
  const workspaceId = 'workspace-route-attachments';
  const conversationId = 'conversation-route-attachments';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'guideanything-attachment-route-'));
    context = await createTestContext({ uploadDir: join(root, 'uploads') });
    seedTestWorkspace(context.database, context.userIds.author, {
      id: workspaceId,
      slug: 'route-attachments',
      name: '路由附件工作区',
    });
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.learner, 'VIEW');
    addTestWorkspaceMember(context.database, workspaceId, context.userIds.otherAuthor, 'VIEW');
    seedConversation(context, conversationId, workspaceId, context.userIds.learner);
  });

  afterEach(async () => {
    await context.close();
    await rm(root, { recursive: true, force: true });
  });

  it('requires authentication and returns the contract-shaped private attachment only', async () => {
    const unauthenticated = await upload(context, '', workspaceId, conversationId, {
      filename: '资料.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from('# 私有附件'),
    });
    expect(unauthenticated.statusCode).toBe(401);

    const uploaded = await upload(context, context.tokens.learner, workspaceId, conversationId, {
      filename: '../\u202E会话资料.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from('# 会话附件\n花式纱质量要求。'),
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toEqual({
      attachment: expect.objectContaining({
        id: expect.any(String),
        originalName: '会话资料.md',
        mimeType: 'text/markdown',
        status: 'READY',
        expiresAt: expect.any(String),
      }),
    });
    expect(JSON.stringify(uploaded.json())).not.toMatch(/storage|uploads|\/Users\//u);
    const attachmentId = uploaded.json().attachment.id as string;
    const row = context.database.prepare(
      `SELECT storage_key, source_id FROM conversation_attachments WHERE id = ?`,
    ).get(attachmentId) as { storage_key: string; source_id: string };
    expect(row.storage_key).toMatch(
      /^conversations\/[0-9a-f]{32}\/[0-9a-f-]{36}\.md$/u,
    );
    expect(context.database.prepare(
      `SELECT COUNT(*) AS count FROM workspace_items WHERE kind = 'SOURCE' AND workspace_id = ?`,
    ).get(workspaceId)).toEqual({ count: 0 });
  });

  it('hides cross-user, cross-workspace, and global conversations behind 404', async () => {
    const crossUser = await upload(context, context.tokens.otherAuthor, workspaceId, conversationId, {
      filename: '越权.md', mimeType: 'text/markdown', bytes: Buffer.from('不得上传'),
    });
    expect(crossUser.statusCode).toBe(404);
    expect(crossUser.json().code).toBe('CONVERSATION_NOT_FOUND');

    const secondWorkspaceId = 'workspace-route-other';
    seedTestWorkspace(context.database, context.userIds.author, {
      id: secondWorkspaceId,
      slug: 'route-other',
      name: '另一个工作区',
    });
    addTestWorkspaceMember(context.database, secondWorkspaceId, context.userIds.learner, 'VIEW');
    const crossWorkspace = await upload(context, context.tokens.learner, secondWorkspaceId, conversationId, {
      filename: '跨空间.md', mimeType: 'text/markdown', bytes: Buffer.from('不得上传'),
    });
    expect(crossWorkspace.statusCode).toBe(404);
    expect(crossWorkspace.json().code).toBe('CONVERSATION_NOT_FOUND');

    seedConversation(context, 'global-route-conversation', null, context.userIds.learner, 'GLOBAL_SANTEXWELL');
    const global = await upload(context, context.tokens.learner, workspaceId, 'global-route-conversation', {
      filename: '全局.md', mimeType: 'text/markdown', bytes: Buffer.from('不得上传'),
    });
    expect(global.statusCode).toBe(404);
    expect(global.json().code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('rejects missing files, unsupported type declarations, and payloads beyond 20 MiB', async () => {
    const noFile = await context.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/conversations/${conversationId}/attachments`,
      headers: authorization(context.tokens.learner),
    });
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json().code).toBe('DOCUMENT_REQUIRED');

    const mismatch = await upload(context, context.tokens.learner, workspaceId, conversationId, {
      filename: '伪装.pdf', mimeType: 'text/plain', bytes: Buffer.from('not pdf'),
    });
    expect(mismatch.statusCode).toBe(415);
    expect(mismatch.json().code).toBe('DOCUMENT_TYPE_MISMATCH');

    const contractOversizedName = await upload(
      context,
      context.tokens.learner,
      workspaceId,
      conversationId,
      {
        filename: `${'😀'.repeat(130)}.md`,
        mimeType: 'text/markdown',
        bytes: Buffer.from('文件名必须符合公开契约'),
      },
    );
    expect(contractOversizedName.statusCode).toBe(400);
    expect(contractOversizedName.json().code).toBe('DOCUMENT_NAME_INVALID');

    const oversized = await upload(context, context.tokens.learner, workspaceId, conversationId, {
      filename: '过大.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.alloc(20 * 1024 * 1024 + 1, 0x41),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().code).toBe('DOCUMENT_TOO_LARGE');
  });
});

async function upload(
  context: TestContext,
  token: string,
  workspaceId: string,
  conversationId: string,
  file: { filename: string; mimeType: string; bytes: Buffer },
) {
  const boundary = `guideanything-${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.mimeType}\r\n\r\n`,
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return context.app.inject({
    method: 'POST',
    url: `/api/workspaces/${workspaceId}/conversations/${conversationId}/attachments`,
    headers: {
      ...(token ? authorization(token) : {}),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
}

function seedConversation(
  context: TestContext,
  conversationId: string,
  workspaceId: string | null,
  ownerId: string,
  scope: 'WORKSPACE' | 'GLOBAL_SANTEXWELL' = 'WORKSPACE',
): void {
  const now = new Date().toISOString();
  context.database.prepare(
    `INSERT INTO conversations (
      id, scope, workspace_id, owner_id, title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '附件路由测试', 'ACTIVE', ?, ?)`,
  ).run(conversationId, scope, workspaceId, ownerId, now, now);
}

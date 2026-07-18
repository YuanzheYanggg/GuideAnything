import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { createConversation, enqueueConversationRun } from '../conversations/repository';
import { loadAgentRunExecutionContext } from './execution-context';

describe('loadAgentRunExecutionContext', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedUser(database, 'owner-1');
    seedWorkspace(database, 'workspace-1', 'owner-1');
  });

  afterEach(() => database.close());

  it('loads the immutable initiating request only while access is still valid', () => {
    const { runId } = seedWorkspaceRun(database);

    expect(loadAgentRunExecutionContext(database, runId)).toMatchObject({
      runId,
      scope: 'WORKSPACE',
      workspaceId: 'workspace-1',
      ownerId: 'owner-1',
      status: 'QUEUED',
      text: '请检查当前流程。',
      sources: { workspaceFlows: true, santexwell: true },
    });

    database.prepare(
      "DELETE FROM workspace_members WHERE workspace_id = 'workspace-1' AND user_id = 'owner-1'",
    ).run();
    expect(() => loadAgentRunExecutionContext(database, runId)).toThrow(/访问权限/u);
  });

  it('captures only active resource centers explicitly mounted to the business team', () => {
    seedWorkspace(database, 'workspace-finance', 'owner-1');
    database.prepare("UPDATE workspaces SET kind = 'FINANCE' WHERE id = 'workspace-finance'").run();
    database.prepare(
      `INSERT INTO workspace_resource_mounts (
        id, consumer_workspace_id, provider_workspace_id, created_by, created_at, updated_at
      ) VALUES ('mount-finance', 'workspace-1', 'workspace-finance', 'owner-1', ?, ?)`,
    ).run('2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
    const { runId } = seedWorkspaceRun(database);

    expect(loadAgentRunExecutionContext(database, runId)).toMatchObject({
      workspaceId: 'workspace-1',
      sharedWorkspaceIds: ['workspace-finance'],
    });
  });

  it('rejects an archived workspace or conversation at execution time', () => {
    const first = seedWorkspaceRun(database);
    database.prepare("UPDATE workspaces SET status = 'ARCHIVED' WHERE id = 'workspace-1'").run();
    expect(() => loadAgentRunExecutionContext(database, first.runId)).toThrow(/工作区/u);

    database.prepare("UPDATE workspaces SET status = 'ACTIVE' WHERE id = 'workspace-1'").run();
    database.prepare("UPDATE conversations SET status = 'ARCHIVED' WHERE id = ?").run(first.conversationId);
    expect(() => loadAgentRunExecutionContext(database, first.runId)).toThrow(/会话/u);
  });

  it('revalidates ready, unexpired attachment ownership before execution', () => {
    const conversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '附件问答',
    });
    const now = new Date();
    database.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, source_id, original_name, mime_type, size,
        storage_key, status, expires_at, created_at, updated_at
      ) VALUES ('attachment-1', ?, 'owner-1', NULL, 'check.md', 'text/markdown', 10,
        'sessions/attachment-1', 'READY', ?, ?, ?)`,
    ).run(
      conversation.id,
      new Date(now.getTime() + 60_000).toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
    const queued = enqueueConversationRun(database, {
      conversationId: conversation.id,
      ownerId: 'owner-1',
      request: {
        clientMessageId: 'client-attachment',
        text: '总结附件。',
        sources: {
          workspaceFlows: false,
          workspaceDocuments: false,
          sessionAttachments: true,
          santexwell: false,
        },
        attachmentIds: ['attachment-1'],
      },
    });

    expect(loadAgentRunExecutionContext(database, queued.accepted.run.id).attachmentIds)
      .toEqual(['attachment-1']);
    database.prepare(
      "UPDATE conversation_attachments SET status = 'EXPIRED' WHERE id = 'attachment-1'",
    ).run();
    expect(() => loadAgentRunExecutionContext(database, queued.accepted.run.id)).toThrow(/附件/u);
  });

  it('rejects a persisted attachment source switch without selected attachment ids', () => {
    const conversation = createConversation(database, {
      scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '空附件来源',
    });
    const queued = enqueueConversationRun(database, {
      conversationId: conversation.id,
      ownerId: 'owner-1',
      request: {
        clientMessageId: 'client-empty-attachment-source',
        text: '不能扩大到不存在的附件来源。',
        sources: {
          workspaceFlows: false,
          workspaceDocuments: false,
          sessionAttachments: true,
          santexwell: false,
        },
        attachmentIds: [],
      },
    });

    expect(() => loadAgentRunExecutionContext(database, queued.accepted.run.id)).toThrow(/选择.*附件/u);
  });
});

function seedWorkspaceRun(database: DatabaseSync): { conversationId: string; runId: string } {
  const conversation = createConversation(database, {
    scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '流程问答',
  });
  const queued = enqueueConversationRun(database, {
    conversationId: conversation.id,
    ownerId: 'owner-1',
    request: {
      clientMessageId: `client-${conversation.id}`,
      text: '请检查当前流程。',
      sources: {
        workspaceFlows: true,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: true,
      },
      attachmentIds: [],
    },
  });
  return { conversationId: conversation.id, runId: queued.accepted.run.id };
}

function seedUser(database: DatabaseSync, id: string): void {
  database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, 'not-used', ?, 'AUTHOR', ?)`,
  ).run(id, `${id}@guide.local`, id, '2026-07-15T00:00:00.000Z');
}

function seedWorkspace(database: DatabaseSync, id: string, ownerId: string): void {
  const now = '2026-07-15T00:00:00.000Z';
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, created_at, updated_at
    ) VALUES (?, ?, '测试工作区', '', 'SquaresFour', 'general', ?, ?, ?)`,
  ).run(id, id, ownerId, now, now);
  database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES (?, ?, 'OWNER', ?)`,
  ).run(id, ownerId, now);
}

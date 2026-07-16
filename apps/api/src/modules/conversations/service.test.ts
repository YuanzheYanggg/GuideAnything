import type { SourceOptionsV1 } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { ConversationService } from './service';

describe('ConversationService', () => {
  let database: DatabaseSync;
  let service: ConversationService;

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedUser(database, 'owner-1');
    seedUser(database, 'owner-2');
    seedWorkspace(database, 'workspace-1', 'owner-1');
    database.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
       VALUES ('workspace-1', 'owner-2', 'VIEW', ?)`,
    ).run('2026-07-15T00:00:00.000Z');
    service = new ConversationService(database);
  });

  afterEach(() => database.close());

  it('creates real global and workspace scopes without a fake workspace id', () => {
    const global = service.createGlobal('owner-1', '花式纱分类');
    const workspace = service.createWorkspace('owner-1', 'workspace-1', '审批流程');
    expect(global).toMatchObject({ scope: 'GLOBAL_SANTEXWELL', workspaceId: null });
    expect(workspace).toMatchObject({ scope: 'WORKSPACE', workspaceId: 'workspace-1' });
    expect(service.listGlobal('owner-1')).toEqual([global]);
    expect(service.listWorkspace('owner-1', 'workspace-1')).toEqual([workspace]);
  });

  it('keeps workspace conversations private even between workspace members', () => {
    const conversation = service.createWorkspace('owner-1', 'workspace-1', '私有对话');
    expect(() => service.readWorkspace('owner-2', 'workspace-1', conversation.id)).toThrowError(
      expect.objectContaining({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' }),
    );
    expect(service.listWorkspace('owner-2', 'workspace-1')).toEqual([]);
  });

  it('accepts a Santexwell-only global message and rejects workspace context', () => {
    const conversation = service.createGlobal('owner-1', '全局问答');
    const accepted = service.sendGlobal('owner-1', conversation.id, {
      clientMessageId: 'client-global-1',
      text: '花式纱有哪些分类？',
      sources: {
        workspaceFlows: false,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: true,
      },
      attachmentIds: [],
    });
    expect(accepted.created).toBe(true);
    expect(accepted.accepted.run.sources).toEqual({
      workspaceFlows: false,
      workspaceDocuments: false,
      sessionAttachments: false,
      santexwell: true,
    });
    expect(() => service.sendGlobal('owner-1', conversation.id, {
      clientMessageId: 'client-global-2',
      text: '查看流程',
      sources: {
        workspaceFlows: false,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: true,
      },
      selectedContext: { kind: 'FLOW_NODE', snapshotId: 'snapshot-1', nodeId: 'approve' },
      attachmentIds: [],
    } as never)).toThrow();
  });

  it('re-authorizes workspace access and session attachments on every message', () => {
    const conversation = service.createWorkspace('owner-1', 'workspace-1', '工作区问答');
    expect(() => service.sendWorkspace('owner-2', 'workspace-1', conversation.id, {
      clientMessageId: 'client-other',
      text: '尝试访问他人对话',
      sources: sources(),
      attachmentIds: [],
    })).toThrowError(expect.objectContaining({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' }));
    expect(() => service.sendWorkspace('owner-1', 'workspace-1', conversation.id, {
      clientMessageId: 'client-attachment-disabled',
      text: '读取附件',
      sources: sources(),
      attachmentIds: ['attachment-1'],
    })).toThrowError(expect.objectContaining({ statusCode: 400, code: 'ATTACHMENT_SOURCE_DISABLED' }));
    expect(() => service.sendWorkspace('owner-1', 'workspace-1', conversation.id, {
      clientMessageId: 'client-attachment-missing',
      text: '读取附件',
      sources: sources({ sessionAttachments: true }),
      attachmentIds: ['attachment-1'],
    })).toThrowError(expect.objectContaining({ statusCode: 400, code: 'ATTACHMENT_NOT_READY' }));
    expect(() => service.sendWorkspace('owner-1', 'workspace-1', conversation.id, {
      clientMessageId: 'client-attachment-empty',
      text: '附件来源不能空开',
      sources: sources({ sessionAttachments: true }),
      attachmentIds: [],
    })).toThrowError(expect.objectContaining({ statusCode: 400, code: 'ATTACHMENT_SELECTION_REQUIRED' }));
  });

  it('uses the canonical attachment projection for dynamic and failed states', () => {
    const conversation = service.createWorkspace('owner-1', 'workspace-1', '失败附件');
    const now = '2026-07-15T00:00:00.000Z';
    database.prepare(
      `INSERT INTO knowledge_sources (
        id, scope, kind, workspace_id, conversation_id, created_by, status, revision,
        config_json, created_at, updated_at
      ) VALUES ('source-failed', 'SESSION', 'SESSION_ATTACHMENT', NULL, ?, 'owner-1',
                'FAILED', 'revision-failed', '{}', ?, ?)`,
    ).run(conversation.id, now, now);
    database.prepare(
      `INSERT INTO knowledge_documents (
        id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision,
        parse_status, metadata_json, created_at, updated_at
      ) VALUES ('document-failed', 'source-failed', NULL, 'failed.pdf', '失败.pdf',
                'revision-failed', 'revision-failed', 'FAILED',
                '{"sourceKind":"SESSION_ATTACHMENT","failureCode":"DOCUMENT_NO_TEXT"}', ?, ?)`,
    ).run(now, now);
    database.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, source_id, original_name, mime_type, size,
        storage_key, status, expires_at, created_at, updated_at
      ) VALUES ('attachment-failed', ?, 'owner-1', 'source-failed', '失败.pdf',
                'application/pdf', 10, 'conversations/fixture/failed.pdf', 'FAILED',
                '2026-07-22T00:00:00.000Z', ?, ?)`,
    ).run(conversation.id, now, now);

    expect(service.readWorkspace('owner-1', 'workspace-1', conversation.id).attachments).toEqual([
      expect.objectContaining({
        id: 'attachment-failed', status: 'FAILED', failureMessage: '文档中没有可检索文本。',
      }),
    ]);
  });

  it('validates selected flow context against the conversation workspace', () => {
    const conversation = service.createWorkspace('owner-1', 'workspace-1', '节点问答');
    expect(() => service.sendWorkspace('owner-1', 'workspace-1', conversation.id, {
      clientMessageId: 'client-flow-disabled',
      text: '查看节点',
      sources: sources(),
      selectedContext: { kind: 'FLOW_NODE', snapshotId: 'missing', nodeId: 'approve' },
      attachmentIds: [],
    })).toThrowError(expect.objectContaining({ statusCode: 400, code: 'FLOW_SOURCE_DISABLED' }));
    expect(() => service.sendWorkspace('owner-1', 'workspace-1', conversation.id, {
      clientMessageId: 'client-flow-missing',
      text: '查看节点',
      sources: sources({ workspaceFlows: true }),
      selectedContext: { kind: 'FLOW_NODE', snapshotId: 'missing', nodeId: 'approve' },
      attachmentIds: [],
    })).toThrowError(expect.objectContaining({ statusCode: 400, code: 'SELECTED_CONTEXT_INVALID' }));
  });
});

function sources(overrides: Partial<SourceOptionsV1> = {}): SourceOptionsV1 {
  return {
    workspaceFlows: false,
    workspaceDocuments: false,
    sessionAttachments: false,
    santexwell: false,
    ...overrides,
  };
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

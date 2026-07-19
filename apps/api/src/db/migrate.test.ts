import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { createDatabase } from './client';
import { migrateDatabase } from './migrate';
import { permanentlyRemoveItem } from '../modules/personal/repository';

const now = '2026-07-15T00:00:00.000Z';
const later = '2026-07-22T00:00:00.000Z';
const sourceOptions = JSON.stringify({
  workspaceFlows: true,
  workspaceDocuments: true,
  sessionAttachments: true,
  santexwell: true,
});

function seedPrincipals(database: DatabaseSync): void {
  const insertUser = database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, 'hash', ?, 'AUTHOR', ?)`,
  );
  insertUser.run('user-one', 'one@example.com', '第一位用户', now);
  insertUser.run('user-two', 'two@example.com', '第二位用户', now);
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, status, created_at, updated_at
    ) VALUES ('workspace-one', 'one', '工作区一', '', 'SquaresFour', 'general', 'user-one', 'ACTIVE', ?, ?)`,
  ).run(now, now);
}

function seedGuideDigestBase(database: DatabaseSync): void {
  database.prepare(
    `INSERT INTO guides (
      id, owner_id, title, summary, tags_json, status, visibility, revision,
      draft_document, created_at, updated_at
    ) VALUES ('digest-guide', 'user-one', '摘要指南', '', '[]', 'DRAFT', 'INTERNAL', 7, '{}', ?, ?)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO workspace_items (
      id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
    ) VALUES ('digest-guide-item', 'workspace-one', 'GUIDE', 'digest-guide', '摘要指南', '', 'user-one', ?, ?)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO flow_knowledge_snapshots (
      id, guide_id, workspace_id, origin_type, revision, document_checksum, snapshot_json, created_at
    ) VALUES ('digest-snapshot', 'digest-guide', 'workspace-one', 'DRAFT', 7, 'checksum', '{}', ?)`,
  ).run(now);
}

function insertConversation(
  database: DatabaseSync,
  input: { id: string; ownerId: string; scope?: 'GLOBAL_SANTEXWELL' | 'WORKSPACE'; workspaceId?: string | null },
): void {
  const scope = input.scope ?? 'GLOBAL_SANTEXWELL';
  database.prepare(
    `INSERT INTO conversations (
      id, scope, workspace_id, owner_id, title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
  ).run(input.id, scope, input.workspaceId ?? null, input.ownerId, `会话 ${input.id}`, now, now);
}

function insertSource(
  database: DatabaseSync,
  input: {
    id: string;
    scope: 'GLOBAL' | 'WORKSPACE' | 'SESSION';
    kind: 'SANTEXWELL_VAULT' | 'WORKSPACE_DOCUMENT' | 'WORKSPACE_FLOW' | 'SESSION_ATTACHMENT';
    workspaceId?: string | null;
    conversationId?: string | null;
    createdBy?: string | null;
  },
): void {
  database.prepare(
    `INSERT INTO knowledge_sources (
      id, scope, kind, workspace_id, conversation_id, created_by, status, revision,
      config_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'READY', 'revision-1', '{}', ?, ?)`,
  ).run(
    input.id,
    input.scope,
    input.kind,
    input.workspaceId ?? null,
    input.conversationId ?? null,
    input.createdBy ?? null,
    now,
    now,
  );
}

function insertDocument(
  database: DatabaseSync,
  id: string,
  sourceId: string,
  flowSnapshotId: string | null = null,
): void {
  database.prepare(
    `INSERT INTO knowledge_documents (
      id, source_id, flow_snapshot_id, relative_locator, title, checksum, revision, parse_status,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'revision-1', 'READY', '{}', ?, ?)`,
  ).run(id, sourceId, flowSnapshotId, `${id}.md`, `文档 ${id}`, `checksum-${id}`, now, now);
}

function insertFragment(
  database: DatabaseSync,
  input: { id: string; documentId: string; title?: string; content?: string; searchText?: string },
): void {
  database.prepare(
    `INSERT INTO knowledge_fragments (
      id, document_id, ordinal, title, heading, content, search_text,
      internal_locator_json, created_at, updated_at
    ) VALUES (?, ?, 0, ?, '标题', ?, ?, '{}', ?, ?)`,
  ).run(
    input.id,
    input.documentId,
    input.title ?? `片段 ${input.id}`,
    input.content ?? `内容 ${input.id}`,
    input.searchText ?? `search ${input.id}`,
    now,
    now,
  );
}

function insertMessageAndRun(
  database: DatabaseSync,
  input: { conversationId: string; messageId: string; runId: string; clientMessageId: string; sequence?: number },
): void {
  database.prepare(
    `INSERT INTO conversation_messages (
      id, conversation_id, role, client_message_id, content, source_options_json,
      committed, created_at
    ) VALUES (?, ?, 'USER', ?, '问题', ?, 1, ?)`,
  ).run(input.messageId, input.conversationId, input.clientMessageId, sourceOptions, now);
  database.prepare(
    `INSERT INTO agent_runs (
      id, conversation_id, initiating_message_id, run_sequence, plan_version, route,
      status, source_options_json, route_decision_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, 'FOCUSED', 'RUNNING', ?, '{}', ?, ?)`,
  ).run(
    input.runId,
    input.conversationId,
    input.messageId,
    input.sequence ?? 1,
    sourceOptions,
    now,
    now,
  );
}

describe('database migrations', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => database?.close());

  it('creates all runtime tables, indexes, triggers, and migration versions idempotently', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    migrateDatabase(database);

    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name",
    ).all().map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining([
      'guide_collaborators',
      'guide_draft_revisions',
      'guide_search',
      'guide_versions',
      'guides',
      'media_assets',
      'schema_migrations',
      'users',
      'workspaces',
      'workspace_members',
      'workspace_items',
      'workspace_folders',
      'workspace_resource_mounts',
      'knowledge_sources',
      'knowledge_documents',
      'knowledge_fragments',
      'knowledge_fragment_search',
      'flow_knowledge_snapshots',
      'conversations',
      'conversation_messages',
      'agent_runs',
      'agent_run_events',
      'answer_citations',
      'artifacts',
      'conversation_attachments',
      'agent_run_steers',
      'workspace_question_clusters',
      'workspace_question_cluster_examples',
      'workspace_knowledge_cards',
      'workspace_knowledge_card_evidence',
      'workspace_flow_proposals',
      'workspace_flow_proposal_operations',
      'workspace_flow_proposal_evidence',
      'workspace_editorial_audit_events',
      'guide_digest_proposals',
      'guide_digest_audit_events',
    ]));
    expect(database.prepare(
      'SELECT version FROM schema_migrations ORDER BY version',
    ).all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }]);

    const indexesAndTriggers = database.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%'",
    ).all().map((row) => (row as { name: string }).name);
    expect(indexesAndTriggers).toEqual(expect.arrayContaining([
      'knowledge_sources_workspace_idx',
      'knowledge_sources_conversation_idx',
      'flow_snapshots_draft_origin_unique',
      'flow_snapshots_published_origin_unique',
      'knowledge_fragments_search_insert',
      'knowledge_fragments_search_update',
      'knowledge_fragments_search_delete',
      'flow_knowledge_snapshots_immutable',
      'answer_citations_reference_id_immutable',
      'knowledge_sources_identity_immutable',
      'knowledge_documents_flow_integrity_insert',
      'knowledge_documents_flow_integrity_update',
      'flow_knowledge_snapshots_workspace_insert',
      'conversation_attachments_identity_immutable',
      'workspace_question_example_scope_insert',
      'workspace_knowledge_card_scope_insert',
      'workspace_card_evidence_scope_insert',
      'workspace_flow_proposal_scope_insert',
      'workspace_flow_proposal_evidence_scope_insert',
      'workspace_folders_workspace_parent_idx',
      'workspace_resource_mounts_consumer_idx',
      'workspace_resource_mounts_provider_idx',
      'guide_draft_revisions_latest_idx',
      'guide_draft_revisions_immutable',
      'guide_digest_proposals_guide_created_idx',
      'guide_digest_proposals_guide_revision_status_idx',
      'guide_digest_proposals_one_draft_idx',
      'guide_digest_proposals_scope_insert',
      'guide_digest_proposals_immutable_content',
      'guide_digest_proposals_status_transition',
      'guide_digest_audit_events_proposal_created_idx',
      'guide_digest_audit_events_scope_insert',
      'guide_digest_audit_events_immutable',
      'guide_digest_audit_events_delete_immutable',
    ]));

    const strictByTable = new Map(
      (database.prepare('PRAGMA table_list').all() as Array<{ name: string; strict: number }>)
        .map((row) => [row.name, row.strict]),
    );
    for (const table of [
      'knowledge_sources', 'knowledge_documents', 'knowledge_fragments',
      'flow_knowledge_snapshots', 'conversations', 'conversation_messages',
      'agent_runs', 'agent_run_events', 'answer_citations', 'artifacts',
      'conversation_attachments',
      'agent_run_steers',
      'workspace_question_clusters', 'workspace_question_cluster_examples',
      'workspace_knowledge_cards', 'workspace_knowledge_card_evidence',
      'workspace_flow_proposals', 'workspace_flow_proposal_operations',
      'workspace_flow_proposal_evidence',
      'workspace_editorial_audit_events',
      'workspace_folders', 'workspace_resource_mounts',
      'guide_draft_revisions',
      'guide_digest_proposals', 'guide_digest_audit_events',
    ]) {
      expect(strictByTable.get(table), `${table} should be STRICT`).toBe(1);
    }
    expect(strictByTable.get('knowledge_fragment_search')).toBe(0);
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    database.prepare(`INSERT INTO users (id, email, password_hash, display_name, role, created_at)
      VALUES ('migration-user', 'migration@example.com', 'hash', '迁移用户', 'AUTHOR', ?)`).run(now);
    database.prepare(`INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, created_at, updated_at
    ) VALUES ('workspace-one', 'one', '工作区一', '', 'SquaresFour', 'general', 'migration-user', ?, ?)`).run(now, now);
    expect(database.prepare(`SELECT kind FROM workspaces WHERE id = 'workspace-one'`).get()).toEqual({
      kind: 'BUSINESS_TEAM',
    });
    expect(database.prepare(`PRAGMA table_info('workspace_items')`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'folder_id', notnull: 0 }),
    ]));
  });

  it('creates one recovery baseline for each guide that existed before draft history', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);
    database.prepare('DELETE FROM schema_migrations WHERE version = 8').run();
    database.prepare(`INSERT INTO guides (
      id, owner_id, title, summary, tags_json, status, visibility, revision,
      draft_document, created_at, updated_at
    ) VALUES ('legacy-guide', 'user-one', '升级前草稿', '保留当前版本', '["打样"]', 'DRAFT', 'INTERNAL', 41, '{"schemaVersion":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1},"steps":[],"exitNodeIds":[]}', ?, ?)`)
      .run(now, later);

    migrateDatabase(database);
    migrateDatabase(database);

    expect(database.prepare(`SELECT guide_id, revision, title, summary, tags_json, draft_document_json, saved_by, saved_at
      FROM guide_draft_revisions WHERE guide_id = 'legacy-guide'`).get()).toEqual({
      guide_id: 'legacy-guide', revision: 41, title: '升级前草稿', summary: '保留当前版本', tags_json: '["打样"]',
      draft_document_json: '{"schemaVersion":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1},"steps":[],"exitNodeIds":[]}',
      saved_by: 'user-one', saved_at: later,
    });
    expect(database.prepare(`SELECT COUNT(*) AS count FROM guide_draft_revisions WHERE guide_id = 'legacy-guide'`).get()).toEqual({ count: 1 });
  });

  it('enforces immutable, scoped, state-dependent guide digest proposal storage', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);
    seedGuideDigestBase(database);

    const insert = database.prepare(
      `INSERT INTO guide_digest_proposals (
        id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
        renderer_version, generation_metadata_json, status, draft_json, markdown,
        failure_code, supersedes_proposal_id, created_by, created_at, updated_at
      ) VALUES (?, 'digest-guide', 'workspace-one', 'digest-snapshot', 7, 1,
        'renderer-v1', '{}', ?, ?, ?, ?, NULL, 'user-one', ?, ?)`,
    );

    expect(() => insert.run('invalid-draft', 'DRAFT', null, null, null, now, now)).toThrow();
    expect(() => database!.prepare(
      `INSERT INTO guide_digest_proposals (
        id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
        renderer_version, generation_metadata_json, status, draft_json, markdown,
        failure_code, created_by, created_at, updated_at
      ) VALUES ('whitespace-markdown', 'digest-guide', 'workspace-one', 'digest-snapshot', 7, 2,
        'renderer-v1', '{}', 'DRAFT', '{"schemaVersion":1}', '   ', NULL,
        'user-one', ?, ?)`,
    ).run(now, now)).toThrow();
    insert.run('digest-proposal', 'DRAFT', '{"schemaVersion":1}', '# 摘要', null, now, now);
    expect(() => insert.run('duplicate-draft', 'DRAFT', '{"schemaVersion":1}', '# 重复', null, now, now)).toThrow();
    expect(() => database!.prepare(
      `UPDATE guide_digest_proposals SET markdown = '# 已篡改' WHERE id = 'digest-proposal'`,
    ).run()).toThrow(/immutable/i);
    expect(() => insert.run('unsafe-failure', 'FAILED', null, null, 'raw model output', now, now)).toThrow();
    expect(() => insert.run('safe-failure', 'FAILED', null, null, 'SCHEMA_INVALID', now, now)).not.toThrow();

    database.prepare(
      `INSERT INTO guide_digest_audit_events (
        id, proposal_id, guide_id, workspace_id, actor_id, event, metadata_json, created_at
      ) VALUES ('digest-audit', 'safe-failure', 'digest-guide', 'workspace-one',
        'user-one', 'VALIDATION_FAILED', '{}', ?)`,
    ).run(now);
    expect(() => database!.prepare(
      `UPDATE guide_digest_audit_events SET metadata_json = '{"changed":true}' WHERE id = 'digest-audit'`,
    ).run()).toThrow(/immutable/i);
    expect(() => database!.prepare(
      `DELETE FROM guide_digest_audit_events WHERE id = 'digest-audit'`,
    ).run()).toThrow(/immutable/i);
    expect(() => database!.prepare(
      `DELETE FROM guide_digest_proposals WHERE id = 'safe-failure'`,
    ).run()).toThrow();

    database.prepare(
      `UPDATE guide_digest_proposals SET status = 'STALE' WHERE id = 'digest-proposal'`,
    ).run();
    database.prepare(
      `INSERT INTO guide_digest_proposals (
        id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
        renderer_version, generation_metadata_json, status, draft_json, markdown,
        failure_code, supersedes_proposal_id, created_by, created_at, updated_at
      ) VALUES ('successor-proposal', 'digest-guide', 'workspace-one', 'digest-snapshot', 7, 1,
        'renderer-v1', '{}', 'DRAFT', '{"schemaVersion":1}', '# 后继摘要', NULL,
        'digest-proposal', 'user-one', ?, ?)`,
    ).run(now, now);
    expect(() => database!.prepare(
      `DELETE FROM guide_digest_proposals WHERE id = 'digest-proposal'`,
    ).run()).toThrow();

    database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, created_at, updated_at
      ) VALUES ('other-guide', 'user-one', '其他指南', '', '[]', 'DRAFT', 'INTERNAL', 7, '{}', ?, ?)`,
    ).run(now, now);
    database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES ('other-guide-item', 'workspace-one', 'GUIDE', 'other-guide', '其他指南', '', 'user-one', ?, ?)`,
    ).run(now, now);
    expect(() => database!.prepare(
      `INSERT INTO guide_digest_proposals (
        id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
        renderer_version, generation_metadata_json, status, draft_json, markdown,
        failure_code, created_by, created_at, updated_at
      ) VALUES ('cross-guide', 'other-guide', 'workspace-one', 'digest-snapshot', 7, 1,
        'renderer-v1', '{}', 'DRAFT', '{"schemaVersion":1}', '# 摘要', NULL,
        'user-one', ?, ?)`,
    ).run(now, now)).toThrow(/scope/i);
  });

  it('enforces conversation scope and mutually exclusive source ownership', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);

    insertConversation(database, { id: 'global-one', ownerId: 'user-one' });
    insertConversation(database, {
      id: 'workspace-one-conversation',
      ownerId: 'user-one',
      scope: 'WORKSPACE',
      workspaceId: 'workspace-one',
    });
    expect(() => insertConversation(database!, {
      id: 'bad-global', ownerId: 'user-one', workspaceId: 'workspace-one',
    })).toThrow();
    expect(() => insertConversation(database!, {
      id: 'bad-workspace', ownerId: 'user-one', scope: 'WORKSPACE', workspaceId: null,
    })).toThrow();

    insertSource(database, {
      id: 'source-global', scope: 'GLOBAL', kind: 'SANTEXWELL_VAULT', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'source-workspace', scope: 'WORKSPACE', kind: 'WORKSPACE_DOCUMENT',
      workspaceId: 'workspace-one', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'source-session', scope: 'SESSION', kind: 'SESSION_ATTACHMENT',
      conversationId: 'global-one', createdBy: 'user-one',
    });

    const invalidSources = [
      { id: 'global-with-workspace', scope: 'GLOBAL', kind: 'SANTEXWELL_VAULT', workspaceId: 'workspace-one' },
      { id: 'global-with-session', scope: 'GLOBAL', kind: 'SANTEXWELL_VAULT', conversationId: 'global-one' },
      { id: 'workspace-without-owner', scope: 'WORKSPACE', kind: 'WORKSPACE_DOCUMENT' },
      { id: 'workspace-with-session', scope: 'WORKSPACE', kind: 'WORKSPACE_DOCUMENT', workspaceId: 'workspace-one', conversationId: 'global-one' },
      { id: 'session-without-owner', scope: 'SESSION', kind: 'SESSION_ATTACHMENT' },
      { id: 'session-with-workspace', scope: 'SESSION', kind: 'SESSION_ATTACHMENT', workspaceId: 'workspace-one', conversationId: 'global-one' },
      { id: 'scope-kind-mismatch', scope: 'GLOBAL', kind: 'WORKSPACE_DOCUMENT' },
    ] as const;
    for (const source of invalidSources) {
      expect(() => insertSource(database!, { ...source, createdBy: 'user-one' })).toThrow();
    }
    expect(() => insertSource(database!, {
      id: 'workspace-without-creator',
      scope: 'WORKSPACE',
      kind: 'WORKSPACE_DOCUMENT',
      workspaceId: 'workspace-one',
    })).toThrow();

    database.prepare(
      `INSERT INTO workspaces (
        id, slug, name, description, icon_key, color_key, owner_id, status, created_at, updated_at
      ) VALUES ('workspace-two', 'two', '工作区二', '', 'SquaresFour', 'general',
        'user-two', 'ACTIVE', ?, ?)`,
    ).run(now, now);
    database.prepare(
      `UPDATE knowledge_sources
       SET status = 'STALE', revision = 'revision-2', config_json = '{"changed":true}', updated_at = ?
       WHERE id = 'source-workspace'`,
    ).run(later);
    expect(database.prepare(
      `SELECT status, revision FROM knowledge_sources WHERE id = 'source-workspace'`,
    ).get()).toEqual({ status: 'STALE', revision: 'revision-2' });

    for (const statement of [
      `UPDATE knowledge_sources SET id = 'renamed-source' WHERE id = 'source-workspace'`,
      `UPDATE knowledge_sources
       SET scope = 'GLOBAL', kind = 'SANTEXWELL_VAULT', workspace_id = NULL
       WHERE id = 'source-workspace'`,
      `UPDATE knowledge_sources SET kind = 'WORKSPACE_FLOW' WHERE id = 'source-workspace'`,
      `UPDATE knowledge_sources SET workspace_id = 'workspace-two' WHERE id = 'source-workspace'`,
      `UPDATE knowledge_sources SET created_by = 'user-two' WHERE id = 'source-workspace'`,
      `UPDATE knowledge_sources SET conversation_id = 'workspace-one-conversation'
       WHERE id = 'source-session'`,
    ]) {
      expect(() => database!.exec(statement)).toThrow(/immutable/i);
    }
  });

  it('models workspace flow and document sources independently without orphaned flow documents', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);
    database.prepare(
      `INSERT INTO workspaces (
        id, slug, name, description, icon_key, color_key, owner_id, status, created_at, updated_at
      ) VALUES ('workspace-two', 'two', '工作区二', '', 'SquaresFour', 'general',
        'user-two', 'ACTIVE', ?, ?)`,
    ).run(now, now);
    const insertGuide = database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, created_at, updated_at
      ) VALUES (?, ?, ?, '', '[]', 'DRAFT', 'INTERNAL', 1, '{}', ?, ?)`,
    );
    insertGuide.run('guide-flow', 'user-one', '流程指南', now, now);
    insertGuide.run('guide-orphan', 'user-one', '无工作区指南', now, now);
    database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES ('item-guide-flow', 'workspace-one', 'GUIDE', 'guide-flow', '流程指南', '',
        'user-one', ?, ?)`,
    ).run(now, now);
    const insertSnapshot = database.prepare(
      `INSERT INTO flow_knowledge_snapshots (
        id, guide_id, workspace_id, origin_type, revision, version_id, version,
        document_checksum, snapshot_json, created_at
      ) VALUES (?, ?, ?, 'DRAFT', 1, NULL, NULL, ?, '{}', ?)`,
    );
    insertSnapshot.run('snapshot-flow', 'guide-flow', 'workspace-one', 'flow-checksum', now);
    expect(() => insertSnapshot.run(
      'snapshot-orphan', 'guide-orphan', 'workspace-one', 'orphan-checksum', now,
    )).toThrow();
    expect(() => insertSnapshot.run(
      'snapshot-wrong-workspace', 'guide-flow', 'workspace-two', 'wrong-workspace-checksum', now,
    )).toThrow();

    insertSource(database, {
      id: 'workspace-document-source', scope: 'WORKSPACE', kind: 'WORKSPACE_DOCUMENT',
      workspaceId: 'workspace-one', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'workspace-flow-source', scope: 'WORKSPACE', kind: 'WORKSPACE_FLOW',
      workspaceId: 'workspace-one', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'wrong-workspace-flow-source', scope: 'WORKSPACE', kind: 'WORKSPACE_FLOW',
      workspaceId: 'workspace-two', createdBy: 'user-two',
    });

    expect(database.prepare(
      `SELECT id, kind FROM knowledge_sources WHERE scope = 'WORKSPACE' ORDER BY id`,
    ).all()).toEqual([
      { id: 'workspace-document-source', kind: 'WORKSPACE_DOCUMENT' },
      { id: 'workspace-flow-source', kind: 'WORKSPACE_FLOW' },
      { id: 'wrong-workspace-flow-source', kind: 'WORKSPACE_FLOW' },
    ]);
    insertDocument(database, 'workspace-document', 'workspace-document-source');
    insertDocument(database, 'workspace-flow-document', 'workspace-flow-source', 'snapshot-flow');
    insertFragment(database, {
      id: 'workspace-flow-fragment',
      documentId: 'workspace-flow-document',
      searchText: 'flowterm',
    });

    expect(() => insertDocument(
      database!, 'flow-without-snapshot', 'workspace-flow-source',
    )).toThrow();
    expect(() => insertDocument(
      database!, 'document-with-snapshot', 'workspace-document-source', 'snapshot-flow',
    )).toThrow();
    expect(() => insertDocument(
      database!, 'wrong-workspace-document', 'wrong-workspace-flow-source', 'snapshot-flow',
    )).toThrow();
    expect(() => insertDocument(
      database!, 'orphan-flow-document', 'workspace-flow-source', 'snapshot-orphan',
    )).toThrow();
    expect(() => insertDocument(
      database!, 'duplicate-flow-document', 'workspace-flow-source', 'snapshot-flow',
    )).toThrow();
    expect(() => database!.prepare(
      `UPDATE knowledge_documents SET flow_snapshot_id = NULL
       WHERE id = 'workspace-flow-document'`,
    ).run()).toThrow();
    expect(() => database!.prepare(
      `UPDATE knowledge_documents SET source_id = 'workspace-document-source'
       WHERE id = 'workspace-flow-document'`,
    ).run()).toThrow();
    expect(() => database!.prepare(
      `UPDATE knowledge_sources SET workspace_id = 'workspace-two'
       WHERE id = 'workspace-flow-source'`,
    ).run()).toThrow(/immutable/i);

    database.prepare(`DELETE FROM workspace_items WHERE id = 'item-guide-flow'`).run();
    expect(database.prepare(
      `SELECT workspace_id FROM flow_knowledge_snapshots WHERE id = 'snapshot-flow'`,
    ).get()).toEqual({ workspace_id: 'workspace-one' });
    expect(database.prepare(
      `SELECT id FROM knowledge_documents WHERE id = 'workspace-flow-document'`,
    ).get()).toEqual({ id: 'workspace-flow-document' });

    database.prepare(`DELETE FROM flow_knowledge_snapshots WHERE id = 'snapshot-flow'`).run();
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_documents WHERE id = 'workspace-flow-document'`,
    ).get()).toEqual({ count: 0 });
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_fragments WHERE id = 'workspace-flow-fragment'`,
    ).get()).toEqual({ count: 0 });
    expect(database.prepare(
      `SELECT fragment_id FROM knowledge_fragment_search
       WHERE knowledge_fragment_search MATCH 'flowterm'`,
    ).all()).toEqual([]);
    expect(database.prepare(
      `SELECT id FROM knowledge_sources WHERE id = 'workspace-flow-source'`,
    ).get()).toEqual({ id: 'workspace-flow-source' });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('preserves published flow history and cascades unpublished flow indexes on permanent guide removal', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);
    const insertGuide = database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, published_version_id, created_at, updated_at
      ) VALUES (?, 'user-one', ?, '', '[]', ?, 'INTERNAL', 1, '{}', ?, ?, ?)`,
    );
    insertGuide.run('published-guide', '已发布指南', 'PUBLISHED', 'published-version', now, now);
    insertGuide.run('draft-guide', '草稿指南', 'DRAFT', null, now, now);
    database.prepare(
      `INSERT INTO guide_versions (
        id, guide_id, version, title, summary, tags_json, document_json,
        search_text, published_by, published_at
      ) VALUES ('published-version', 'published-guide', 1, '已发布指南', '', '[]', '{}', '',
        'user-one', ?)`,
    ).run(now);
    const insertItem = database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by,
        deleted_at, deleted_by, created_at, updated_at
      ) VALUES (?, 'workspace-one', 'GUIDE', ?, ?, '', 'user-one', ?, 'user-one', ?, ?)`,
    );
    insertItem.run('published-item', 'published-guide', '已发布指南', now, now, now);
    insertItem.run('draft-item', 'draft-guide', '草稿指南', now, now, now);
    const insertSnapshot = database.prepare(
      `INSERT INTO flow_knowledge_snapshots (
        id, guide_id, workspace_id, origin_type, revision, version_id, version,
        document_checksum, snapshot_json, created_at
      ) VALUES (?, ?, 'workspace-one', ?, ?, ?, ?, ?, '{}', ?)`,
    );
    insertSnapshot.run(
      'published-snapshot', 'published-guide', 'PUBLISHED', null,
      'published-version', 1, 'published-checksum', now,
    );
    insertSnapshot.run(
      'draft-snapshot', 'draft-guide', 'DRAFT', 1, null, null, 'draft-checksum', now,
    );
    insertSource(database, {
      id: 'published-flow-source', scope: 'WORKSPACE', kind: 'WORKSPACE_FLOW',
      workspaceId: 'workspace-one', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'draft-flow-source', scope: 'WORKSPACE', kind: 'WORKSPACE_FLOW',
      workspaceId: 'workspace-one', createdBy: 'user-one',
    });
    insertDocument(database, 'published-flow-document', 'published-flow-source', 'published-snapshot');
    insertDocument(database, 'draft-flow-document', 'draft-flow-source', 'draft-snapshot');
    insertFragment(database, {
      id: 'published-flow-fragment',
      documentId: 'published-flow-document',
      searchText: 'publishedflow',
    });
    insertFragment(database, {
      id: 'draft-flow-fragment',
      documentId: 'draft-flow-document',
      searchText: 'draftflow',
    });

    permanentlyRemoveItem(database, {
      id: 'published-item',
      workspaceId: 'workspace-one',
      kind: 'GUIDE',
      entityId: 'published-guide',
      createdBy: 'user-one',
      deletedAt: now,
      workspacePermission: 'OWNER',
      guideOwnerId: 'user-one',
      publishedVersionId: 'published-version',
    });
    expect(database.prepare(
      `SELECT status FROM guides WHERE id = 'published-guide'`,
    ).get()).toEqual({ status: 'ARCHIVED' });
    expect(database.prepare(
      `SELECT workspace_id FROM flow_knowledge_snapshots WHERE id = 'published-snapshot'`,
    ).get()).toEqual({ workspace_id: 'workspace-one' });
    expect(database.prepare(
      `SELECT id FROM knowledge_documents WHERE id = 'published-flow-document'`,
    ).get()).toEqual({ id: 'published-flow-document' });

    permanentlyRemoveItem(database, {
      id: 'draft-item',
      workspaceId: 'workspace-one',
      kind: 'GUIDE',
      entityId: 'draft-guide',
      createdBy: 'user-one',
      deletedAt: now,
      workspacePermission: 'OWNER',
      guideOwnerId: 'user-one',
      publishedVersionId: null,
    });
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM guides WHERE id = 'draft-guide'`,
    ).get()).toEqual({ count: 0 });
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM flow_knowledge_snapshots WHERE id = 'draft-snapshot'`,
    ).get()).toEqual({ count: 0 });
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM knowledge_documents WHERE id = 'draft-flow-document'`,
    ).get()).toEqual({ count: 0 });
    expect(database.prepare(
      `SELECT fragment_id FROM knowledge_fragment_search
       WHERE knowledge_fragment_search MATCH 'draftflow'`,
    ).all()).toEqual([]);
    expect(database.prepare(
      `SELECT fragment_id FROM knowledge_fragment_search
       WHERE knowledge_fragment_search MATCH 'publishedflow'`,
    ).all()).toEqual([{ fragment_id: 'published-flow-fragment' }]);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps flow snapshot origins unique, mutually exclusive, and immutable', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);
    database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, created_at, updated_at
      ) VALUES ('guide-one', 'user-one', '指南', '', '[]', 'PUBLISHED', 'INTERNAL', 2, '{}', ?, ?)`,
    ).run(now, now);
    database.prepare(
      `INSERT INTO guide_versions (
        id, guide_id, version, title, summary, tags_json, document_json,
        search_text, published_by, published_at
      ) VALUES ('version-one', 'guide-one', 1, '指南', '', '[]', '{}', '', 'user-one', ?)`,
    ).run(now);
    database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES ('item-guide-one', 'workspace-one', 'GUIDE', 'guide-one', '指南', '',
        'user-one', ?, ?)`,
    ).run(now, now);

    const insertSnapshot = database.prepare(
      `INSERT INTO flow_knowledge_snapshots (
        id, guide_id, workspace_id, origin_type, revision, version_id, version,
        document_checksum, snapshot_json, created_at
      ) VALUES (?, 'guide-one', 'workspace-one', ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertSnapshot.run('snapshot-draft', 'DRAFT', 2, null, null, 'draft-checksum', '{"schemaVersion":1}', now);
    insertSnapshot.run('snapshot-published', 'PUBLISHED', null, 'version-one', 1, 'published-checksum', '{"schemaVersion":1}', now);

    expect(() => insertSnapshot.run(
      'snapshot-draft-duplicate', 'DRAFT', 2, null, null, 'other', '{}', now,
    )).toThrow();
    expect(() => insertSnapshot.run(
      'snapshot-published-duplicate', 'PUBLISHED', null, 'version-one', 1, 'other', '{}', now,
    )).toThrow();
    expect(() => insertSnapshot.run(
      'snapshot-published-mismatched-version', 'PUBLISHED', null, 'version-one', 2, 'other', '{}', now,
    )).toThrow();
    expect(() => insertSnapshot.run(
      'bad-draft', 'DRAFT', null, null, null, 'bad', '{}', now,
    )).toThrow();
    expect(() => insertSnapshot.run(
      'bad-published', 'PUBLISHED', 2, 'version-one', 1, 'bad', '{}', now,
    )).toThrow();
    expect(() => insertSnapshot.run(
      'bad-json', 'DRAFT', 3, null, null, 'bad', '{', now,
    )).toThrow();
    expect(() => database!.prepare(
      `UPDATE flow_knowledge_snapshots SET snapshot_json = '{}' WHERE id = 'snapshot-draft'`,
    ).run()).toThrow(/immutable/i);
  });

  it('enforces message, run, event, citation, artifact, and attachment contracts', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);
    insertConversation(database, { id: 'conversation-one', ownerId: 'user-one' });
    insertConversation(database, { id: 'conversation-two', ownerId: 'user-two' });
    insertMessageAndRun(database, {
      conversationId: 'conversation-one', messageId: 'message-one', runId: 'run-one', clientMessageId: 'client-1',
    });
    insertMessageAndRun(database, {
      conversationId: 'conversation-two', messageId: 'message-two', runId: 'run-two', clientMessageId: 'client-1',
    });

    expect(() => database!.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json, committed, created_at
      ) VALUES ('duplicate-client', 'conversation-one', 'USER', 'client-1', '重复', ?, 1, ?)`,
    ).run(sourceOptions, now)).toThrow();
    expect(() => database!.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json, committed, created_at
      ) VALUES ('bad-options', 'conversation-one', 'USER', 'client-2', '坏 JSON', '{', 1, ?)`,
    ).run(now)).toThrow();
    const messageColumns = database.prepare('PRAGMA table_info(conversation_messages)').all()
      .map((row) => (row as { name: string }).name);
    expect(messageColumns).toEqual(expect.arrayContaining([
      'selected_context_json', 'attachment_ids_json',
    ]));
    expect(() => database!.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json,
        selected_context_json, attachment_ids_json, committed, created_at
      ) VALUES ('bad-selected-context', 'conversation-one', 'USER', 'client-3',
        '坏上下文', ?, '[', '[]', 1, ?)`,
    ).run(sourceOptions, now)).toThrow();
    expect(() => database!.prepare(
      `INSERT INTO conversation_messages (
        id, conversation_id, role, client_message_id, content, source_options_json,
        selected_context_json, attachment_ids_json, committed, created_at
      ) VALUES ('bad-attachment-list', 'conversation-one', 'USER', 'client-4',
        '坏附件', ?, NULL, '{}', 1, ?)`,
    ).run(sourceOptions, now)).toThrow();
    expect(() => database!.prepare(
      `INSERT INTO agent_runs (
        id, conversation_id, initiating_message_id, run_sequence, plan_version, route,
        status, source_options_json, created_at, updated_at
      ) VALUES ('duplicate-sequence', 'conversation-one', 'message-one', 1, 1,
        'DIRECT', 'QUEUED', ?, ?, ?)`,
    ).run(sourceOptions, now, now)).toThrow();
    const runColumns = database.prepare('PRAGMA table_info(agent_runs)').all()
      .map((row) => (row as { name: string }).name);
    expect(runColumns).toContain('error_retryable');
    expect(() => database!.prepare(
      `UPDATE agent_runs SET status = 'FAILED', error_code = 'BROKEN_ONLY'
       WHERE id = 'run-one'`,
    ).run()).toThrow();
    expect(() => database!.prepare(
      `UPDATE agent_runs SET status = 'FAILED' WHERE id = 'run-one'`,
    ).run()).toThrow();
    expect(() => database!.prepare(
      `INSERT INTO agent_runs (
        id, conversation_id, initiating_message_id, run_sequence, plan_version, route,
        status, source_options_json, created_at, updated_at
      ) VALUES ('cross-conversation', 'conversation-two', 'message-one', 2, 1,
        'DIRECT', 'QUEUED', ?, ?, ?)`,
    ).run(sourceOptions, now, now)).toThrow();

    const insertEvent = database.prepare(
      `INSERT INTO agent_run_events (
        id, run_id, sequence, plan_version, phase, type, payload_json, stale, created_at
      ) VALUES (?, 'run-one', ?, 1, ?, ?, ?, ?, ?)`,
    );
    insertEvent.run('event-one', 1, 'PROVISIONAL', 'route.started', '{}', 0, now);
    insertEvent.run('event-two', 2, 'COMMITTED', 'run.completed', '{"messageId":"message-one"}', 0, now);
    expect(() => insertEvent.run('event-duplicate', 1, 'PROVISIONAL', 'task.started', '{}', 0, now)).toThrow();
    expect(() => insertEvent.run('event-stale-committed', 3, 'COMMITTED', 'run.completed', '{}', 1, now)).toThrow();
    expect(() => insertEvent.run('event-bad-type', 3, 'PROVISIONAL', 'hidden.reasoning', '{}', 0, now)).toThrow();
    expect(() => insertEvent.run('event-bad-json', 3, 'PROVISIONAL', 'task.progress', '{', 0, now)).toThrow();

    database.prepare(
      `INSERT INTO answer_citations (
        reference_id, run_id, source_kind, internal_locator_json, title, excerpt, revision, created_at
      ) VALUES ('reference-one', 'run-one', 'SANTEXWELL', '{"kind":"SANTEXWELL"}',
        '引用', '摘要', 'revision-1', ?)`,
    ).run(now);
    const citationColumns = database.prepare('PRAGMA table_info(answer_citations)').all()
      .map((row) => (row as { name: string }).name);
    expect(citationColumns).not.toContain('href');
    expect(() => database!.prepare(
      `UPDATE answer_citations SET reference_id = 'reference-two' WHERE reference_id = 'reference-one'`,
    ).run()).toThrow(/immutable/i);
    expect(() => database!.prepare(
      `UPDATE answer_citations SET internal_locator_json = '{"kind":"WORKSPACE_FLOW"}'
       WHERE reference_id = 'reference-one'`,
    ).run()).toThrow(/immutable/i);
    expect(() => database!.prepare(
      `UPDATE answer_citations SET revision = 'revision-2'
       WHERE reference_id = 'reference-one'`,
    ).run()).toThrow(/immutable/i);
    expect(() => database!.prepare(
      `UPDATE answer_citations SET run_id = 'run-two'
       WHERE reference_id = 'reference-one'`,
    ).run()).toThrow(/immutable/i);
    expect(() => database!.prepare(
      `INSERT INTO answer_citations (
        reference_id, run_id, source_kind, internal_locator_json, title, excerpt, revision, created_at
      ) VALUES ('reference-one', 'run-one', 'SANTEXWELL', '{}', '重复', '重复', 'revision-1', ?)`,
    ).run(now)).toThrow();

    const insertArtifact = database.prepare(
      `INSERT INTO artifacts (
        id, conversation_id, owner_id, run_id, kind, title, payload_json, created_at
      ) VALUES (?, 'conversation-one', 'user-one', 'run-one', ?, ?, '{}', ?)`,
    );
    for (const kind of ['REPORT', 'DIAGRAM', 'FLOW_PROPOSAL', 'REFERENCE_COLLECTION']) {
      insertArtifact.run(`artifact-${kind}`, kind, kind, now);
    }
    expect(() => insertArtifact.run('artifact-image', 'IMAGE', '图片', now)).toThrow();
    expect(() => database!.prepare(
      `INSERT INTO artifacts (
        id, conversation_id, owner_id, run_id, kind, title, payload_json, created_at
      ) VALUES ('artifact-bad-json', 'conversation-one', 'user-one', 'run-one',
        'REPORT', '坏 JSON', '{', ?)`,
    ).run(now)).toThrow();

    insertSource(database, {
      id: 'attachment-source', scope: 'SESSION', kind: 'SESSION_ATTACHMENT',
      conversationId: 'conversation-one', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'attachment-source-two', scope: 'SESSION', kind: 'SESSION_ATTACHMENT',
      conversationId: 'conversation-two', createdBy: 'user-two',
    });
    database.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, source_id, original_name, mime_type, size,
        storage_key, status, expires_at, created_at, updated_at
      ) VALUES ('attachment-one', 'conversation-one', 'user-one', 'attachment-source',
        '资料.md', 'text/markdown', 12, 'conversations/conversation-one/attachment-one',
        'READY', ?, ?, ?)`,
    ).run(later, now, now);
    expect(() => database!.prepare(
      `UPDATE conversation_attachments
       SET conversation_id = 'conversation-two', owner_id = 'user-two', source_id = 'attachment-source-two'
       WHERE id = 'attachment-one'`,
    ).run()).toThrow(/immutable/i);
    expect(() => database!.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, original_name, mime_type, size,
        storage_key, status, expires_at, created_at, updated_at
      ) VALUES ('attachment-absolute', 'conversation-one', 'user-one', '坏.md',
        'text/markdown', 1, '/tmp/private.md', 'READY', ?, ?, ?)`,
    ).run(later, now, now)).toThrow();
    expect(() => database!.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, original_name, mime_type, size,
        storage_key, status, expires_at, created_at, updated_at
      ) VALUES ('attachment-no-ttl', 'conversation-one', 'user-one', '坏.md',
        'text/markdown', 1, 'safe/key', 'READY', NULL, ?, ?)`,
    ).run(now, now)).toThrow();

    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM workspace_items
       WHERE kind IN ('CONVERSATION', 'ARTIFACT')`,
    ).get()).toEqual({ count: 0 });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps the fragment FTS projection synchronized on insert, update, and cascade delete', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);
    insertSource(database, {
      id: 'source-global', scope: 'GLOBAL', kind: 'SANTEXWELL_VAULT', createdBy: 'user-one',
    });
    insertDocument(database, 'document-search', 'source-global');
    insertFragment(database, {
      id: 'fragment-search',
      documentId: 'document-search',
      content: 'oldterm 原始内容',
      searchText: 'oldterm 羊毛 毛衫',
    });

    expect(database.prepare(
      `SELECT fragment_id FROM knowledge_fragment_search WHERE knowledge_fragment_search MATCH 'oldterm'`,
    ).all()).toEqual([{ fragment_id: 'fragment-search' }]);
    expect(database.prepare(
      `SELECT fragment_id FROM knowledge_fragment_search WHERE knowledge_fragment_search MATCH '羊毛'`,
    ).all()).toEqual([{ fragment_id: 'fragment-search' }]);

    database.prepare(
      `UPDATE knowledge_fragments
       SET title = '新标题', content = 'newterm 新内容', search_text = 'newterm 羊绒 绒线', updated_at = ?
       WHERE id = 'fragment-search'`,
    ).run(now);
    expect(database.prepare(
      `SELECT fragment_id FROM knowledge_fragment_search WHERE knowledge_fragment_search MATCH 'oldterm'`,
    ).all()).toEqual([]);
    expect(database.prepare(
      `SELECT fragment_id FROM knowledge_fragment_search WHERE knowledge_fragment_search MATCH 'newterm'`,
    ).all()).toEqual([{ fragment_id: 'fragment-search' }]);

    database.prepare(`DELETE FROM knowledge_sources WHERE id = 'source-global'`).run();
    expect(database.prepare(
      `SELECT fragment_id FROM knowledge_fragment_search WHERE knowledge_fragment_search MATCH 'newterm'`,
    ).all()).toEqual([]);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('deletes only one conversation private tree and preserves other, global, and workspace knowledge', () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedPrincipals(database);
    insertConversation(database, { id: 'private-one', ownerId: 'user-one' });
    insertConversation(database, { id: 'private-two', ownerId: 'user-two' });
    insertSource(database, {
      id: 'global-source', scope: 'GLOBAL', kind: 'SANTEXWELL_VAULT', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'workspace-source', scope: 'WORKSPACE', kind: 'WORKSPACE_DOCUMENT',
      workspaceId: 'workspace-one', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'session-one-source', scope: 'SESSION', kind: 'SESSION_ATTACHMENT',
      conversationId: 'private-one', createdBy: 'user-one',
    });
    insertSource(database, {
      id: 'session-two-source', scope: 'SESSION', kind: 'SESSION_ATTACHMENT',
      conversationId: 'private-two', createdBy: 'user-two',
    });
    for (const [documentId, sourceId, fragmentId] of [
      ['global-document', 'global-source', 'global-fragment'],
      ['workspace-document', 'workspace-source', 'workspace-fragment'],
      ['session-one-document', 'session-one-source', 'session-one-fragment'],
      ['session-two-document', 'session-two-source', 'session-two-fragment'],
    ] as const) {
      insertDocument(database, documentId, sourceId);
      insertFragment(database, { id: fragmentId, documentId, searchText: fragmentId });
    }
    insertMessageAndRun(database, {
      conversationId: 'private-one', messageId: 'message-one', runId: 'run-one', clientMessageId: 'client-one',
    });
    insertMessageAndRun(database, {
      conversationId: 'private-two', messageId: 'message-two', runId: 'run-two', clientMessageId: 'client-two',
    });
    database.prepare(
      `INSERT INTO agent_run_events (
        id, run_id, sequence, plan_version, phase, type, payload_json, stale, created_at
      ) VALUES ('event-one', 'run-one', 1, 1, 'COMMITTED', 'run.completed', '{}', 0, ?)`,
    ).run(now);
    database.prepare(
      `INSERT INTO answer_citations (
        reference_id, run_id, source_kind, internal_locator_json, title, excerpt, revision, created_at
      ) VALUES ('reference-one', 'run-one', 'SESSION_ATTACHMENT', '{}', '引用', '摘要', 'revision-1', ?)`,
    ).run(now);
    database.prepare(
      `INSERT INTO artifacts (
        id, conversation_id, owner_id, run_id, kind, title, payload_json, created_at
      ) VALUES ('artifact-one', 'private-one', 'user-one', 'run-one', 'REPORT', '报告', '{}', ?)`,
    ).run(now);
    database.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, source_id, original_name, mime_type, size,
        storage_key, status, expires_at, created_at, updated_at
      ) VALUES ('attachment-one', 'private-one', 'user-one', 'session-one-source', '资料.md',
        'text/markdown', 12, 'conversations/private-one/attachment-one', 'READY', ?, ?, ?)`,
    ).run(later, now, now);

    database.prepare(`DELETE FROM conversations WHERE id = 'private-one'`).run();

    for (const table of [
      'conversation_messages', 'agent_runs', 'agent_run_events', 'answer_citations',
      'artifacts', 'conversation_attachments',
    ]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table)
        .toEqual({ count: table === 'conversation_messages' || table === 'agent_runs' ? 1 : 0 });
    }
    expect(database.prepare('SELECT id FROM conversations ORDER BY id').all())
      .toEqual([{ id: 'private-two' }]);
    expect(database.prepare('SELECT id FROM knowledge_sources ORDER BY id').all()).toEqual([
      { id: 'global-source' },
      { id: 'session-two-source' },
      { id: 'workspace-source' },
    ]);
    expect(database.prepare('SELECT id FROM knowledge_documents ORDER BY id').all()).toEqual([
      { id: 'global-document' },
      { id: 'session-two-document' },
      { id: 'workspace-document' },
    ]);
    expect(database.prepare('SELECT id FROM knowledge_fragments ORDER BY id').all()).toEqual([
      { id: 'global-fragment' },
      { id: 'session-two-fragment' },
      { id: 'workspace-fragment' },
    ]);
    expect(database.prepare('SELECT fragment_id FROM knowledge_fragment_search ORDER BY fragment_id').all()).toEqual([
      { fragment_id: 'global-fragment' },
      { fragment_id: 'session-two-fragment' },
      { fragment_id: 'workspace-fragment' },
    ]);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

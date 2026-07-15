import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { createDatabase } from './client';
import { migrateDatabase } from './migrate';

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
    kind: 'SANTEXWELL_VAULT' | 'WORKSPACE_DOCUMENT' | 'SESSION_ATTACHMENT';
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

function insertDocument(database: DatabaseSync, id: string, sourceId: string): void {
  database.prepare(
    `INSERT INTO knowledge_documents (
      id, source_id, relative_locator, title, checksum, revision, parse_status,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'revision-1', 'READY', '{}', ?, ?)`,
  ).run(id, sourceId, `${id}.md`, `文档 ${id}`, `checksum-${id}`, now, now);
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
      'guide_search',
      'guide_versions',
      'guides',
      'media_assets',
      'schema_migrations',
      'users',
      'workspaces',
      'workspace_members',
      'workspace_items',
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
    ]));
    expect(database.prepare(
      'SELECT version FROM schema_migrations ORDER BY version',
    ).all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);

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
    ]) {
      expect(strictByTable.get(table), `${table} should be STRICT`).toBe(1);
    }
    expect(strictByTable.get('knowledge_fragment_search')).toBe(0);
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
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

    const insertSnapshot = database.prepare(
      `INSERT INTO flow_knowledge_snapshots (
        id, guide_id, origin_type, revision, version_id, version,
        document_checksum, snapshot_json, created_at
      ) VALUES (?, 'guide-one', ?, ?, ?, ?, ?, ?, ?)`,
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
    expect(() => database!.prepare(
      `INSERT INTO agent_runs (
        id, conversation_id, initiating_message_id, run_sequence, plan_version, route,
        status, source_options_json, created_at, updated_at
      ) VALUES ('duplicate-sequence', 'conversation-one', 'message-one', 1, 1,
        'DIRECT', 'QUEUED', ?, ?, ?)`,
    ).run(sourceOptions, now, now)).toThrow();
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
    database.prepare(
      `INSERT INTO conversation_attachments (
        id, conversation_id, owner_id, source_id, original_name, mime_type, size,
        storage_key, status, expires_at, created_at, updated_at
      ) VALUES ('attachment-one', 'conversation-one', 'user-one', 'attachment-source',
        '资料.md', 'text/markdown', 12, 'conversations/conversation-one/attachment-one',
        'READY', ?, ?, ?)`,
    ).run(later, now, now);
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

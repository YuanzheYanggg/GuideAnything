CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL_SANTEXWELL', 'WORKSPACE')),
  workspace_id TEXT REFERENCES workspaces(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(title) > 0),
  runtime_thread_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (scope = 'GLOBAL_SANTEXWELL' AND workspace_id IS NULL)
    OR (scope = 'WORKSPACE' AND workspace_id IS NOT NULL)
  ),
  UNIQUE (id, owner_id)
) STRICT;

CREATE INDEX conversations_owner_idx
  ON conversations(owner_id, status, updated_at DESC);
CREATE INDEX conversations_workspace_idx
  ON conversations(workspace_id, owner_id, status, updated_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'WORKSPACE', 'SESSION')),
  kind TEXT NOT NULL CHECK (kind IN (
    'SANTEXWELL_VAULT', 'WORKSPACE_DOCUMENT', 'WORKSPACE_FLOW', 'SESSION_ATTACHMENT'
  )),
  workspace_id TEXT REFERENCES workspaces(id),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'INDEXING', 'READY', 'STALE', 'FAILED', 'UNAVAILABLE'
  )),
  revision TEXT NOT NULL CHECK (length(revision) > 0),
  config_json TEXT NOT NULL CHECK (
    json_valid(config_json) AND json_type(config_json) = 'object'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (scope = 'GLOBAL'
      AND kind = 'SANTEXWELL_VAULT'
      AND workspace_id IS NULL
      AND conversation_id IS NULL)
    OR (scope = 'WORKSPACE'
      AND kind IN ('WORKSPACE_DOCUMENT', 'WORKSPACE_FLOW')
      AND workspace_id IS NOT NULL
      AND conversation_id IS NULL
      AND created_by IS NOT NULL)
    OR (scope = 'SESSION'
      AND kind = 'SESSION_ATTACHMENT'
      AND workspace_id IS NULL
      AND conversation_id IS NOT NULL
      AND created_by IS NOT NULL)
  ),
  FOREIGN KEY (conversation_id, created_by)
    REFERENCES conversations(id, owner_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX knowledge_sources_workspace_idx
  ON knowledge_sources(workspace_id, status, updated_at DESC)
  WHERE scope = 'WORKSPACE';
CREATE INDEX knowledge_sources_conversation_idx
  ON knowledge_sources(conversation_id, status, updated_at DESC)
  WHERE scope = 'SESSION';
CREATE INDEX knowledge_sources_global_idx
  ON knowledge_sources(kind, status, updated_at DESC)
  WHERE scope = 'GLOBAL';

CREATE TRIGGER knowledge_sources_identity_immutable
BEFORE UPDATE OF id, scope, kind, workspace_id, conversation_id, created_by ON knowledge_sources
WHEN NEW.id IS NOT OLD.id
  OR NEW.scope IS NOT OLD.scope
  OR NEW.kind IS NOT OLD.kind
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.created_by IS NOT OLD.created_by
BEGIN
  SELECT RAISE(ABORT, 'knowledge source identity is immutable');
END;

CREATE TABLE knowledge_documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  flow_snapshot_id TEXT REFERENCES flow_knowledge_snapshots(id) ON DELETE CASCADE,
  relative_locator TEXT NOT NULL CHECK (
    length(relative_locator) > 0
    AND substr(relative_locator, 1, 1) != '/'
    AND instr(relative_locator, '..') = 0
    AND instr(relative_locator, char(92)) = 0
  ),
  title TEXT NOT NULL CHECK (length(title) > 0),
  checksum TEXT NOT NULL CHECK (length(checksum) > 0),
  revision TEXT NOT NULL CHECK (length(revision) > 0),
  parse_status TEXT NOT NULL CHECK (parse_status IN ('PENDING', 'READY', 'FAILED')),
  metadata_json TEXT NOT NULL CHECK (
    json_valid(metadata_json) AND json_type(metadata_json) = 'object'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, relative_locator, revision)
) STRICT;

CREATE INDEX knowledge_documents_source_idx
  ON knowledge_documents(source_id, parse_status, updated_at DESC);
CREATE UNIQUE INDEX knowledge_documents_flow_snapshot_unique
  ON knowledge_documents(flow_snapshot_id)
  WHERE flow_snapshot_id IS NOT NULL;

CREATE TABLE knowledge_fragments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  title TEXT NOT NULL CHECK (length(title) > 0),
  heading TEXT,
  content TEXT NOT NULL CHECK (length(content) > 0),
  search_text TEXT NOT NULL,
  internal_locator_json TEXT NOT NULL CHECK (
    json_valid(internal_locator_json) AND json_type(internal_locator_json) = 'object'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (document_id, ordinal)
) STRICT;

CREATE INDEX knowledge_fragments_document_idx
  ON knowledge_fragments(document_id, ordinal);

CREATE VIRTUAL TABLE knowledge_fragment_search USING fts5(
  fragment_id UNINDEXED,
  title,
  heading,
  content,
  search_text,
  tokenize = 'unicode61'
);

CREATE TRIGGER knowledge_fragments_search_insert
AFTER INSERT ON knowledge_fragments
BEGIN
  INSERT INTO knowledge_fragment_search (fragment_id, title, heading, content, search_text)
  VALUES (NEW.id, NEW.title, NEW.heading, NEW.content, NEW.search_text);
END;

CREATE TRIGGER knowledge_fragments_search_update
AFTER UPDATE OF id, title, heading, content, search_text ON knowledge_fragments
BEGIN
  DELETE FROM knowledge_fragment_search WHERE fragment_id = OLD.id;
  INSERT INTO knowledge_fragment_search (fragment_id, title, heading, content, search_text)
  VALUES (NEW.id, NEW.title, NEW.heading, NEW.content, NEW.search_text);
END;

CREATE TRIGGER knowledge_fragments_search_delete
AFTER DELETE ON knowledge_fragments
BEGIN
  DELETE FROM knowledge_fragment_search WHERE fragment_id = OLD.id;
END;

CREATE UNIQUE INDEX guide_versions_snapshot_origin_unique
  ON guide_versions(guide_id, id, version);

CREATE TABLE flow_knowledge_snapshots (
  id TEXT PRIMARY KEY,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  origin_type TEXT NOT NULL CHECK (origin_type IN ('DRAFT', 'PUBLISHED')),
  revision INTEGER CHECK (revision >= 0),
  version_id TEXT REFERENCES guide_versions(id),
  version INTEGER CHECK (version > 0),
  document_checksum TEXT NOT NULL CHECK (length(document_checksum) > 0),
  snapshot_json TEXT NOT NULL CHECK (
    json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'
  ),
  created_at TEXT NOT NULL,
  CHECK (
    (origin_type = 'DRAFT'
      AND revision IS NOT NULL
      AND version_id IS NULL
      AND version IS NULL)
    OR (origin_type = 'PUBLISHED'
      AND revision IS NULL
      AND version_id IS NOT NULL
      AND version IS NOT NULL)
  ),
  FOREIGN KEY (guide_id, version_id, version)
    REFERENCES guide_versions(guide_id, id, version)
) STRICT;

CREATE UNIQUE INDEX flow_snapshots_draft_origin_unique
  ON flow_knowledge_snapshots(guide_id, revision)
  WHERE origin_type = 'DRAFT';
CREATE UNIQUE INDEX flow_snapshots_published_origin_unique
  ON flow_knowledge_snapshots(guide_id, version_id, version)
  WHERE origin_type = 'PUBLISHED';
CREATE INDEX flow_snapshots_guide_created_idx
  ON flow_knowledge_snapshots(guide_id, created_at DESC);

CREATE TRIGGER flow_knowledge_snapshots_workspace_insert
BEFORE INSERT ON flow_knowledge_snapshots
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_items
  WHERE kind = 'GUIDE'
    AND entity_id = NEW.guide_id
    AND workspace_id = NEW.workspace_id
)
BEGIN
  SELECT RAISE(ABORT, 'flow snapshot guide must belong to its immutable workspace');
END;

CREATE TRIGGER flow_knowledge_snapshots_immutable
BEFORE UPDATE ON flow_knowledge_snapshots
BEGIN
  SELECT RAISE(ABORT, 'flow knowledge snapshots are immutable');
END;

CREATE TRIGGER knowledge_documents_flow_integrity_insert
BEFORE INSERT ON knowledge_documents
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM knowledge_sources
      WHERE id = NEW.source_id AND kind = 'WORKSPACE_FLOW'
    ) AND NEW.flow_snapshot_id IS NULL
    THEN RAISE(ABORT, 'workspace flow documents require a flow snapshot')
    WHEN EXISTS (
      SELECT 1 FROM knowledge_sources
      WHERE id = NEW.source_id AND kind != 'WORKSPACE_FLOW'
    ) AND NEW.flow_snapshot_id IS NOT NULL
    THEN RAISE(ABORT, 'only workspace flow documents may reference a flow snapshot')
    WHEN NEW.flow_snapshot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM knowledge_sources AS source
      JOIN flow_knowledge_snapshots AS snapshot ON snapshot.id = NEW.flow_snapshot_id
      WHERE source.id = NEW.source_id
        AND source.scope = 'WORKSPACE'
        AND source.kind = 'WORKSPACE_FLOW'
        AND source.workspace_id = snapshot.workspace_id
    )
    THEN RAISE(ABORT, 'flow snapshot guide must belong to the source workspace')
  END;
END;

CREATE TRIGGER knowledge_documents_flow_integrity_update
BEFORE UPDATE OF source_id, flow_snapshot_id ON knowledge_documents
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM knowledge_sources
      WHERE id = NEW.source_id AND kind = 'WORKSPACE_FLOW'
    ) AND NEW.flow_snapshot_id IS NULL
    THEN RAISE(ABORT, 'workspace flow documents require a flow snapshot')
    WHEN EXISTS (
      SELECT 1 FROM knowledge_sources
      WHERE id = NEW.source_id AND kind != 'WORKSPACE_FLOW'
    ) AND NEW.flow_snapshot_id IS NOT NULL
    THEN RAISE(ABORT, 'only workspace flow documents may reference a flow snapshot')
    WHEN NEW.flow_snapshot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM knowledge_sources AS source
      JOIN flow_knowledge_snapshots AS snapshot ON snapshot.id = NEW.flow_snapshot_id
      WHERE source.id = NEW.source_id
        AND source.scope = 'WORKSPACE'
        AND source.kind = 'WORKSPACE_FLOW'
        AND source.workspace_id = snapshot.workspace_id
    )
    THEN RAISE(ABORT, 'flow snapshot guide must belong to the source workspace')
  END;
END;

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  client_message_id TEXT,
  content TEXT NOT NULL CHECK (length(content) > 0),
  source_options_json TEXT CHECK (
    source_options_json IS NULL
    OR (json_valid(source_options_json) AND json_type(source_options_json) = 'object')
  ),
  selected_context_json TEXT CHECK (
    selected_context_json IS NULL
    OR (json_valid(selected_context_json) AND json_type(selected_context_json) = 'object')
  ),
  attachment_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(attachment_ids_json)
    AND json_type(attachment_ids_json) = 'array'
    AND json_array_length(attachment_ids_json) <= 20
  ),
  committed INTEGER NOT NULL CHECK (committed IN (0, 1)),
  created_at TEXT NOT NULL,
  CHECK (
    (role = 'USER' AND client_message_id IS NOT NULL AND source_options_json IS NOT NULL)
    OR (role = 'ASSISTANT'
      AND client_message_id IS NULL
      AND source_options_json IS NULL
      AND selected_context_json IS NULL
      AND json_array_length(attachment_ids_json) = 0)
  ),
  UNIQUE (conversation_id, client_message_id),
  UNIQUE (conversation_id, id)
) STRICT;

CREATE INDEX conversation_messages_conversation_idx
  ON conversation_messages(conversation_id, created_at, id);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  initiating_message_id TEXT NOT NULL,
  run_sequence INTEGER NOT NULL CHECK (run_sequence > 0),
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  route TEXT CHECK (route IS NULL OR route IN (
    'DIRECT', 'FOCUSED', 'COMPOSITE', 'OPEN_RESEARCH'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'ROUTING', 'RUNNING', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  source_options_json TEXT NOT NULL CHECK (
    json_valid(source_options_json) AND json_type(source_options_json) = 'object'
  ),
  route_decision_json TEXT CHECK (
    route_decision_json IS NULL
    OR (json_valid(route_decision_json) AND json_type(route_decision_json) = 'object')
  ),
  error_code TEXT,
  error_message TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (conversation_id, run_sequence),
  UNIQUE (conversation_id, id),
  FOREIGN KEY (conversation_id, initiating_message_id)
    REFERENCES conversation_messages(conversation_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX agent_runs_conversation_idx
  ON agent_runs(conversation_id, run_sequence DESC);
CREATE INDEX agent_runs_status_idx
  ON agent_runs(status, created_at);

CREATE TABLE agent_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  phase TEXT NOT NULL CHECK (phase IN ('PROVISIONAL', 'COMMITTED')),
  type TEXT NOT NULL CHECK (type IN (
    'route.started', 'route.completed', 'plan.committed',
    'task.started', 'task.progress', 'task.finding', 'task.completed', 'reduce.started',
    'answer.draft.delta', 'answer.validating', 'citation.committed', 'answer.committed',
    'artifact.committed', 'run.cancelled', 'run.failed', 'run.completed'
  )),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json) = 'object'
  ),
  stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
  created_at TEXT NOT NULL,
  CHECK (phase != 'COMMITTED' OR stale = 0),
  CHECK (
    (phase = 'PROVISIONAL' AND type IN (
      'route.started', 'route.completed', 'plan.committed',
      'task.started', 'task.progress', 'task.finding', 'task.completed',
      'reduce.started', 'answer.draft.delta'
    ))
    OR (phase = 'COMMITTED' AND type IN (
      'answer.validating', 'citation.committed', 'answer.committed',
      'artifact.committed', 'run.cancelled', 'run.failed', 'run.completed'
    ))
  ),
  UNIQUE (run_id, sequence)
) STRICT;

CREATE INDEX agent_run_events_replay_idx
  ON agent_run_events(run_id, sequence);

CREATE TABLE answer_citations (
  reference_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'WORKSPACE_FLOW', 'WORKSPACE_DOCUMENT', 'SESSION_ATTACHMENT',
    'SANTEXWELL', 'PRIOR_CONVERSATION'
  )),
  internal_locator_json TEXT NOT NULL CHECK (
    json_valid(internal_locator_json) AND json_type(internal_locator_json) = 'object'
  ),
  title TEXT NOT NULL CHECK (length(title) > 0),
  excerpt TEXT NOT NULL CHECK (length(excerpt) > 0),
  revision TEXT NOT NULL CHECK (length(revision) > 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX answer_citations_run_idx
  ON answer_citations(run_id, created_at);

CREATE TRIGGER answer_citations_reference_id_immutable
BEFORE UPDATE ON answer_citations
BEGIN
  SELECT RAISE(ABORT, 'answer citation is immutable');
END;

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'REPORT', 'DIAGRAM', 'FLOW_PROPOSAL', 'REFERENCE_COLLECTION'
  )),
  title TEXT NOT NULL CHECK (length(title) > 0),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json) = 'object'
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id, owner_id)
    REFERENCES conversations(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, run_id)
    REFERENCES agent_runs(conversation_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX artifacts_owner_idx
  ON artifacts(owner_id, created_at DESC);
CREATE INDEX artifacts_conversation_idx
  ON artifacts(conversation_id, created_at DESC);

CREATE TABLE conversation_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  source_id TEXT UNIQUE REFERENCES knowledge_sources(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL CHECK (length(original_name) > 0),
  mime_type TEXT NOT NULL CHECK (length(mime_type) > 0),
  size INTEGER NOT NULL CHECK (size >= 0),
  storage_key TEXT NOT NULL UNIQUE CHECK (
    length(storage_key) > 0
    AND substr(storage_key, 1, 1) != '/'
    AND instr(storage_key, '..') = 0
    AND instr(storage_key, char(92)) = 0
  ),
  status TEXT NOT NULL CHECK (status IN (
    'UPLOADING', 'INDEXING', 'READY', 'FAILED', 'EXPIRED', 'DELETED'
  )),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (expires_at > created_at),
  FOREIGN KEY (conversation_id, owner_id)
    REFERENCES conversations(id, owner_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX conversation_attachments_owner_idx
  ON conversation_attachments(owner_id, status, expires_at);
CREATE INDEX conversation_attachments_conversation_idx
  ON conversation_attachments(conversation_id, created_at DESC);

CREATE TRIGGER conversation_attachments_identity_immutable
BEFORE UPDATE OF id, conversation_id, owner_id ON conversation_attachments
WHEN NEW.id IS NOT OLD.id
  OR NEW.conversation_id IS NOT OLD.conversation_id
  OR NEW.owner_id IS NOT OLD.owner_id
BEGIN
  SELECT RAISE(ABORT, 'conversation attachment identity is immutable');
END;

CREATE TRIGGER conversation_attachments_session_source_insert
BEFORE INSERT ON conversation_attachments
WHEN NEW.source_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM knowledge_sources
    WHERE id = NEW.source_id
      AND scope = 'SESSION'
      AND kind = 'SESSION_ATTACHMENT'
      AND conversation_id = NEW.conversation_id
  ) THEN RAISE(ABORT, 'attachment source must belong to the same conversation') END;
END;

CREATE TRIGGER conversation_attachments_session_source_update
BEFORE UPDATE OF source_id, conversation_id ON conversation_attachments
WHEN NEW.source_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM knowledge_sources
    WHERE id = NEW.source_id
      AND scope = 'SESSION'
      AND kind = 'SESSION_ATTACHMENT'
      AND conversation_id = NEW.conversation_id
  ) THEN RAISE(ABORT, 'attachment source must belong to the same conversation') END;
END;

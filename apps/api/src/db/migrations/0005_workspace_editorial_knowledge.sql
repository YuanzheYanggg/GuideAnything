CREATE TABLE workspace_question_clusters (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cluster_key TEXT NOT NULL CHECK (length(cluster_key) > 0),
  summary TEXT NOT NULL CHECK (length(summary) > 0),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'DISMISSED', 'CARD_CREATED')),
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count > 0),
  owner_visible_example_count INTEGER NOT NULL CHECK (owner_visible_example_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, cluster_key)
) STRICT;

CREATE INDEX workspace_question_clusters_list_idx
  ON workspace_question_clusters(workspace_id, status, updated_at DESC);

CREATE TABLE workspace_question_cluster_examples (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL REFERENCES workspace_question_clusters(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (cluster_id, message_id)
) STRICT;

CREATE INDEX workspace_question_examples_owner_idx
  ON workspace_question_cluster_examples(workspace_id, owner_id, created_at DESC);

CREATE TRIGGER workspace_question_example_scope_insert
BEFORE INSERT ON workspace_question_cluster_examples
WHEN NOT EXISTS (
  SELECT 1
  FROM workspace_question_clusters AS cluster
  JOIN conversation_messages AS message ON message.id = NEW.message_id
  JOIN conversations AS conversation ON conversation.id = message.conversation_id
  WHERE cluster.id = NEW.cluster_id
    AND cluster.workspace_id = NEW.workspace_id
    AND conversation.scope = 'WORKSPACE'
    AND conversation.workspace_id = NEW.workspace_id
    AND conversation.owner_id = NEW.owner_id
    AND message.role = 'USER'
)
BEGIN
  SELECT RAISE(ABORT, 'question example must belong to its workspace owner conversation');
END;

CREATE TABLE workspace_knowledge_cards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cluster_id TEXT REFERENCES workspace_question_clusters(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('QUESTION_GAP', 'EVIDENCE_CONFLICT', 'IMPROVEMENT_PROPOSAL')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'ARCHIVED')),
  title TEXT NOT NULL CHECK (length(title) > 0),
  summary TEXT NOT NULL CHECK (length(summary) > 0),
  guide_id TEXT REFERENCES guides(id) ON DELETE SET NULL,
  node_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX workspace_knowledge_cards_list_idx
  ON workspace_knowledge_cards(workspace_id, status, updated_at DESC);

CREATE TRIGGER workspace_knowledge_card_scope_insert
BEFORE INSERT ON workspace_knowledge_cards
WHEN (NEW.cluster_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM workspace_question_clusters WHERE id = NEW.cluster_id AND workspace_id = NEW.workspace_id
)) OR (NEW.guide_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM workspace_items WHERE kind = 'GUIDE' AND entity_id = NEW.guide_id AND workspace_id = NEW.workspace_id AND deleted_at IS NULL
))
BEGIN
  SELECT RAISE(ABORT, 'knowledge card relation must belong to workspace');
END;

CREATE TABLE workspace_knowledge_card_evidence (
  card_id TEXT NOT NULL REFERENCES workspace_knowledge_cards(id) ON DELETE CASCADE,
  reference_id TEXT NOT NULL REFERENCES answer_citations(reference_id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (card_id, reference_id)
) STRICT;

CREATE TRIGGER workspace_card_evidence_scope_insert
BEFORE INSERT ON workspace_knowledge_card_evidence
WHEN NOT EXISTS (
  SELECT 1
  FROM workspace_knowledge_cards AS card
  JOIN answer_citations AS citation ON citation.reference_id = NEW.reference_id
  JOIN agent_runs AS run ON run.id = citation.run_id
  JOIN conversations AS conversation ON conversation.id = run.conversation_id
  WHERE card.id = NEW.card_id
    AND card.workspace_id = NEW.workspace_id
    AND conversation.scope = 'WORKSPACE'
    AND conversation.workspace_id = NEW.workspace_id
)
BEGIN
  SELECT RAISE(ABORT, 'card evidence must be a workspace citation');
END;

CREATE TABLE workspace_flow_proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES workspace_knowledge_cards(id) ON DELETE SET NULL,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'APPLIED', 'STALE')),
  summary TEXT NOT NULL CHECK (length(summary) > 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_revision INTEGER CHECK (applied_revision >= 0)
) STRICT;

CREATE INDEX workspace_flow_proposals_list_idx
  ON workspace_flow_proposals(workspace_id, status, updated_at DESC);

CREATE TRIGGER workspace_flow_proposal_scope_insert
BEFORE INSERT ON workspace_flow_proposals
WHEN NOT EXISTS (
  SELECT 1 FROM workspace_items WHERE kind = 'GUIDE' AND entity_id = NEW.guide_id AND workspace_id = NEW.workspace_id AND deleted_at IS NULL
) OR (NEW.card_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM workspace_knowledge_cards WHERE id = NEW.card_id AND workspace_id = NEW.workspace_id
))
BEGIN
  SELECT RAISE(ABORT, 'flow proposal relation must belong to workspace');
END;

CREATE TABLE workspace_flow_proposal_operations (
  proposal_id TEXT NOT NULL REFERENCES workspace_flow_proposals(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  operation_json TEXT NOT NULL CHECK (json_valid(operation_json) AND json_type(operation_json) = 'object'),
  PRIMARY KEY (proposal_id, ordinal)
) STRICT;

CREATE TABLE workspace_editorial_audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (length(action) > 0),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('QUESTION_CLUSTER', 'KNOWLEDGE_CARD', 'FLOW_PROPOSAL')),
  target_id TEXT NOT NULL CHECK (length(target_id) > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX workspace_editorial_audit_list_idx
  ON workspace_editorial_audit_events(workspace_id, created_at DESC);

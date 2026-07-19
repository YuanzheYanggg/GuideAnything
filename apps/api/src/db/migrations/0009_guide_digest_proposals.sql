CREATE TABLE guide_digest_proposals (
  id TEXT PRIMARY KEY,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  base_snapshot_id TEXT NOT NULL REFERENCES flow_knowledge_snapshots(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  bundle_revision INTEGER NOT NULL CHECK (bundle_revision > 0),
  renderer_version TEXT NOT NULL CHECK (length(renderer_version) > 0),
  generation_metadata_json TEXT NOT NULL CHECK (
    json_valid(generation_metadata_json) AND json_type(generation_metadata_json) = 'object'
  ),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'REJECTED', 'APPLIED', 'STALE', 'FAILED')),
  draft_json TEXT,
  markdown TEXT,
  failure_code TEXT CHECK (
    failure_code IS NULL OR (
      length(failure_code) BETWEEN 1 AND 100
      AND failure_code NOT GLOB '*[^A-Z0-9_]*'
    )
  ),
  supersedes_proposal_id TEXT REFERENCES guide_digest_proposals(id) ON DELETE CASCADE,
  applied_revision INTEGER CHECK (applied_revision >= 0),
  selected_summary INTEGER CHECK (selected_summary IN (0, 1)),
  accepted_tags_json TEXT CHECK (
    accepted_tags_json IS NULL OR (
      json_valid(accepted_tags_json) AND json_type(accepted_tags_json) = 'array'
    )
  ),
  accepted_markdown INTEGER CHECK (accepted_markdown IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (supersedes_proposal_id IS NULL OR supersedes_proposal_id != id),
  CHECK (
    (status IN ('DRAFT', 'REJECTED', 'STALE')
      AND draft_json IS NOT NULL
      AND json_valid(draft_json)
      AND json_type(draft_json) = 'object'
      AND markdown IS NOT NULL
      AND length(markdown) > 0
      AND failure_code IS NULL
      AND applied_revision IS NULL
      AND selected_summary IS NULL
      AND accepted_tags_json IS NULL
      AND accepted_markdown IS NULL)
    OR (status = 'APPLIED'
      AND draft_json IS NOT NULL
      AND json_valid(draft_json)
      AND json_type(draft_json) = 'object'
      AND markdown IS NOT NULL
      AND length(markdown) > 0
      AND failure_code IS NULL
      AND applied_revision IS NOT NULL
      AND selected_summary IS NOT NULL
      AND accepted_tags_json IS NOT NULL
      AND accepted_markdown IS NOT NULL)
    OR (status = 'FAILED'
      AND draft_json IS NULL
      AND markdown IS NULL
      AND failure_code IS NOT NULL
      AND applied_revision IS NULL
      AND selected_summary IS NULL
      AND accepted_tags_json IS NULL
      AND accepted_markdown IS NULL)
  )
) STRICT;

CREATE INDEX guide_digest_proposals_guide_created_idx
  ON guide_digest_proposals(guide_id, created_at DESC);

CREATE INDEX guide_digest_proposals_guide_revision_status_idx
  ON guide_digest_proposals(guide_id, base_revision, status);

CREATE UNIQUE INDEX guide_digest_proposals_one_draft_idx
  ON guide_digest_proposals(guide_id, base_snapshot_id, bundle_revision)
  WHERE status = 'DRAFT';

CREATE TRIGGER guide_digest_proposals_scope_insert
BEFORE INSERT ON guide_digest_proposals
WHEN NOT EXISTS (
  SELECT 1
  FROM flow_knowledge_snapshots AS snapshot
  JOIN workspace_items AS item
    ON item.kind = 'GUIDE'
   AND item.entity_id = snapshot.guide_id
   AND item.workspace_id = snapshot.workspace_id
   AND item.deleted_at IS NULL
  WHERE snapshot.id = NEW.base_snapshot_id
    AND snapshot.guide_id = NEW.guide_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.origin_type = 'DRAFT'
    AND snapshot.revision = NEW.base_revision
) OR (
  NEW.supersedes_proposal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM guide_digest_proposals AS prior
    WHERE prior.id = NEW.supersedes_proposal_id
      AND prior.guide_id = NEW.guide_id
      AND prior.workspace_id = NEW.workspace_id
      AND prior.base_snapshot_id = NEW.base_snapshot_id
      AND prior.base_revision = NEW.base_revision
      AND prior.bundle_revision = NEW.bundle_revision
      AND prior.status = 'STALE'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'guide digest proposal scope is invalid');
END;

CREATE TRIGGER guide_digest_proposals_immutable_content
BEFORE UPDATE OF
  id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
  renderer_version, generation_metadata_json, draft_json, markdown, failure_code,
  supersedes_proposal_id, created_by, created_at
ON guide_digest_proposals
BEGIN
  SELECT RAISE(ABORT, 'guide digest proposal generated content is immutable');
END;

CREATE TRIGGER guide_digest_proposals_status_transition
BEFORE UPDATE OF status, applied_revision, selected_summary, accepted_tags_json, accepted_markdown
ON guide_digest_proposals
WHEN OLD.status != 'DRAFT'
  OR NEW.status NOT IN ('REJECTED', 'APPLIED', 'STALE')
  OR NEW.status = OLD.status
BEGIN
  SELECT RAISE(ABORT, 'guide digest proposal state transition is invalid');
END;

CREATE TABLE guide_digest_audit_events (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES guide_digest_proposals(id) ON DELETE CASCADE,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  event TEXT NOT NULL CHECK (
    event IN ('GENERATED', 'VALIDATION_FAILED', 'REJECTED', 'MARKED_STALE', 'APPLIED')
  ),
  metadata_json TEXT NOT NULL CHECK (
    json_valid(metadata_json) AND json_type(metadata_json) = 'object'
  ),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX guide_digest_audit_events_proposal_created_idx
  ON guide_digest_audit_events(proposal_id, created_at ASC);

CREATE TRIGGER guide_digest_audit_events_scope_insert
BEFORE INSERT ON guide_digest_audit_events
WHEN NOT EXISTS (
  SELECT 1
  FROM guide_digest_proposals AS proposal
  WHERE proposal.id = NEW.proposal_id
    AND proposal.guide_id = NEW.guide_id
    AND proposal.workspace_id = NEW.workspace_id
)
BEGIN
  SELECT RAISE(ABORT, 'guide digest audit event scope is invalid');
END;

CREATE TRIGGER guide_digest_audit_events_immutable
BEFORE UPDATE ON guide_digest_audit_events
BEGIN
  SELECT RAISE(ABORT, 'guide digest audit event is immutable');
END;

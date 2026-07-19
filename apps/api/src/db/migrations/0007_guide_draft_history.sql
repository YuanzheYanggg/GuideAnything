CREATE TABLE guide_draft_revisions (
  id TEXT PRIMARY KEY,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  draft_document_json TEXT NOT NULL,
  saved_by TEXT NOT NULL REFERENCES users(id),
  saved_at TEXT NOT NULL,
  UNIQUE (guide_id, revision)
) STRICT;

CREATE INDEX guide_draft_revisions_latest_idx
  ON guide_draft_revisions(guide_id, saved_at DESC, revision DESC);

CREATE TRIGGER guide_draft_revisions_immutable
BEFORE UPDATE ON guide_draft_revisions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'guide draft revision is immutable');
END;

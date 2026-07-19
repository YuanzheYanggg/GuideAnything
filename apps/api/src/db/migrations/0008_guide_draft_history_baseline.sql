-- Existing guides predate draft-history snapshots. Preserve each current draft
-- once so users have a recovery baseline immediately after upgrading.
INSERT INTO guide_draft_revisions (
  id,
  guide_id,
  revision,
  title,
  summary,
  tags_json,
  draft_document_json,
  saved_by,
  saved_at
)
SELECT
  lower(hex(randomblob(16))),
  guides.id,
  guides.revision,
  guides.title,
  guides.summary,
  guides.tags_json,
  guides.draft_document,
  guides.owner_id,
  guides.updated_at
FROM guides
WHERE NOT EXISTS (
  SELECT 1
  FROM guide_draft_revisions
  WHERE guide_draft_revisions.guide_id = guides.id
    AND guide_draft_revisions.revision = guides.revision
);

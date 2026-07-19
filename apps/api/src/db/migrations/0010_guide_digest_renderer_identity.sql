DROP INDEX guide_digest_proposals_one_draft_idx;

CREATE UNIQUE INDEX guide_digest_proposals_one_draft_idx
  ON guide_digest_proposals(guide_id, base_snapshot_id, bundle_revision, renderer_version)
  WHERE status = 'DRAFT';

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('AUTHOR', 'EDITOR', 'LEARNER')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE guides (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  visibility TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (visibility = 'INTERNAL'),
  revision INTEGER NOT NULL DEFAULT 0,
  draft_document TEXT NOT NULL,
  published_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX guides_owner_idx ON guides(owner_id, updated_at DESC);

CREATE TABLE guide_collaborators (
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission = 'EDIT'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (guide_id, user_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE guide_versions (
  id TEXT PRIMARY KEY,
  guide_id TEXT NOT NULL REFERENCES guides(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  document_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES users(id),
  published_at TEXT NOT NULL,
  UNIQUE (guide_id, version)
) STRICT;

CREATE INDEX guide_versions_guide_idx ON guide_versions(guide_id, version DESC);

CREATE VIRTUAL TABLE guide_search USING fts5(
  version_id UNINDEXED,
  guide_id UNINDEXED,
  title,
  summary,
  tags,
  content,
  tokenize = 'unicode61'
);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('IMAGE', 'VIDEO')),
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  storage_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;


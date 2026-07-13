CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_key TEXT NOT NULL,
  color_key TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('OWNER', 'EDIT', 'VIEW')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE workspace_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('GUIDE','SOURCE','AGENT','ONTOLOGY','CONVERSATION','ARTIFACT')),
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, entity_id)
) STRICT;

CREATE INDEX workspace_items_workspace_idx
  ON workspace_items(workspace_id, deleted_at, updated_at DESC);

CREATE TABLE user_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE recent_views (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
  last_viewed_at TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 1 CHECK (view_count > 0),
  context_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, item_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE workspace_activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN (
    'GUIDE_CREATED','GUIDE_UPDATED','GUIDE_PUBLISHED',
    'COLLABORATOR_ADDED','ITEM_TRASHED','ITEM_RESTORED'
  )),
  item_id TEXT REFERENCES workspace_items(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
) STRICT;

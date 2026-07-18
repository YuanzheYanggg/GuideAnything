ALTER TABLE workspaces
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'BUSINESS_TEAM'
  CHECK (kind IN ('BUSINESS_TEAM', 'FINANCE', 'TECHNICAL', 'FOLLOW_UP', 'PRODUCTION'));

CREATE TABLE workspace_folders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES workspace_folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(name)) BETWEEN 1 AND 120)
) STRICT;

CREATE UNIQUE INDEX workspace_folders_workspace_parent_name_unique
  ON workspace_folders(workspace_id, ifnull(parent_id, ''), name COLLATE NOCASE);

CREATE INDEX workspace_folders_workspace_parent_idx
  ON workspace_folders(workspace_id, parent_id, name COLLATE NOCASE);

CREATE TRIGGER workspace_folders_parent_scope_insert
BEFORE INSERT ON workspace_folders
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM workspace_folders AS parent
    WHERE parent.id = NEW.parent_id AND parent.workspace_id = NEW.workspace_id
  )
BEGIN
  SELECT RAISE(ABORT, 'workspace folder parent must belong to the same workspace');
END;

CREATE TRIGGER workspace_folders_parent_scope_update
BEFORE UPDATE OF workspace_id, parent_id ON workspace_folders
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM workspace_folders AS parent
    WHERE parent.id = NEW.parent_id AND parent.workspace_id = NEW.workspace_id
  )
BEGIN
  SELECT RAISE(ABORT, 'workspace folder parent must belong to the same workspace');
END;

ALTER TABLE workspace_items ADD COLUMN folder_id TEXT;

CREATE INDEX workspace_items_folder_idx
  ON workspace_items(workspace_id, folder_id, deleted_at, updated_at DESC);

CREATE TRIGGER workspace_items_folder_scope_insert
BEFORE INSERT ON workspace_items
FOR EACH ROW WHEN NEW.folder_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM workspace_folders AS folder
    WHERE folder.id = NEW.folder_id AND folder.workspace_id = NEW.workspace_id
  )
BEGIN
  SELECT RAISE(ABORT, 'workspace item folder must belong to the same workspace');
END;

CREATE TRIGGER workspace_items_folder_scope_update
BEFORE UPDATE OF workspace_id, folder_id ON workspace_items
FOR EACH ROW WHEN NEW.folder_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM workspace_folders AS folder
    WHERE folder.id = NEW.folder_id AND folder.workspace_id = NEW.workspace_id
  )
BEGIN
  SELECT RAISE(ABORT, 'workspace item folder must belong to the same workspace');
END;

CREATE TRIGGER workspace_folders_delete_empty
BEFORE DELETE ON workspace_folders
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM workspace_folders AS child WHERE child.parent_id = OLD.id
) OR EXISTS (
  SELECT 1 FROM workspace_items AS item
  WHERE item.folder_id = OLD.id AND item.deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'workspace folder is not empty');
END;

CREATE TABLE workspace_resource_mounts (
  id TEXT PRIMARY KEY,
  consumer_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (consumer_workspace_id != provider_workspace_id),
  UNIQUE (consumer_workspace_id, provider_workspace_id)
) STRICT;

CREATE INDEX workspace_resource_mounts_consumer_idx
  ON workspace_resource_mounts(consumer_workspace_id, updated_at DESC);

CREATE INDEX workspace_resource_mounts_provider_idx
  ON workspace_resource_mounts(provider_workspace_id, updated_at DESC);

CREATE TRIGGER workspace_resource_mounts_role_insert
BEFORE INSERT ON workspace_resource_mounts
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM workspaces AS consumer
  JOIN workspaces AS provider ON provider.id = NEW.provider_workspace_id
  WHERE consumer.id = NEW.consumer_workspace_id
    AND consumer.status = 'ACTIVE'
    AND provider.status = 'ACTIVE'
    AND consumer.kind = 'BUSINESS_TEAM'
    AND provider.kind IN ('FINANCE', 'TECHNICAL', 'FOLLOW_UP', 'PRODUCTION')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace resource mount requires an active business team and resource center');
END;

CREATE TRIGGER workspace_resource_mounts_role_update
BEFORE UPDATE OF consumer_workspace_id, provider_workspace_id ON workspace_resource_mounts
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM workspaces AS consumer
  JOIN workspaces AS provider ON provider.id = NEW.provider_workspace_id
  WHERE consumer.id = NEW.consumer_workspace_id
    AND consumer.status = 'ACTIVE'
    AND provider.status = 'ACTIVE'
    AND consumer.kind = 'BUSINESS_TEAM'
    AND provider.kind IN ('FINANCE', 'TECHNICAL', 'FOLLOW_UP', 'PRODUCTION')
)
BEGIN
  SELECT RAISE(ABORT, 'workspace resource mount requires an active business team and resource center');
END;

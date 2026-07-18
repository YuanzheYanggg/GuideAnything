import type {
  WorkspaceActivity,
  WorkspaceFolder,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspaceKind,
  WorkspaceResourceMount,
  WorkspaceSummary,
} from '@guideanything/contracts';

export type {
  WorkspaceActivity,
  WorkspaceFolder,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspaceKind,
  WorkspaceResourceMount,
  WorkspaceSummary,
} from '@guideanything/contracts';

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description: string;
  iconKey: string;
  colorKey: string;
  kind?: WorkspaceKind;
}

export interface WorkspaceApi {
  list: () => Promise<WorkspaceSummary[]>;
  create: (input: CreateWorkspaceInput) => Promise<WorkspaceSummary>;
  get: (id: string) => Promise<{
    workspace: WorkspaceSummary;
    counts: Record<WorkspaceItemKind, number>;
  }>;
  listItems: (id: string, kind?: WorkspaceItemKind) => Promise<WorkspaceItemSummary[]>;
  activity: (id: string) => Promise<WorkspaceActivity[]>;
  listFolders: (id: string) => Promise<WorkspaceFolder[]>;
  createFolder: (id: string, input: { name: string; parentId: string | null }) => Promise<WorkspaceFolder>;
  renameFolder: (id: string, folderId: string, name: string) => Promise<WorkspaceFolder>;
  deleteFolder: (id: string, folderId: string) => Promise<void>;
  moveItemToFolder: (id: string, itemId: string, folderId: string | null) => Promise<WorkspaceItemSummary>;
  listResourceMounts: (id: string) => Promise<WorkspaceResourceMount[]>;
  createResourceMount: (id: string, providerWorkspaceId: string) => Promise<WorkspaceResourceMount>;
  deleteResourceMount: (id: string, mountId: string) => Promise<void>;
}

export interface PersonalApi {
  listFavorites: () => Promise<WorkspaceItemSummary[]>;
  listRecent: () => Promise<WorkspaceItemSummary[]>;
  listShared: () => Promise<WorkspaceItemSummary[]>;
  listTrash: () => Promise<WorkspaceItemSummary[]>;
  favorite: (itemId: string) => Promise<WorkspaceItemSummary>;
  unfavorite: (itemId: string) => Promise<WorkspaceItemSummary>;
  recordRecent: (itemId: string, context: Record<string, unknown>) => Promise<WorkspaceItemSummary>;
  trashItem: (itemId: string) => Promise<WorkspaceItemSummary>;
  restoreItem: (itemId: string) => Promise<WorkspaceItemSummary>;
  permanentlyRemoveItem: (itemId: string) => Promise<void>;
}

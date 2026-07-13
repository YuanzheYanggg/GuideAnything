import type {
  WorkspaceActivity,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspaceSummary,
} from '@guideanything/contracts';

export type {
  WorkspaceActivity,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspaceSummary,
} from '@guideanything/contracts';

export interface WorkspaceApi {
  list: () => Promise<WorkspaceSummary[]>;
  get: (id: string) => Promise<{
    workspace: WorkspaceSummary;
    counts: Record<WorkspaceItemKind, number>;
  }>;
  listItems: (id: string, kind?: WorkspaceItemKind) => Promise<WorkspaceItemSummary[]>;
  activity: (id: string) => Promise<WorkspaceActivity[]>;
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

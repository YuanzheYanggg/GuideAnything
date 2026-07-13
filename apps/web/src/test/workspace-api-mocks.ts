import type { WorkspaceItemSummary, WorkspaceSummary } from '@guideanything/contracts';
import { vi } from 'vitest';

import { ApiClient } from '../lib/api';
import type { PersonalApi } from '../features/workspace/types';

export function mockAuthenticatedWorkspaceApi(input: {
  workspaces?: WorkspaceSummary[];
  favorites?: WorkspaceItemSummary[];
}) {
  const counts = { GUIDE: 0, SOURCE: 0, AGENT: 0, ONTOLOGY: 0, CONVERSATION: 0, ARTIFACT: 0 };
  vi.spyOn(ApiClient.prototype, 'hasToken', 'get').mockReturnValue(true);
  vi.spyOn(ApiClient.prototype, 'me').mockResolvedValue({
    id: 'user-author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR',
  });
  vi.spyOn(ApiClient.prototype, 'workspaceApi').mockReturnValue({
    list: vi.fn().mockResolvedValue(input.workspaces ?? []),
    get: vi.fn(async (id) => ({
      workspace: (input.workspaces ?? []).find((workspace) => workspace.id === id)!,
      counts,
    })),
    listItems: vi.fn().mockResolvedValue([]),
    activity: vi.fn().mockResolvedValue([]),
  });
  vi.spyOn(ApiClient.prototype, 'personalApi').mockReturnValue({
    listFavorites: vi.fn().mockResolvedValue(input.favorites ?? []),
    listRecent: vi.fn().mockResolvedValue([]),
    listShared: vi.fn().mockResolvedValue([]),
    listTrash: vi.fn().mockResolvedValue([]),
    favorite: vi.fn(),
    unfavorite: vi.fn(),
    recordRecent: vi.fn(),
    trashItem: vi.fn(),
    restoreItem: vi.fn(),
    permanentlyRemoveItem: vi.fn(),
  });
}

export function createPersonalApiMock(): PersonalApi {
  return {
    listFavorites: vi.fn().mockResolvedValue([]),
    listRecent: vi.fn().mockResolvedValue([]),
    listShared: vi.fn().mockResolvedValue([]),
    listTrash: vi.fn().mockResolvedValue([]),
    favorite: vi.fn(),
    unfavorite: vi.fn(),
    recordRecent: vi.fn(),
    trashItem: vi.fn(),
    restoreItem: vi.fn(),
    permanentlyRemoveItem: vi.fn(),
  };
}

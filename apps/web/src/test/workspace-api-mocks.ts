import type { WorkspaceItemSummary, WorkspaceSummary } from '@guideanything/contracts';
import { vi } from 'vitest';

import { ApiClient } from '../lib/api';

export function mockAuthenticatedWorkspaceApi(input: {
  workspaces?: WorkspaceSummary[];
  favorites?: WorkspaceItemSummary[];
}) {
  vi.spyOn(ApiClient.prototype, 'hasToken', 'get').mockReturnValue(true);
  vi.spyOn(ApiClient.prototype, 'me').mockResolvedValue({
    id: 'user-author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR',
  });
  vi.spyOn(ApiClient.prototype, 'workspaceApi').mockReturnValue({
    list: vi.fn().mockResolvedValue(input.workspaces ?? []),
    get: vi.fn(),
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

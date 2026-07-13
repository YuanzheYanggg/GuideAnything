import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { ApiClient } from './lib/api';
import { mockAuthenticatedWorkspaceApi } from './test/workspace-api-mocks';

const workspace = {
  id: 'workspace-materials',
  slug: 'materials',
  name: '物料管理',
  description: '',
  iconKey: 'FileText',
  colorKey: 'materials',
  ownerId: 'user-author',
  ownerName: '王作者',
  permission: 'OWNER' as const,
  guideCount: 0,
  updatedAt: '2026-07-13T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('App routes', () => {
  it('restores the favorites route after authentication', async () => {
    window.history.replaceState(null, '', '/favorites');
    mockAuthenticatedWorkspaceApi({ workspaces: [], favorites: [] });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '收藏夹' })).toBeVisible();
    expect(screen.getByRole('button', { name: '收藏夹' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens a workspace URL and keeps it after reload', async () => {
    window.history.replaceState(null, '', '/workspaces/workspace-materials');
    mockAuthenticatedWorkspaceApi({ workspaces: [workspace] });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '物料管理' })).toBeVisible();
    expect(window.location.pathname).toBe('/workspaces/workspace-materials');
  });
});

describe('workspace API clients', () => {
  it('unwraps workspace collection responses and preserves item filters', async () => {
    const client = new ApiClient();
    const counts = { GUIDE: 0, SOURCE: 0, AGENT: 0, ONTOLOGY: 0, CONVERSATION: 0, ARTIFACT: 0 };
    const request = vi.spyOn(client, 'request').mockImplementation(async (path) => {
      if (path === '/workspaces') return { items: [workspace] } as never;
      if (path === `/workspaces/${workspace.id}`) return { workspace, counts } as never;
      return { items: [] } as never;
    });

    const api = client.workspaceApi();

    await expect(api.list()).resolves.toEqual([workspace]);
    await expect(api.get(workspace.id)).resolves.toEqual({ workspace, counts });
    await expect(api.listItems(workspace.id, 'GUIDE')).resolves.toEqual([]);
    await expect(api.activity(workspace.id)).resolves.toEqual([]);
    expect(request).toHaveBeenNthCalledWith(1, '/workspaces');
    expect(request).toHaveBeenNthCalledWith(2, '/workspaces/workspace-materials');
    expect(request).toHaveBeenNthCalledWith(3, '/workspaces/workspace-materials/items?kind=GUIDE');
    expect(request).toHaveBeenNthCalledWith(4, '/workspaces/workspace-materials/activity');
  });

  it('exposes downstream personal names and unwraps mutation items', async () => {
    const client = new ApiClient();
    const item = {
      id: 'item-guide', workspaceId: workspace.id, workspaceName: workspace.name,
      kind: 'GUIDE' as const, entityId: 'guide-1', title: '物料指南', summary: '',
      updatedAt: workspace.updatedAt, favorite: true, permission: 'EDIT' as const,
    };
    const request = vi.spyOn(client, 'request').mockImplementation(async (path) => (
      path.startsWith('/me/') && !path.includes(item.id) ? { items: [item] } : { item }
    ) as never);

    const api = client.personalApi();

    await expect(api.listFavorites()).resolves.toEqual([item]);
    await expect(api.listRecent()).resolves.toEqual([item]);
    await expect(api.listShared()).resolves.toEqual([item]);
    await expect(api.listTrash()).resolves.toEqual([item]);
    await expect(api.favorite(item.id)).resolves.toEqual(item);
    await expect(api.unfavorite(item.id)).resolves.toEqual(item);
    await expect(api.recordRecent(item.id, { source: 'library' })).resolves.toEqual(item);
    await expect(api.trashItem(item.id)).resolves.toEqual(item);
    await expect(api.restoreItem(item.id)).resolves.toEqual(item);
    await expect(api.permanentlyRemoveItem(item.id)).resolves.toBeUndefined();
    expect(request).toHaveBeenNthCalledWith(1, '/me/favorites');
    expect(request).toHaveBeenNthCalledWith(5, '/me/favorites/item-guide', { method: 'PUT' });
    expect(request).toHaveBeenNthCalledWith(7, '/me/recent/item-guide', {
      method: 'PUT', body: JSON.stringify({ context: { source: 'library' } }),
    });
    expect(request).toHaveBeenNthCalledWith(10, '/workspace-items/item-guide', { method: 'DELETE' });
  });
});

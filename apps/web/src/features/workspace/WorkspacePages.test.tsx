import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../auth/types';
import { AppearanceProvider } from '../theme/AppearanceToggle';
import { ReservedModulePage } from './ReservedModulePage';
import { WorkspaceDirectoryPage } from './WorkspaceDirectoryPage';
import { WorkspaceOverviewPage } from './WorkspaceOverviewPage';
import { WorkspaceShell } from './WorkspaceShell';
import type { PersonalApi, WorkspaceApi, WorkspaceSummary } from './types';

const authorUser: AuthUser = {
  id: 'user-author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR',
};

const workspaceDefaults: Omit<WorkspaceSummary, 'id' | 'name'> = {
  slug: 'materials',
  description: '维护物料主数据、供应商和采购流程。',
  iconKey: 'FileText',
  colorKey: 'materials',
  ownerId: authorUser.id,
  ownerName: authorUser.displayName,
  permission: 'OWNER',
  guideCount: 3,
  updatedAt: '2026-07-13T00:00:00.000Z',
};

function createEmptyPersonalApi(): PersonalApi {
  return {
    listFavorites: vi.fn().mockResolvedValue([]),
    listRecent: vi.fn().mockResolvedValue([]),
    listShared: vi.fn().mockResolvedValue([]),
    listTrash: vi.fn().mockResolvedValue([]),
    favorite: vi.fn(), unfavorite: vi.fn(), recordRecent: vi.fn(),
    trashItem: vi.fn(), restoreItem: vi.fn(), permanentlyRemoveItem: vi.fn(),
  };
}

function renderWorkspaceRoutes(input: { initialPath: string; workspaces: WorkspaceSummary[] }) {
  const workspaceApi: WorkspaceApi = {
    list: vi.fn().mockResolvedValue(input.workspaces),
    get: vi.fn(async (id) => ({
      workspace: input.workspaces.find((item) => item.id === id)!,
      counts: { GUIDE: 3, SOURCE: 0, AGENT: 0, ONTOLOGY: 0, CONVERSATION: 0, ARTIFACT: 0 },
    })),
    listItems: vi.fn().mockResolvedValue([]),
    activity: vi.fn().mockResolvedValue([]),
  };
  const personalApi = createEmptyPersonalApi();
  render(
    <AppearanceProvider>
      <MemoryRouter initialEntries={[input.initialPath]}>
        <Routes>
          <Route element={<WorkspaceShell user={authorUser} workspaceApi={workspaceApi} personalApi={personalApi} onLogout={vi.fn()} />}>
            <Route path="/library" element={<h1>指南库</h1>} />
            <Route path="/workspaces" element={<WorkspaceDirectoryPage workspaceApi={workspaceApi} />} />
            <Route path="/workspaces/:workspaceId" element={<WorkspaceOverviewPage workspaceApi={workspaceApi} />} />
            <Route path="/workspaces/:workspaceId/:module" element={<ReservedModulePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppearanceProvider>,
  );
}

describe('workspace pages', () => {
  it('activates real sidebar routes and opens a workspace overview', async () => {
    const user = userEvent.setup();
    renderWorkspaceRoutes({
      initialPath: '/library',
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    await user.click(await screen.findByRole('link', { name: '物料管理' }));

    expect(await screen.findByRole('heading', { name: '物料管理' })).toBeVisible();
    expect(screen.getByText('工作区概览')).toBeVisible();
  });

  it('renders the workspace directory from API data', async () => {
    renderWorkspaceRoutes({
      initialPath: '/workspaces',
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('heading', { name: '工作区' })).toBeVisible();
    expect(screen.getByText('维护物料主数据、供应商和采购流程。')).toBeVisible();
    expect(screen.getByText('3 条指南')).toBeVisible();
  });

  it('shows honest empty states for reserved modules', async () => {
    renderWorkspaceRoutes({
      initialPath: '/workspaces/workspace-materials/agents',
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('heading', { name: 'Agent' })).toBeVisible();
    expect(screen.getByText('尚未配置 Agent Runtime')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

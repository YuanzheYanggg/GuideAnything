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
import type { PersonalApi, WorkspaceApi, WorkspaceItemSummary, WorkspaceSummary } from './types';

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

function renderWorkspaceRoutes(input: {
  initialPath: string;
  workspaces: WorkspaceSummary[];
  items?: WorkspaceItemSummary[];
  user?: AuthUser;
  create?: WorkspaceApi['create'];
}) {
  const workspaceApi: WorkspaceApi = {
    list: vi.fn().mockResolvedValue(input.workspaces),
    create: input.create ?? vi.fn().mockResolvedValue(input.workspaces[0]),
    get: vi.fn(async (id) => ({
      workspace: input.workspaces.find((item) => item.id === id)!,
      counts: { GUIDE: 3, SOURCE: 0, AGENT: 0, ONTOLOGY: 0, CONVERSATION: 0, ARTIFACT: 0 },
    })),
    listItems: vi.fn().mockResolvedValue(input.items ?? []),
    activity: vi.fn().mockResolvedValue([]),
  };
  const personalApi = createEmptyPersonalApi();
  render(
    <AppearanceProvider>
      <MemoryRouter initialEntries={[input.initialPath]}>
        <Routes>
          <Route element={<WorkspaceShell user={input.user ?? authorUser} workspaceApi={workspaceApi} personalApi={personalApi} onLogout={vi.fn()} />}>
            <Route path="/library" element={<h1>指南库</h1>} />
            <Route path="/workspaces" element={<WorkspaceDirectoryPage />} />
            <Route path="/workspaces/:workspaceId" element={<WorkspaceOverviewPage workspaceApi={workspaceApi} />} />
            <Route path="/workspaces/:workspaceId/:module" element={<ReservedModulePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppearanceProvider>,
  );
  return { workspaceApi };
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
    const { workspaceApi } = renderWorkspaceRoutes({
      initialPath: '/workspaces',
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('heading', { name: '工作区' })).toBeVisible();
    expect(screen.getByText('维护物料主数据、供应商和采购流程。')).toBeVisible();
    expect(screen.getByText('3 条指南')).toBeVisible();
    expect(workspaceApi.list).toHaveBeenCalledTimes(1);
  });

  it('shows the workspace creation entry to authors', async () => {
    renderWorkspaceRoutes({
      initialPath: '/workspaces',
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('button', { name: '新建工作区' })).toBeVisible();
  });

  it.each(['EDITOR', 'LEARNER'] as const)('hides workspace creation entry from %s users', async (role) => {
    renderWorkspaceRoutes({
      initialPath: '/workspaces',
      user: { ...authorUser, id: role.toLowerCase(), role },
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('heading', { name: '工作区' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '新建工作区' })).not.toBeInTheDocument();
  });

  it('submits workspace details and opens the created workspace', async () => {
    const user = userEvent.setup();
    const create = vi.fn().mockResolvedValue({ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' });
    const { workspaceApi } = renderWorkspaceRoutes({
      initialPath: '/workspaces',
      create,
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    await user.click(await screen.findByRole('button', { name: '新建工作区' }));
    await user.type(screen.getByLabelText('名称'), '采购管理');
    await user.type(screen.getByLabelText('Slug'), 'procurement');
    await user.type(screen.getByLabelText('描述'), '采购与供应商知识');
    await user.selectOptions(screen.getByLabelText('图标'), 'FileText');
    await user.selectOptions(screen.getByLabelText('颜色'), 'materials');
    await user.click(screen.getByRole('button', { name: '创建工作区' }));

    expect(workspaceApi.create).toHaveBeenCalledWith({
      name: '采购管理',
      slug: 'procurement',
      description: '采购与供应商知识',
      iconKey: 'FileText',
      colorKey: 'materials',
    });
    expect(await screen.findByRole('heading', { name: '物料管理' })).toBeVisible();
  });

  it('keeps the form open and shows a create error when the API rejects', async () => {
    const user = userEvent.setup();
    const create = vi.fn().mockRejectedValue(new Error('Slug 已被占用'));
    renderWorkspaceRoutes({
      initialPath: '/workspaces',
      create,
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    await user.click(await screen.findByRole('button', { name: '新建工作区' }));
    await user.type(screen.getByLabelText('名称'), '采购管理');
    await user.type(screen.getByLabelText('Slug'), 'procurement');
    await user.click(screen.getByRole('button', { name: '创建工作区' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Slug 已被占用');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('uses one main landmark and hides settings without a real route', async () => {
    renderWorkspaceRoutes({ initialPath: '/library', workspaces: [] });

    expect(await screen.findByRole('heading', { name: '指南库' })).toBeVisible();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: '设置' })).not.toBeInTheDocument();
  });

  it.each(['OWNER', 'EDIT'] as const)('offers %s users a workspace-scoped create action', async (permission) => {
    renderWorkspaceRoutes({
      initialPath: '/workspaces/workspace-materials',
      workspaces: [{ ...workspaceDefaults, permission, id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('link', { name: '新建指南' })).toHaveAttribute(
      'href', '/workspaces/workspace-materials/guides?create=1',
    );
    expect(screen.queryByRole('link', { name: 'Ontology' })).not.toBeInTheDocument();
  });

  it('does not offer VIEW users a create action', async () => {
    renderWorkspaceRoutes({
      initialPath: '/workspaces/workspace-materials',
      workspaces: [{ ...workspaceDefaults, permission: 'VIEW', id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('heading', { name: '物料管理' })).toBeVisible();
    expect(screen.queryByRole('link', { name: '新建指南' })).not.toBeInTheDocument();
  });

  it('does not offer a workspace-owner create action to learners', async () => {
    renderWorkspaceRoutes({
      initialPath: '/workspaces/workspace-materials',
      user: { ...authorUser, id: 'learner', role: 'LEARNER' },
      workspaces: [{ ...workspaceDefaults, permission: 'OWNER', id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('heading', { name: '物料管理' })).toBeVisible();
    expect(screen.queryByRole('link', { name: '新建指南' })).not.toBeInTheDocument();
  });

  it('offers an EDIT workspace create action to editors', async () => {
    renderWorkspaceRoutes({
      initialPath: '/workspaces/workspace-materials',
      user: { ...authorUser, id: 'editor', role: 'EDITOR' },
      workspaces: [{ ...workspaceDefaults, permission: 'EDIT', id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('link', { name: '新建指南' })).toHaveAttribute(
      'href', '/workspaces/workspace-materials/guides?create=1',
    );
  });

  it('links favorite guides to the route allowed by their permission', async () => {
    const items: WorkspaceItemSummary[] = [
      {
        id: 'item-owner', workspaceId: 'workspace-materials', workspaceName: '物料管理', kind: 'GUIDE',
        entityId: 'guide-owner', title: '所有者指南', summary: '', updatedAt: workspaceDefaults.updatedAt,
        favorite: true, permission: 'OWNER', canEdit: true, publishedVersionId: null,
      },
      {
        id: 'item-edit', workspaceId: 'workspace-materials', workspaceName: '物料管理', kind: 'GUIDE',
        entityId: 'guide-edit', title: '可编辑指南', summary: '', updatedAt: workspaceDefaults.updatedAt,
        favorite: true, permission: 'EDIT', canEdit: true, publishedVersionId: null,
      },
      {
        id: 'item-view', workspaceId: 'workspace-materials', workspaceName: '物料管理', kind: 'GUIDE',
        entityId: 'guide-view', title: '可学习指南', summary: '', updatedAt: workspaceDefaults.updatedAt,
        favorite: true, permission: 'VIEW', canEdit: false, publishedVersionId: 'version-view',
      },
      {
        id: 'item-source', workspaceId: 'workspace-materials', workspaceName: '物料管理', kind: 'SOURCE',
        entityId: 'source-future', title: '未来资料源', summary: '', updatedAt: workspaceDefaults.updatedAt,
        favorite: true, permission: 'VIEW', canEdit: false,
      },
    ];
    renderWorkspaceRoutes({
      initialPath: '/workspaces/workspace-materials', items,
      workspaces: [{ ...workspaceDefaults, id: 'workspace-materials', name: '物料管理' }],
    });

    expect(await screen.findByRole('link', { name: /所有者指南/u })).toHaveAttribute('href', '/guides/guide-owner/edit');
    expect(screen.getByRole('link', { name: /可编辑指南/u })).toHaveAttribute('href', '/guides/guide-edit/edit');
    expect(screen.getByRole('link', { name: /可学习指南/u })).toHaveAttribute('href', '/versions/version-view/learn');
    expect(screen.getByText('未来资料源')).toBeVisible();
    expect(screen.queryByRole('link', { name: /未来资料源/u })).not.toBeInTheDocument();
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

  it('renders a single alert when workspace loading fails', async () => {
    const workspaceApi: WorkspaceApi = {
      list: vi.fn().mockRejectedValue(new Error('工作区载入失败')),
      create: vi.fn(), get: vi.fn(), listItems: vi.fn(), activity: vi.fn(),
    };
    render(<AppearanceProvider><MemoryRouter initialEntries={['/workspaces']}><Routes>
      <Route element={<WorkspaceShell user={authorUser} workspaceApi={workspaceApi} personalApi={createEmptyPersonalApi()} onLogout={vi.fn()} />}>
        <Route path="/workspaces" element={<WorkspaceDirectoryPage />} />
      </Route>
    </Routes></MemoryRouter></AppearanceProvider>);
    expect(await screen.findAllByRole('alert')).toHaveLength(1);
  });
});

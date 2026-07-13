import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSummary } from '../workspace/types';
import { createPersonalApiMock } from '../../test/workspace-api-mocks';

import { LibraryPage, type LibraryApi } from './LibraryPage';

const result = {
  versionId: 'version-1',
  guideId: 'guide-1',
  workspaceId: 'workspace-sales',
  workspaceItemId: 'item-guide-1',
  workspaceName: '销售与分销',
  favorite: false,
  canManageLifecycle: true,
  title: 'ERP 销售订单创建',
  summary: 'VA01 操作教学',
  tags: ['ERP', '销售订单'],
  version: 1,
  authorName: '王作者',
};

function workspace(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'workspace-default', slug: 'default', name: '默认工作区', description: '',
    iconKey: 'BookOpen', colorKey: 'blue', ownerId: 'user-author', ownerName: '王作者',
    permission: 'OWNER', guideCount: 0, updatedAt: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

function createLibraryApi(input: { workspaces: WorkspaceSummary[] }): LibraryApi {
  return {
    listEditableWorkspaces: vi.fn().mockResolvedValue(input.workspaces),
    listDrafts: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    createGuide: vi.fn().mockResolvedValue({ id: 'guide-new' }),
  };
}

describe('LibraryPage', () => {
  it('shows loading, search results, and learner actions', async () => {
    const user = userEvent.setup();
    let resolveSearch!: (items: typeof result[]) => void;
    const search = vi.fn((query: string) => query ? new Promise<typeof result[]>((resolve) => { resolveSearch = resolve; }) : Promise.resolve([result]));
    const api: LibraryApi = {
      listDrafts: vi.fn().mockResolvedValue([]),
      search,
      createGuide: vi.fn(),
      listEditableWorkspaces: vi.fn().mockResolvedValue([]),
    };
    render(
      <LibraryPage
        user={{ id: 'learner', displayName: '李学员', email: 'learner@guide.local', role: 'LEARNER' }}
        api={api}
        onEdit={vi.fn()}
        onLearn={vi.fn()}
        personalApi={createPersonalApiMock()}
      />,
    );

    expect(await screen.findByRole('heading', { name: '已发布指南' })).toBeVisible();
    await user.type(screen.getByRole('searchbox'), '销售订单');
    await user.click(screen.getByRole('button', { name: '搜索指南' }));
    expect(screen.getByText('正在检索已发布指南…')).toBeVisible();
    resolveSearch([result]);

    expect(await screen.findByText('ERP 销售订单创建')).toBeVisible();
    expect(screen.getByRole('button', { name: '学习 ERP 销售订单创建' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '新建指南' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑 ERP 销售订单创建' })).not.toBeInTheDocument();
  });

  it('lets authors create and open editable drafts and handles empty search', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const api: LibraryApi = {
      listDrafts: vi.fn().mockResolvedValue([{ ...result, id: 'guide-1', revision: 2, status: 'DRAFT' }]),
      search: vi.fn((query: string) => Promise.resolve(query ? [] : [result])),
      createGuide: vi.fn().mockResolvedValue({ id: 'guide-new' }),
      listEditableWorkspaces: vi.fn().mockResolvedValue([workspace()]),
    };
    render(
      <LibraryPage
        user={{ id: 'author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR' }}
        api={api}
        onEdit={onEdit}
        onLearn={vi.fn()}
        personalApi={createPersonalApiMock()}
      />,
    );

    expect(await screen.findByRole('heading', { name: '我的草稿与协作' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '编辑 ERP 销售订单创建' }));
    expect(onEdit).toHaveBeenCalledWith('guide-1');

    await user.type(screen.getByRole('searchbox'), '不存在');
    await user.click(screen.getByRole('button', { name: '搜索指南' }));
    expect(await screen.findByText('没有找到匹配的已发布指南')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '新建指南' }));
    expect(api.createGuide).toHaveBeenCalledWith('workspace-default');
    expect(onEdit).toHaveBeenCalledWith('guide-new');
  });

  it('selects a workspace before creating from the global library', async () => {
    const user = userEvent.setup();
    const api = createLibraryApi({
      workspaces: [
        workspace({ id: 'workspace-sales', name: '销售与分销', permission: 'EDIT' }),
        workspace({ id: 'workspace-materials', name: '物料管理', permission: 'OWNER' }),
      ],
    });
    render(<LibraryPage user={{ id: 'author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR' }} api={api} personalApi={createPersonalApiMock()} onEdit={vi.fn()} onLearn={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '新建指南' }));
    await user.click(screen.getByRole('button', { name: '在物料管理中新建' }));
    expect(api.createGuide).toHaveBeenCalledWith('workspace-materials');
  });

  it('allows an editor to create in an editable workspace', async () => {
    const user = userEvent.setup();
    const api = createLibraryApi({ workspaces: [workspace({ id: 'workspace-sales', permission: 'EDIT' })] });
    render(<LibraryPage user={{ id: 'editor', displayName: '陈编辑', email: 'editor@guide.local', role: 'EDITOR' }} api={api} personalApi={createPersonalApiMock()} onEdit={vi.fn()} onLearn={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: '新建指南' }));
    expect(api.createGuide).toHaveBeenCalledWith('workspace-sales');
  });

  it('creates directly inside the current workspace and consumes route intent once', async () => {
    const api = createLibraryApi({ workspaces: [] });
    const onCreateIntentConsumed = vi.fn();
    render(<LibraryPage user={{ id: 'author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR' }} api={api} personalApi={createPersonalApiMock()} workspaceId="workspace-sales" createRequested onCreateIntentConsumed={onCreateIntentConsumed} onEdit={vi.fn()} onLearn={vi.fn()} />);
    expect(await screen.findByText('正在创建指南…')).toBeVisible();
    expect(api.createGuide).toHaveBeenCalledWith('workspace-sales');
    expect(onCreateIntentConsumed).toHaveBeenCalledTimes(1);
  });

  it('updates favorites and removes an authorized guide after trashing it', async () => {
    const user = userEvent.setup();
    const personalApi = createPersonalApiMock();
    const api = createLibraryApi({ workspaces: [workspace({ id: 'workspace-sales', name: '销售与分销', permission: 'EDIT' })] });
    api.search = vi.fn().mockResolvedValue([result]);
    render(<LibraryPage user={{ id: 'author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR' }} api={api} personalApi={personalApi} onEdit={vi.fn()} onLearn={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '收藏 ERP 销售订单创建' }));
    expect(personalApi.favorite).toHaveBeenCalledWith('item-guide-1');
    await user.click(screen.getByRole('button', { name: '更多操作 ERP 销售订单创建' }));
    await user.click(screen.getByRole('menuitem', { name: '移到回收站' }));
    await user.click(screen.getByRole('button', { name: '确认移到回收站' }));
    expect(personalApi.trashItem).toHaveBeenCalledWith('item-guide-1');
    expect(screen.queryByText('ERP 销售订单创建')).not.toBeInTheDocument();
  });

  it('hides trash from workspace editors unless the capability allows lifecycle management', async () => {
    const api = createLibraryApi({ workspaces: [workspace({ id: 'workspace-sales', permission: 'EDIT' })] });
    api.search = vi.fn().mockResolvedValue([{ ...result, canManageLifecycle: false }]);
    render(<LibraryPage user={{ id: 'editor', displayName: '陈编辑', email: 'editor@guide.local', role: 'EDITOR' }} api={api} personalApi={createPersonalApiMock()} onEdit={vi.fn()} onLearn={vi.fn()} />);
    await screen.findByText(result.title);
    expect(screen.queryByRole('button', { name: `更多操作 ${result.title}` })).not.toBeInTheDocument();
  });

  it('uses draft favorite state and toggles it in both directions', async () => {
    const user = userEvent.setup();
    const personalApi = createPersonalApiMock();
    const api = createLibraryApi({ workspaces: [workspace({ id: 'workspace-sales' })] });
    api.listDrafts = vi.fn().mockResolvedValue([{ ...result, id: 'guide-1', status: 'DRAFT', revision: 1, updatedAt: '2026-07-13T00:00:00.000Z', favorite: true, canManageLifecycle: true }]);
    render(<LibraryPage user={{ id: 'author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR' }} api={api} personalApi={personalApi} onEdit={vi.fn()} onLearn={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: `取消收藏 ${result.title}` }));
    expect(personalApi.unfavorite).toHaveBeenCalledWith(result.workspaceItemId);
    await user.click(await screen.findByRole('button', { name: `收藏 ${result.title}` }));
    expect(personalApi.favorite).toHaveBeenCalledWith(result.workspaceItemId);
  });

  it('ignores an older overlapping search response and its finally state', async () => {
    const user = userEvent.setup();
    let resolveOld!: (items: typeof result[]) => void;
    let resolveNew!: (items: typeof result[]) => void;
    const api = createLibraryApi({ workspaces: [] });
    api.search = vi.fn((query: string) => {
      if (!query) return Promise.resolve([]);
      return new Promise<typeof result[]>((resolve) => { if (query === '旧') resolveOld = resolve; else resolveNew = resolve; });
    });
    render(<LibraryPage user={{ id: 'learner', displayName: '李学员', email: 'learner@guide.local', role: 'LEARNER' }} api={api} personalApi={createPersonalApiMock()} onEdit={vi.fn()} onLearn={vi.fn()} />);
    const searchbox = screen.getByRole('searchbox');
    await user.type(searchbox, '旧');
    await user.click(screen.getByRole('button', { name: '搜索指南' }));
    await user.clear(searchbox);
    await user.type(searchbox, '新');
    await user.click(screen.getByRole('button', { name: '搜索指南' }));
    resolveNew([{ ...result, title: '新结果' }]);
    expect(await screen.findByText('新结果')).toBeVisible();
    resolveOld([{ ...result, title: '旧结果' }]);
    await Promise.resolve();
    expect(screen.queryByText('旧结果')).not.toBeInTheDocument();
    expect(screen.queryByText('正在检索已发布指南…')).not.toBeInTheDocument();
  });

  it('traps picker focus, restores the trigger, and locks while creation is pending', async () => {
    const user = userEvent.setup();
    let resolveCreate!: (guide: { id: string }) => void;
    const api = createLibraryApi({ workspaces: [workspace({ id: 'w1', name: '甲' }), workspace({ id: 'w2', name: '乙' })] });
    api.createGuide = vi.fn(() => new Promise<{ id: string }>((resolve) => { resolveCreate = resolve; }));
    render(<LibraryPage user={{ id: 'author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR' }} api={api} personalApi={createPersonalApiMock()} onEdit={vi.fn()} onLearn={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '新建指南' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '选择创建位置' });
    const first = within(dialog).getByRole('button', { name: '在甲中新建' });
    const cancel = within(dialog).getByRole('button', { name: '取消' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '在甲中新建' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByText('正在创建指南…')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeVisible();
    resolveCreate({ id: 'guide-new' });
  });

  it('keeps workspace load failures distinct and retries from the real error', async () => {
    const user = userEvent.setup();
    const api = createLibraryApi({ workspaces: [] });
    api.listEditableWorkspaces = vi.fn().mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValueOnce([workspace()]);
    render(<LibraryPage user={{ id: 'author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR' }} api={api} personalApi={createPersonalApiMock()} onEdit={vi.fn()} onLearn={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('网络不可用');
    expect(screen.queryByText('没有可创建指南的工作区')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试载入工作区' }));
    await waitFor(() => expect(api.listEditableWorkspaces).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('网络不可用')).not.toBeInTheDocument();
  });
});

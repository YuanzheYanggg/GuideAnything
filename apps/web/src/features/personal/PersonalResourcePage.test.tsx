import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PersonalApi, WorkspaceItemSummary } from '../workspace/types';
import { PersonalResourcePage } from './PersonalResourcePage';

function guideResource(overrides: Partial<WorkspaceItemSummary> = {}): WorkspaceItemSummary {
  return {
    id: 'item-guide',
    workspaceId: 'workspace-materials',
    workspaceName: '物料管理',
    kind: 'GUIDE',
    entityId: 'guide-1',
    title: '测试指南',
    summary: '',
    updatedAt: '2026-07-13T00:00:00.000Z',
    favorite: false,
    permission: 'EDIT',
    publishedVersionId: 'version-1',
    ...overrides,
  };
}

function createPersonalApi(input: {
  favorites?: WorkspaceItemSummary[];
  recent?: WorkspaceItemSummary[];
  shared?: WorkspaceItemSummary[];
  trash?: WorkspaceItemSummary[];
}): PersonalApi {
  return {
    listFavorites: vi.fn().mockResolvedValue(input.favorites ?? []),
    listRecent: vi.fn().mockResolvedValue(input.recent ?? []),
    listShared: vi.fn().mockResolvedValue(input.shared ?? []),
    listTrash: vi.fn().mockResolvedValue(input.trash ?? []),
    favorite: vi.fn().mockImplementation(async (id: string) => guideResource({ id, favorite: true })),
    unfavorite: vi.fn().mockImplementation(async (id: string) => guideResource({ id, favorite: false })),
    recordRecent: vi.fn().mockImplementation(async (id: string) => guideResource({ id })),
    trashItem: vi.fn().mockImplementation(async (id: string) => guideResource({ id })),
    restoreItem: vi.fn().mockImplementation(async (id: string) => guideResource({ id })),
    permanentlyRemoveItem: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PersonalResourcePage', () => {
  it('loads favorites and removes one without a reload', async () => {
    const user = userEvent.setup();
    const api = createPersonalApi({
      favorites: [guideResource({ id: 'item-1', title: '物料主数据检查', favorite: true })],
    });
    render(<PersonalResourcePage kind="favorites" api={api} onOpen={vi.fn()} />);

    expect(await screen.findByText('物料主数据检查')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '取消收藏 物料主数据检查' }));

    expect(api.unfavorite).toHaveBeenCalledWith('item-1');
    expect(screen.queryByText('物料主数据检查')).not.toBeInTheDocument();
  });

  it('restores an item from trash', async () => {
    const user = userEvent.setup();
    const api = createPersonalApi({
      trash: [guideResource({ id: 'item-2', title: '销售订单草稿', deletedAt: '2026-07-13T00:00:00.000Z' })],
    });
    render(<PersonalResourcePage kind="trash" api={api} onOpen={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '恢复 销售订单草稿' }));

    expect(api.restoreItem).toHaveBeenCalledWith('item-2');
    expect(screen.queryByText('销售订单草稿')).not.toBeInTheDocument();
  });

  it('keeps a failed mutation visible and reports the server message', async () => {
    const user = userEvent.setup();
    const api = createPersonalApi({
      favorites: [guideResource({ id: 'item-3', title: '失败操作', favorite: true })],
    });
    vi.mocked(api.unfavorite).mockRejectedValueOnce(new Error('资源已被其他成员移除'));
    render(<PersonalResourcePage kind="favorites" api={api} onOpen={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '取消收藏 失败操作' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('资源已被其他成员移除');
    expect(screen.getByText('失败操作')).toBeVisible();
  });

  it('confirms permanent removal with the pinned-reference snapshot warning', async () => {
    const user = userEvent.setup();
    const api = createPersonalApi({
      trash: [guideResource({ id: 'item-4', title: '待永久移除' })],
    });
    render(<PersonalResourcePage kind="trash" api={api} onOpen={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '更多操作 待永久移除' }));
    await user.click(screen.getByRole('menuitem', { name: '永久移除' }));

    expect(screen.getByRole('dialog', { name: '永久移除待永久移除？' })).toBeVisible();
    expect(screen.getByText(/已发布快照仍会保留/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认永久移除' }));
    expect(api.permanentlyRemoveItem).toHaveBeenCalledWith('item-4');
  });

  it('opens live guides but does not offer fake open behavior for future kinds', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const api = createPersonalApi({
      recent: [
        guideResource({ id: 'item-live', title: '可学习指南' }),
        guideResource({ id: 'item-future', kind: 'SOURCE', title: '未来资料源', entityId: 'source-1' }),
      ],
    });
    render(<PersonalResourcePage kind="recent" api={api} onOpen={onOpen} />);

    await user.click(await screen.findByRole('button', { name: '学习 可学习指南' }));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-live' }));
    expect(screen.getByText('未来资料源')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^(编辑|学习) 未来资料源$/u })).not.toBeInTheDocument();
  });

  it('shows a load error without also claiming the page is empty', async () => {
    const api = createPersonalApi({});
    vi.mocked(api.listShared).mockRejectedValueOnce(new Error('共享资源暂时不可用'));

    render(<PersonalResourcePage kind="shared" api={api} onOpen={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('共享资源暂时不可用');
    expect(screen.queryByText('还没有共享给你的资源')).not.toBeInTheDocument();
  });

  it('moves focus into an action menu and returns it to the trigger on Escape', async () => {
    const user = userEvent.setup();
    const api = createPersonalApi({ recent: [guideResource({ title: '键盘指南' })] });
    render(<PersonalResourcePage kind="recent" api={api} onOpen={vi.fn()} />);

    const trigger = await screen.findByRole('button', { name: '更多操作 键盘指南' });
    await user.click(trigger);

    expect(screen.getByRole('menuitem', { name: '移到回收站' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('disables a direct mutation while the request is pending', async () => {
    const user = userEvent.setup();
    let finishRestore: ((item: WorkspaceItemSummary) => void) | undefined;
    const api = createPersonalApi({ trash: [guideResource({ id: 'item-pending', title: '处理中指南' })] });
    vi.mocked(api.restoreItem).mockImplementationOnce(() => new Promise((resolve) => { finishRestore = resolve; }));
    render(<PersonalResourcePage kind="trash" api={api} onOpen={vi.fn()} />);

    const restore = await screen.findByRole('button', { name: '恢复 处理中指南' });
    await user.click(restore);

    expect(restore).toBeDisabled();
    finishRestore?.(guideResource({ id: 'item-pending' }));
    await waitFor(() => expect(screen.queryByText('处理中指南')).not.toBeInTheDocument());
  });
});

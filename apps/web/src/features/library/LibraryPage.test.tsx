import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LibraryPage, type LibraryApi } from './LibraryPage';

const result = {
  versionId: 'version-1',
  guideId: 'guide-1',
  title: 'ERP 销售订单创建',
  summary: 'VA01 操作教学',
  tags: ['ERP', '销售订单'],
  version: 1,
  authorName: '王作者',
};

describe('LibraryPage', () => {
  it('shows loading, search results, and learner actions', async () => {
    const user = userEvent.setup();
    let resolveSearch!: (items: typeof result[]) => void;
    const search = vi.fn((query: string) => query ? new Promise<typeof result[]>((resolve) => { resolveSearch = resolve; }) : Promise.resolve([result]));
    const api: LibraryApi = {
      listDrafts: vi.fn().mockResolvedValue([]),
      search,
      createGuide: vi.fn(),
    };
    render(
      <LibraryPage
        user={{ id: 'learner', displayName: '李学员', email: 'learner@guide.local', role: 'LEARNER' }}
        api={api}
        onEdit={vi.fn()}
        onLearn={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: '已发布指南' })).toBeVisible();
    await user.type(screen.getByRole('searchbox'), '销售订单');
    await user.click(screen.getByRole('button', { name: '搜索指南' }));
    expect(screen.getByText('正在检索已发布指南…')).toBeVisible();
    resolveSearch([result]);

    expect(await screen.findByText('ERP 销售订单创建')).toBeVisible();
    expect(screen.getByRole('button', { name: '开始学习 ERP 销售订单创建' })).toBeVisible();
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
    };
    render(
      <LibraryPage
        user={{ id: 'author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR' }}
        api={api}
        onEdit={onEdit}
        onLearn={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: '我的草稿与协作' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '编辑 ERP 销售订单创建' }));
    expect(onEdit).toHaveBeenCalledWith('guide-1');

    await user.type(screen.getByRole('searchbox'), '不存在');
    await user.click(screen.getByRole('button', { name: '搜索指南' }));
    expect(await screen.findByText('没有找到匹配的已发布指南')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '新建指南' }));
    expect(api.createGuide).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalledWith('guide-new');
  });
});

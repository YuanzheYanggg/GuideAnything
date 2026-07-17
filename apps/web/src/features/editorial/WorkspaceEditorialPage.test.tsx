import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceSummary } from '../workspace/types';
import { WorkspaceEditorialPage } from './WorkspaceEditorialPage';
import type { EditorialApi } from './types';

function renderEditorial(input: {
  permission: WorkspaceSummary['permission'];
  api?: EditorialApi;
}) {
  const workspace: WorkspaceSummary = {
    id: 'workspace-1', slug: 'quality', name: '质量管理', description: '', iconKey: 'FileText', colorKey: 'quality',
    ownerId: 'owner-1', ownerName: '王作者', permission: input.permission, guideCount: 2,
    updatedAt: '2026-07-17T00:00:00.000Z',
  };
  const api = input.api ?? editorialApi();
  render(<MemoryRouter initialEntries={['/workspaces/workspace-1/knowledge-evolution']}><Routes>
    <Route element={<Outlet context={{ workspaces: [workspace] }} />}>
      <Route path="/workspaces/:workspaceId/knowledge-evolution" element={<WorkspaceEditorialPage api={api} />} />
      <Route path="/workspaces/:workspaceId" element={<h1>工作区概览</h1>} />
    </Route>
  </Routes></MemoryRouter>);
  return api;
}

describe('WorkspaceEditorialPage', () => {
  it('renders the editor workbench for EDIT members without exposing raw-question controls', async () => {
    const api = renderEditorial({ permission: 'EDIT' });

    expect(await screen.findByRole('heading', { name: '知识演进' })).toBeVisible();
    expect(screen.getByRole('button', { name: '创建知识卡' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '查看原始提问' })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: '应用到草稿' }));
    expect(api.applyProposal).toHaveBeenCalledWith('workspace-1', 'proposal-1');
    expect(await screen.findByText('已应用到草稿修订 8')).toBeVisible();
  });

  it('redirects a VIEW member away from the editor-only route', async () => {
    renderEditorial({ permission: 'VIEW' });

    expect(await screen.findByRole('heading', { name: '工作区概览' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '知识演进' })).not.toBeInTheDocument();
  });

  it('shows a revision-conflict message instead of presenting a stale proposal as applied', async () => {
    const api = editorialApi();
    vi.mocked(api.applyProposal).mockRejectedValue(new Error('流程草稿已经更新，请基于最新修订重新审核提案'));
    renderEditorial({ permission: 'OWNER', api });

    await userEvent.setup().click(await screen.findByRole('button', { name: '应用到草稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('流程草稿已经更新');
  });
});

function editorialApi(): EditorialApi {
  return {
    listQuestionClusters: vi.fn().mockResolvedValue([{
      id: 'cluster-1', workspaceId: 'workspace-1', status: 'OPEN', summary: '工作区问答存在待补充的内部证据覆盖。',
      occurrenceCount: 3, ownerVisibleExampleCount: 2,
      createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z',
    }]),
    listOwnerQuestionExamples: vi.fn().mockResolvedValue([]),
    listCards: vi.fn().mockResolvedValue([]),
    createCard: vi.fn().mockResolvedValue({
      id: 'card-1', workspaceId: 'workspace-1', clusterId: 'cluster-1', kind: 'QUESTION_GAP', status: 'DRAFT',
      title: '待补充：工作区证据覆盖', summary: '工作区问答存在待补充的内部证据覆盖。', guideId: null, nodeId: null,
      createdBy: 'editor-1', createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z',
    }),
    transitionCard: vi.fn(),
    listProposals: vi.fn().mockResolvedValue([{
      id: 'proposal-1', workspaceId: 'workspace-1', cardId: null, guideId: 'guide-1', baseRevision: 7,
      status: 'ACCEPTED', summary: '补充异常复核步骤', operations: [{
        kind: 'ADD_NODE', node: {
          id: 'review', type: 'process', position: { x: 0, y: 0 }, zIndex: 0,
          data: { label: '复核异常', shape: 'process' },
        },
      }],
      evidenceIds: ['reference-1'], createdBy: 'editor-1', createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z', appliedRevision: null,
    }]),
    transitionProposal: vi.fn(),
    applyProposal: vi.fn().mockResolvedValue({
      guide: { id: 'guide-1', revision: 8 },
      proposal: { id: 'proposal-1', status: 'APPLIED', appliedRevision: 8 },
    }),
  };
}

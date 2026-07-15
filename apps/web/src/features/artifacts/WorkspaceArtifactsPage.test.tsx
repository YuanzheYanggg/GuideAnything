import type { ArtifactV1 } from '@guideanything/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ArtifactViewer } from './ArtifactViewer';
import { WorkspaceArtifactsPage } from './WorkspaceArtifactsPage';
import type { ArtifactsApi } from './types';

const report: ArtifactV1 = {
  id: 'artifact-report', runId: 'run-1', kind: 'REPORT', title: '验货节点分析', summary: '流程覆盖了主要验货动作。',
  sections: [{ title: '发现', markdown: '包含 **尺寸复核** 与异常升级。' }], createdAt: '2026-07-15T00:00:00.000Z',
};
const proposal: ArtifactV1 = {
  id: 'artifact-proposal', runId: 'run-1', kind: 'FLOW_PROPOSAL', title: '验货流程改进建议', guideId: 'guide-1',
  baseSnapshotId: 'snapshot-1', summary: '建议补充异常复核节点。',
  changes: [{ id: 'change-1', kind: 'ADD_NODE', summary: '在验货不通过后增加复核节点。' }],
  createdAt: '2026-07-15T00:00:00.000Z',
};
const referenceCollection: ArtifactV1 = {
  id: 'artifact-references', runId: 'run-1', kind: 'REFERENCE_COLLECTION', title: '验货依据',
  references: [{
    referenceId: 'reference-1', title: '验货节点', summary: '打开对应流程节点。',
    href: '/references/reference-1',
  }],
  createdAt: '2026-07-15T00:00:00.000Z',
};

describe('workspace artifacts', () => {
  it('renders sanitized reports and keeps flow proposals read-only', () => {
    const { rerender } = render(<MemoryRouter><ArtifactViewer artifact={report} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '验货节点分析' })).toBeVisible();
    expect(screen.getByText('尺寸复核')).toBeVisible();

    rerender(<MemoryRouter><ArtifactViewer artifact={proposal} /></MemoryRouter>);
    expect(screen.getByText('这是与正式指南分离的只读建议。当前页面没有“应用”或写回操作。')).toBeVisible();
    expect(screen.queryByRole('button', { name: /应用/u })).not.toBeInTheDocument();
  });

  it('preserves a safe return target when a reference collection opens evidence', () => {
    render(<MemoryRouter initialEntries={['/workspaces/workspace-1/artifacts']}>
      <ArtifactViewer artifact={referenceCollection} />
    </MemoryRouter>);

    expect(screen.getByRole('link', { name: /验货节点/u })).toHaveAttribute(
      'href', '/references/reference-1?returnTo=%2Fworkspaces%2Fworkspace-1%2Fartifacts',
    );
  });

  it('switches between private artifact and conversation views', async () => {
    const user = userEvent.setup();
    const api: ArtifactsApi = {
      listWorkspace: vi.fn().mockResolvedValue([report, proposal]),
      listWorkspaceConversations: vi.fn().mockResolvedValue([{
        id: 'conversation-1', scope: 'WORKSPACE', workspaceId: 'workspace-1', title: '验货问题', status: 'ACTIVE',
        lastMessagePreview: '检查当前流程', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
      }]),
      resolveReference: vi.fn(),
    };
    render(<MemoryRouter initialEntries={['/workspaces/workspace-1/artifacts']}><Routes>
      <Route path="/workspaces/:workspaceId/artifacts" element={<WorkspaceArtifactsPage api={api} />} />
    </Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: '会话与产物' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '验货节点分析' })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: /会话/u }));
    expect(screen.getByRole('link', { name: /验货问题/u })).toHaveAttribute('href', '/workspaces/workspace-1/agents?conversation=conversation-1');
  });
});

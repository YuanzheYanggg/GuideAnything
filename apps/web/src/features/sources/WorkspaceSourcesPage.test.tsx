import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceSourcesPage } from './WorkspaceSourcesPage';
import type { SourcesApi } from './types';

function api(canUpload = true): SourcesApi {
  return {
    list: vi.fn().mockResolvedValue({
      workspaceId: 'workspace-1', workspacePermission: canUpload ? 'EDIT' : 'VIEW',
      capabilities: { canUploadPersistentSource: canUpload },
      items: [{
        sourceId: 'source-1', documentId: 'document-1', title: '验货标准.pdf', originalName: '验货标准.pdf',
        mimeType: 'application/pdf', size: 1_024, status: 'READY', parseStatus: 'READY', revision: 'revision-1',
        createdAt: '2026-07-15T06:00:00.000Z', updatedAt: '2026-07-15T06:00:00.000Z',
      }],
    }),
    listFlowSnapshots: vi.fn().mockResolvedValue([{
      snapshotId: 'snapshot-1', sourceId: 'flow-source-1', documentId: 'flow-document-1', guideId: 'guide-1',
      guideTitle: '成衣验货流程', origin: { kind: 'PUBLISHED', versionId: 'version-1', version: 3 },
      nodeCount: 18, status: 'READY', href: '/versions/version-1/learn', createdAt: '2026-07-15T06:00:00.000Z',
    }]),
    santexwellStatus: vi.fn().mockResolvedValue({
      status: 'READY', revision: 'vault-1', indexedDocuments: 760, indexedFragments: 13_929,
      harnessRevision: 'harness-1', harnessFileCount: 4, reasonCodes: [], indexedAt: '2026-07-15T06:00:00.000Z',
    }),
    upload: vi.fn().mockResolvedValue({
      sourceId: 'source-new', documentId: 'document-new', title: '补充说明.md', originalName: '补充说明.md',
      mimeType: 'text/markdown', size: 12, status: 'READY', parseStatus: 'READY', revision: 'revision-new',
      createdAt: '2026-07-15T07:00:00.000Z', updatedAt: '2026-07-15T07:00:00.000Z',
    }),
  };
}

function renderPage(sourcesApi: SourcesApi, initialPath = '/workspaces/workspace-1/sources') {
  render(<MemoryRouter initialEntries={[initialPath]}><Routes>
    <Route path="/workspaces/:workspaceId/sources" element={<WorkspaceSourcesPage api={sourcesApi} />} />
  </Routes></MemoryRouter>);
}

describe('WorkspaceSourcesPage', () => {
  it('shows documents, compiled flow snapshots, and global vault availability', async () => {
    renderPage(api());

    expect(await screen.findByRole('heading', { name: '资料源' })).toBeVisible();
    expect(screen.getByText('验货标准.pdf')).toBeVisible();
    expect(screen.getByRole('link', { name: /成衣验货流程/u })).toHaveAttribute('href', '/versions/version-1/learn');
    expect(screen.getByText('Santexwell 可用')).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\/Users\/|wiki_v2/u);
  });

  it('uploads persistent sources only when the server capability allows it', async () => {
    const user = userEvent.setup();
    const sourcesApi = api(true);
    renderPage(sourcesApi);

    const input = await screen.findByLabelText('上传工作区资料');
    const file = new File(['# 补充说明'], '补充说明.md', { type: 'text/markdown' });
    await user.upload(input, file);

    expect(sourcesApi.upload).toHaveBeenCalledWith('workspace-1', file);
    expect(await screen.findByText('补充说明.md')).toBeVisible();
  });

  it('keeps VIEW users read-only', async () => {
    renderPage(api(false));

    expect(await screen.findByRole('heading', { name: '资料源' })).toBeVisible();
    expect(screen.queryByLabelText('上传工作区资料')).not.toBeInTheDocument();
    expect(screen.getByText('当前权限仅支持查看')).toBeVisible();
  });

  it('locates the workspace document selected by a backend-generated query', async () => {
    renderPage(api(), '/workspaces/workspace-1/sources?document=document-1&fragment=fragment-7');

    expect(await screen.findByText('已定位引用资料：验货标准.pdf')).toBeVisible();
    const row = screen.getByRole('article', { name: '资料 验货标准.pdf' });
    expect(row).toHaveClass('is-target');
    expect(row).toHaveAttribute('data-target-fragment', 'fragment-7');
    expect(row).toHaveFocus();
  });

  it('reports an unavailable document query without exposing an internal locator', async () => {
    renderPage(api(), '/workspaces/workspace-1/sources?document=missing-document&fragment=private-fragment');

    expect(await screen.findByRole('alert')).toHaveTextContent('引用资料不存在或当前不可访问');
    expect(document.body.textContent).not.toContain('private-fragment');
  });
});

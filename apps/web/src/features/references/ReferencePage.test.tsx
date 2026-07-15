import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ReferencePage, withReturnTo } from './ReferencePage';

describe('ReferencePage', () => {
  it('uses only the backend-resolved product href and preserves a safe return target', async () => {
    const resolveReference = vi.fn().mockResolvedValue({
      status: 'VALID', referenceId: 'reference-1', source: 'WORKSPACE_FLOW', title: '成衣验货流程', excerpt: '不通过时进入异常复核。',
      target: { kind: 'PUBLISHED_FLOW_NODE', href: '/versions/version-1/learn?nodeId=review' },
    });
    renderPage(resolveReference, '/references/reference-1?returnTo=%2Fworkspaces%2Fworkspace-1%2Fagents');

    expect(await screen.findByRole('heading', { name: '成衣验货流程' })).toBeVisible();
    expect(screen.getByRole('link', { name: /打开原始位置/u })).toHaveAttribute(
      'href', '/versions/version-1/learn?nodeId=review&returnTo=%2Fworkspaces%2Fworkspace-1%2Fagents',
    );
    expect(resolveReference).toHaveBeenCalledWith('reference-1');
  });

  it('shows an invalid state without fabricating a link', async () => {
    renderPage(vi.fn().mockResolvedValue({
      status: 'INVALID', referenceId: 'reference-1', title: '旧流程节点', excerpt: '原节点内容。',
      reasonCode: 'STALE', invalidReason: '对应快照已经更新，请回到会话重新检索。',
    }));

    expect(await screen.findByRole('heading', { name: '旧流程节点' })).toBeVisible();
    expect(screen.getByText('对应快照已经更新，请回到会话重新检索。')).toBeVisible();
    expect(screen.queryByRole('link', { name: /打开原始位置/u })).not.toBeInTheDocument();
    expect(withReturnTo('/library', '//evil.example')).toBe('/library?returnTo=%2Flibrary');
  });
});

function renderPage(resolveReference: (referenceId: string) => Promise<never>, path = '/references/reference-1') {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/references/:referenceId" element={<ReferencePage api={{ resolveReference }} />} />
  </Routes></MemoryRouter>);
}

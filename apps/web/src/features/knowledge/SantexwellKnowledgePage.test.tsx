import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SantexwellKnowledgePage } from './SantexwellKnowledgePage';
import type { KnowledgeApi, KnowledgeHealth } from './types';

const ready: KnowledgeHealth = {
  status: 'READY', revision: 'revision-1', indexedDocuments: 760, indexedFragments: 13_929,
  harnessRevision: 'harness-1', harnessFileCount: 4, reasonCodes: [],
  indexedAt: '2026-07-15T06:00:00.000Z',
};

function api(overrides: Partial<KnowledgeApi> = {}): KnowledgeApi {
  return {
    status: vi.fn().mockResolvedValue(ready),
    overview: vi.fn().mockResolvedValue({
      clusters: [
        { cluster: 'textile-knowledge', documentCount: 520, supportCount: 480, discoveryCount: 40 },
        { cluster: 'quality-ops', documentCount: 180, supportCount: 150, discoveryCount: 30 },
        { cluster: 'complaint-case', documentCount: 60, supportCount: 55, discoveryCount: 5 },
      ],
      mocs: [{ documentId: 'doc-moc', title: '毛衫知识地图', summary: '从术语、工艺到质量案例。', href: '/knowledge/santexwell/documents/doc-moc' }],
    }),
    search: vi.fn().mockResolvedValue([{
      sourceKind: 'SANTEXWELL', documentId: 'doc-yarn', fragmentId: 'fragment-types',
      title: '花式纱线', heading: '分类', excerpt: '可按结构、成纱方式与视觉效果分类。',
      evidenceRole: 'SUPPORT', revision: 'revision-1', indexedAt: ready.indexedAt!, rawEvidenceAvailable: true,
      href: '/knowledge/santexwell/documents/doc-yarn?fragment=fragment-types', score: 920,
    }]),
    readDocument: vi.fn().mockResolvedValue({
      sourceKind: 'SANTEXWELL', documentId: 'doc-yarn', title: '花式纱线', aliases: ['Fancy yarn'], tags: ['纱线'],
      pageType: 'concept', revision: 'revision-1', indexedAt: ready.indexedAt!, rawEvidenceAvailable: true,
      sections: [{ fragmentId: 'fragment-types', heading: '分类', content: '花式纱线可按结构与成纱方式分类。' }],
      resolvedLinks: [{ documentId: 'doc-spinning', title: '纺纱方式' }], unresolvedLinkCount: 0,
    }),
    ...overrides,
  };
}

function renderPage(knowledgeApi: KnowledgeApi, initialPath = '/knowledge/santexwell') {
  render(<MemoryRouter initialEntries={[initialPath]}><Routes>
    <Route path="/knowledge/santexwell" element={<SantexwellKnowledgePage api={knowledgeApi} />} />
    <Route path="/knowledge/santexwell/documents/:documentId" element={<SantexwellKnowledgePage api={knowledgeApi} />} />
  </Routes></MemoryRouter>);
}

describe('SantexwellKnowledgePage', () => {
  it('shows index health, knowledge clusters, and MOCs without server paths', async () => {
    renderPage(api());

    expect(await screen.findByRole('heading', { name: 'Santexwell 知识库' })).toBeVisible();
    expect(screen.getByText('760')).toBeVisible();
    expect(screen.getByRole('heading', { name: '纺织知识' })).toBeVisible();
    expect(screen.getByRole('link', { name: /毛衫知识地图/u })).toHaveAttribute('href', '/knowledge/santexwell/documents/doc-moc');
    expect(document.body.textContent).not.toMatch(/\/Users\/|wiki_v2/u);
  });

  it('searches a focused term and opens a matched fragment', async () => {
    const user = userEvent.setup();
    const knowledgeApi = api();
    renderPage(knowledgeApi);

    await user.type(await screen.findByRole('searchbox', { name: '搜索知识库' }), '花式纱');
    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(knowledgeApi.search).toHaveBeenCalledWith('花式纱');
    expect(await screen.findByText('可按结构、成纱方式与视觉效果分类。')).toBeVisible();
    await user.click(screen.getByRole('link', { name: /花式纱线/u }));
    expect(await screen.findByRole('heading', { name: '花式纱线' })).toBeVisible();
    expect(knowledgeApi.readDocument).toHaveBeenCalledWith('doc-yarn');
  });

  it('renders an honest unavailable state and does not pretend search works', async () => {
    renderPage(api({
      status: vi.fn().mockResolvedValue({ ...ready, status: 'UNAVAILABLE', revision: null, indexedDocuments: 0, indexedFragments: 0, reasonCodes: ['NOT_INDEXED'], indexedAt: null }),
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent('知识库当前不可用');
    expect(screen.getByRole('searchbox', { name: '搜索知识库' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /开始新的问答/u })).not.toBeInTheDocument();
  });

  it('does not mount the QA composer when the vault is unavailable', async () => {
    renderPage(api({
      status: vi.fn().mockResolvedValue({ ...ready, status: 'UNAVAILABLE', revision: null, indexedDocuments: 0, indexedFragments: 0, reasonCodes: ['NOT_INDEXED'], indexedAt: null }),
    }), '/knowledge/santexwell?conversation=new');

    expect(await screen.findByRole('alert')).toHaveTextContent('知识问答暂不可用');
    expect(screen.queryByRole('textbox', { name: '向 Agent 提问' })).not.toBeInTheDocument();
  });

  it('recovers in place after a search error', async () => {
    const user = userEvent.setup();
    const knowledgeApi = api({
      search: vi.fn()
        .mockRejectedValueOnce(new Error('索引暂时繁忙'))
        .mockResolvedValueOnce([{
          sourceKind: 'SANTEXWELL', documentId: 'doc-yarn', fragmentId: 'fragment-types',
          title: '花式纱线', heading: '分类', excerpt: '恢复后的可验证结果。',
          evidenceRole: 'SUPPORT', revision: 'revision-1', indexedAt: ready.indexedAt!, rawEvidenceAvailable: true,
          href: '/knowledge/santexwell/documents/doc-yarn?fragment=fragment-types', score: 920,
        }]),
    });
    renderPage(knowledgeApi);

    const searchbox = await screen.findByRole('searchbox', { name: '搜索知识库' });
    await user.type(searchbox, '第一次查询');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('索引暂时繁忙');
    expect(searchbox).toBeVisible();

    await user.clear(searchbox);
    await user.type(searchbox, '花式纱');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('恢复后的可验证结果。')).toBeVisible();
    expect(screen.queryByText('索引暂时繁忙')).not.toBeInTheDocument();
  });

  it('focuses a referenced knowledge fragment and preserves a safe return target', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderPage(api(), '/knowledge/santexwell/documents/doc-yarn?fragment=fragment-types&returnTo=%2Fknowledge%2Fsantexwell%3Fconversation%3Dconversation-1');

    expect(await screen.findByRole('heading', { name: '花式纱线' })).toBeVisible();
    const target = document.getElementById('fragment-fragment-types');
    await waitFor(() => expect(target).toHaveFocus());
    expect(target).toHaveClass('is-target-fragment');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /返回原页面/u })).toHaveAttribute(
      'href', '/knowledge/santexwell?conversation=conversation-1',
    );
  });
});

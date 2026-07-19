import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GuideDigestDialog, type GuideDigestProposal } from './GuideDigestDialog';

const proposal: GuideDigestProposal = {
  id: 'proposal-1', guideId: 'guide-1', workspaceId: 'workspace-1', baseSnapshotId: 'snapshot-1', baseRevision: 4,
  bundleRevision: 1, rendererVersion: 'guide-digest-markdown-v1', generationMetadata: {}, status: 'DRAFT',
  draft: {
    schemaVersion: 1, shortSummary: '建议的流程摘要', scope: { audiences: [], businessObjects: [], systems: [] },
    stageSections: [{ stageId: 'stage-1', title: '准备', overview: '准备订单', steps: [{ targetId: 'node-1', title: '确认订单', description: '确认客户需求', inputs: [], actions: [], outputs: [], resourceIds: ['resource-1'] }] }], keyRules: [],
    tagSuggestions: [{ label: '订单复核', category: 'PROCESS', sourceIds: ['stage-1', 'node-1', 'resource-1'] }],
    gaps: [{ code: 'MISSING_EXIT', message: '缺少明确出口', sourceIds: ['stage-1', 'node-1', 'resource-1'] }],
  },
  markdown: '# 指南总览\n\n安全内容\n\n<script>alert(1)</script>', failureCode: null, supersedesProposalId: null,
  appliedRevision: null, selectedSummary: null, acceptedTags: null, acceptedMarkdown: null,
  createdBy: 'author', createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z',
  sourceDescriptors: [
    { id: 'stage-1', kind: 'STAGE', label: '阶段：权威准备阶段' },
    { id: 'node-1', kind: 'NODE', label: '步骤：权威确认订单' },
    { id: 'resource-1', kind: 'RESOURCE', label: '图片：权威订单界面' },
  ],
};

describe('GuideDigestDialog', () => {
  it('keeps suggested tags unselected and sanitizes the read-only Markdown proposal', () => {
    render(<GuideDigestDialog
      guide={{ id: 'guide-1', revision: 4, summary: '当前摘要', tags: ['ERP'] }}
      status={{ guideRevision: 4, sourceStatus: 'READY', snapshotId: 'snapshot-1', snapshotRevision: 4, snapshotSchemaVersion: 2, failureCode: null }}
      proposal={proposal}
      onReconcile={vi.fn()}
      onGenerate={vi.fn()}
      onReject={vi.fn()}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('checkbox', { name: '采用标签 订单复核' })).not.toBeChecked();
    expect(screen.getByText('ERP')).toHaveClass('guide-digest-current-tag');
    expect(screen.getByText('订单复核')).toHaveClass('guide-digest-suggested-tag');
    expect(screen.queryByText('alert(1)')).not.toBeInTheDocument();
    expect(screen.getByText('安全内容')).toBeInTheDocument();
    expect(screen.getByText('缺少明确出口')).toBeInTheDocument();
    expect(screen.getByText('类别：流程')).toBeInTheDocument();
    expect(screen.getByText('阶段：权威准备阶段')).toBeInTheDocument();
    expect(screen.getByText('步骤：权威确认订单')).toBeInTheDocument();
    expect(screen.getByText('图片：权威订单界面')).toBeInTheDocument();
    expect(screen.queryByText('阶段：准备')).not.toBeInTheDocument();
    expect(screen.getByText(/sourceIds=stage-1,node-1,resource-1/)).toBeInTheDocument();
  });

  it('refuses an empty effective apply selection', () => {
    const onApply = vi.fn();
    render(<GuideDigestDialog
      guide={{ id: 'guide-1', revision: 4, summary: '当前摘要', tags: ['ERP'] }}
      status={{ guideRevision: 4, sourceStatus: 'READY', snapshotId: 'snapshot-1', snapshotRevision: 4, snapshotSchemaVersion: 2, failureCode: null }}
      proposal={proposal}
      onReconcile={vi.fn()}
      onGenerate={vi.fn()}
      onReject={vi.fn()}
      onApply={onApply}
      onClose={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: '接受并应用到草稿' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('至少选择一项摘要、标签或 Markdown');
  });

  it('resets selection and validation feedback when reviewing another proposal', () => {
    const { rerender } = render(<GuideDigestDialog
      guide={{ id: 'guide-1', revision: 4, summary: '当前摘要', tags: ['ERP'] }}
      status={{ guideRevision: 4, sourceStatus: 'READY', snapshotId: 'snapshot-1', snapshotRevision: 4, snapshotSchemaVersion: 2, failureCode: null }}
      proposal={proposal}
      onReconcile={vi.fn()}
      onGenerate={vi.fn()}
      onReject={vi.fn()}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: '接受并应用到草稿' }));
    expect(screen.getByRole('alert')).toHaveTextContent('至少选择一项摘要、标签或 Markdown');
    fireEvent.click(screen.getByRole('checkbox', { name: '采用标签 订单复核' }));
    expect(screen.getByRole('checkbox', { name: '采用标签 订单复核' })).toBeChecked();

    rerender(<GuideDigestDialog
      guide={{ id: 'guide-1', revision: 4, summary: '当前摘要', tags: ['ERP'] }}
      status={{ guideRevision: 4, sourceStatus: 'READY', snapshotId: 'snapshot-1', snapshotRevision: 4, snapshotSchemaVersion: 2, failureCode: null }}
      proposal={{ ...proposal, id: 'proposal-2' }}
      onReconcile={vi.fn()}
      onGenerate={vi.fn()}
      onReject={vi.fn()}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('checkbox', { name: '采用标签 订单复核' })).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves focus into the modal, keeps Tab navigation inside it, and requests close on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GuideDigestDialog
      guide={{ id: 'guide-1', revision: 4, summary: '当前摘要', tags: ['ERP'] }}
      status={{ guideRevision: 4, sourceStatus: 'READY', snapshotId: 'snapshot-1', snapshotRevision: 4, snapshotSchemaVersion: 2, failureCode: null }}
      proposal={proposal}
      onReconcile={vi.fn()}
      onGenerate={vi.fn()}
      onReject={vi.fn()}
      onApply={vi.fn()}
      onClose={onClose}
    />);

    const closeButton = screen.getByRole('button', { name: '关闭指南总览' });
    expect(closeButton).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: '接受并应用到草稿' })).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(closeButton).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape even when focus has temporarily left the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GuideDigestDialog
      guide={{ id: 'guide-1', revision: 4, summary: '当前摘要', tags: ['ERP'] }}
      status={{ guideRevision: 4, sourceStatus: 'READY', snapshotId: 'snapshot-1', snapshotRevision: 4, snapshotSchemaVersion: 2, failureCode: null }}
      proposal={proposal}
      onReconcile={vi.fn()}
      onGenerate={vi.fn()}
      onReject={vi.fn()}
      onApply={vi.fn()}
      onClose={onClose}
    />);

    document.body.tabIndex = -1;
    document.body.focus();
    expect(document.body).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    document.body.removeAttribute('tabindex');
  });
});

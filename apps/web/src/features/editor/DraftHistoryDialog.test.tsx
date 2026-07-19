import type { GuideDraftHistorySnapshot } from '@guideanything/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DraftHistoryDialog } from './DraftHistoryDialog';

const snapshots: GuideDraftHistorySnapshot[] = [
  {
    revision: 8,
    title: '打样流程',
    summary: '当前草稿',
    tags: ['打样'],
    savedAt: '2026-07-19T01:00:00.000Z',
    savedBy: { id: 'author', displayName: '王作者' },
  },
  {
    revision: 6,
    title: '打样流程',
    summary: '误删前草稿',
    tags: ['打样'],
    savedAt: '2026-07-19T00:30:00.000Z',
    savedBy: { id: 'editor', displayName: '陈编辑' },
  },
];

describe('DraftHistoryDialog', () => {
  it('marks the current revision and confirms before restoring a historical draft', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn().mockResolvedValue(undefined);
    render(<DraftHistoryDialog items={snapshots} currentRevision={8} onRestore={onRestore} onClose={vi.fn()} />);

    expect(screen.getByText('当前版本')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复 revision 8' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '恢复 revision 6' }));
    expect(screen.getByRole('dialog', { name: '确认恢复草稿' })).toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(onRestore).toHaveBeenCalledWith(6);
  });
});

import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GuideDetailsHeader, type GuideDetailsHeaderProps } from './GuideDetailsHeader';

function props(overrides: Partial<GuideDetailsHeaderProps> = {}): GuideDetailsHeaderProps {
  return {
    tags: ['ERP', '原料', '打样', '供应商'],
    disabled: false,
    summaryTriggerRef: createRef<HTMLButtonElement>(),
    digestTriggerRef: createRef<HTMLButtonElement>(),
    onTagsChange: vi.fn(),
    onOpenSummary: vi.fn(),
    onOpenDigest: vi.fn(),
    ...overrides,
  };
}

describe('GuideDetailsHeader', () => {
  it('shows a compact summary, only the first three tags, and a digest command card', () => {
    render(<GuideDetailsHeader {...props()} />);

    expect(screen.getByRole('button', { name: '查看摘要' })).toBeVisible();
    expect(screen.getByText('ERP')).toBeVisible();
    expect(screen.getByText('原料')).toBeVisible();
    expect(screen.getByText('打样')).toBeVisible();
    expect(screen.getByRole('button', { name: '更多标签，共 1 个' })).toBeVisible();
    expect(screen.queryByText('供应商')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成指南总览' })).toBeVisible();
  });

  it('expands tags and enters controlled summary and tag edit states', async () => {
    const user = userEvent.setup();
    const onTagsChange = vi.fn();
    const onOpenSummary = vi.fn();
    render(<GuideDetailsHeader {...props({ onTagsChange, onOpenSummary })} />);

    await user.click(screen.getByRole('button', { name: '更多标签，共 1 个' }));
    expect(screen.getByRole('button', { name: '收起标签' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('供应商')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '查看摘要' }));
    expect(onOpenSummary).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '编辑标签' }));
    const tags = screen.getByLabelText('标签');
    fireEvent.change(tags, { target: { value: 'ERP，新增' } });
    expect(onTagsChange).toHaveBeenLastCalledWith(['ERP', '新增']);
    await user.click(screen.getByRole('button', { name: '完成标签' }));
    expect(screen.getByRole('button', { name: '编辑标签' })).toBeVisible();
  });

  it('keeps edit and disclosure controls disabled during layout preview', () => {
    render(<GuideDetailsHeader {...props({ disabled: true })} />);

    expect(screen.getByRole('button', { name: '查看摘要' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑标签' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '更多标签，共 1 个' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '生成指南总览' })).toBeDisabled();
  });
});

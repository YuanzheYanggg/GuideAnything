import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InlineNodeEditingProvider, InlineNodeTextEditor } from './InlineNodeTextEditor';

describe('InlineNodeTextEditor', () => {
  it('commits a required single-line value with Enter', async () => {
    const user = userEvent.setup();
    const updateText = vi.fn();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText }}>
        <InlineNodeTextEditor nodeId="process-1" field="label" value="旧标题" label="节点标题" required>
          <strong>旧标题</strong>
        </InlineNodeTextEditor>
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByText('旧标题'));
    const input = screen.getByRole('textbox', { name: '节点标题' });
    await user.clear(input);
    await user.type(input, '新标题{Enter}');

    expect(updateText).toHaveBeenCalledOnce();
    expect(updateText).toHaveBeenCalledWith('process-1', 'label', '新标题');
  });

  it('cancels with Escape without committing', async () => {
    const user = userEvent.setup();
    const updateText = vi.fn();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText }}>
        <InlineNodeTextEditor nodeId="process-1" field="label" value="旧标题" label="节点标题" required>
          <strong>旧标题</strong>
        </InlineNodeTextEditor>
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByText('旧标题'));
    await user.clear(screen.getByRole('textbox', { name: '节点标题' }));
    await user.type(screen.getByRole('textbox', { name: '节点标题' }), '临时标题{Escape}');

    expect(updateText).not.toHaveBeenCalled();
    expect(screen.getByText('旧标题')).toBeVisible();
  });

  it('keeps ordinary multiline Enter and commits with Meta Enter', async () => {
    const user = userEvent.setup();
    const updateText = vi.fn();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText }}>
        <InlineNodeTextEditor nodeId="markdown-1" field="markdown" value="第一行" label="Markdown 内容" multiline>
          <p>第一行</p>
        </InlineNodeTextEditor>
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByText('第一行'));
    const textarea = screen.getByRole('textbox', { name: 'Markdown 内容' });
    await user.clear(textarea);
    await user.type(textarea, '第一行{Enter}第二行');
    expect(textarea).toHaveValue('第一行\n第二行');
    expect(updateText).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(updateText).toHaveBeenCalledWith('markdown-1', 'markdown', '第一行\n第二行');
  });

  it('keeps an empty required title open and reports the validation error', async () => {
    const user = userEvent.setup();
    const updateText = vi.fn();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText }}>
        <InlineNodeTextEditor nodeId="process-1" field="label" value="旧标题" label="节点标题" required>
          <strong>旧标题</strong>
        </InlineNodeTextEditor>
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByText('旧标题'));
    const input = screen.getByRole('textbox', { name: '节点标题' });
    await user.clear(input);
    await user.type(input, '{Enter}');

    expect(updateText).not.toHaveBeenCalled();
    expect(input).toBeVisible();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('标题不能为空');
  });

  it('stays read-only when no enabled editing provider is present', async () => {
    const user = userEvent.setup();
    render(
      <InlineNodeTextEditor nodeId="process-1" field="label" value="只读标题" label="节点标题" required>
        <strong>只读标题</strong>
      </InlineNodeTextEditor>,
    );

    await user.dblClick(screen.getByText('只读标题'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

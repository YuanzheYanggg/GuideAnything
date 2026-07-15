import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import { FlowNode } from './FlowNode';
import { ImageNode } from './ImageNode';
import { InlineNodeEditingProvider } from './InlineNodeTextEditor';
import { MarkdownNode } from './MarkdownNode';
import { SubguideNode } from './SubguideNode';
import { VideoNode } from './VideoNode';

vi.mock('./NodeChrome', async () => {
  const React = await import('react');
  return { NodeChrome: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) };
});

function props(id: string, type: string, data: Record<string, unknown>, selected = true): NodeProps {
  return { id, type, data, selected, width: 320, height: 260 } as NodeProps;
}

describe('inline node text integration', () => {
  it('opens flow titles and details for direct editing', async () => {
    const user = userEvent.setup();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText: vi.fn() }}>
        <FlowNode {...props('process-1', 'process', { label: '收到订单', description: '检查客户' })} />
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByText('收到订单'));
    expect(screen.getByRole('textbox', { name: '收到订单 · 节点标题' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.dblClick(screen.getByText('检查客户'));
    expect(screen.getByRole('textbox', { name: '收到订单 · 节点明细' })).toBeVisible();
  });

  it('opens rendered Markdown as a raw multiline editor', async () => {
    const user = userEvent.setup();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText: vi.fn() }}>
        <MarkdownNode {...props('markdown-1', 'markdown', { markdown: '## 操作说明' })} />
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByRole('heading', { name: '操作说明' }));
    expect(screen.getByRole('textbox', { name: 'Markdown 内容' })).toHaveValue('## 操作说明');
  });

  it('shows and opens an empty image-caption placeholder only while selected', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText: vi.fn() }}>
        <ImageNode {...props('image-1', 'image', { url: 'https://example.com/a.png', alt: '示意图' }, false)} />
      </InlineNodeEditingProvider>,
    );
    expect(screen.queryByText('双击添加图片说明')).not.toBeInTheDocument();

    rerender(
      <InlineNodeEditingProvider value={{ enabled: true, updateText: vi.fn() }}>
        <ImageNode {...props('image-1', 'image', { url: 'https://example.com/a.png', alt: '示意图' })} />
      </InlineNodeEditingProvider>,
    );
    await user.dblClick(screen.getByText('双击添加图片说明'));
    expect(screen.getByRole('textbox', { name: '示意图 · 图片说明' })).toBeVisible();
  });

  it('opens a video caption without changing the reusable video controls', async () => {
    const user = userEvent.setup();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText: vi.fn() }}>
        <VideoNode {...props('video-1', 'video', { url: 'https://example.com/a.mp4', caption: '操作演示', keypoints: [] })} />
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByText('操作演示'));
    expect(screen.getByRole('textbox', { name: '操作演示 · 视频说明' })).toBeVisible();
  });

  it('keeps pinned subguide titles read-only', async () => {
    const user = userEvent.setup();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText: vi.fn() }}>
        <SubguideNode {...props('subguide-1', 'subguide', { guideId: 'guide-1', guideVersionId: 'version-1', title: '固定指南', version: 1, expanded: false })} />
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByText('固定指南'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

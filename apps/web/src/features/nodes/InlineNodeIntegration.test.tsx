import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import { FlowNode } from './FlowNode';
import { ImageNode } from './ImageNode';
import { InlineNodeEditingProvider } from './InlineNodeTextEditor';
import { MarkdownNode } from './MarkdownNode';
import { NodeDetailPresentationProvider } from './NodeDetailPresentation';
import { SubguideNode } from './SubguideNode';
import { VideoNode } from './VideoNode';

const { nodeChromeProps } = vi.hoisted(() => ({ nodeChromeProps: { height: undefined as number | undefined } }));

vi.mock('./NodeChrome', async () => {
  const React = await import('react');
  return {
    NodeChrome: ({ children, height }: { children: React.ReactNode; height?: number }) => {
      nodeChromeProps.height = height;
      return React.createElement('div', null, children);
    },
  };
});

function props(id: string, type: string, data: Record<string, unknown>, selected = true): NodeProps {
  return { id, type, data, selected, width: 320, height: 260 } as NodeProps;
}

describe('inline node text integration', () => {
  it('does not feed React Flow measured height back into flow-node content', () => {
    nodeChromeProps.height = undefined;
    render(
      <NodeDetailPresentationProvider value={{ expandedNodeIds: new Set(), onOpenEditor: vi.fn(), onToggleExpanded: vi.fn() }}>
        <FlowNode {...props('process-1', 'process', { label: '收到订单' }, false)} />
      </NodeDetailPresentationProvider>,
    );

    expect(nodeChromeProps.height).toBeUndefined();
  });

  it('keeps flow titles inline while requesting a dialog for details', async () => {
    const user = userEvent.setup();
    const onOpenEditor = vi.fn();
    const onToggleExpanded = vi.fn();
    render(
      <InlineNodeEditingProvider value={{ enabled: true, updateText: vi.fn() }}>
        <NodeDetailPresentationProvider value={{ expandedNodeIds: new Set(), onOpenEditor, onToggleExpanded }}>
          <FlowNode {...props('process-1', 'process', { label: '收到订单', description: '检查客户' })} />
        </NodeDetailPresentationProvider>
      </InlineNodeEditingProvider>,
    );

    await user.dblClick(screen.getByText('收到订单'));
    expect(screen.getByRole('textbox', { name: '收到订单 · 节点标题' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.dblClick(screen.getByRole('button', { name: '编辑收到订单 · 节点明细' }));
    expect(onOpenEditor).toHaveBeenCalledWith('process-1', expect.any(HTMLButtonElement));
    const detailToggle = screen.getByRole('button', { name: '详情' });
    expect(detailToggle).toHaveClass('flow-detail-toggle-compact');
    await user.click(detailToggle);
    expect(onToggleExpanded).toHaveBeenCalledWith('process-1');
  });

  it('opens flow details from a direct click when the canvas consumes a double-click gesture', async () => {
    const user = userEvent.setup();
    const onOpenEditor = vi.fn();
    render(
      <NodeDetailPresentationProvider value={{ expandedNodeIds: new Set(), onOpenEditor, onToggleExpanded: vi.fn() }}>
        <FlowNode {...props('process-1', 'process', { label: '收到订单', description: '检查客户' })} />
      </NodeDetailPresentationProvider>,
    );

    await user.click(screen.getByRole('button', { name: '编辑收到订单 · 节点明细' }));
    expect(onOpenEditor).toHaveBeenCalledWith('process-1', expect.any(HTMLButtonElement));
  });

  it('renders flow details as static content when the surrounding canvas is read-only', () => {
    render(
      <NodeDetailPresentationProvider value={{ enabled: false, expandedNodeIds: new Set(), onOpenEditor: vi.fn(), onToggleExpanded: vi.fn() }}>
        <FlowNode {...props('process-1', 'process', { label: '收到订单', description: '检查客户' })} />
      </NodeDetailPresentationProvider>,
    );

    expect(screen.queryByRole('button', { name: '编辑收到订单 · 节点明细' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '详情' })).not.toBeInTheDocument();
    expect(screen.getByText('检查客户')).toBeVisible();
  });

  it('uses the local presentation state when a controlled React Flow node still carries an old expanded flag', () => {
    render(
      <NodeDetailPresentationProvider value={{ expandedNodeIds: new Set(), onOpenEditor: vi.fn(), onToggleExpanded: vi.fn() }}>
        <FlowNode {...props('process-1', 'process', { label: '收到订单', description: '第一行\n第二行', detailExpanded: true })} />
      </NodeDetailPresentationProvider>,
    );

    expect(screen.getByRole('button', { name: '详情' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '收起' })).not.toBeInTheDocument();
  });

  it('does not repeat the swimlane inside a flow node', () => {
    render(
      <NodeDetailPresentationProvider value={{ expandedNodeIds: new Set(), onOpenEditor: vi.fn(), onToggleExpanded: vi.fn() }}>
        <FlowNode {...props('process-1', 'process', {
          label: '确认原料',
          description: '核对供应商与交期',
          shape: 'process',
          responsibility: { title: '供应商、原辅料采购与质量确认协调职责', kind: 'ROLE' },
        })} />
      </NodeDetailPresentationProvider>,
    );

    expect(screen.queryByText('泳道', { selector: '.node-responsibility-label' })).not.toBeInTheDocument();
    expect(screen.queryByText('供应商、原辅料采购与质量确认协调职责')).not.toBeInTheDocument();
    expect(screen.getByText('确认原料').closest('.flow-node-header')).toBeInTheDocument();
    expect(screen.getByTestId('flow-description-process-1').closest('.flow-node-content')).toBeInTheDocument();
  });

  it('renders expanded flow details as sanitized Markdown', () => {
    render(
      <NodeDetailPresentationProvider value={{ expandedNodeIds: new Set(['process-1']), onOpenEditor: vi.fn(), onToggleExpanded: vi.fn() }}>
        <FlowNode {...props('process-1', 'process', { label: '收到订单', description: '# 检查客户\n\n- 核对售达方' })} />
      </NodeDetailPresentationProvider>,
    );

    expect(screen.getByRole('heading', { name: '检查客户' })).toBeVisible();
    expect(screen.getByText('核对售达方')).toBeVisible();
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

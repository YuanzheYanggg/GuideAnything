import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NodeActionProvider, NodeAnchorPresentationProvider, NodeChrome, nodeChromeStyle, nodeHandleConfig } from './NodeChrome';

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, className, style, 'aria-label': label, 'aria-hidden': hidden }: { id?: string; className?: string; style?: React.CSSProperties; 'aria-label'?: string; 'aria-hidden'?: boolean | 'true' | 'false' }) => <span data-handle-id={id} className={className} style={style} aria-label={label} aria-hidden={hidden} />,
  NodeResizer: ({ isVisible }: { isVisible?: boolean }) => <span data-testid="node-resizer" data-visible={String(isVisible)} />,
  Position: { Left: 'left', Right: 'right', Bottom: 'bottom' },
}));

describe('nodeChromeStyle', () => {
  it('fills a React Flow node that has explicit resized dimensions', () => {
    expect(nodeChromeStyle(1060, 748)).toEqual({ width: '100%', height: '100%' });
  });

  it('leaves an unmeasured node at its default CSS dimensions', () => {
    expect(nodeChromeStyle(undefined, undefined)).toEqual({});
  });

  it('keeps the saved width but releases temporary expanded detail height', () => {
    expect(nodeChromeStyle(240, 104, true)).toEqual({ width: '100%' });
  });
});

describe('nodeHandleConfig', () => {
  it('exposes branch-specific ports only on decision nodes', () => {
    expect(nodeHandleConfig('decision').map((handle) => handle.id)).toEqual(['yes', 'no']);
    expect(nodeHandleConfig('image').map((handle) => handle.id)).toEqual(['out']);
    expect(nodeHandleConfig('process').map((handle) => handle.id)).toEqual(['out']);
  });
});

describe('NodeChrome delete action', () => {
  it('keeps the default resize chrome hidden for a selected node', () => {
    render(<NodeChrome nodeId="process-1" selected tone="process"><strong>节点</strong></NodeChrome>);

    expect(screen.getByTestId('node-resizer')).toHaveAttribute('data-visible', 'false');
  });

  it('exposes continuous source and target connection surfaces on every node edge', () => {
    render(<NodeChrome nodeId="process-1" tone="process"><strong>节点</strong></NodeChrome>);

    expect(screen.getByLabelText('起点连接面 TOP')).toBeInTheDocument();
    expect(screen.getByLabelText('起点连接面 RIGHT')).toBeInTheDocument();
    expect(screen.getByLabelText('终点连接面 BOTTOM')).toBeInTheDocument();
    expect(screen.getByLabelText('终点连接面 LEFT')).toBeInTheDocument();
  });

  it('keeps stored route handles hidden while leaving continuous surfaces exposed', () => {
    const handles = new Map([['process-1', [{
      id: 'edge:business:target', type: 'target' as const, side: 'LEFT' as const, offset: 0.4,
    }]]]);
    const { container } = render(
      <NodeAnchorPresentationProvider handlesByNodeId={handles}>
        <NodeChrome nodeId="process-1" tone="process"><strong>节点</strong></NodeChrome>
      </NodeAnchorPresentationProvider>,
    );

    const stored = container.querySelector('[data-handle-id="edge:business:target"]');
    expect(stored).toHaveAttribute('aria-hidden', 'true');
    expect(stored).not.toHaveAttribute('aria-label');
    expect(screen.getByLabelText('终点连接面 LEFT')).toBeInTheDocument();
  });

  it('keeps continuous surfaces inside the node so a reconnect endpoint remains clickable', () => {
    render(<NodeChrome nodeId="process-1" tone="process"><strong>节点</strong></NodeChrome>);

    expect(screen.getByLabelText('起点连接面 TOP')).toHaveStyle({ transform: 'translate(-50%, 100%)' });
    expect(screen.getByLabelText('起点连接面 LEFT')).toHaveStyle({ transform: 'translate(100%, -50%)' });
  });

  it('shows a top-right delete button for an active node and forwards its id', () => {
    const onDeleteNode = vi.fn();
    render(
      <NodeActionProvider onDeleteNode={onDeleteNode}>
        <NodeChrome nodeId="process-1" selected tone="process"><strong>节点</strong></NodeChrome>
      </NodeActionProvider>,
    );

    const button = screen.getByRole('button', { name: '删除节点' });
    expect(button).toHaveClass('canvas-node-delete', 'nodrag', 'nopan', 'nowheel');
    expect(button).toHaveAttribute('tabindex', '0');
    fireEvent.pointerDown(button);
    fireEvent.click(button);

    expect(onDeleteNode).toHaveBeenCalledWith('process-1');
  });

  it('keeps the delete button keyboard-inactive until the node is selected', () => {
    render(
      <NodeActionProvider onDeleteNode={vi.fn()}>
        <NodeChrome nodeId="process-1" tone="process"><strong>节点</strong></NodeChrome>
      </NodeActionProvider>,
    );

    expect(screen.getByRole('button', { name: '删除节点' })).toHaveAttribute('tabindex', '-1');
  });

  it('does not expose deletion while the editor is locked', () => {
    render(
      <NodeActionProvider enabled={false} onDeleteNode={vi.fn()}>
        <NodeChrome nodeId="process-1" selected tone="process"><strong>节点</strong></NodeChrome>
      </NodeActionProvider>,
    );

    expect(screen.queryByRole('button', { name: '删除节点' })).not.toBeInTheDocument();
  });
});

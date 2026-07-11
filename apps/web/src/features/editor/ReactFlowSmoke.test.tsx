import { ReactFlow, type Edge, type Node } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const nodes: Node[] = [];
const edges: Edge[] = [];
const noop = () => {};

describe('React Flow runtime', () => {
  it('mounts an empty controlled canvas under React 19', () => {
    render(<div style={{ width: 800, height: 600 }} aria-label="smoke-canvas"><ReactFlow nodes={nodes} edges={edges} onNodesChange={noop} onEdgesChange={noop} /></div>);
    expect(screen.getByLabelText('smoke-canvas')).toBeVisible();
  });
});

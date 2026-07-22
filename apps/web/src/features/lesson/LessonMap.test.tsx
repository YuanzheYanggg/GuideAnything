import type { CanvasDocument } from '@guideanything/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LessonMap, lessonDocumentForDisplay, toLessonFlowEdges } from './LessonMap';

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    ReactFlow: ({ children, nodes = [], nodeTypes = {} }: {
      children?: React.ReactNode;
      nodes?: Array<{ id: string; type: string; data: Record<string, unknown>; style?: { width?: number; height?: number }; selected?: boolean }>;
      nodeTypes?: Record<string, React.ComponentType<Record<string, unknown>>>;
    }) => <div data-testid="lesson-react-flow">{nodes.map((node) => {
      const NodeView = nodeTypes[node.type];
      return NodeView ? <NodeView key={node.id} {...node} width={node.style?.width} height={node.style?.height} /> : null;
    })}{children}</div>,
    Handle: ({ id, 'aria-label': label, 'data-testid': testId, style }: { id?: string; 'aria-label'?: string; 'data-testid'?: string; style?: React.CSSProperties }) => <span data-handleid={id} aria-label={label} data-testid={testId} style={style} />,
    ViewportPortal: ({ children }: { children?: React.ReactNode }) => <div data-testid="lesson-viewport-portal">{children}</div>,
    Background: () => null,
    MiniMap: () => null,
    Controls: () => null,
    BackgroundVariant: { Dots: 'dots' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  };
});

const documentWithStagesAndNoLanes: CanvasDocument = {
  schemaVersion: 1,
  stages: [{ id: 'proposal', title: '客人提案阶段', order: 0 }],
  nodes: [
    { id: 'process-1', type: 'process', stageId: 'proposal', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '确认原料', shape: 'process' } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  exitNodeIds: [],
};

const documentWithConfiguredLanes: CanvasDocument = {
  ...documentWithStagesAndNoLanes,
  lanes: [
    { id: 'sales', title: '业务', kind: 'ROLE', order: 0 },
    { id: 'craft', title: '工艺', kind: 'ROLE', order: 1 },
  ],
  nodes: [
    { ...documentWithStagesAndNoLanes.nodes[0]!, laneId: 'sales' },
    { id: 'process-2', type: 'process', stageId: 'proposal', laneId: 'craft', position: { x: 360, y: 0 }, zIndex: 1, data: { label: '工艺确认', shape: 'process' } },
  ],
};

const documentWithManualAnchors: CanvasDocument = {
  schemaVersion: 1,
  nodes: [
    { id: 'source', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '发起', shape: 'process' } },
    { id: 'target', type: 'process', position: { x: 480, y: 240 }, zIndex: 1, data: { label: '确认', shape: 'process' } },
  ],
  edges: [{
    id: 'e1', source: 'source', target: 'target',
    presentation: {
      sourceAnchor: { side: 'BOTTOM', offset: 0.25 },
      targetAnchor: { side: 'LEFT', offset: 0.6 },
    },
  }],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  exitNodeIds: [],
};

describe('LessonMap', () => {
  it('keeps hidden resources in the source document but removes them from the published map projection', () => {
    const document: CanvasDocument = {
      ...documentWithStagesAndNoLanes,
      nodes: [
        ...documentWithStagesAndNoLanes.nodes,
        { id: 'hidden-resource', type: 'markdown', visibility: 'HIDDEN', position: { x: 320, y: 0 }, zIndex: 1, data: { markdown: '不应出现在学习地图' } },
      ],
      edges: [{ id: 'hidden-edge', source: 'process-1', target: 'hidden-resource' }],
    };
    const displayDocument = lessonDocumentForDisplay(document);

    expect(document.nodes.find((node) => node.id === 'hidden-resource')).not.toHaveProperty('hidden');
    expect(displayDocument.nodes.find((node) => node.id === 'hidden-resource')).toMatchObject({ hidden: true, visibility: 'HIDDEN' });
    expect(displayDocument.edges).toEqual([]);
    expect(toLessonFlowEdges(document)).toEqual([]);
  });

  it('renders configured stages behind the read-only map without inventing a lane', () => {
    render(<LessonMap document={documentWithStagesAndNoLanes} onSelectNode={vi.fn()} />);

    expect(screen.getByText('客人提案阶段')).toBeVisible();
    expect(screen.queryByTestId('lesson-swimlane')).not.toBeInTheDocument();
    expect(screen.queryByText('未分配责任')).not.toBeInTheDocument();
  });

  it('renders only configured swimlanes when lanes exist', () => {
    const { rerender } = render(<LessonMap document={documentWithStagesAndNoLanes} onSelectNode={vi.fn()} />);
    expect(screen.queryByTestId('lesson-swimlane')).not.toBeInTheDocument();

    rerender(<LessonMap document={documentWithConfiguredLanes} onSelectNode={vi.fn()} />);
    expect(screen.getAllByTestId('lesson-swimlane')).toHaveLength(2);
    expect(screen.getByText('业务')).toBeVisible();
    expect(screen.getByText('工艺')).toBeVisible();
    expect(screen.queryByText('未分配责任')).not.toBeInTheDocument();
  });

  it('uses router-sized nodes and per-edge physical endpoint handles', () => {
    render(<LessonMap document={documentWithManualAnchors} onSelectNode={vi.fn()} />);

    expect(screen.getByTestId('lesson-node-source')).toHaveStyle({ width: '240px', height: '104px' });
    expect(screen.getByTestId('lesson-anchor-edge-e1-source')).toBeInTheDocument();
    expect(screen.getByTestId('lesson-anchor-edge-e1-target')).toBeInTheDocument();
    expect(screen.getByTestId('lesson-anchor-edge-e1-source')).toHaveStyle({ left: '25%' });
    expect(screen.getByTestId('lesson-anchor-edge-e1-target')).toHaveStyle({ top: '60%' });
  });

  it('passes a persisted smooth business edge to the shared renderer while leaving resource decoration non-selectable', () => {
    const document: CanvasDocument = {
      ...documentWithManualAnchors,
      nodes: [
        ...documentWithManualAnchors.nodes,
        { id: 'resource', type: 'markdown', position: { x: 300, y: 480 }, zIndex: 2, data: { markdown: '补充说明' } },
      ],
      edges: [
        { id: 'smooth-business', source: 'source', target: 'target', presentation: { pathStyle: 'smooth' } },
        { id: 'resource-decoration', source: 'source', target: 'resource', semantic: { kind: 'RESOURCE_REFERENCE' } },
      ],
    };
    const edges = toLessonFlowEdges(document);
    const business = edges.find((edge) => edge.id === 'smooth-business')!;
    const decoration = edges.find((edge) => edge.id === 'resource-decoration')!;

    expect(business.type).toBe('orthogonal');
    expect((business.data as { route?: { pathStyle?: string } }).route?.pathStyle).toBe('smooth');
    expect(decoration.type).toBe('smoothstep');
    expect(decoration.selectable).toBe(false);
  });
});

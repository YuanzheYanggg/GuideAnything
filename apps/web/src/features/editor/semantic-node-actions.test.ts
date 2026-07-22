import type { CanvasDocument, CanvasNode } from '@guideanything/contracts';
import { deriveSemanticFlow } from '@guideanything/canvas-core';
import { describe, expect, it } from 'vitest';

import { connectSemanticNodes, insertSemanticNode, moveSemanticOutlineNode } from './semantic-node-actions';

const process = (id: string, overrides: Partial<CanvasNode<'process'>> = {}): CanvasNode<'process'> => ({
  id,
  type: 'process',
  position: { x: 0, y: 0 },
  zIndex: 0,
  data: { label: id, shape: 'process' },
  ...overrides,
});

const decision = (id: string): CanvasNode<'decision'> => ({
  id,
  type: 'decision',
  position: { x: 0, y: 0 },
  zIndex: 0,
  data: { label: id, shape: 'decision', branchLabels: ['通过', '退回'] },
});

const markdown = (id: string): CanvasNode<'markdown'> => ({
  id,
  type: 'markdown',
  position: { x: 0, y: 0 },
  zIndex: 0,
  data: { markdown: id },
});

const document = (nodes: CanvasNode[]): CanvasDocument => ({
  schemaVersion: 1,
  stages: [{ id: 'intake', title: '需求确认', order: 0 }],
  lanes: [{ id: 'sales', title: '业务', kind: 'ROLE', order: 0 }],
  nodes,
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  exitNodeIds: [],
});

describe('semantic node actions', () => {
  it('inserts a toolbar step immediately after the selected peer and inherits its stage and lane', () => {
    const result = insertSemanticNode(document([
      process('receive', { stageId: 'intake', laneId: 'sales', outline: { order: 0, kind: 'STEP' } }),
      process('archive', { stageId: 'intake', laneId: 'sales', outline: { order: 1, kind: 'STEP' } }),
    ]), process('confirm'), { origin: 'toolbar', sourceId: 'receive', edgeId: 'receive-confirm' });
    const confirm = result.nodes.find((node) => node.id === 'confirm')!;

    expect(confirm.stageId).toBe('intake');
    expect(confirm.laneId).toBe('sales');
    expect(deriveSemanticFlow(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'receive:1', 'confirm:2', 'archive:3',
    ]);
    expect(result.edges).toContainEqual(expect.objectContaining({
      id: 'receive-confirm', source: 'receive', target: 'confirm', semantic: { kind: 'FLOW' },
    }));
  });

  it('creates an explicit child step instead of silently making it a peer', () => {
    const result = insertSemanticNode(document([
      process('receive', { stageId: 'intake', laneId: 'sales', outline: { order: 0, kind: 'STEP' } }),
    ]), process('check'), { origin: 'child', sourceId: 'receive', edgeId: 'receive-check' });

    expect(deriveSemanticFlow(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'receive:1', 'check:1.1',
    ]);
    expect(result.nodes.find((node) => node.id === 'check')?.outline).toMatchObject({ parentId: 'receive', kind: 'STEP' });
  });

  it('creates a B branch only when a connection starts from a decision', () => {
    const result = insertSemanticNode(document([
      { ...decision('qualified'), stageId: 'intake', laneId: 'sales', outline: { order: 0, kind: 'STEP' } },
    ]), process('continue'), { origin: 'connection', sourceId: 'qualified', edgeId: 'qualified-continue' });

    expect(deriveSemanticFlow(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'qualified:1', 'continue:1.B1',
    ]);
    expect(result.edges).toContainEqual(expect.objectContaining({
      id: 'qualified-continue', semantic: { kind: 'BRANCH', order: 0 }, label: '通过',
    }));
  });

  it('attaches toolbar or connection resources to one owner without creating a duplicate flow edge', () => {
    const result = insertSemanticNode(document([
      process('receive', { stageId: 'intake', laneId: 'sales', outline: { order: 0, kind: 'STEP' } }),
    ]), markdown('note'), { origin: 'toolbar', sourceId: 'receive' });

    expect(result.nodes.find((node) => node.id === 'note')?.attachment).toEqual({ ownerNodeId: 'receive', order: 0 });
    expect(deriveSemanticFlow(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'receive:1', 'note:1.R1',
    ]);
    expect(result.edges).toEqual([]);
  });

  it('moves a primary node to its adjacent semantic sibling and renumbers the global flow', () => {
    const result = moveSemanticOutlineNode(document([
      process('receive', { stageId: 'intake', laneId: 'sales', outline: { order: 0, kind: 'STEP' } }),
      process('confirm', { stageId: 'intake', laneId: 'sales', outline: { order: 1, kind: 'STEP' } }),
      process('archive', { stageId: 'intake', laneId: 'sales', outline: { order: 2, kind: 'STEP' } }),
    ]), 'archive', 'previous');

    expect(deriveSemanticFlow(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'receive:1', 'archive:2', 'confirm:3',
    ]);
    expect(result.nodes.find((node) => node.id === 'archive')?.outline?.order).toBe(1);
    expect(result.nodes.find((node) => node.id === 'confirm')?.outline?.order).toBe(2);
  });

  it('materializes outline orders when moving a legacy node ahead of its semantic sibling', () => {
    const result = moveSemanticOutlineNode(document([
      process('receive'),
      process('confirm'),
    ]), 'confirm', 'previous');

    expect(deriveSemanticFlow(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'confirm:1', 'receive:2',
    ]);
    expect(result.nodes.find((node) => node.id === 'confirm')?.outline).toEqual({ order: 0, kind: 'STEP' });
    expect(result.nodes.find((node) => node.id === 'receive')?.outline).toEqual({ order: 1, kind: 'STEP' });
  });

  it('converts an existing node connected from a decision into a numbered branch', () => {
    const result = connectSemanticNodes(document([
      { ...decision('qualified'), outline: { order: 0, kind: 'STEP' } },
      process('continue', { outline: { order: 1, kind: 'STEP' } }),
    ]), { id: 'qualified-continue', source: 'qualified', target: 'continue' });

    expect(deriveSemanticFlow(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'qualified:1', 'continue:1.B1',
    ]);
    expect(result.nodes.find((node) => node.id === 'continue')?.outline).toEqual({ parentId: 'qualified', order: 0, kind: 'BRANCH' });
    expect(result.edges).toContainEqual(expect.objectContaining({
      id: 'qualified-continue', semantic: { kind: 'BRANCH', order: 0 }, label: '通过',
    }));
  });

  it('repairs a stale deeper parent when a process receives a third ordinary flow target', () => {
    const source = document([
      process('parent', { outline: { order: 0, kind: 'STEP' } }),
      process('first', { outline: { parentId: 'parent', order: 0, kind: 'STEP' } }),
      process('second', { outline: { parentId: 'parent', order: 1, kind: 'STEP' } }),
      process('third', { outline: { parentId: 'second', order: 0, kind: 'STEP' } }),
    ]);
    const result = connectSemanticNodes({
      ...source,
      edges: [
        { id: 'parent-first', source: 'parent', target: 'first', semantic: { kind: 'FLOW' } },
        { id: 'parent-second', source: 'parent', target: 'second', semantic: { kind: 'FLOW' } },
      ],
    }, { id: 'parent-third', source: 'parent', target: 'third' });

    expect(result.nodes.find((node) => node.id === 'first')?.outline).toEqual({ parentId: 'parent', order: 0, kind: 'STEP' });
    expect(result.nodes.find((node) => node.id === 'second')?.outline).toEqual({ parentId: 'parent', order: 1, kind: 'STEP' });
    expect(result.nodes.find((node) => node.id === 'third')?.outline).toEqual({ parentId: 'parent', order: 2, kind: 'STEP' });
    expect(deriveSemanticFlow(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'parent:1', 'first:1.1', 'second:1.2', 'third:1.3',
    ]);
  });
});

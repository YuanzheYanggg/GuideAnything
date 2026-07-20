import type { CanvasDocument } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import * as canvasCore from './index';

const base = { position: { x: 0, y: 0 }, zIndex: 0, stageId: 'prepare', laneId: 'sales' };

const document = {
  schemaVersion: 1,
  stages: [{ id: 'prepare', title: '准备', order: 0 }],
  lanes: [{ id: 'sales', title: '业务', kind: 'ROLE', order: 0 }],
  nodes: [
    { ...base, id: 'one', type: 'process', outline: { order: 0, kind: 'STEP' }, data: { label: '接收需求', shape: 'process' } },
    { ...base, id: 'two', type: 'process', outline: { order: 1, kind: 'STEP' }, data: { label: '确认原料', shape: 'process' } },
    { ...base, id: 'two-child', type: 'process', outline: { parentId: 'two', order: 0, kind: 'STEP' }, data: { label: '核对供应商', shape: 'process' } },
    { ...base, id: 'decision', type: 'decision', outline: { order: 2, kind: 'STEP' }, data: { label: '原料合格？', shape: 'decision', branchLabels: ['通过', '不通过'] } },
    { ...base, id: 'pass', type: 'process', outline: { parentId: 'decision', order: 0, kind: 'BRANCH' }, data: { label: '进入打样', shape: 'process' } },
    { ...base, id: 'fail', type: 'process', outline: { parentId: 'decision', order: 1, kind: 'BRANCH' }, data: { label: '补充原料', shape: 'process' } },
    { id: 'resource', type: 'markdown', position: { x: 0, y: 160 }, zIndex: 6, attachment: { ownerNodeId: 'decision', order: 0 }, data: { markdown: '原料规格书' } },
  ],
  edges: [
    { id: 'flow-one-two', source: 'one', target: 'two', semantic: { kind: 'FLOW' } },
    { id: 'branch-pass', source: 'decision', target: 'pass', semantic: { kind: 'BRANCH', order: 0 }, label: '通过' },
    { id: 'branch-fail', source: 'decision', target: 'fail', semantic: { kind: 'BRANCH', order: 1 }, label: '不通过' },
    { id: 'resource-reference', source: 'pass', target: 'resource', semantic: { kind: 'RESOURCE_REFERENCE' } },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  entryNodeId: 'one',
  exitNodeIds: ['fail'],
} as unknown as CanvasDocument;

describe('semantic flow', () => {
  it('derives global, child, branch, and resource codes without duplicating a resource reference', () => {
    const deriveSemanticFlow = (canvasCore as Record<string, unknown>).deriveSemanticFlow as undefined | ((value: CanvasDocument) => {
      items: Array<{ nodeId: string; code: string }>;
      lessonSteps: Array<{ nodeId: string }>;
    });

    expect(deriveSemanticFlow).toBeTypeOf('function');
    const result = deriveSemanticFlow!(document);

    expect(result.items.map((item) => `${item.nodeId}:${item.code}`)).toEqual([
      'one:1',
      'two:2',
      'two-child:2.1',
      'decision:3',
      'resource:3.R1',
      'pass:3.B1',
      'fail:3.B2',
    ]);
    expect(result.lessonSteps.map((step) => step.nodeId)).toEqual([
      'one', 'two', 'two-child', 'decision', 'resource', 'pass', 'fail',
    ]);
  });

  it('renumbers from semantic sibling order rather than the stored node-array order', () => {
    const renumberSemanticFlow = (canvasCore as Record<string, unknown>).renumberSemanticFlow as undefined | ((value: CanvasDocument) => CanvasDocument);
    const reordered = {
      ...document,
      nodes: [
        document.nodes.find((node) => node.id === 'one')!,
        { ...document.nodes.find((node) => node.id === 'two')!, outline: { order: 2, kind: 'STEP' as const } },
        { ...document.nodes.find((node) => node.id === 'decision')!, outline: { order: 1, kind: 'STEP' as const } },
      ],
      edges: [],
    } as CanvasDocument;

    expect(renumberSemanticFlow).toBeTypeOf('function');
    const result = renumberSemanticFlow!(reordered);

    expect((canvasCore.deriveSemanticFlow as (value: CanvasDocument) => { items: Array<{ nodeId: string; code: string }> })(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual(['one:1', 'decision:2', 'two:3']);
  });

  it('migrates one-owner legacy resource edges into appendix attachments without retaining a duplicate edge', () => {
    const renumberSemanticFlow = (canvasCore as Record<string, unknown>).renumberSemanticFlow as undefined | ((value: CanvasDocument) => CanvasDocument);
    const legacy = {
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '确认原料', shape: 'process' } },
        { id: 'note', type: 'markdown', position: { x: 600, y: 300 }, zIndex: 1, data: { markdown: '# 原料规格书' } },
      ],
      edges: [{ id: 'legacy-attachment', source: 'step', target: 'note' }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    } as CanvasDocument;

    expect(renumberSemanticFlow).toBeTypeOf('function');
    const result = renumberSemanticFlow!(legacy);

    expect(result.nodes.find((node) => node.id === 'note')?.attachment).toEqual({ ownerNodeId: 'step', order: 0 });
    expect(result.nodes.find((node) => node.id === 'note')).not.toHaveProperty('contentParentId');
    expect(result.edges).toEqual([]);
    expect((canvasCore.deriveSemanticFlow as (value: CanvasDocument) => { items: Array<{ nodeId: string; code: string }> })(result).items.map((item) => `${item.nodeId}:${item.code}`)).toEqual(['step:1', 'note:1.R1']);
  });

  it('preserves an unowned semantic resource reference without converting it into an attachment', () => {
    const renumberSemanticFlow = (canvasCore as Record<string, unknown>).renumberSemanticFlow as undefined | ((value: CanvasDocument) => CanvasDocument);
    const referenced = {
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, outline: { order: 0, kind: 'STEP' }, data: { label: '确认原料', shape: 'process' } },
        { id: 'note', type: 'markdown', position: { x: 600, y: 300 }, zIndex: 1, data: { markdown: '# 原料规格书' } },
      ],
      edges: [{ id: 'reference', source: 'step', target: 'note', semantic: { kind: 'RESOURCE_REFERENCE' } }],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    } as CanvasDocument;

    expect(renumberSemanticFlow).toBeTypeOf('function');
    const result = renumberSemanticFlow!(referenced);

    expect(result.nodes.find((node) => node.id === 'note')?.attachment).toBeUndefined();
    expect(result.edges).toEqual([{ id: 'reference', source: 'step', target: 'note', semantic: { kind: 'RESOURCE_REFERENCE' } }]);
  });

  it('leaves ambiguous legacy resource owners unassigned instead of selecting an arbitrary edge', () => {
    const renumberSemanticFlow = (canvasCore as Record<string, unknown>).renumberSemanticFlow as undefined | ((value: CanvasDocument) => CanvasDocument);
    const ambiguous = {
      schemaVersion: 1,
      nodes: [
        { id: 'first', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '步骤一', shape: 'process' } },
        { id: 'second', type: 'process', position: { x: 320, y: 0 }, zIndex: 1, data: { label: '步骤二', shape: 'process' } },
        { id: 'note', type: 'markdown', position: { x: 600, y: 300 }, zIndex: 2, data: { markdown: '# 原料规格书' } },
      ],
      edges: [
        { id: 'first-note', source: 'first', target: 'note' },
        { id: 'second-note', source: 'second', target: 'note' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    } as CanvasDocument;

    expect(renumberSemanticFlow).toBeTypeOf('function');
    const result = renumberSemanticFlow!(ambiguous);

    expect(result.nodes.find((node) => node.id === 'note')?.attachment).toBeUndefined();
    expect(result.edges).toHaveLength(2);
  });
});

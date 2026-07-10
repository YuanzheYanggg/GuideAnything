import { describe, expect, it } from 'vitest';
import type { CanvasDocument, CanvasNode, GuideVersionSnapshot } from '@guideanything/contracts';

import { expandSubguide, setSubguideExpanded } from './subguide';

const host: CanvasDocument = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'ref-1',
      type: 'subguide',
      position: { x: 100, y: 100 },
      zIndex: 1,
      data: {
        guideId: 'guide-source',
        guideVersionId: 'version-1',
        title: '物料主数据检查',
        version: 1,
        expanded: false,
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [],
  exitNodeIds: [],
};

const snapshot: GuideVersionSnapshot = {
  id: 'version-1',
  guideId: 'guide-source',
  version: 1,
  title: '物料主数据检查',
  summary: '检查物料是否可销售',
  tags: ['ERP', '物料'],
  document: {
    schemaVersion: 1,
    nodes: [
      { id: 'source-start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
      { id: 'source-end', type: 'end', position: { x: 240, y: 0 }, zIndex: 0, data: { label: '完成', shape: 'end' } },
    ],
    edges: [{ id: 'source-edge', source: 'source-start', target: 'source-end' }],
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [{ id: 'source-step', order: 1, title: '检查', nodeId: 'source-start' }],
    entryNodeId: 'source-start',
    exitNodeIds: ['source-end'],
  },
};

describe('expandSubguide', () => {
  it('namespaces source IDs, offsets coordinates, and records origin', () => {
    const reference = host.nodes[0] as CanvasNode<'subguide'>;
    const expanded = expandSubguide(host, reference, snapshot);
    const derived = expanded.nodes.find((node) => node.id === 'ref:ref-1:source-start');

    expect(derived?.position).toEqual({ x: 420, y: 100 });
    expect(derived?.source).toEqual({
      referenceNodeId: 'ref-1',
      sourceGuideId: 'guide-source',
      sourceVersionId: 'version-1',
      sourceElementId: 'source-start',
    });
    expect(expanded.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ref:ref-1:source-edge',
        source: 'ref:ref-1:source-start',
        target: 'ref:ref-1:source-end',
      }),
      expect.objectContaining({ source: 'ref-1', target: 'ref:ref-1:source-start' }),
    ]));
    expect(expanded.steps[0]?.nodeId).toBe('ref:ref-1:source-start');
  });

  it('is idempotent and can hide and reveal only derived elements', () => {
    const reference = host.nodes[0] as CanvasNode<'subguide'>;
    const once = expandSubguide(host, reference, snapshot);
    expect(expandSubguide(once, reference, snapshot)).toEqual(once);

    const collapsed = setSubguideExpanded(once, 'ref-1', false);
    expect(collapsed.nodes.find(isDerived)?.hidden).toBe(true);
    expect(collapsed.nodes.find((node) => node.id === 'ref-1')?.hidden).not.toBe(true);

    const reopened = setSubguideExpanded(collapsed, 'ref-1', true);
    expect(reopened.nodes.find(isDerived)?.hidden).toBe(false);
  });
});

function isDerived(node: CanvasDocument['nodes'][number]): boolean {
  return node.source?.referenceNodeId === 'ref-1';
}

import type { CanvasDocument } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { applyFlowProposalOperations } from './flow-proposal';

const baseDocument: CanvasDocument = {
  schemaVersion: 1,
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
    { id: 'end', type: 'end', position: { x: 320, y: 0 }, zIndex: 1, data: { label: '结束', shape: 'end' } },
  ],
  edges: [{ id: 'start-end', source: 'start', target: 'end' }],
  viewport: { x: 0, y: 0, zoom: 1 },
  steps: [{ id: 'step-start', order: 0, title: '开始', nodeId: 'start' }],
  entryNodeId: 'start',
  exitNodeIds: ['end'],
};

describe('applyFlowProposalOperations', () => {
  it('adds an approved node without mutating the base canvas document', () => {
    const result = applyFlowProposalOperations(baseDocument, [{
      kind: 'ADD_NODE',
      node: { id: 'review', type: 'process', position: { x: 160, y: 120 }, zIndex: 2, data: { label: '复核', shape: 'process' } },
    }]);

    expect(result.nodes.map((node) => node.id)).toContain('review');
    expect(baseDocument.nodes.map((node) => node.id)).not.toContain('review');
  });

  it('rejects a remove-node operation while a remaining edge references that node', () => {
    expect(() => applyFlowProposalOperations(baseDocument, [{ kind: 'REMOVE_NODE', nodeId: 'start' }]))
      .toThrow('流程提案会留下悬空连线');
  });
});

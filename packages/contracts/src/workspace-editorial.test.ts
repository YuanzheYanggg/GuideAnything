import { describe, expect, it } from 'vitest';

import {
  FlowProposalOperationV1Schema,
  WorkspaceFlowProposalV1Schema,
  WorkspaceKnowledgeCardV1Schema,
} from './workspace-editorial';

describe('workspace editorial contracts', () => {
  it('rejects a card without a workspace and a proposal without its base draft revision', () => {
    expect(WorkspaceKnowledgeCardV1Schema.safeParse({ id: 'card-1', status: 'DRAFT' }).success).toBe(false);
    expect(WorkspaceFlowProposalV1Schema.safeParse({
      id: 'proposal-1', workspaceId: 'workspace-1', guideId: 'guide-1', status: 'DRAFT', operations: [],
    }).success).toBe(false);
  });

  it('accepts an update-node operation only when the replacement keeps the targeted node identity', () => {
    const valid = {
      kind: 'UPDATE_NODE',
      nodeId: 'review',
      node: {
        id: 'review', type: 'process', position: { x: 0, y: 0 }, zIndex: 0,
        data: { label: '复核', shape: 'process' },
      },
    };
    expect(FlowProposalOperationV1Schema.safeParse(valid).success).toBe(true);
    expect(FlowProposalOperationV1Schema.safeParse({
      ...valid,
      node: { ...valid.node, id: 'different-node' },
    }).success).toBe(false);
  });
});

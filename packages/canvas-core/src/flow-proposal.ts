import {
  CanvasDocumentSchema,
  FlowProposalOperationV1Schema,
  type CanvasDocument,
  type FlowProposalOperationV1,
} from '@guideanything/contracts';

export class FlowProposalApplicationError extends Error {
  constructor(public readonly code: 'DUPLICATE_ID' | 'MISSING_TARGET' | 'DANGLING_REFERENCE' | 'INVALID_RESULT', message: string) {
    super(message);
    this.name = 'FlowProposalApplicationError';
  }
}

export interface FlowProposalDiffV1 {
  addedNodeIds: string[];
  updatedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  updatedEdgeIds: string[];
  removedEdgeIds: string[];
}

export function applyFlowProposalOperations(
  base: CanvasDocument,
  operations: readonly FlowProposalOperationV1[],
): CanvasDocument {
  const draft = structuredClone(CanvasDocumentSchema.parse(base));
  for (const untrustedOperation of operations) {
    applyOne(draft, FlowProposalOperationV1Schema.parse(untrustedOperation));
  }
  const parsed = CanvasDocumentSchema.safeParse(draft);
  if (!parsed.success) throw new FlowProposalApplicationError('INVALID_RESULT', '流程提案无法形成有效流程图');
  return parsed.data;
}

export function describeFlowProposalOperations(
  base: CanvasDocument,
  operations: readonly FlowProposalOperationV1[],
): FlowProposalDiffV1 {
  applyFlowProposalOperations(base, operations);
  const diff: FlowProposalDiffV1 = {
    addedNodeIds: [], updatedNodeIds: [], removedNodeIds: [],
    addedEdgeIds: [], updatedEdgeIds: [], removedEdgeIds: [],
  };
  for (const operation of operations) {
    switch (operation.kind) {
      case 'ADD_NODE': diff.addedNodeIds.push(operation.node.id); break;
      case 'UPDATE_NODE': diff.updatedNodeIds.push(operation.nodeId); break;
      case 'REMOVE_NODE': diff.removedNodeIds.push(operation.nodeId); break;
      case 'ADD_EDGE': diff.addedEdgeIds.push(operation.edge.id); break;
      case 'UPDATE_EDGE': diff.updatedEdgeIds.push(operation.edgeId); break;
      case 'REMOVE_EDGE': diff.removedEdgeIds.push(operation.edgeId); break;
      case 'REPLACE_STEPS':
      case 'SET_ENTRY_EXIT':
        break;
    }
  }
  return {
    addedNodeIds: uniqueSorted(diff.addedNodeIds), updatedNodeIds: uniqueSorted(diff.updatedNodeIds), removedNodeIds: uniqueSorted(diff.removedNodeIds),
    addedEdgeIds: uniqueSorted(diff.addedEdgeIds), updatedEdgeIds: uniqueSorted(diff.updatedEdgeIds), removedEdgeIds: uniqueSorted(diff.removedEdgeIds),
  };
}

function applyOne(draft: CanvasDocument, operation: FlowProposalOperationV1): void {
  switch (operation.kind) {
    case 'ADD_NODE':
      if (draft.nodes.some((node) => node.id === operation.node.id)) throw new FlowProposalApplicationError('DUPLICATE_ID', '流程提案新增了重复节点 ID');
      draft.nodes.push(operation.node);
      return;
    case 'UPDATE_NODE': {
      const index = draft.nodes.findIndex((node) => node.id === operation.nodeId);
      if (index < 0) throw new FlowProposalApplicationError('MISSING_TARGET', '流程提案引用了不存在的节点');
      draft.nodes[index] = operation.node;
      return;
    }
    case 'REMOVE_NODE':
      assertNodeMayBeRemoved(draft, operation.nodeId);
      draft.nodes = draft.nodes.filter((node) => node.id !== operation.nodeId);
      return;
    case 'ADD_EDGE':
      if (draft.edges.some((edge) => edge.id === operation.edge.id)) throw new FlowProposalApplicationError('DUPLICATE_ID', '流程提案新增了重复连线 ID');
      draft.edges.push(operation.edge);
      return;
    case 'UPDATE_EDGE': {
      const index = draft.edges.findIndex((edge) => edge.id === operation.edgeId);
      if (index < 0) throw new FlowProposalApplicationError('MISSING_TARGET', '流程提案引用了不存在的连线');
      draft.edges[index] = operation.edge;
      return;
    }
    case 'REMOVE_EDGE': {
      const exists = draft.edges.some((edge) => edge.id === operation.edgeId);
      if (!exists) throw new FlowProposalApplicationError('MISSING_TARGET', '流程提案引用了不存在的连线');
      draft.edges = draft.edges.filter((edge) => edge.id !== operation.edgeId);
      return;
    }
    case 'REPLACE_STEPS':
      draft.steps = operation.steps;
      return;
    case 'SET_ENTRY_EXIT':
      if (operation.entryNodeId === null) delete draft.entryNodeId;
      else draft.entryNodeId = operation.entryNodeId;
      draft.exitNodeIds = operation.exitNodeIds;
  }
}

function assertNodeMayBeRemoved(draft: CanvasDocument, nodeId: string): void {
  if (!draft.nodes.some((node) => node.id === nodeId)) throw new FlowProposalApplicationError('MISSING_TARGET', '流程提案引用了不存在的节点');
  if (draft.edges.some((edge) => edge.source === nodeId || edge.target === nodeId)) {
    throw new FlowProposalApplicationError('DANGLING_REFERENCE', '流程提案会留下悬空连线');
  }
  if (draft.steps.some((step) => step.nodeId === nodeId) || draft.entryNodeId === nodeId || draft.exitNodeIds.includes(nodeId)) {
    throw new FlowProposalApplicationError('DANGLING_REFERENCE', '流程提案会留下悬空步骤或入口出口');
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

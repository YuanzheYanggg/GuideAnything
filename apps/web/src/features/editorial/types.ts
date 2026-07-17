import type {
  WorkspaceFlowProposalV1,
  WorkspaceKnowledgeCardV1,
  WorkspaceQuestionClusterV1,
} from '@guideanything/contracts';

export type {
  WorkspaceFlowProposalV1,
  WorkspaceKnowledgeCardV1,
  WorkspaceQuestionClusterV1,
};

export interface OwnerQuestionExample {
  id: string;
  messageId: string;
  content: string;
  createdAt: string;
}

export interface EditorialApi {
  listQuestionClusters: (workspaceId: string) => Promise<WorkspaceQuestionClusterV1[]>;
  listOwnerQuestionExamples: (workspaceId: string, clusterId: string) => Promise<OwnerQuestionExample[]>;
  listCards: (workspaceId: string) => Promise<WorkspaceKnowledgeCardV1[]>;
  createCard: (workspaceId: string, input: {
    clusterId: string | null;
    kind: WorkspaceKnowledgeCardV1['kind'];
    title: string;
    summary: string;
    guideId: string | null;
    nodeId: string | null;
    evidenceIds: string[];
  }) => Promise<WorkspaceKnowledgeCardV1>;
  transitionCard: (
    workspaceId: string,
    cardId: string,
    status: WorkspaceKnowledgeCardV1['status'],
  ) => Promise<WorkspaceKnowledgeCardV1>;
  listProposals: (workspaceId: string) => Promise<WorkspaceFlowProposalV1[]>;
  transitionProposal: (
    workspaceId: string,
    proposalId: string,
    status: Exclude<WorkspaceFlowProposalV1['status'], 'APPLIED' | 'STALE'>,
  ) => Promise<WorkspaceFlowProposalV1>;
  applyProposal: (workspaceId: string, proposalId: string) => Promise<{
    guide: { id: string; revision: number };
    proposal: Pick<WorkspaceFlowProposalV1, 'id' | 'status' | 'appliedRevision'>;
  }>;
}

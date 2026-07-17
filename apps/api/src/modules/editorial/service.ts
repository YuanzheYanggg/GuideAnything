import {
  type WorkspaceFlowProposalV1,
  type WorkspaceKnowledgeCardV1,
} from '@guideanything/contracts';
import { applyFlowProposalOperations } from '@guideanything/canvas-core';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import { getGuide, updateGuideInTransaction, type GuideDraft } from '../guides/repository';
import {
  FlowIndexError,
  recordFlowIndexFailure,
  syncGuideFlowSnapshot,
  type GuideFlowContext,
} from '../knowledge/flow-indexer';
import { getWorkspacePermission } from '../workspaces/repository';
import {
  createFlowProposal,
  createKnowledgeCard,
  getFlowProposal,
  listFlowProposals,
  listKnowledgeCards,
  listOwnerQuestionExamples,
  listQuestionClusters,
  loadFlowProposalForApplication,
  recordEditorialAuditEvent,
  updateFlowProposalStatus,
  updateKnowledgeCardStatus,
  type CreateFlowProposalInput,
  type CreateKnowledgeCardInput,
} from './repository';

type Actor = { id: string; role: string };

export class WorkspaceEditorialService {
  constructor(private readonly database: DatabaseSync) {}

  questionClusters(actor: Actor, workspaceId: string) {
    this.requireEditor(actor.id, workspaceId);
    return listQuestionClusters(this.database, workspaceId);
  }

  ownerQuestionExamples(actor: Actor, workspaceId: string, clusterId: string) {
    this.requireOwner(actor.id, workspaceId);
    return listOwnerQuestionExamples(this.database, workspaceId, clusterId);
  }

  cards(actor: Actor, workspaceId: string) {
    this.requireEditor(actor.id, workspaceId);
    return listKnowledgeCards(this.database, workspaceId);
  }

  createCard(actor: Actor, workspaceId: string, input: CreateKnowledgeCardInput) {
    this.requireEditor(actor.id, workspaceId);
    return this.inTransaction(() => {
      const card = createKnowledgeCard(this.database, workspaceId, actor.id, input);
      if (input.clusterId) {
        this.database.prepare(
          `UPDATE workspace_question_clusters
           SET status = 'CARD_CREATED', updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        ).run(new Date().toISOString(), input.clusterId, workspaceId);
      }
      recordEditorialAuditEvent(this.database, {
        workspaceId,
        actorId: actor.id,
        action: 'KNOWLEDGE_CARD_CREATED',
        targetKind: 'KNOWLEDGE_CARD',
        targetId: card.id,
        payload: { clusterId: card.clusterId, kind: card.kind, evidenceCount: input.evidenceIds.length },
      });
      return card;
    });
  }

  transitionCard(
    actor: Actor,
    workspaceId: string,
    cardId: string,
    status: WorkspaceKnowledgeCardV1['status'],
  ) {
    this.requireEditor(actor.id, workspaceId);
    return this.inTransaction(() => {
      const card = updateKnowledgeCardStatus(this.database, workspaceId, cardId, status);
      if (!card) throw httpError(404, 'KNOWLEDGE_CARD_NOT_FOUND', '知识卡不存在');
      recordEditorialAuditEvent(this.database, {
        workspaceId,
        actorId: actor.id,
        action: 'KNOWLEDGE_CARD_STATUS_CHANGED',
        targetKind: 'KNOWLEDGE_CARD',
        targetId: card.id,
        payload: { status: card.status },
      });
      return card;
    });
  }

  proposals(actor: Actor, workspaceId: string) {
    this.requireEditor(actor.id, workspaceId);
    return listFlowProposals(this.database, workspaceId);
  }

  createProposal(actor: Actor, workspaceId: string, input: CreateFlowProposalInput) {
    this.requireEditor(actor.id, workspaceId);
    return this.inTransaction(() => {
      const proposal = createFlowProposal(this.database, workspaceId, actor.id, input);
      recordEditorialAuditEvent(this.database, {
        workspaceId,
        actorId: actor.id,
        action: 'FLOW_PROPOSAL_CREATED',
        targetKind: 'FLOW_PROPOSAL',
        targetId: proposal.id,
        payload: { guideId: proposal.guideId, baseRevision: proposal.baseRevision, evidenceCount: proposal.evidenceIds.length },
      });
      return proposal;
    });
  }

  transitionProposal(
    actor: Actor,
    workspaceId: string,
    proposalId: string,
    status: Exclude<WorkspaceFlowProposalV1['status'], 'APPLIED' | 'STALE'>,
  ) {
    this.requireEditor(actor.id, workspaceId);
    return this.inTransaction(() => {
      const proposal = updateFlowProposalStatus(this.database, workspaceId, proposalId, status);
      if (!proposal) throw httpError(404, 'FLOW_PROPOSAL_NOT_FOUND', '流程提案不存在');
      recordEditorialAuditEvent(this.database, {
        workspaceId,
        actorId: actor.id,
        action: 'FLOW_PROPOSAL_STATUS_CHANGED',
        targetKind: 'FLOW_PROPOSAL',
        targetId: proposal.id,
        payload: { status: proposal.status },
      });
      return proposal;
    });
  }

  applyProposal(actor: Actor, workspaceId: string, proposalId: string):
    | { outcome: 'APPLIED'; guide: GuideDraft; proposal: WorkspaceFlowProposalV1 }
    | { outcome: 'STALE'; proposal: WorkspaceFlowProposalV1 } {
    this.requireEditor(actor.id, workspaceId);
    const result = this.inTransaction(() => {
      const proposal = loadFlowProposalForApplication(this.database, workspaceId, proposalId);
      if (!proposal) throw httpError(404, 'FLOW_PROPOSAL_NOT_FOUND', '流程提案不存在');
      if (proposal.status !== 'ACCEPTED') {
        throw httpError(409, 'PROPOSAL_NOT_ACCEPTED', '只有已接受的流程提案可以应用到草稿');
      }
      const guide = getGuide(this.database, proposal.guideId);
      if (!guide || guide.workspaceId !== workspaceId) {
        throw httpError(404, 'GUIDE_NOT_FOUND', '提案关联的指南不存在');
      }
      if (guide.revision !== proposal.baseRevision) {
        const stale = updateFlowProposalStatus(this.database, workspaceId, proposal.id, 'STALE');
        if (!stale) throw httpError(404, 'FLOW_PROPOSAL_NOT_FOUND', '流程提案不存在');
        recordEditorialAuditEvent(this.database, {
          workspaceId,
          actorId: actor.id,
          action: 'FLOW_PROPOSAL_MARKED_STALE',
          targetKind: 'FLOW_PROPOSAL',
          targetId: proposal.id,
          payload: { baseRevision: proposal.baseRevision, currentRevision: guide.revision },
        });
        return { outcome: 'STALE' as const, proposal: stale };
      }
      const document = applyFlowProposalOperations(guide.document, proposal.operations);
      const saved = updateGuideInTransaction(this.database, guide.id, actor.id, proposal.baseRevision, { document });
      const applied = updateFlowProposalStatus(this.database, workspaceId, proposal.id, 'APPLIED', saved.revision);
      if (!applied) throw httpError(404, 'FLOW_PROPOSAL_NOT_FOUND', '流程提案不存在');
      recordEditorialAuditEvent(this.database, {
        workspaceId,
        actorId: actor.id,
        action: 'FLOW_PROPOSAL_APPLIED',
        targetKind: 'FLOW_PROPOSAL',
        targetId: proposal.id,
        payload: { guideId: saved.id, baseRevision: proposal.baseRevision, appliedRevision: saved.revision },
      });
      return { outcome: 'APPLIED' as const, guide: saved, proposal: applied };
    });

    if (result.outcome === 'APPLIED') this.bestEffortFlowSync(result.guide);
    return result;
  }

  private requireEditor(actorId: string, workspaceId: string): 'OWNER' | 'EDIT' {
    const permission = getWorkspacePermission(this.database, workspaceId, actorId);
    if (!permission) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    if (permission === 'VIEW') {
      throw httpError(403, 'FORBIDDEN', '只有工作区所有者或编辑者可以管理知识演进');
    }
    return permission;
  }

  private requireOwner(actorId: string, workspaceId: string): void {
    const permission = getWorkspacePermission(this.database, workspaceId, actorId);
    if (!permission) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    if (permission !== 'OWNER') throw httpError(403, 'FORBIDDEN', '只有工作区所有者可以查看原始问题');
  }

  private inTransaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private bestEffortFlowSync(guide: GuideDraft): void {
    const context: GuideFlowContext = {
      workspaceId: guide.workspaceId,
      workspaceItemId: guide.workspaceItemId,
      guideId: guide.id,
      ownerId: guide.ownerId,
      title: guide.title,
      summary: guide.summary,
      tags: guide.tags,
      origin: { kind: 'DRAFT', revision: guide.revision },
      document: guide.document,
    };
    try {
      syncGuideFlowSnapshot(this.database, context);
    } catch (error) {
      try {
        recordFlowIndexFailure(this.database, context, error instanceof FlowIndexError ? error.code : 'FLOW_INDEX_FAILED');
      } catch {
        // Draft mutation and audit are authoritative; reconciliation repairs indexing failures.
      }
    }
  }
}

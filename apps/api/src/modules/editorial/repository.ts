import {
  FlowProposalOperationV1Schema,
  WorkspaceFlowProposalV1Schema,
  WorkspaceKnowledgeCardV1Schema,
  WorkspaceQuestionClusterV1Schema,
  type FlowProposalOperationV1,
  type WorkspaceFlowProposalV1,
  type WorkspaceKnowledgeCardV1,
  type WorkspaceQuestionClusterV1,
} from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface OwnerQuestionExample {
  id: string;
  messageId: string;
  content: string;
  createdAt: string;
}

export interface CreateKnowledgeCardInput {
  clusterId: string | null;
  kind: WorkspaceKnowledgeCardV1['kind'];
  title: string;
  summary: string;
  guideId: string | null;
  nodeId: string | null;
  evidenceIds: readonly string[];
}

export interface CreateFlowProposalInput {
  cardId: string | null;
  guideId: string;
  baseRevision: number;
  summary: string;
  operations: readonly FlowProposalOperationV1[];
  evidenceIds: readonly string[];
}

interface ClusterRow {
  id: string;
  workspace_id: string;
  status: WorkspaceQuestionClusterV1['status'];
  summary: string;
  occurrence_count: number;
  owner_visible_example_count: number;
  created_at: string;
  updated_at: string;
}

interface CardRow {
  id: string;
  workspace_id: string;
  cluster_id: string | null;
  kind: WorkspaceKnowledgeCardV1['kind'];
  status: WorkspaceKnowledgeCardV1['status'];
  title: string;
  summary: string;
  guide_id: string | null;
  node_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ProposalRow {
  id: string;
  workspace_id: string;
  card_id: string | null;
  guide_id: string;
  base_revision: number;
  status: WorkspaceFlowProposalV1['status'];
  summary: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  applied_revision: number | null;
}

export interface LoadedFlowProposal {
  id: string;
  workspaceId: string;
  guideId: string;
  baseRevision: number;
  status: WorkspaceFlowProposalV1['status'];
  summary: string;
  operations: FlowProposalOperationV1[];
}

export function listQuestionClusters(database: DatabaseSync, workspaceId: string): WorkspaceQuestionClusterV1[] {
  const rows = database.prepare(
    `SELECT id, workspace_id, status, summary, occurrence_count, owner_visible_example_count, created_at, updated_at
     FROM workspace_question_clusters
     WHERE workspace_id = ?
     ORDER BY updated_at DESC, id ASC`,
  ).all(workspaceId) as unknown as ClusterRow[];
  return rows.map(mapCluster);
}

export function listOwnerQuestionExamples(
  database: DatabaseSync,
  workspaceId: string,
  clusterId: string,
): OwnerQuestionExample[] {
  const rows = database.prepare(
    `SELECT example.id, example.message_id, message.content, example.created_at
     FROM workspace_question_cluster_examples AS example
     JOIN conversation_messages AS message ON message.id = example.message_id
     WHERE example.workspace_id = ? AND example.cluster_id = ?
     ORDER BY example.created_at DESC, example.id ASC`,
  ).all(workspaceId, clusterId) as Array<{
    id: string;
    message_id: string;
    content: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    messageId: row.message_id,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export function listKnowledgeCards(database: DatabaseSync, workspaceId: string): WorkspaceKnowledgeCardV1[] {
  const rows = database.prepare(
    `SELECT id, workspace_id, cluster_id, kind, status, title, summary, guide_id, node_id,
            created_by, created_at, updated_at
     FROM workspace_knowledge_cards
     WHERE workspace_id = ?
     ORDER BY updated_at DESC, id ASC`,
  ).all(workspaceId) as unknown as CardRow[];
  return rows.map(mapCard);
}

export function createKnowledgeCard(
  database: DatabaseSync,
  workspaceId: string,
  createdBy: string,
  input: CreateKnowledgeCardInput,
): WorkspaceKnowledgeCardV1 {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO workspace_knowledge_cards (
      id, workspace_id, cluster_id, kind, status, title, summary, guide_id, node_id,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    input.clusterId,
    input.kind,
    input.title,
    input.summary,
    input.guideId,
    input.nodeId,
    createdBy,
    now,
    now,
  );
  for (const referenceId of input.evidenceIds) {
    database.prepare(
      `INSERT INTO workspace_knowledge_card_evidence (card_id, reference_id, workspace_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, referenceId, workspaceId, now);
  }
  return getKnowledgeCard(database, workspaceId, id)!;
}

export function getKnowledgeCard(
  database: DatabaseSync,
  workspaceId: string,
  cardId: string,
): WorkspaceKnowledgeCardV1 | null {
  const row = database.prepare(
    `SELECT id, workspace_id, cluster_id, kind, status, title, summary, guide_id, node_id,
            created_by, created_at, updated_at
     FROM workspace_knowledge_cards
     WHERE workspace_id = ? AND id = ?`,
  ).get(workspaceId, cardId) as unknown as CardRow | undefined;
  return row ? mapCard(row) : null;
}

export function updateKnowledgeCardStatus(
  database: DatabaseSync,
  workspaceId: string,
  cardId: string,
  status: WorkspaceKnowledgeCardV1['status'],
): WorkspaceKnowledgeCardV1 | null {
  const result = database.prepare(
    `UPDATE workspace_knowledge_cards SET status = ?, updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(status, new Date().toISOString(), workspaceId, cardId);
  if (result.changes === 0) return null;
  return getKnowledgeCard(database, workspaceId, cardId);
}

export function listFlowProposals(database: DatabaseSync, workspaceId: string): WorkspaceFlowProposalV1[] {
  const rows = database.prepare(
    `SELECT id, workspace_id, card_id, guide_id, base_revision, status, summary,
            created_by, created_at, updated_at, applied_revision
     FROM workspace_flow_proposals
     WHERE workspace_id = ?
     ORDER BY updated_at DESC, id ASC`,
  ).all(workspaceId) as unknown as ProposalRow[];
  return rows.map((row) => mapProposal(database, row));
}

export function createFlowProposal(
  database: DatabaseSync,
  workspaceId: string,
  createdBy: string,
  input: CreateFlowProposalInput,
): WorkspaceFlowProposalV1 {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO workspace_flow_proposals (
      id, workspace_id, card_id, guide_id, base_revision, status, summary,
      created_by, created_at, updated_at, applied_revision
    ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL)`,
  ).run(id, workspaceId, input.cardId, input.guideId, input.baseRevision, input.summary, createdBy, now, now);
  for (const [ordinal, operation] of input.operations.entries()) {
    database.prepare(
      `INSERT INTO workspace_flow_proposal_operations (proposal_id, ordinal, operation_json)
       VALUES (?, ?, ?)`,
    ).run(id, ordinal, JSON.stringify(operation));
  }
  for (const referenceId of input.evidenceIds) {
    database.prepare(
      `INSERT INTO workspace_flow_proposal_evidence (proposal_id, reference_id, workspace_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, referenceId, workspaceId, now);
  }
  return getFlowProposal(database, workspaceId, id)!;
}

export function getFlowProposal(
  database: DatabaseSync,
  workspaceId: string,
  proposalId: string,
): WorkspaceFlowProposalV1 | null {
  const row = getProposalRow(database, workspaceId, proposalId);
  return row ? mapProposal(database, row) : null;
}

export function loadFlowProposalForApplication(
  database: DatabaseSync,
  workspaceId: string,
  proposalId: string,
): LoadedFlowProposal | null {
  const row = getProposalRow(database, workspaceId, proposalId);
  if (!row) return null;
  const operations = database.prepare(
    `SELECT operation_json FROM workspace_flow_proposal_operations
     WHERE proposal_id = ? ORDER BY ordinal ASC`,
  ).all(row.id) as Array<{ operation_json: string }>;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    guideId: row.guide_id,
    baseRevision: row.base_revision,
    status: row.status,
    summary: row.summary,
    operations: operations.map((operation) => FlowProposalOperationV1Schema.parse(JSON.parse(operation.operation_json))),
  };
}

export function updateFlowProposalStatus(
  database: DatabaseSync,
  workspaceId: string,
  proposalId: string,
  status: WorkspaceFlowProposalV1['status'],
  appliedRevision: number | null = null,
): WorkspaceFlowProposalV1 | null {
  const result = database.prepare(
    `UPDATE workspace_flow_proposals
     SET status = ?, applied_revision = ?, updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(status, appliedRevision, new Date().toISOString(), workspaceId, proposalId);
  if (result.changes === 0) return null;
  return getFlowProposal(database, workspaceId, proposalId);
}

export function recordEditorialAuditEvent(
  database: DatabaseSync,
  input: {
    workspaceId: string;
    actorId: string;
    action: string;
    targetKind: 'QUESTION_CLUSTER' | 'KNOWLEDGE_CARD' | 'FLOW_PROPOSAL';
    targetId: string;
    payload: Record<string, unknown>;
  },
): void {
  database.prepare(
    `INSERT INTO workspace_editorial_audit_events (
      id, workspace_id, actor_id, action, target_kind, target_id, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.workspaceId,
    input.actorId,
    input.action,
    input.targetKind,
    input.targetId,
    JSON.stringify(input.payload),
    new Date().toISOString(),
  );
}

function getProposalRow(database: DatabaseSync, workspaceId: string, proposalId: string): ProposalRow | undefined {
  return database.prepare(
    `SELECT id, workspace_id, card_id, guide_id, base_revision, status, summary,
            created_by, created_at, updated_at, applied_revision
     FROM workspace_flow_proposals
     WHERE workspace_id = ? AND id = ?`,
  ).get(workspaceId, proposalId) as unknown as ProposalRow | undefined;
}

function mapCluster(row: ClusterRow): WorkspaceQuestionClusterV1 {
  return WorkspaceQuestionClusterV1Schema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    status: row.status,
    summary: row.summary,
    occurrenceCount: row.occurrence_count,
    ownerVisibleExampleCount: row.owner_visible_example_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapCard(row: CardRow): WorkspaceKnowledgeCardV1 {
  return WorkspaceKnowledgeCardV1Schema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    clusterId: row.cluster_id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    summary: row.summary,
    guideId: row.guide_id,
    nodeId: row.node_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapProposal(database: DatabaseSync, row: ProposalRow): WorkspaceFlowProposalV1 {
  const operations = database.prepare(
    `SELECT operation_json FROM workspace_flow_proposal_operations
     WHERE proposal_id = ? ORDER BY ordinal ASC`,
  ).all(row.id) as Array<{ operation_json: string }>;
  const evidence = database.prepare(
    `SELECT reference_id FROM workspace_flow_proposal_evidence
     WHERE proposal_id = ? ORDER BY reference_id ASC`,
  ).all(row.id) as Array<{ reference_id: string }>;
  return WorkspaceFlowProposalV1Schema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    cardId: row.card_id,
    guideId: row.guide_id,
    baseRevision: row.base_revision,
    status: row.status,
    summary: row.summary,
    operations: operations.map((operation) => JSON.parse(operation.operation_json)),
    evidenceIds: evidence.map((item) => item.reference_id),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedRevision: row.applied_revision,
  });
}

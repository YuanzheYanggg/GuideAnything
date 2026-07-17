import {
  FlowProposalOperationV1Schema,
  WorkspaceFlowProposalStatusV1Schema,
  WorkspaceKnowledgeCardKindV1Schema,
  WorkspaceKnowledgeCardStatusV1Schema,
} from '@guideanything/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { WorkspaceEditorialService } from './service';

const IdSchema = z.string().trim().min(1).max(200);
const WorkspaceParamsSchema = z.object({ id: IdSchema });
const ClusterParamsSchema = WorkspaceParamsSchema.extend({ clusterId: IdSchema });
const CardParamsSchema = WorkspaceParamsSchema.extend({ cardId: IdSchema });
const ProposalParamsSchema = WorkspaceParamsSchema.extend({ proposalId: IdSchema });
const NullableIdSchema = IdSchema.nullable().optional().default(null);
const EvidenceIdsSchema = z.array(IdSchema).max(200).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', message: '证据 ID 不能重复' });
  }
});
const CreateCardSchema = z.object({
  clusterId: NullableIdSchema,
  kind: WorkspaceKnowledgeCardKindV1Schema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(5_000),
  guideId: NullableIdSchema,
  nodeId: NullableIdSchema,
  evidenceIds: EvidenceIdsSchema.default([]),
});
const CardStatusSchema = z.object({ status: WorkspaceKnowledgeCardStatusV1Schema });
const CreateProposalSchema = z.object({
  cardId: NullableIdSchema,
  guideId: IdSchema,
  baseRevision: z.number().int().min(0),
  summary: z.string().trim().min(1).max(5_000),
  operations: z.array(FlowProposalOperationV1Schema).min(1).max(500),
  evidenceIds: EvidenceIdsSchema.min(1),
});
const ProposalStatusSchema = z.object({
  status: WorkspaceFlowProposalStatusV1Schema.extract(['DRAFT', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED']),
});

export async function registerWorkspaceEditorialRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const service = new WorkspaceEditorialService(database);
  const auth = { preHandler: app.authenticateRequest };

  app.get('/api/workspaces/:id/editorial/question-clusters', auth, async (request, reply) => {
    const params = parseOrReply(WorkspaceParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.questionClusters(request.authUser!, params.id) };
  });

  app.get('/api/workspaces/:id/editorial/question-clusters/:clusterId/examples', auth, async (request, reply) => {
    const params = parseOrReply(ClusterParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.ownerQuestionExamples(request.authUser!, params.id, params.clusterId) };
  });

  app.get('/api/workspaces/:id/editorial/cards', auth, async (request, reply) => {
    const params = parseOrReply(WorkspaceParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.cards(request.authUser!, params.id) };
  });

  app.post('/api/workspaces/:id/editorial/cards', auth, async (request, reply) => {
    const params = parseOrReply(WorkspaceParamsSchema, request.params, reply);
    const input = parseOrReply(CreateCardSchema, request.body, reply);
    if (!params || !input) return;
    return reply.code(201).send({ card: service.createCard(request.authUser!, params.id, input) });
  });

  app.patch('/api/workspaces/:id/editorial/cards/:cardId/status', auth, async (request, reply) => {
    const params = parseOrReply(CardParamsSchema, request.params, reply);
    const input = parseOrReply(CardStatusSchema, request.body, reply);
    if (!params || !input) return;
    return { card: service.transitionCard(request.authUser!, params.id, params.cardId, input.status) };
  });

  app.get('/api/workspaces/:id/editorial/proposals', auth, async (request, reply) => {
    const params = parseOrReply(WorkspaceParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.proposals(request.authUser!, params.id) };
  });

  app.post('/api/workspaces/:id/editorial/proposals', auth, async (request, reply) => {
    const params = parseOrReply(WorkspaceParamsSchema, request.params, reply);
    const input = parseOrReply(CreateProposalSchema, request.body, reply);
    if (!params || !input) return;
    return reply.code(201).send({ proposal: service.createProposal(request.authUser!, params.id, input) });
  });

  app.patch('/api/workspaces/:id/editorial/proposals/:proposalId/status', auth, async (request, reply) => {
    const params = parseOrReply(ProposalParamsSchema, request.params, reply);
    const input = parseOrReply(ProposalStatusSchema, request.body, reply);
    if (!params || !input) return;
    return { proposal: service.transitionProposal(request.authUser!, params.id, params.proposalId, input.status) };
  });

  app.post('/api/workspaces/:id/editorial/proposals/:proposalId/apply', auth, async (request, reply) => {
    const params = parseOrReply(ProposalParamsSchema, request.params, reply);
    if (!params) return;
    const result = service.applyProposal(request.authUser!, params.id, params.proposalId);
    if (result.outcome === 'STALE') {
      return reply.code(409).send({
        code: 'PROPOSAL_STALE',
        message: '流程草稿已经更新，请基于最新修订重新审核提案',
        proposal: result.proposal,
      });
    }
    return { guide: result.guide, proposal: result.proposal };
  });
}

function parseOrReply<T extends z.ZodType>(schema: T, input: unknown, reply: FastifyReply): z.infer<T> | null {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  reply.code(400).send({
    code: 'VALIDATION_ERROR',
    message: '请求数据格式不正确',
    issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
  return null;
}

import { CanvasDocumentSchema } from '@guideanything/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { httpError } from '../../lib/http-error';
import type { AgentRuntimeClient } from '../agents/runtime-client';
import { GuideDigestService } from './digest-service';
import { GuideService } from './service';

const IdParamsSchema = z.object({ id: z.string().min(1).max(200) });
const DraftHistoryParamsSchema = IdParamsSchema.extend({ revision: z.coerce.number().int().positive() });
const CreateGuideSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  folderId: z.string().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2_000).default(''),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});
const SaveGuideSchema = z.object({
  revision: z.number().int().min(0),
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(2_000).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  document: CanvasDocumentSchema.optional(),
});
const RestoreDraftSchema = z.object({ revision: z.number().int().min(0) });
const CollaboratorSchema = z.object({ userId: z.string().min(1).max(200) });
const GuideListQuerySchema = z.object({
  workspaceId: z.string().min(1).max(200).optional(),
  scope: z.enum(['owned', 'editable', 'shared']).optional(),
});
const DigestProposalParamsSchema = IdParamsSchema.extend({
  proposalId: z.string().min(1).max(200),
});
const CreateDigestProposalSchema = z.object({
  regenerate: z.boolean().optional(),
}).strict().default({});
const RejectDigestProposalSchema = z.object({
  status: z.literal('REJECTED'),
}).strict();
const ApplyDigestProposalSchema = z.object({
  applySummary: z.boolean(),
  acceptedTagLabels: z.array(z.string().trim().min(1).max(50)).max(20),
  acceptMarkdown: z.boolean(),
}).strict().refine(
  (input) => input.applySummary || input.acceptedTagLabels.length > 0 || input.acceptMarkdown,
  { message: '至少选择一项摘要、标签或 Markdown' },
);

export async function registerGuideRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  guideDigestRuntime?: AgentRuntimeClient,
): Promise<void> {
  const service = new GuideService(database);
  const digestService = new GuideDigestService(database, guideDigestRuntime);

  app.post('/api/guides', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const input = parseOrReply(CreateGuideSchema, request.body, reply);
    if (!input) return;
    const guide = service.create(request.authUser!, {
      workspaceId: input.workspaceId,
      title: input.title,
      summary: input.summary,
      tags: input.tags,
      ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
    });
    return reply.code(201).send({ guide });
  });

  app.get('/api/guides', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const input = parseOrReply(GuideListQuerySchema, request.query, reply);
    if (!input) return;
    const options = {
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    };
    return { items: service.list(request.authUser!.id, options) };
  });

  app.get('/api/guides/:id', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { guide: service.readDraft(request.authUser!, params.id) };
  });

  app.get('/api/guides/:id/flow-snapshot-status', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { status: digestService.getFlowSnapshotStatus(request.authUser!, params.id) };
  });

  app.post('/api/guides/:id/flow-snapshot/reconcile', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { status: digestService.reconcileFlowSnapshot(request.authUser!, params.id) };
  });

  app.post('/api/guides/:id/digest-proposals', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const input = parseOrReply(CreateDigestProposalSchema, request.body, reply);
    if (!params || !input) return;
    const result = await digestService.createProposal(request.authUser!, params.id, {
      ...(input.regenerate === undefined ? {} : { regenerate: input.regenerate }),
    });
    return reply.code(result.created ? 201 : 200).send({ proposal: result.proposal });
  });

  app.get('/api/guides/:id/digest-proposals', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { items: digestService.listProposals(request.authUser!, params.id) };
  });

  app.get('/api/guides/:id/digest-proposals/:proposalId', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(DigestProposalParamsSchema, request.params, reply);
    if (!params) return;
    return { proposal: digestService.getProposal(request.authUser!, params.id, params.proposalId) };
  });

  app.patch('/api/guides/:id/digest-proposals/:proposalId/status', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(DigestProposalParamsSchema, request.params, reply);
    const input = parseOrReply(RejectDigestProposalSchema, request.body, reply);
    if (!params || !input) return;
    return { proposal: digestService.rejectProposal(request.authUser!, params.id, params.proposalId) };
  });

  app.post('/api/guides/:id/digest-proposals/:proposalId/apply', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(DigestProposalParamsSchema, request.params, reply);
    const input = parseOrReply(ApplyDigestProposalSchema, request.body, reply);
    if (!params || !input) return;
    return digestService.applyProposal(request.authUser!, params.id, params.proposalId, input);
  });

  app.get('/api/guides/:id/draft-history', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.draftHistory(request.authUser!, params.id) };
  });

  app.post('/api/guides/:id/draft-history/:revision/restore', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(DraftHistoryParamsSchema, request.params, reply);
    const input = parseOrReply(RestoreDraftSchema, request.body, reply);
    if (!params || !input) return;
    return { guide: service.restoreDraft(request.authUser!, params.id, params.revision, input.revision) };
  });

  app.get('/api/guides/:id/reference-updates', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.referenceUpdates(request.authUser!, params.id) };
  });

  app.patch('/api/guides/:id', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const input = parseOrReply(SaveGuideSchema, request.body, reply);
    if (!params || !input) return;
    const changes = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.document === undefined ? {} : { document: input.document }),
    };
    const { revision } = input;
    return { guide: service.save(request.authUser!, params.id, revision, changes) };
  });

  app.post('/api/guides/:id/publish', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return reply.code(201).send({ version: service.publish(request.authUser!, params.id) });
  });

  app.post('/api/guides/:id/collaborators', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const input = parseOrReply(CollaboratorSchema, request.body, reply);
    if (!params || !input) return;
    service.invite(request.authUser!, params.id, input.userId);
    return reply.code(201).send({ permission: 'EDIT', userId: input.userId });
  });

  app.get('/api/versions/:id', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { version: service.readVersion(params.id) };
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

export function requireGuideId(input: unknown): string {
  const result = IdParamsSchema.safeParse(input);
  if (!result.success) throw httpError(400, 'VALIDATION_ERROR', '指南 ID 格式不正确');
  return result.data.id;
}

import { CanvasDocumentSchema } from '@guideanything/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { httpError } from '../../lib/http-error';
import { GuideService } from './service';

const IdParamsSchema = z.object({ id: z.string().min(1).max(200) });
const CreateGuideSchema = z.object({
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
const CollaboratorSchema = z.object({ userId: z.string().min(1).max(200) });

export async function registerGuideRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const service = new GuideService(database);

  app.post('/api/guides', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const input = parseOrReply(CreateGuideSchema, request.body, reply);
    if (!input) return;
    const guide = service.create(request.authUser!, input);
    return reply.code(201).send({ guide });
  });

  app.get('/api/guides', { preHandler: app.authenticateRequest }, async (request) => ({
    items: service.list(request.authUser!.id),
  }));

  app.get('/api/guides/:id', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { guide: service.readDraft(request.authUser!.id, params.id) };
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
    return { guide: service.save(request.authUser!.id, params.id, revision, changes) };
  });

  app.post('/api/guides/:id/publish', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return reply.code(201).send({ version: service.publish(request.authUser!.id, params.id) });
  });

  app.post('/api/guides/:id/collaborators', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const input = parseOrReply(CollaboratorSchema, request.body, reply);
    if (!params || !input) return;
    service.invite(request.authUser!.id, params.id, input.userId);
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

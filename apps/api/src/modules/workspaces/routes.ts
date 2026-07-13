import { WorkspaceItemKindSchema } from '@guideanything/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { WorkspaceService } from './service';

const IdParamsSchema = z.object({ id: z.string().min(1).max(200) });
const MemberParamsSchema = IdParamsSchema.extend({ userId: z.string().min(1).max(200) });
const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(2_000).default(''),
  iconKey: z.string().trim().min(1).max(50),
  colorKey: z.string().trim().min(1).max(50),
});
const UpdateWorkspaceSchema = CreateWorkspaceSchema.partial();
const ItemsQuerySchema = z.object({ kind: WorkspaceItemKindSchema.optional() });
const AddMemberSchema = z.object({
  userId: z.string().min(1).max(200),
  permission: z.enum(['EDIT', 'VIEW']),
});

export async function registerWorkspaceRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const service = new WorkspaceService(database);

  app.get('/api/workspaces', { preHandler: app.authenticateRequest }, async (request) => ({
    items: service.list(request.authUser!.id),
  }));

  app.post('/api/workspaces', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const input = parseOrReply(CreateWorkspaceSchema, request.body, reply);
    if (!input) return;
    return reply.code(201).send({ workspace: service.create(request.authUser!, input) });
  });

  app.get('/api/workspaces/:id', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return service.read(request.authUser!.id, params.id);
  });

  app.patch('/api/workspaces/:id', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const input = parseOrReply(UpdateWorkspaceSchema, request.body, reply);
    if (!params || !input) return;
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.iconKey === undefined ? {} : { iconKey: input.iconKey }),
      ...(input.colorKey === undefined ? {} : { colorKey: input.colorKey }),
    };
    return { workspace: service.update(request.authUser!.id, params.id, changes) };
  });

  app.get('/api/workspaces/:id/items', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const query = parseOrReply(ItemsQuerySchema, request.query, reply);
    if (!params || !query) return;
    return { items: service.items(request.authUser!.id, params.id, query.kind) };
  });

  app.get('/api/workspaces/:id/activity', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.activity(request.authUser!.id, params.id) };
  });

  app.get('/api/workspaces/:id/members', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.members(request.authUser!.id, params.id) };
  });

  app.post('/api/workspaces/:id/members', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const input = parseOrReply(AddMemberSchema, request.body, reply);
    if (!params || !input) return;
    return reply.code(201).send({
      member: service.addMember(request.authUser!.id, params.id, input.userId, input.permission),
    });
  });

  app.delete('/api/workspaces/:id/members/:userId', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(MemberParamsSchema, request.params, reply);
    if (!params) return;
    service.removeMember(request.authUser!.id, params.id, params.userId);
    return reply.code(204).send();
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

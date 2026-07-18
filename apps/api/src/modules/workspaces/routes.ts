import { WorkspaceItemKindSchema, WorkspaceKindSchema } from '@guideanything/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { WorkspaceService } from './service';

const IdParamsSchema = z.object({ id: z.string().min(1).max(200) });
const MemberParamsSchema = IdParamsSchema.extend({ userId: z.string().min(1).max(200) });
const FolderParamsSchema = IdParamsSchema.extend({ folderId: z.string().min(1).max(200) });
const ItemParamsSchema = IdParamsSchema.extend({ itemId: z.string().min(1).max(200) });
const MountParamsSchema = IdParamsSchema.extend({ mountId: z.string().min(1).max(200) });
const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(2_000).default(''),
  iconKey: z.string().trim().min(1).max(50),
  colorKey: z.string().trim().min(1).max(50),
  kind: WorkspaceKindSchema.default('BUSINESS_TEAM'),
});
const UpdateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().trim().max(2_000).optional(),
  iconKey: z.string().trim().min(1).max(50).optional(),
  colorKey: z.string().trim().min(1).max(50).optional(),
});
const ItemsQuerySchema = z.object({ kind: WorkspaceItemKindSchema.optional() });
const AddMemberSchema = z.object({
  userId: z.string().min(1).max(200),
  permission: z.enum(['EDIT', 'VIEW']),
});
const CreateFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().min(1).max(200).nullable().default(null),
});
const RenameFolderSchema = z.object({ name: z.string().trim().min(1).max(120) });
const MoveItemSchema = z.object({ folderId: z.string().min(1).max(200).nullable() });
const CreateResourceMountSchema = z.object({ providerWorkspaceId: z.string().min(1).max(200) });

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

  app.get('/api/workspaces/:id/folders', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.folders(request.authUser!.id, params.id) };
  });

  app.post('/api/workspaces/:id/folders', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const input = parseOrReply(CreateFolderSchema, request.body, reply);
    if (!params || !input) return;
    return reply.code(201).send({ folder: service.createFolder(request.authUser!.id, params.id, input) });
  });

  app.patch('/api/workspaces/:id/folders/:folderId', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(FolderParamsSchema, request.params, reply);
    const input = parseOrReply(RenameFolderSchema, request.body, reply);
    if (!params || !input) return;
    return { folder: service.renameFolder(request.authUser!.id, params.id, params.folderId, input.name) };
  });

  app.delete('/api/workspaces/:id/folders/:folderId', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(FolderParamsSchema, request.params, reply);
    if (!params) return;
    service.deleteFolder(request.authUser!.id, params.id, params.folderId);
    return reply.code(204).send();
  });

  app.patch('/api/workspaces/:id/items/:itemId/folder', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(ItemParamsSchema, request.params, reply);
    const input = parseOrReply(MoveItemSchema, request.body, reply);
    if (!params || !input) return;
    return { item: service.moveItemToFolder(request.authUser!.id, params.id, params.itemId, input.folderId) };
  });

  app.get('/api/workspaces/:id/resource-mounts', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.resourceMounts(request.authUser!.id, params.id) };
  });

  app.post('/api/workspaces/:id/resource-mounts', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    const input = parseOrReply(CreateResourceMountSchema, request.body, reply);
    if (!params || !input) return;
    return reply.code(201).send({
      mount: service.createResourceMount(request.authUser!.id, params.id, input.providerWorkspaceId),
    });
  });

  app.delete('/api/workspaces/:id/resource-mounts/:mountId', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(MountParamsSchema, request.params, reply);
    if (!params) return;
    service.deleteResourceMount(request.authUser!.id, params.id, params.mountId);
    return reply.code(204).send();
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

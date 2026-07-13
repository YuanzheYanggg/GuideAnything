import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { PersonalService } from './service';

const ItemParamsSchema = z.object({ itemId: z.string().min(1).max(200) });
const RecentContextSchema = z.object({
  context: z.record(z.string(), z.unknown()).default({}),
});

export async function registerPersonalRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const service = new PersonalService(database);
  const auth = { preHandler: app.authenticateRequest };

  app.get('/api/me/favorites', auth, async (request) => ({
    items: service.listFavorites(request.authUser!),
  }));

  app.put('/api/me/favorites/:itemId', auth, async (request, reply) => {
    const params = parseOrReply(ItemParamsSchema, request.params, reply);
    if (!params) return;
    return { item: service.setFavorite(request.authUser!, params.itemId) };
  });

  app.delete('/api/me/favorites/:itemId', auth, async (request, reply) => {
    const params = parseOrReply(ItemParamsSchema, request.params, reply);
    if (!params) return;
    return { item: service.removeFavorite(request.authUser!, params.itemId) };
  });

  app.get('/api/me/recent', auth, async (request) => ({
    items: service.listRecentViews(request.authUser!),
  }));

  app.put('/api/me/recent/:itemId', auth, async (request, reply) => {
    const params = parseOrReply(ItemParamsSchema, request.params, reply);
    const input = parseOrReply(RecentContextSchema, request.body ?? {}, reply);
    if (!params || !input) return;
    return { item: service.recordRecentView(request.authUser!, params.itemId, input.context) };
  });

  app.get('/api/me/shared', auth, async (request) => ({
    items: service.listSharedItems(request.authUser!.id),
  }));

  app.get('/api/me/trash', auth, async (request) => ({
    items: service.listTrash(request.authUser!.id),
  }));

  app.post('/api/workspace-items/:itemId/trash', auth, async (request, reply) => {
    const params = parseOrReply(ItemParamsSchema, request.params, reply);
    if (!params) return;
    return { item: service.trashItem(request.authUser!.id, params.itemId) };
  });

  app.post('/api/workspace-items/:itemId/restore', auth, async (request, reply) => {
    const params = parseOrReply(ItemParamsSchema, request.params, reply);
    if (!params) return;
    return { item: service.restoreItem(request.authUser!.id, params.itemId) };
  });

  app.delete('/api/workspace-items/:itemId', auth, async (request, reply) => {
    const params = parseOrReply(ItemParamsSchema, request.params, reply);
    if (!params) return;
    service.permanentlyRemoveItem(request.authUser!.id, params.itemId);
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

import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { searchPublishedGuides } from './repository';

const SearchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  workspaceId: z.string().min(1).max(200).optional(),
  consumerWorkspaceId: z.string().min(1).max(200).optional(),
});

export async function registerSearchRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  app.get('/api/search', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const input = SearchQuerySchema.safeParse(request.query);
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '关键词不能超过 100 个字符' });
    }
    return searchPublishedGuides(
      database,
      request.authUser!.id,
      input.data.q,
      input.data.limit,
      input.data.offset,
      input.data.workspaceId,
      input.data.consumerWorkspaceId,
    );
  });
}

import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { searchPublishedGuides } from './repository';

const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function registerSearchRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  app.get('/api/search', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const input = SearchQuerySchema.safeParse(request.query);
    if (!input.success) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '请输入 1 到 100 个字符的关键词' });
    }
    return { items: searchPublishedGuides(database, input.data.q, input.data.limit) };
  });
}


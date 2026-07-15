import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { httpError } from '../../lib/http-error';
import { KnowledgeService } from './service';

const IdParamsSchema = z.object({ id: z.string().min(1).max(200) });
const DocumentParamsSchema = z.object({ documentId: z.string().min(1).max(200) });
const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function registerKnowledgeRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  uploadRoot: string,
): Promise<void> {
  const service = new KnowledgeService(database, uploadRoot);

  app.get('/api/knowledge/santexwell/status', { preHandler: app.authenticateRequest }, async () => ({
    status: service.santexwellStatus(),
  }));

  app.get('/api/knowledge/santexwell/overview', { preHandler: app.authenticateRequest }, async () => (
    service.santexwellOverview()
  ));

  app.get('/api/knowledge/santexwell/search', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const query = parseOrReply(SearchQuerySchema, request.query, reply);
    if (!query) return;
    return { items: service.searchSantexwell(query.q, query.limit) };
  });

  app.get('/api/knowledge/santexwell/documents/:documentId', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(DocumentParamsSchema, request.params, reply);
    if (!params) return;
    return { document: service.readSantexwellDocument(params.documentId) };
  });

  app.get('/api/workspaces/:id/sources', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return service.workspaceSources(request.authUser!, params.id);
  });

  app.post('/api/workspaces/:id/sources', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    const file = await request.file();
    if (!file) throw httpError(400, 'DOCUMENT_REQUIRED', '请选择要上传的资料文件');
    return reply.code(201).send({ source: await service.uploadWorkspaceSource(request.authUser!, params.id, file) });
  });

  app.get('/api/workspaces/:id/flow-snapshots', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = parseOrReply(IdParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.flowSnapshots(request.authUser!, params.id) };
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

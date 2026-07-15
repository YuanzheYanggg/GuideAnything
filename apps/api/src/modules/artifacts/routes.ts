import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { ArtifactReferenceService } from './service';

const WorkspaceParamsSchema = z.object({
  workspaceId: z.string().min(1).max(200),
}).strict();
const ReferenceParamsSchema = z.object({
  referenceId: z.string().min(1).max(200),
}).strict();

export async function registerArtifactRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
): Promise<void> {
  const service = new ArtifactReferenceService(database);

  app.get('/api/workspaces/:workspaceId/artifacts', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const params = parseOrReply(WorkspaceParamsSchema, request.params, reply);
    if (!params) return;
    return { items: service.listWorkspace(request.authUser!.id, params.workspaceId) };
  });

  app.get('/api/references/:referenceId', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const params = parseOrReply(ReferenceParamsSchema, request.params, reply);
    if (!params) return;
    return service.resolveReference(request.authUser!.id, params.referenceId);
  });
}

function parseOrReply<T extends z.ZodType>(
  schema: T,
  input: unknown,
  reply: FastifyReply,
): z.infer<T> | null {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  reply.code(400).send({
    code: 'VALIDATION_ERROR',
    message: '请求数据格式不正确',
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'), message: issue.message,
    })),
  });
  return null;
}

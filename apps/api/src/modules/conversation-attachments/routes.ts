import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { httpError } from '../../lib/http-error';
import { ConversationAttachmentService } from './service';

const WorkspaceConversationParamsSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(200),
}).strict();

export async function registerConversationAttachmentRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  uploadRoot: string,
): Promise<void> {
  const service = new ConversationAttachmentService(database, uploadRoot);

  app.post('/api/workspaces/:workspaceId/conversations/:conversationId/attachments', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const params = parseParams(request.params);
    if (!request.isMultipart()) {
      throw httpError(400, 'DOCUMENT_REQUIRED', '请选择要上传的资料文件');
    }
    const file = await request.file();
    if (!file) throw httpError(400, 'DOCUMENT_REQUIRED', '请选择要上传的资料文件');
    const attachment = await service.upload(
      request.authUser!.id,
      params.workspaceId,
      params.conversationId,
      file,
    );
    return reply.code(201).send({ attachment });
  });
}

function parseParams(input: unknown): z.infer<typeof WorkspaceConversationParamsSchema> {
  const result = WorkspaceConversationParamsSchema.safeParse(input);
  if (result.success) return result.data;
  throw httpError(400, 'VALIDATION_ERROR', '请求数据格式不正确', result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  })));
}

import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { httpError } from '../../lib/http-error';
import { openMedia, storeMedia } from './service';

const MediaParamsSchema = z.object({ id: z.string().uuid() });

export async function registerMediaRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  uploadDir: string,
): Promise<void> {
  app.post('/api/media', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const file = await request.file();
    if (!file) throw httpError(400, 'MEDIA_REQUIRED', '请选择要上传的媒体文件');
    const asset = await storeMedia(database, uploadDir, request.authUser!.id, file);
    return reply.code(201).send({ asset });
  });

  app.get('/api/media/:id', { preHandler: app.authenticateRequest }, async (request, reply) => {
    const params = MediaParamsSchema.safeParse(request.params);
    if (!params.success) throw httpError(400, 'VALIDATION_ERROR', '媒体 ID 格式不正确');
    const { asset, stream } = openMedia(database, params.data.id);
    return reply
      .header('Content-Type', asset.mimeType)
      .header('Content-Length', asset.size)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=3600')
      .header('Content-Disposition', `inline; filename="${asset.id}"`)
      .send(stream);
  });
}


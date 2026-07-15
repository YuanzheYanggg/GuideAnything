import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { registerArtifactRoutes } from './modules/artifacts/routes';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerConversationAttachmentRoutes } from './modules/conversation-attachments/routes';
import { registerConversationRoutes, type ConversationRouteRuntime } from './modules/conversations/routes';
import { registerGuideRoutes } from './modules/guides/routes';
import { registerMediaRoutes } from './modules/media/routes';
import { registerKnowledgeRoutes } from './modules/knowledge/routes';
import { registerPersonalRoutes } from './modules/personal/routes';
import { registerSearchRoutes } from './modules/search/routes';
import { registerWorkspaceRoutes } from './modules/workspaces/routes';
import { createAuthenticateRequest } from './plugins/auth';

export interface BuildAppOptions {
  database: DatabaseSync;
  jwtSecret: string;
  webOrigin?: string;
  logger?: boolean;
  uploadDir?: string;
  agentRuntime?: ConversationRouteRuntime;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  if (options.jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.webOrigin ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(jwt, { secret: options.jwtSecret });
  await app.register(multipart, {
    limits: { files: 1, parts: 2, fileSize: 201 * 1024 * 1024 },
  });

  app.decorateRequest('authUser', undefined);
  app.decorate('authenticateRequest', createAuthenticateRequest(options.database));

  app.setErrorHandler((error, _request, reply) => {
    const candidate = (error instanceof Error
      ? error
      : new Error('Unknown error')) as Error & { statusCode?: unknown; code?: unknown };
    const statusCode = typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : 500;
    const code = typeof candidate.code === 'string'
      ? candidate.code
      : 'INTERNAL_ERROR';
    reply.code(statusCode).send({
      code,
      message: statusCode >= 500 ? '服务器处理请求时发生错误' : candidate.message,
    });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  await registerAuthRoutes(app, options.database);
  await registerArtifactRoutes(app, options.database);
  if (options.agentRuntime) {
    await registerConversationRoutes(
      app,
      options.database,
      options.agentRuntime,
      options.uploadDir ?? resolve('data/uploads'),
    );
  }
  await registerGuideRoutes(app, options.database);
  await registerKnowledgeRoutes(app, options.database, options.uploadDir ?? resolve('data/uploads'));
  await registerConversationAttachmentRoutes(
    app,
    options.database,
    options.uploadDir ?? resolve('data/uploads'),
  );
  await registerMediaRoutes(app, options.database, options.uploadDir ?? resolve('data/uploads'));
  await registerPersonalRoutes(app, options.database);
  await registerSearchRoutes(app, options.database);
  await registerWorkspaceRoutes(app, options.database);
  await app.ready();
  return app;
}

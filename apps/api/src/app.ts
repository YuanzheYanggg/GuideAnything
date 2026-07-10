import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

import { registerAuthRoutes } from './modules/auth/routes';
import { createAuthenticateRequest } from './plugins/auth';

export interface BuildAppOptions {
  database: DatabaseSync;
  jwtSecret: string;
  webOrigin?: string;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  if (options.jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.webOrigin ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(jwt, { secret: options.jwtSecret });

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
  await app.ready();
  return app;
}

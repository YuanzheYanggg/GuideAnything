import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { authenticate } from './service';

const LoginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(128),
});

export async function registerAuthRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  app.post('/api/auth/login', async (request, reply) => {
    const input = LoginSchema.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '登录信息格式不正确',
        issues: input.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }

    const user = await authenticate(database, input.data.email, input.data.password);
    if (!user) {
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' });
    }
    const token = app.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '8h' },
    );
    return { token, user };
  });

  app.get('/api/auth/me', { preHandler: app.authenticateRequest }, async (request) => ({
    user: request.authUser,
  }));
}


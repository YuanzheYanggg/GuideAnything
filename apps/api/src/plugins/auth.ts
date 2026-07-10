import type { FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

import { findUserById, type AuthenticatedUser } from '../modules/auth/service';

export function createAuthenticateRequest(database: DatabaseSync) {
  return async function authenticateRequest(request: FastifyRequest): Promise<void> {
    try {
      await request.jwtVerify();
    } catch {
      throw httpError(401, 'UNAUTHORIZED', '登录已失效');
    }
    const identity = findUserById(database, request.user.sub);
    if (!identity) throw httpError(401, 'UNAUTHORIZED', '登录已失效');
    request.authUser = identity;
  };
}

export function requireRole(...roles: AuthenticatedUser['role'][]) {
  return async function checkRole(request: FastifyRequest): Promise<void> {
    if (!request.authUser || !roles.includes(request.authUser.role)) {
      throw httpError(403, 'FORBIDDEN', '没有执行此操作的权限');
    }
  };
}

function httpError(statusCode: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

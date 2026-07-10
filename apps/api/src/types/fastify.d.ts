import type { AuthenticatedUser } from '../modules/auth/service';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: AuthenticatedUser['role'] };
    user: { sub: string; email: string; role: AuthenticatedUser['role'] };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticateRequest: (request: FastifyRequest) => Promise<void>;
  }

  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

export {};


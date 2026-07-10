import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

import { buildApp } from '../../app';
import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { hashPassword } from './service';

describe('authentication', () => {
  let app: FastifyInstance;
  let database: DatabaseSync;

  beforeEach(async () => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    database.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'user-author',
      'author@guide.local',
      await hashPassword('Guide123!'),
      '王作者',
      'AUTHOR',
      new Date().toISOString(),
    );
    app = await buildApp({ database, jwtSecret: 'test-secret-that-is-long-enough-1234' });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it('returns a JWT and current user for valid credentials', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'author@guide.local', password: 'Guide123!' },
    });

    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({
      token: expect.any(String),
      user: { id: 'user-author', email: 'author@guide.local', displayName: '王作者', role: 'AUTHOR' },
    });

    const current = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${login.json().token as string}` },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().user.id).toBe('user-author');
  });

  it('uses the same generic error for unknown users and bad passwords', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'missing@guide.local', password: 'Guide123!' },
    });
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'author@guide.local', password: 'wrong-password' },
    });

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('rejects missing and stale identities on protected routes', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);

    const staleToken = app.jwt.sign({ sub: 'deleted-user', email: 'gone@guide.local', role: 'AUTHOR' });
    const stale = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${staleToken}` },
    });
    expect(stale.statusCode).toBe(401);
  });

  it('validates the login payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'not-an-email', password: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

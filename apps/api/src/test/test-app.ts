import type { CanvasDocument, UserRole } from '@guideanything/contracts';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

import { buildApp } from '../app';
import { createDatabase } from '../db/client';
import { migrateDatabase } from '../db/migrate';
import { hashPassword } from '../modules/auth/service';

export interface TestContext {
  app: FastifyInstance;
  database: DatabaseSync;
  tokens: Record<'author' | 'editor' | 'learner' | 'otherAuthor', string>;
  userIds: Record<'author' | 'editor' | 'learner' | 'otherAuthor', string>;
  close: () => Promise<void>;
}

const users: Array<{ key: keyof TestContext['tokens']; email: string; name: string; role: UserRole }> = [
  { key: 'author', email: 'author@guide.local', name: '王作者', role: 'AUTHOR' },
  { key: 'editor', email: 'editor@guide.local', name: '陈编辑', role: 'EDITOR' },
  { key: 'learner', email: 'learner@guide.local', name: '李学员', role: 'LEARNER' },
  { key: 'otherAuthor', email: 'other@guide.local', name: '赵作者', role: 'AUTHOR' },
];

export async function createTestContext(options: { uploadDir?: string } = {}): Promise<TestContext> {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const passwordHash = await hashPassword('Guide123!');
  const insert = database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const userIds = {} as TestContext['userIds'];
  for (const user of users) {
    const id = `user-${user.key}`;
    userIds[user.key] = id;
    insert.run(id, user.email, passwordHash, user.name, user.role, new Date().toISOString());
  }

  const app = await buildApp({
    database,
    jwtSecret: 'test-secret-that-is-long-enough-1234',
    ...(options.uploadDir ? { uploadDir: options.uploadDir } : {}),
  });
  const tokens = {} as TestContext['tokens'];
  for (const user of users) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'Guide123!' },
    });
    tokens[user.key] = response.json().token as string;
  }

  return {
    app,
    database,
    tokens,
    userIds,
    async close() {
      await app.close();
      database.close();
    },
  };
}

export function authorization(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export function sampleDocument(markdown = '# 创建销售订单\n填写客户与销售组织。'): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'start',
        type: 'start',
        position: { x: 0, y: 0 },
        zIndex: 0,
        data: { label: '开始', shape: 'start' },
      },
      {
        id: 'instructions',
        type: 'markdown',
        position: { x: 260, y: 0 },
        zIndex: 1,
        data: { markdown },
      },
    ],
    edges: [{ id: 'edge-1', source: 'start', target: 'instructions' }],
    viewport: { x: 10, y: 20, zoom: 0.9 },
    steps: [
      { id: 'step-1', order: 0, title: '打开事务', nodeId: 'start' },
      { id: 'step-2', order: 1, title: '填写客户', nodeId: 'instructions' },
    ],
    entryNodeId: 'start',
    exitNodeIds: ['instructions'],
  };
}

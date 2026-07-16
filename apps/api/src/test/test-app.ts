import type { CanvasDocument, UserRole, WorkspacePermission } from '@guideanything/contracts';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';

import { buildApp } from '../app';
import { createDatabase } from '../db/client';
import { migrateDatabase } from '../db/migrate';
import { hashPassword } from '../modules/auth/service';
import type { ConversationRouteRuntime } from '../modules/conversations/routes';

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

export async function createTestContext(options: {
  uploadDir?: string;
  agentRuntime?: ConversationRouteRuntime;
} = {}): Promise<TestContext> {
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
    ...(options.agentRuntime ? { agentRuntime: options.agentRuntime } : {}),
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

export function seedTestWorkspace(
  database: DatabaseSync,
  ownerId: string,
  input: {
    id: string;
    slug: string;
    name: string;
    description?: string;
    iconKey?: string;
    colorKey?: string;
  },
) {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.slug,
    input.name,
    input.description ?? '',
    input.iconKey ?? 'SquaresFour',
    input.colorKey ?? 'general',
    ownerId,
    now,
    now,
  );
  addTestWorkspaceMember(database, input.id, ownerId, 'OWNER');
  return { ...input, id: input.id };
}

export function addTestWorkspaceMember(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
  permission: WorkspacePermission,
): void {
  database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET permission = excluded.permission`,
  ).run(workspaceId, userId, permission, new Date().toISOString());
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

export async function createWorkspaceGuideFixture() {
  const context = await createTestContext();
  const workspace = seedTestWorkspace(context.database, context.userIds.author, {
    id: 'workspace-fixture',
    slug: 'fixture',
    name: '测试工作区',
  });
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: authorization(context.tokens.author),
    payload: { workspaceId: workspace.id, title: '可检索测试指南', summary: '', tags: ['测试'] },
  });
  expect(created.statusCode).toBe(201);
  const guide = created.json().guide as { id: string; workspaceItemId: string };
  const saved = await context.app.inject({
    method: 'PATCH',
    url: `/api/guides/${guide.id}`,
    headers: authorization(context.tokens.author),
    payload: { revision: 0, document: sampleDocument('# 可检索测试指南\n用于回收站检索测试。') },
  });
  expect(saved.statusCode).toBe(200);
  const published = await context.app.inject({
    method: 'POST',
    url: `/api/guides/${guide.id}/publish`,
    headers: authorization(context.tokens.author),
  });
  expect(published.statusCode).toBe(201);
  return {
    ...context,
    workspaceId: workspace.id,
    workspaceItemId: guide.workspaceItemId,
    guideId: guide.id,
    versionId: published.json().version.id as string,
  };
}

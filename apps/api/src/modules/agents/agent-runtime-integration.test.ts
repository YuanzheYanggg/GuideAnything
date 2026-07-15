import type { AppConfig } from '../../config';
import { buildApp } from '../../app';
import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { hashPassword } from '../auth/service';
import { reconcileGuideFlowSnapshots } from '../knowledge/flow-indexer';
import { authorization, sampleDocument, seedTestWorkspace } from '../../test/test-app';
import { afterEach, describe, expect, it } from 'vitest';

import { createAgentRuntimeAssembly } from './assembly';
import { createDatabaseAgentKnowledgeAdapters } from './knowledge-adapters';

describe('read-only Agent runtime integration', () => {
  const database = createDatabase(':memory:');
  const runtime = createAgentRuntimeAssembly({
    database,
    config: fakeConfig(),
    knowledgeAdapters: createDatabaseAgentKnowledgeAdapters({ database }),
  });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await runtime.close?.();
    await app?.close();
    database.close();
  });

  it('routes, retrieves a flow snapshot, commits an answer, streams events, and resolves its citation', async () => {
    migrateDatabase(database);
    const passwordHash = await hashPassword('Guide123!');
    database.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
       VALUES ('integration-author', 'integration@guide.local', ?, '集成测试作者', 'AUTHOR', ?)`,
    ).run(passwordHash, new Date().toISOString());
    seedTestWorkspace(database, 'integration-author', {
      id: 'integration-workspace', slug: 'integration-workspace', name: 'Agent 集成工作区',
    });
    app = await buildApp({
      database,
      jwtSecret: 'test-secret-that-is-long-enough-1234',
      agentRuntime: runtime,
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'integration@guide.local', password: 'Guide123!' },
    });
    const headers = authorization(login.json().token as string);

    const createdGuide = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers,
      payload: {
        workspaceId: 'integration-workspace',
        title: '样衣复核流程',
        summary: '用于验证 Agent 可以读取并定位流程节点。',
        tags: ['复核'],
      },
    });
    expect(createdGuide.statusCode).toBe(201);
    const guideId = createdGuide.json().guide.id as string;
    const savedGuide = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${guideId}`,
      headers,
      payload: {
        revision: 0,
        document: sampleDocument('# 样衣复核\n质量复核员负责检查尺寸、工艺和最终放行。'),
      },
    });
    expect(savedGuide.statusCode).toBe(200);
    reconcileGuideFlowSnapshots(database);

    const createdConversation = await app.inject({
      method: 'POST',
      url: '/api/workspaces/integration-workspace/conversations',
      headers,
      payload: { title: '谁负责复核' },
    });
    const conversationId = createdConversation.json().conversation.id as string;
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/workspaces/integration-workspace/conversations/${conversationId}/messages`,
      headers,
      payload: {
        clientMessageId: 'integration-message-1',
        text: '谁负责样衣复核？',
        sources: {
          workspaceFlows: true,
          workspaceDocuments: false,
          sessionAttachments: false,
          santexwell: false,
        },
        attachmentIds: [],
      },
    });
    expect(accepted.statusCode).toBe(202);
    const runId = accepted.json().run.id as string;
    await waitForTerminalRun(database, runId);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/workspaces/integration-workspace/conversations/${conversationId}`,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().latestRun).toMatchObject({ id: runId, status: 'COMPLETED' });
    const assistant = detail.json().messages.find((message: { role: string }) => message.role === 'ASSISTANT');
    expect(assistant.answer.conclusion).toContain('质量复核员负责检查尺寸');
    const relevantCitation = assistant.answer.citations.find((citation: { excerpt: string }) => (
      citation.excerpt.includes('质量复核员负责检查尺寸')
    ));
    expect(relevantCitation).toBeDefined();
    if (!relevantCitation) throw new Error('missing relevant flow citation');

    const eventStream = await app.inject({
      method: 'GET',
      url: `/api/agent-runs/${runId}/events`,
      headers: { ...headers, accept: 'text/event-stream' },
    });
    expect(eventStream.statusCode).toBe(200);
    expect(eventStream.body).toContain('event: route.completed');
    expect(eventStream.body).toContain('event: answer.draft.delta');
    expect(eventStream.body).toContain('event: run.completed');

    const referenceId = relevantCitation.referenceId as string;
    const reference = await app.inject({
      method: 'GET',
      url: `/api/references/${encodeURIComponent(referenceId)}`,
      headers,
    });
    expect(reference.statusCode).toBe(200);
    expect(reference.json()).toMatchObject({
      status: 'VALID',
      source: 'WORKSPACE_FLOW',
      target: {
        kind: 'CURRENT_DRAFT_FLOW_NODE',
        href: expect.stringContaining(`/guides/${guideId}/edit?nodeId=`),
      },
    });
  });
});

async function waitForTerminalRun(
  database: ReturnType<typeof createDatabase>,
  runId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = database.prepare('SELECT status FROM agent_runs WHERE id = ?').get(runId) as {
      status: string;
    } | undefined;
    if (row?.status === 'COMPLETED') return;
    if (row?.status === 'FAILED' || row?.status === 'CANCELLED') {
      throw new Error(`Agent integration run ended as ${row.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Agent integration run did not reach a terminal state');
}

function fakeConfig(): AppConfig {
  return {
    port: 3001,
    webOrigin: 'http://localhost:5173',
    databasePath: ':memory:',
    uploadDir: 'data/uploads',
    jwtSecret: 'test-secret-that-is-long-enough-1234',
    seedDemo: false,
    runtimeMode: 'fake',
    santexwellVaultPath: null,
    bridgeUrl: 'http://127.0.0.1:3010/',
    bridgeToken: null,
    agentConcurrency: 3,
    routerTimeoutMs: 5_000,
    workerTimeoutMs: 5_000,
    reducerTimeoutMs: 5_000,
    runTimeoutMs: 20_000,
    modelRoles: {
      router: null,
      deepRouter: null,
      focusedWorker: null,
      deepWorker: null,
      reducer: null,
    },
  };
}

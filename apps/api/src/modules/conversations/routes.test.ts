import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRunEventStore, RunEventBroker } from './events';
import {
  authorization,
  createTestContext,
  seedTestWorkspace,
  type TestContext,
} from '../../test/test-app';

describe('conversation and run routes', () => {
  let context: TestContext;
  let broker: RunEventBroker;
  const scheduleRun = vi.fn(async () => undefined);

  beforeEach(async () => {
    broker = new RunEventBroker();
    scheduleRun.mockClear();
    context = await createTestContext({ agentRuntime: { broker, scheduleRun } });
    seedTestWorkspace(context.database, context.userIds.author, {
      id: 'workspace-agent', slug: 'workspace-agent', name: 'Agent 工作区',
    });
  });

  afterEach(async () => context.close());

  it('creates separate global and workspace conversations', async () => {
    const global = await context.app.inject({
      method: 'POST',
      url: '/api/knowledge/santexwell/conversations',
      headers: authorization(context.tokens.author),
      payload: { title: '花式纱分类' },
    });
    expect(global.statusCode).toBe(201);
    expect(global.json().conversation).toMatchObject({
      scope: 'GLOBAL_SANTEXWELL', workspaceId: null, title: '花式纱分类',
    });

    const workspace = await context.app.inject({
      method: 'POST',
      url: '/api/workspaces/workspace-agent/conversations',
      headers: authorization(context.tokens.author),
      payload: { title: '审批流程' },
    });
    expect(workspace.statusCode).toBe(201);
    expect(workspace.json().conversation).toMatchObject({
      scope: 'WORKSPACE', workspaceId: 'workspace-agent', title: '审批流程',
    });
  });

  it('accepts an idempotent message before scheduling background execution', async () => {
    const conversationId = await createWorkspaceConversation();
    const payload = {
      clientMessageId: 'client-message-1',
      text: '这个流程是否缺少复核？',
      sources: {
        workspaceFlows: false,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: false,
      },
      attachmentIds: [],
    };
    const first = await context.app.inject({
      method: 'POST',
      url: `/api/workspaces/workspace-agent/conversations/${conversationId}/messages`,
      headers: authorization(context.tokens.author),
      payload,
    });
    expect(first.statusCode).toBe(202);
    expect(first.json().run.status).toBe('QUEUED');
    await vi.waitFor(() => expect(scheduleRun).toHaveBeenCalledWith(first.json().run.id));

    const replay = await context.app.inject({
      method: 'POST',
      url: `/api/workspaces/workspace-agent/conversations/${conversationId}/messages`,
      headers: authorization(context.tokens.author),
      payload,
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(first.json());
    expect(scheduleRun).toHaveBeenCalledTimes(1);
  });

  it('does not expose another owners private conversation or run', async () => {
    const conversationId = await createWorkspaceConversation();
    const accepted = await sendWorkspaceMessage(conversationId);
    const conversation = await context.app.inject({
      method: 'GET',
      url: `/api/workspaces/workspace-agent/conversations/${conversationId}`,
      headers: authorization(context.tokens.otherAuthor),
    });
    expect(conversation.statusCode).toBe(404);
    const run = await context.app.inject({
      method: 'GET',
      url: `/api/agent-runs/${accepted.run.id}`,
      headers: authorization(context.tokens.otherAuthor),
    });
    expect(run.statusCode).toBe(404);
  });

  it('replays authenticated SSE with event ids and stops at terminal state', async () => {
    const conversationId = await createWorkspaceConversation();
    const accepted = await sendWorkspaceMessage(conversationId);
    const store = new AgentRunEventStore(context.database, broker);
    store.append({
      runId: accepted.run.id,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'route.started',
      payload: {},
    });
    store.append({
      runId: accepted.run.id,
      planVersion: 1,
      phase: 'COMMITTED',
      type: 'run.failed',
      payload: { code: 'TEST_FAILURE', message: '测试终止。', retryable: true },
    });

    const response = await context.app.inject({
      method: 'GET',
      url: `/api/agent-runs/${accepted.run.id}/events`,
      headers: {
        ...authorization(context.tokens.author),
        accept: 'text/event-stream',
        'last-event-id': '1',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).not.toContain('id: 1\n');
    expect(response.body).toContain('id: 2\n');
    expect(response.body).toContain('event: run.failed\n');
    expect(response.body).toContain('"retryable":true');
  });

  it('rejects malformed Last-Event-ID before opening a stream', async () => {
    const conversationId = await createWorkspaceConversation();
    const accepted = await sendWorkspaceMessage(conversationId);
    const response = await context.app.inject({
      method: 'GET',
      url: `/api/agent-runs/${accepted.run.id}/events`,
      headers: {
        ...authorization(context.tokens.author),
        accept: 'text/event-stream',
        'last-event-id': '1 OR 1=1',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_LAST_EVENT_ID');
  });

  async function createWorkspaceConversation(): Promise<string> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/workspaces/workspace-agent/conversations',
      headers: authorization(context.tokens.author),
      payload: { title: '流程问答' },
    });
    expect(response.statusCode).toBe(201);
    return response.json().conversation.id as string;
  }

  async function sendWorkspaceMessage(conversationId: string) {
    const response = await context.app.inject({
      method: 'POST',
      url: `/api/workspaces/workspace-agent/conversations/${conversationId}/messages`,
      headers: authorization(context.tokens.author),
      payload: {
        clientMessageId: `client-${conversationId}`,
        text: '检查流程',
        sources: {
          workspaceFlows: false,
          workspaceDocuments: false,
          sessionAttachments: false,
          santexwell: false,
        },
        attachmentIds: [],
      },
    });
    expect(response.statusCode).toBe(202);
    return response.json() as { run: { id: string } };
  }
});

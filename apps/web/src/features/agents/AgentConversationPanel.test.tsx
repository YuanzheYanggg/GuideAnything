import type {
  AgentCommittedAnswerV1,
  AgentMessageAcceptedV1,
  AgentRunEventV1,
  AgentRunSnapshotV1,
  ConversationDetailV1,
  ConversationSummaryV1,
} from '@guideanything/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AgentConversationPanel } from './AgentConversationPanel';
import type { AgentApi } from './types';

describe('AgentConversationPanel', () => {
  it('creates a workspace conversation and sends the explicit per-turn source switches', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderPanel(mock, { kind: 'WORKSPACE', workspaceId: 'workspace-1' });

    await user.click(await screen.findByLabelText('Santexwell'));
    await user.type(screen.getByRole('textbox', { name: '向 Agent 提问' }), '先比较当前流程中的验货节点');
    await user.click(screen.getByRole('button', { name: '发送问题' }));

    expect(mock.createWorkspace).toHaveBeenCalledWith('workspace-1', '先比较当前流程中的验货节点');
    expect(mock.sendWorkspace).toHaveBeenCalledWith('workspace-1', 'conversation-1', expect.objectContaining({
      text: '先比较当前流程中的验货节点',
      attachmentIds: [],
      sources: {
        workspaceFlows: true,
        workspaceDocuments: true,
        sessionAttachments: false,
        santexwell: false,
      },
    }));
  });

  it('keeps provisional draft and committed answer visually separate', async () => {
    const mock = api({
      listGlobal: vi.fn().mockResolvedValue([conversation('GLOBAL_SANTEXWELL')]),
      getGlobal: vi.fn().mockResolvedValue(detail('GLOBAL_SANTEXWELL')),
      streamRun: vi.fn(() => stream([
        event(1, 'route.completed', { route: 'FOCUSED', userFacingPlan: '先定位概念页。' }),
        event(2, 'answer.draft.delta', { delta: '暂定结论' }),
        event(3, 'answer.committed', { answer: committedAnswer }, 'COMMITTED'),
        event(4, 'run.completed', { messageId: 'assistant-1' }, 'COMMITTED'),
      ])),
    });
    renderPanel(mock, { kind: 'GLOBAL' }, '/knowledge/santexwell?conversation=conversation-1');

    expect((await screen.findByText('暂定结论')).closest('.agent-draft')).not.toBeNull();
    expect(await screen.findByText(committedAnswer.conclusion)).toBeVisible();
    expect(screen.getByText(committedAnswer.conclusion).closest('.agent-answer-committed')).not.toBeNull();
    expect(screen.getByText('聚焦检索')).toBeVisible();
  });

  it('locks global conversations to the Santexwell-only source policy', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderPanel(mock, { kind: 'GLOBAL' });

    expect(await screen.findByText('本轮仅访问 Santexwell Vault')).toBeVisible();
    expect(screen.queryByLabelText('流程')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '向 Agent 提问' }), '花式纱有什么分类？');
    await user.click(screen.getByRole('button', { name: '发送问题' }));

    expect(mock.sendGlobal).toHaveBeenCalledWith('conversation-1', expect.objectContaining({
      sources: { workspaceFlows: false, workspaceDocuments: false, sessionAttachments: false, santexwell: true },
    }));
  });
});

const committedAnswer: AgentCommittedAnswerV1 = {
  mode: 'ANSWER',
  conclusion: '花式纱可按结构、成纱方式和视觉效果分类。',
  sections: [],
  evidenceStatus: 'SUPPORTED',
  citations: [],
  flowFeedback: [],
  artifacts: [],
  suggestedQuestions: [],
};

function renderPanel(api: AgentApi, scope: { kind: 'GLOBAL' } | { kind: 'WORKSPACE'; workspaceId: string }, path = '/workspaces/workspace-1/agents?conversation=new') {
  render(<MemoryRouter initialEntries={[path]}><AgentConversationPanel api={api} scope={scope} /></MemoryRouter>);
}

function api(overrides: Partial<AgentApi> = {}): AgentApi {
  const globalConversation = conversation('GLOBAL_SANTEXWELL');
  const workspaceConversation = conversation('WORKSPACE');
  return {
    listGlobal: vi.fn().mockResolvedValue([]),
    createGlobal: vi.fn().mockResolvedValue(globalConversation),
    getGlobal: vi.fn().mockResolvedValue(detail('GLOBAL_SANTEXWELL')),
    sendGlobal: vi.fn().mockResolvedValue(accepted(globalConversation)),
    listWorkspace: vi.fn().mockResolvedValue([]),
    createWorkspace: vi.fn().mockResolvedValue(workspaceConversation),
    getWorkspace: vi.fn().mockResolvedValue(detail('WORKSPACE')),
    sendWorkspace: vi.fn().mockResolvedValue(accepted(workspaceConversation)),
    getRun: vi.fn().mockResolvedValue(run()),
    streamRun: vi.fn(() => stream([])),
    cancelRun: vi.fn().mockResolvedValue({ ...run(), status: 'CANCELLED', completedAt: '2026-07-15T00:00:03.000Z' }),
    steerRun: vi.fn().mockResolvedValue({ ...run(), planVersion: 2 }),
    ...overrides,
  };
}

function conversation(scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE'): ConversationSummaryV1 {
  return {
    id: 'conversation-1',
    scope,
    workspaceId: scope === 'WORKSPACE' ? 'workspace-1' : null,
    title: '花式纱分类',
    status: 'ACTIVE',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  } as ConversationSummaryV1;
}

function detail(scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE'): ConversationDetailV1 {
  return { conversation: conversation(scope), messages: [], latestRun: run(), attachments: [] };
}

function run(): AgentRunSnapshotV1 {
  return {
    id: 'run-1', conversationId: 'conversation-1', initiatingMessageId: 'message-1', runSequence: 1,
    planVersion: 1, route: null, status: 'RUNNING',
    sources: { workspaceFlows: false, workspaceDocuments: false, sessionAttachments: false, santexwell: true },
    lastEventSequence: 0, createdAt: '2026-07-15T00:00:00.000Z', startedAt: '2026-07-15T00:00:00.000Z',
    completedAt: null, updatedAt: '2026-07-15T00:00:00.000Z', error: null,
  };
}

function accepted(target: ConversationSummaryV1): AgentMessageAcceptedV1 {
  const nextRun = { ...run(), conversationId: target.id };
  return {
    message: {
      id: 'message-1', role: 'USER', clientMessageId: 'client-1', content: '问题', sources: nextRun.sources,
      createdAt: '2026-07-15T00:00:00.000Z',
    },
    run: nextRun,
    eventsPath: '/agent-runs/run-1/events',
  };
}

function event<T extends AgentRunEventV1['type']>(
  sequence: number,
  type: T,
  payload: Extract<AgentRunEventV1, { type: T }>['payload'],
  phase: AgentRunEventV1['phase'] = 'PROVISIONAL',
): Extract<AgentRunEventV1, { type: T }> {
  return {
    id: `event-${sequence}`, runId: 'run-1', sequence, planVersion: 1, phase, type, payload,
    createdAt: `2026-07-15T00:00:0${sequence}.000Z`,
  } as Extract<AgentRunEventV1, { type: T }>;
}

async function* stream(events: AgentRunEventV1[]) {
  for (const item of events) yield item;
}

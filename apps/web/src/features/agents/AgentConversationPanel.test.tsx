import type {
  AgentCommittedAnswerV1,
  AgentMessageAcceptedV1,
  AgentRunEventV1,
  AgentRunSnapshotV1,
  ConversationAttachmentSummaryV1,
  ConversationDetailV1,
  ConversationSummaryV1,
} from '@guideanything/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
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

  it('uploads a private attachment and binds it explicitly to the next workspace message', async () => {
    const user = userEvent.setup();
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([conversation('WORKSPACE')]),
      getWorkspace: vi.fn().mockResolvedValue({ ...detail('WORKSPACE'), latestRun: null }),
      uploadAttachment: vi.fn().mockResolvedValue({
        id: 'attachment-1', originalName: '验货清单.md', mimeType: 'text/markdown', size: 12,
        status: 'READY', expiresAt: '2026-07-22T00:00:00.000Z',
        createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
      }),
    });
    renderPanel(mock, { kind: 'WORKSPACE', workspaceId: 'workspace-1' }, '/workspaces/workspace-1/agents?conversation=conversation-1');

    const file = new File(['验货检查内容'], '验货清单.md', { type: 'text/markdown' });
    await user.upload(await screen.findByLabelText('添加会话附件'), file);
    expect(mock.uploadAttachment).toHaveBeenCalledWith('workspace-1', 'conversation-1', file);
    expect(await screen.findByText('验货清单.md')).toBeVisible();

    await user.type(screen.getByRole('textbox', { name: '向 Agent 提问' }), '这份清单和当前流程有冲突吗？');
    await user.click(screen.getByRole('button', { name: '发送问题' }));
    expect(mock.sendWorkspace).toHaveBeenCalledWith('workspace-1', 'conversation-1', expect.objectContaining({
      attachmentIds: ['attachment-1'],
      sources: expect.objectContaining({ sessionAttachments: true }),
    }));
  });

  it('creates a private workspace conversation before uploading its first attachment', async () => {
    const user = userEvent.setup();
    const mock = api({
      uploadAttachment: vi.fn().mockResolvedValue({
        id: 'attachment-first', originalName: '说明.txt', mimeType: 'text/plain', size: 4,
        status: 'READY', expiresAt: '2026-07-22T00:00:00.000Z',
        createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
      }),
    });
    renderPanel(mock, { kind: 'WORKSPACE', workspaceId: 'workspace-1' });

    const file = new File(['说明'], '说明.txt', { type: 'text/plain' });
    await user.upload(await screen.findByLabelText('添加会话附件'), file);

    expect(mock.createWorkspace).toHaveBeenCalledWith('workspace-1', '新对话');
    expect(mock.uploadAttachment).toHaveBeenCalledWith('workspace-1', 'conversation-1', file);
    expect(await screen.findByRole('checkbox', { name: '本轮使用附件 说明.txt' })).toBeChecked();
  });

  it('locks sending and conversation choices while an attachment upload is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<ConversationAttachmentSummaryV1>();
    const first = namedConversation('conversation-1', '第一会话');
    const second = namedConversation('conversation-2', '第二会话');
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([first, second]),
      getWorkspace: vi.fn().mockImplementation((_workspaceId, conversationId) => Promise.resolve(
        idleDetail(conversationId === second.id ? second : first),
      )),
      uploadAttachment: vi.fn().mockReturnValue(pending.promise),
    });
    renderPanel(mock, { kind: 'WORKSPACE', workspaceId: 'workspace-1' }, '/workspaces/workspace-1/agents?conversation=conversation-1');

    const prompt = await screen.findByRole('textbox', { name: '向 Agent 提问' });
    await user.type(prompt, '等附件上传完成后再发送');
    await user.upload(screen.getByLabelText('添加会话附件'), new File(['内容'], '等待.md', { type: 'text/markdown' }));

    expect(prompt).toBeDisabled();
    expect(screen.getByRole('button', { name: /第二会话/u })).toBeDisabled();
    pending.resolve(attachment('attachment-waiting', '等待.md'));
    expect(await screen.findByText('等待.md')).toBeVisible();
  });

  it('does not carry an in-flight attachment into a conversation selected through the URL', async () => {
    const user = userEvent.setup();
    const pending = deferred<ConversationAttachmentSummaryV1>();
    const first = namedConversation('conversation-1', '第一会话');
    const second = namedConversation('conversation-2', '第二会话');
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([first, second]),
      getWorkspace: vi.fn().mockImplementation((_workspaceId, conversationId) => Promise.resolve(
        idleDetail(conversationId === second.id ? second : first),
      )),
      uploadAttachment: vi.fn().mockReturnValue(pending.promise),
    });
    renderNavigablePanel(mock, '/workspaces/workspace-1/agents?conversation=conversation-1');

    await screen.findByRole('heading', { name: '第一会话' });
    await user.upload(screen.getByLabelText('添加会话附件'), new File(['A'], '会话A.md', { type: 'text/markdown' }));
    await user.click(screen.getByRole('button', { name: '模拟历史记录切换到第二会话' }));
    await screen.findByRole('heading', { name: '第二会话' });

    pending.resolve(attachment('attachment-a', '会话A.md'));
    await screen.findByText('添加附件');
    expect(screen.getByRole('heading', { name: '第二会话' })).toBeVisible();
    expect(screen.queryByText('会话A.md')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '向 Agent 提问' }), '第二会话的问题');
    await user.click(screen.getByRole('button', { name: '发送问题' }));
    expect(mock.sendWorkspace).toHaveBeenCalledWith('workspace-1', 'conversation-2', expect.objectContaining({
      attachmentIds: [],
      sources: expect.objectContaining({ sessionAttachments: false }),
    }));
  });

  it('does not show a stale attachment failure after navigating to another conversation', async () => {
    const user = userEvent.setup();
    const pending = deferred<ConversationAttachmentSummaryV1>();
    const first = namedConversation('conversation-1', '第一会话');
    const second = namedConversation('conversation-2', '第二会话');
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([first, second]),
      getWorkspace: vi.fn().mockImplementation((_workspaceId, conversationId) => Promise.resolve(
        idleDetail(conversationId === second.id ? second : first),
      )),
      uploadAttachment: vi.fn().mockReturnValue(pending.promise),
    });
    renderNavigablePanel(mock, '/workspaces/workspace-1/agents?conversation=conversation-1');

    await screen.findByRole('heading', { name: '第一会话' });
    await user.upload(screen.getByLabelText('添加会话附件'), new File(['A'], '会话A.md', { type: 'text/markdown' }));
    await user.click(screen.getByRole('button', { name: '模拟历史记录切换到第二会话' }));
    await screen.findByRole('heading', { name: '第二会话' });

    pending.reject(new Error('会话 A 上传失败'));
    await waitFor(() => expect(conversationButton('第二会话')).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps an in-flight send response out of a conversation selected through the URL', async () => {
    const user = userEvent.setup();
    const pending = deferred<AgentMessageAcceptedV1>();
    const first = namedConversation('conversation-1', '第一会话');
    const second = namedConversation('conversation-2', '第二会话');
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([first, second]),
      getWorkspace: vi.fn().mockImplementation((_workspaceId, conversationId) => Promise.resolve(
        idleDetail(conversationId === second.id ? second : first),
      )),
      sendWorkspace: vi.fn().mockReturnValue(pending.promise),
    });
    renderNavigablePanel(mock, '/workspaces/workspace-1/agents?conversation=conversation-1');

    await screen.findByRole('heading', { name: '第一会话' });
    await user.type(screen.getByRole('textbox', { name: '向 Agent 提问' }), '会话 A 的问题');
    await user.click(screen.getByRole('button', { name: '发送问题' }));
    expect(conversationButton('第二会话')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '模拟历史记录切换到第二会话' }));
    await screen.findByRole('heading', { name: '第二会话' });
    expect(screen.getByRole('textbox', { name: '向 Agent 提问' })).toHaveValue('');
    pending.resolve(accepted(first));

    await waitFor(() => expect(conversationButton('第二会话')).toBeEnabled());
    expect(screen.getByRole('heading', { name: '第二会话' })).toBeVisible();
    expect(screen.queryByText('问题')).not.toBeInTheDocument();
  });

  it('does not replace a URL-selected conversation when a pending send creates a new conversation', async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<ConversationSummaryV1>();
    const second = namedConversation('conversation-2', '第二会话');
    const created = namedConversation('conversation-created', '新建会话');
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([second]),
      getWorkspace: vi.fn().mockResolvedValue(idleDetail(second)),
      createWorkspace: vi.fn().mockReturnValue(pendingCreate.promise),
    });
    renderNavigablePanel(mock, '/workspaces/workspace-1/agents?conversation=new');

    await user.type(await screen.findByRole('textbox', { name: '向 Agent 提问' }), '新会话问题');
    await user.click(screen.getByRole('button', { name: '发送问题' }));
    await user.click(screen.getByRole('button', { name: '模拟历史记录切换到第二会话' }));
    await screen.findByRole('heading', { name: '第二会话' });
    pendingCreate.resolve(created);

    await waitFor(() => expect(conversationButton('第二会话')).toBeEnabled());
    expect(screen.getByRole('heading', { name: '第二会话' })).toBeVisible();
    expect(mock.sendWorkspace).not.toHaveBeenCalled();
  });

  it('does not replace a URL-selected conversation when a pending upload creates a new conversation', async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<ConversationSummaryV1>();
    const second = namedConversation('conversation-2', '第二会话');
    const created = namedConversation('conversation-created', '新建会话');
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([second]),
      getWorkspace: vi.fn().mockResolvedValue(idleDetail(second)),
      createWorkspace: vi.fn().mockReturnValue(pendingCreate.promise),
    });
    renderNavigablePanel(mock, '/workspaces/workspace-1/agents?conversation=new');

    await user.upload(await screen.findByLabelText('添加会话附件'), new File(['新'], '新附件.md', { type: 'text/markdown' }));
    await user.click(screen.getByRole('button', { name: '模拟历史记录切换到第二会话' }));
    await screen.findByRole('heading', { name: '第二会话' });
    pendingCreate.resolve(created);

    await waitFor(() => expect(conversationButton('第二会话')).toBeEnabled());
    expect(screen.getByRole('heading', { name: '第二会话' })).toBeVisible();
    expect(mock.uploadAttachment).not.toHaveBeenCalled();
  });

  it('cannot enable the attachment source without a selected ready attachment', async () => {
    const user = userEvent.setup();
    const target = namedConversation('conversation-1', '无附件会话');
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([target]),
      getWorkspace: vi.fn().mockResolvedValue(idleDetail(target)),
    });
    renderPanel(mock, { kind: 'WORKSPACE', workspaceId: 'workspace-1' }, '/workspaces/workspace-1/agents?conversation=conversation-1');

    const source = await screen.findByLabelText('附件');
    expect(source).toBeDisabled();
    await user.click(source);
    expect(source).not.toBeChecked();
    await user.type(screen.getByRole('textbox', { name: '向 Agent 提问' }), '只看工作区资料');
    await user.click(screen.getByRole('button', { name: '发送问题' }));
    expect(mock.sendWorkspace).toHaveBeenCalledWith('workspace-1', 'conversation-1', expect.objectContaining({
      attachmentIds: [],
      sources: expect.objectContaining({ sessionAttachments: false }),
    }));
  });

  it('keeps a committed answer in the transcript when the next run starts', async () => {
    const user = userEvent.setup();
    const target = conversation('GLOBAL_SANTEXWELL');
    const mock = api({
      listGlobal: vi.fn().mockResolvedValue([target]),
      getGlobal: vi.fn().mockResolvedValue(detail('GLOBAL_SANTEXWELL')),
      sendGlobal: vi.fn().mockResolvedValue(acceptedFor(target, 'run-2', 'message-2', 2)),
      streamRun: vi.fn((path) => path.includes('run-1') ? stream([
        event(1, 'answer.committed', { answer: committedAnswer }, 'COMMITTED'),
        event(2, 'run.completed', { messageId: 'assistant-1' }, 'COMMITTED'),
      ]) : stream([])),
    });
    renderPanel(mock, { kind: 'GLOBAL' }, '/knowledge/santexwell?conversation=conversation-1');

    expect(await screen.findByText(committedAnswer.conclusion)).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: '向 Agent 提问' }), '继续说明');
    await user.click(screen.getByRole('button', { name: '发送问题' }));

    await waitFor(() => expect(mock.sendGlobal).toHaveBeenCalledTimes(1));
    expect(screen.getByText(committedAnswer.conclusion)).toBeVisible();
  });

  it('keeps validated flow feedback navigable and exposes global artifacts inline', async () => {
    const user = userEvent.setup();
    const target = conversation('GLOBAL_SANTEXWELL');
    const answer: AgentCommittedAnswerV1 = {
      ...committedAnswer,
      flowFeedback: [{
        kind: 'GAP', message: '流程缺少复核节点。', referenceId: 'reference-flow', href: '/references/reference-flow',
      }, {
        kind: 'CONFLICT', message: '旧节点已经失效。', referenceId: 'reference-stale', href: null,
        invalidReason: '对应流程版本已经更新。',
      }],
      artifacts: [{
        id: 'artifact-global', runId: 'run-existing', kind: 'REPORT', title: '全局分析报告', summary: '跨页面结论。',
        sections: [{ title: '发现', markdown: '可验证的 **报告内容**。' }], createdAt: '2026-07-15T00:00:00.000Z',
      }],
    };
    const withAnswer: ConversationDetailV1 = {
      conversation: target,
      messages: [{ id: 'assistant-existing', role: 'ASSISTANT', runId: 'run-existing', answer, createdAt: '2026-07-15T00:00:00.000Z' }],
      latestRun: null,
      attachments: [],
    };
    const mock = api({
      listGlobal: vi.fn().mockResolvedValue([target]),
      getGlobal: vi.fn().mockResolvedValue(withAnswer),
    });
    renderPanel(mock, { kind: 'GLOBAL' }, '/knowledge/santexwell?conversation=conversation-1');

    expect(await screen.findByRole('link', { name: /流程缺少复核节点/u })).toHaveAttribute(
      'href', '/references/reference-flow?returnTo=%2Fknowledge%2Fsantexwell%3Fconversation%3Dconversation-1',
    );
    expect(screen.getByText('对应流程版本已经更新。')).toBeVisible();
    await user.click(screen.getByText('报告 · 全局分析报告'));
    expect(await screen.findByRole('heading', { name: '全局分析报告' })).toBeVisible();
    expect(screen.getByText('报告内容')).toBeVisible();
  });

  it('focuses the conversation message selected by a validated reference', async () => {
    const target = conversation('WORKSPACE');
    const targetDetail: ConversationDetailV1 = {
      conversation: target,
      messages: [{
        id: 'message-target', role: 'USER', clientMessageId: 'client-target', content: '需要定位的历史问题',
        sources: { workspaceFlows: true, workspaceDocuments: true, sessionAttachments: false, santexwell: false },
        createdAt: '2026-07-15T00:00:00.000Z',
      }],
      latestRun: null,
      attachments: [],
    };
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const mock = api({
      listWorkspace: vi.fn().mockResolvedValue([target]),
      getWorkspace: vi.fn().mockResolvedValue(targetDetail),
    });
    renderPanel(
      mock,
      { kind: 'WORKSPACE', workspaceId: 'workspace-1' },
      '/workspaces/workspace-1/agents?conversation=conversation-1&message=message-target&returnTo=%2Fworkspaces%2Fworkspace-1%2Fagents%3Fconversation%3Dorigin',
    );

    const message = (await screen.findByText('需要定位的历史问题')).closest('article');
    await waitFor(() => expect(message).toHaveFocus());
    expect(message).toHaveClass('is-target');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /返回引用来源/u })).toHaveAttribute(
      'href', '/workspaces/workspace-1/agents?conversation=origin',
    );
  });

  it('submits one steer while the control request is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<AgentRunSnapshotV1>();
    const mock = api({ steerRun: vi.fn().mockReturnValue(pending.promise) });
    renderPanel(mock, { kind: 'WORKSPACE', workspaceId: 'workspace-1' }, '/workspaces/workspace-1/agents?conversation=conversation-1');

    await user.click(await screen.findByRole('button', { name: '调整方向' }));
    await user.type(screen.getByLabelText('告诉调度器接下来要调整什么'), '只看当前流程');
    const apply = screen.getByRole('button', { name: '应用' });
    await user.dblClick(apply);

    expect(mock.steerRun).toHaveBeenCalledTimes(1);
    expect(apply).toBeDisabled();
    pending.resolve({ ...run(), planVersion: 2 });
    await waitFor(() => expect(screen.queryByRole('button', { name: '应用' })).not.toBeInTheDocument());
  });

  it('follows streamed output only while the message viewport remains near the bottom', async () => {
    const firstDelta = deferred<void>();
    const secondDelta = deferred<void>();
    const mock = api({
      streamRun: vi.fn(async function* () {
        await firstDelta.promise;
        yield event(1, 'answer.draft.delta', { delta: '第一段' });
        await secondDelta.promise;
        yield event(2, 'answer.draft.delta', { delta: '第二段' });
      }),
    });
    renderPanel(mock, { kind: 'WORKSPACE', workspaceId: 'workspace-1' }, '/workspaces/workspace-1/agents?conversation=conversation-1');

    const viewport = await screen.findByLabelText('会话消息');
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, get: () => 1_000 },
      clientHeight: { configurable: true, get: () => 300 },
    });
    viewport.scrollTop = 650;
    fireEvent.scroll(viewport);
    firstDelta.resolve();
    expect(await screen.findByText('第一段')).toBeVisible();
    await waitFor(() => expect(viewport.scrollTop).toBe(1_000));

    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    secondDelta.resolve();
    expect(await screen.findByText('第一段第二段')).toBeVisible();
    expect(viewport.scrollTop).toBe(100);
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

function renderNavigablePanel(api: AgentApi, path: string) {
  render(<MemoryRouter initialEntries={[path]}>
    <HistoryNavigationTarget />
    <AgentConversationPanel api={api} scope={{ kind: 'WORKSPACE', workspaceId: 'workspace-1' }} />
  </MemoryRouter>);
}

function conversationButton(name: string) {
  return within(screen.getByLabelText('会话列表')).getByRole('button', { name: new RegExp(name, 'u') });
}

function HistoryNavigationTarget() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/workspaces/workspace-1/agents?conversation=conversation-2')}>
    模拟历史记录切换到第二会话
  </button>;
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
    uploadAttachment: vi.fn(),
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

function namedConversation(id: string, title: string): ConversationSummaryV1 {
  return { ...conversation('WORKSPACE'), id, title };
}

function idleDetail(target: ConversationSummaryV1): ConversationDetailV1 {
  return { conversation: target, messages: [], latestRun: null, attachments: [] };
}

function attachment(id: string, originalName: string): ConversationAttachmentSummaryV1 {
  return {
    id,
    originalName,
    mimeType: 'text/markdown',
    size: 12,
    status: 'READY',
    expiresAt: '2026-07-22T00:00:00.000Z',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
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
  return acceptedFor(target, 'run-1', 'message-1', 1);
}

function acceptedFor(
  target: ConversationSummaryV1,
  runId: string,
  messageId: string,
  runSequence: number,
): AgentMessageAcceptedV1 {
  const nextRun = { ...run(), id: runId, conversationId: target.id, initiatingMessageId: messageId, runSequence };
  return {
    message: {
      id: messageId, role: 'USER', clientMessageId: `client-${messageId}`, content: '问题', sources: nextRun.sources,
      createdAt: '2026-07-15T00:00:00.000Z',
    },
    run: nextRun,
    eventsPath: `/agent-runs/${runId}/events`,
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

import { describe, expect, it } from 'vitest';

import {
  AgentRunSnapshotV1Schema,
  ConversationDetailV1Schema,
  ConversationSummaryV1Schema,
  CreateConversationRequestV1Schema,
  AgentMessageAcceptedV1Schema,
  ReferenceResolutionV1Schema,
  SendConversationMessageRequestV1Schema,
  SendGlobalConversationMessageRequestV1Schema,
} from './conversation-api';
import { AgentRunEventV1Schema, PublicRoutePlanV1Schema } from './agent-runtime';

const now = '2026-07-15T00:00:00.000Z';

describe('conversation API contracts', () => {
  it('keeps global and workspace conversation identities mutually exclusive', () => {
    expect(CreateConversationRequestV1Schema.parse({
      scope: 'GLOBAL_SANTEXWELL',
      title: '花式纱分类',
    })).toEqual({ scope: 'GLOBAL_SANTEXWELL', title: '花式纱分类' });

    expect(CreateConversationRequestV1Schema.safeParse({
      scope: 'GLOBAL_SANTEXWELL',
      workspaceId: 'workspace-1',
    }).success).toBe(false);
    expect(CreateConversationRequestV1Schema.safeParse({
      scope: 'WORKSPACE',
    }).success).toBe(false);

    expect(ConversationSummaryV1Schema.safeParse({
      id: 'conversation-1',
      scope: 'WORKSPACE',
      workspaceId: null,
      title: '流程问答',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    }).success).toBe(false);
  });

  it('accepts opaque selected context and rejects path-bearing additions', () => {
    const request = SendConversationMessageRequestV1Schema.parse({
      clientMessageId: 'client-message-1',
      text: '这个审批节点由谁负责？',
      sources: {
        workspaceFlows: true,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: true,
      },
      selectedContext: {
        kind: 'FLOW_NODE',
        snapshotId: 'snapshot-1',
        nodeId: 'approve',
      },
      attachmentIds: [],
    });
    expect(request.selectedContext).toEqual({
      kind: 'FLOW_NODE',
      snapshotId: 'snapshot-1',
      nodeId: 'approve',
    });

    expect(SendConversationMessageRequestV1Schema.safeParse({
      ...request,
      selectedContext: {
        kind: 'KNOWLEDGE_FRAGMENT',
        documentId: 'document-1',
        fragmentId: 'fragment-1',
        relativePath: 'wiki_v2/concepts/private.md',
      },
    }).success).toBe(false);
  });

  it('keeps global messages Santexwell-only with no attachments or workspace context', () => {
    const base = {
      clientMessageId: 'client-global-1',
      text: '花式纱有哪些分类？',
      sources: {
        workspaceFlows: false as const,
        workspaceDocuments: false as const,
        sessionAttachments: false as const,
        santexwell: true as const,
      },
      attachmentIds: [],
    };
    expect(SendGlobalConversationMessageRequestV1Schema.safeParse({
      ...base,
      selectedContext: { kind: 'KNOWLEDGE_FRAGMENT', documentId: 'document-1', fragmentId: 'fragment-1' },
    }).success).toBe(true);
    expect(SendGlobalConversationMessageRequestV1Schema.safeParse({
      ...base,
      selectedContext: { kind: 'FLOW_NODE', snapshotId: 'snapshot-1', nodeId: 'approve' },
    }).success).toBe(false);
    expect(SendGlobalConversationMessageRequestV1Schema.safeParse({
      ...base,
      attachmentIds: ['attachment-1'],
    }).success).toBe(false);
    expect(SendGlobalConversationMessageRequestV1Schema.safeParse({
      ...base,
      sources: { ...base.sources, sessionAttachments: true },
    }).success).toBe(false);
  });

  it('separates user text from committed assistant answers', () => {
    const detail = ConversationDetailV1Schema.parse({
      conversation: {
        id: 'conversation-1',
        scope: 'GLOBAL_SANTEXWELL',
        workspaceId: null,
        title: '花式纱分类',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
      messages: [
        {
          id: 'message-user',
          role: 'USER',
          clientMessageId: 'client-message-1',
          content: '花式纱有哪些分类？',
          sources: {
            workspaceFlows: false,
            workspaceDocuments: false,
            sessionAttachments: false,
            santexwell: true,
          },
          createdAt: now,
        },
        {
          id: 'message-assistant',
          role: 'ASSISTANT',
          runId: 'run-1',
          answer: {
            mode: 'ANSWER',
            conclusion: '可按结构、成纱方式与效果分类。',
            sections: [],
            evidenceStatus: 'SUPPORTED',
            citations: [],
            flowFeedback: [],
            artifacts: [],
            suggestedQuestions: [],
          },
          createdAt: now,
        },
      ],
      latestRun: null,
      attachments: [],
    });

    expect(detail.messages[0]?.role).toBe('USER');
    expect(detail.messages[1]?.role).toBe('ASSISTANT');
    expect(JSON.stringify(detail)).not.toMatch(/locator|storageKey|runtimeThreadId|\/Users\//u);
  });

  it('publishes only a user-facing route plan', () => {
    const plan = PublicRoutePlanV1Schema.parse({
      route: 'COMPOSITE',
      userFacingPlan: '先检查工作区流程和资料，再按需补充知识库依据。',
      executionMode: 'PARALLEL',
      tasks: [
        { id: 'flow', label: '检查当前流程', sourceKind: 'WORKSPACE_FLOW' },
        { id: 'vault', label: '补充知识库依据', sourceKind: 'SANTEXWELL' },
        { id: 'reduce', label: '汇总已验证结果', sourceKind: 'REDUCE' },
      ],
    });
    expect(plan).not.toHaveProperty('contextAssessment');
    expect(plan).not.toHaveProperty('budget');
    expect(PublicRoutePlanV1Schema.safeParse({
      ...plan,
      contextAssessment: 'private router rationale',
    }).success).toBe(false);
    expect(AgentRunEventV1Schema.parse({
      id: 'event-1',
      runId: 'run-1',
      sequence: 1,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'plan.committed',
      payload: { plan },
      createdAt: now,
    }).payload).toEqual({ plan });
    expect(AgentRunEventV1Schema.safeParse({
      id: 'event-2',
      runId: 'run-1',
      sequence: 2,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'plan.committed',
      payload: { decision: { contextAssessment: 'private router rationale' } },
      createdAt: now,
    }).success).toBe(false);
  });

  it('models replayable run state without internal route decisions', () => {
    const run = AgentRunSnapshotV1Schema.parse({
      id: 'run-1',
      conversationId: 'conversation-1',
      initiatingMessageId: 'message-user',
      runSequence: 1,
      planVersion: 2,
      route: 'FOCUSED',
      status: 'RUNNING',
      sources: {
        workspaceFlows: true,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: false,
      },
      lastEventSequence: 12,
      createdAt: now,
      startedAt: now,
      completedAt: null,
      updatedAt: now,
      error: null,
    });
    expect(run.lastEventSequence).toBe(12);
    expect(run).not.toHaveProperty('routeDecision');
  });

  it('rejects mismatched accepted runs and impossible run states', () => {
    const message = {
      id: 'message-user',
      role: 'USER' as const,
      clientMessageId: 'client-message-1',
      content: '检查当前节点。',
      sources: {
        workspaceFlows: true,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: false,
      },
      createdAt: now,
    };
    const run = {
      id: 'run-1',
      conversationId: 'conversation-1',
      initiatingMessageId: message.id,
      runSequence: 1,
      planVersion: 1,
      route: null,
      status: 'QUEUED' as const,
      sources: message.sources,
      lastEventSequence: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      error: null,
    };
    expect(AgentMessageAcceptedV1Schema.safeParse({
      message,
      run,
      eventsPath: '/agent-runs/run-1/events',
    }).success).toBe(true);
    expect(AgentMessageAcceptedV1Schema.safeParse({
      message,
      run: { ...run, initiatingMessageId: 'other-message' },
      eventsPath: '/agent-runs/run-1/events',
    }).success).toBe(false);
    expect(AgentMessageAcceptedV1Schema.safeParse({
      message,
      run: { ...run, sources: { ...run.sources, santexwell: true } },
      eventsPath: '/agent-runs/run-1/events',
    }).success).toBe(false);
    expect(AgentRunSnapshotV1Schema.safeParse({
      ...run,
      route: 'FOCUSED',
      publicPlan: {
        route: 'DIRECT', userFacingPlan: '错误路线', executionMode: 'SEQUENTIAL', tasks: [],
      },
    }).success).toBe(false);
    expect(AgentRunSnapshotV1Schema.safeParse({
      ...run,
      status: 'COMPLETED',
      completedAt: null,
    }).success).toBe(false);
    expect(AgentRunSnapshotV1Schema.safeParse({
      ...run,
      status: 'COMPLETED',
      completedAt: now,
      error: { code: 'SHOULD_NOT_EXIST', message: '不应存在', retryable: false },
    }).success).toBe(false);
  });

  it('binds detail runs and global message sources to the conversation', () => {
    const globalConversation = {
      id: 'conversation-global',
      scope: 'GLOBAL_SANTEXWELL' as const,
      workspaceId: null,
      title: '全局问答',
      status: 'ACTIVE' as const,
      createdAt: now,
      updatedAt: now,
    };
    const globalUserMessage = {
      id: 'message-global',
      role: 'USER' as const,
      clientMessageId: 'client-global',
      content: '问题',
      sources: {
        workspaceFlows: false,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: true,
      },
      createdAt: now,
    };
    expect(ConversationDetailV1Schema.safeParse({
      conversation: globalConversation,
      messages: [{
        ...globalUserMessage,
        sources: { ...globalUserMessage.sources, workspaceFlows: true },
      }],
      latestRun: null,
      attachments: [],
    }).success).toBe(false);
    expect(ConversationDetailV1Schema.safeParse({
      conversation: globalConversation,
      messages: [globalUserMessage],
      latestRun: {
        id: 'run-other',
        conversationId: 'other-conversation',
        initiatingMessageId: globalUserMessage.id,
        runSequence: 1,
        planVersion: 1,
        route: null,
        status: 'QUEUED',
        sources: globalUserMessage.sources,
        lastEventSequence: 0,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
        error: null,
      },
      attachments: [],
    }).success).toBe(false);
  });

  it('allows only safe app-local reference destinations', () => {
    const resolved = ReferenceResolutionV1Schema.parse({
      status: 'VALID',
      referenceId: 'reference-1',
      source: 'WORKSPACE_FLOW',
      title: '审批节点',
      excerpt: '审批节点由质量负责人确认。',
      target: {
        kind: 'PUBLISHED_FLOW_NODE',
        href: '/versions/version-1/learn?nodeId=approve',
      },
    });
    expect(resolved.status === 'VALID' && resolved.target.href).toBe('/versions/version-1/learn?nodeId=approve');

    expect(ReferenceResolutionV1Schema.parse({
      status: 'VALID',
      referenceId: 'reference-santexwell',
      source: 'SANTEXWELL',
      title: '知识页',
      excerpt: '知识页摘要。',
      target: {
        kind: 'SANTEXWELL_FRAGMENT',
        href: '/knowledge/santexwell/documents/document-1?fragment=fragment-1',
      },
    }).status).toBe('VALID');

    expect(ReferenceResolutionV1Schema.parse({
      status: 'VALID',
      referenceId: 'reference-attachment',
      source: 'SESSION_ATTACHMENT',
      title: '会话附件',
      excerpt: '附件摘要。',
      target: {
        kind: 'CONVERSATION_MESSAGE',
        href: '/workspaces/workspace-1/agents?conversation=conversation-1&message=message-1',
      },
    }).status).toBe('VALID');

    for (const href of [
      'https://example.com',
      '//example.com/path',
      '/api/private',
      '/knowledge/santexwell\\secret',
      '/knowledge/santexwell?token=secret',
      '/api/../versions/version-1/learn?nodeId=approve',
      '/api/%2e%2e/knowledge/santexwell?document=document-1',
    ]) {
      expect(ReferenceResolutionV1Schema.safeParse({
        status: 'VALID',
        referenceId: 'reference-1',
        source: 'SANTEXWELL',
        title: '知识页',
        excerpt: '知识页摘要。',
        target: { kind: 'SANTEXWELL_FRAGMENT', href },
      }).success, href).toBe(false);
    }

    expect(ReferenceResolutionV1Schema.safeParse({
      status: 'VALID',
      referenceId: 'reference-wrong-source',
      source: 'SANTEXWELL',
      title: '错误映射',
      excerpt: '错误映射。',
      target: { kind: 'PUBLISHED_FLOW_NODE', href: '/versions/version-1/learn?nodeId=approve' },
    }).success).toBe(false);
    expect(ReferenceResolutionV1Schema.safeParse({
      status: 'VALID',
      referenceId: 'reference-conversation',
      source: 'PRIOR_CONVERSATION',
      title: '历史对话',
      excerpt: '历史结论。',
      target: { kind: 'CONVERSATION_MESSAGE', href: '/knowledge/santexwell?conversation=conversation-1' },
    }).success).toBe(false);

    expect(ReferenceResolutionV1Schema.parse({
      status: 'INVALID',
      referenceId: 'reference-2',
      title: '已失效引用',
      excerpt: '原始证据摘要。',
      reasonCode: 'STALE',
      invalidReason: '原引用已失效。',
    }).status).toBe('INVALID');
  });
});

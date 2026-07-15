import { describe, expect, it } from 'vitest';

import {
  AgentRunSnapshotV1Schema,
  ConversationDetailV1Schema,
  ConversationSummaryV1Schema,
  CreateConversationRequestV1Schema,
  ReferenceResolutionV1Schema,
  SendConversationMessageRequestV1Schema,
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

    for (const href of [
      'https://example.com',
      '//example.com/path',
      '/api/private',
      '/knowledge/santexwell\\secret',
      '/knowledge/santexwell?token=secret',
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

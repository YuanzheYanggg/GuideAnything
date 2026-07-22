import { z } from 'zod';

import {
  AgentCommittedAnswerV1Schema,
  EvidenceSourceV1Schema,
  PublicErrorCodeV1Schema,
  PublicRoutePlanV1Schema,
  SourceOptionsV1Schema,
} from './agent-runtime';

const IdV1Schema = z.string().min(1).max(200);
const TimestampV1Schema = z.string().datetime();
const ShortTextV1Schema = z.string().min(1).max(500);

export const ConversationScopeV1Schema = z.enum(['GLOBAL_SANTEXWELL', 'WORKSPACE']);
export const ConversationStatusV1Schema = z.enum(['ACTIVE', 'ARCHIVED']);

const ConversationSummaryBaseV1Shape = {
  id: IdV1Schema,
  title: z.string().min(1).max(200),
  status: ConversationStatusV1Schema,
  lastMessagePreview: z.string().min(1).max(500).optional(),
  createdAt: TimestampV1Schema,
  updatedAt: TimestampV1Schema,
};

export const ConversationSummaryV1Schema = z.discriminatedUnion('scope', [
  z.object({
    ...ConversationSummaryBaseV1Shape,
    scope: z.literal('GLOBAL_SANTEXWELL'),
    workspaceId: z.null(),
  }).strict(),
  z.object({
    ...ConversationSummaryBaseV1Shape,
    scope: z.literal('WORKSPACE'),
    workspaceId: IdV1Schema,
  }).strict(),
]);

export const CreateConversationRequestV1Schema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('GLOBAL_SANTEXWELL'),
    title: z.string().min(1).max(200).optional(),
  }).strict(),
  z.object({
    scope: z.literal('WORKSPACE'),
    workspaceId: IdV1Schema,
    title: z.string().min(1).max(200).optional(),
  }).strict(),
]);

export const SelectedAgentContextV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('FLOW_NODE'),
    snapshotId: IdV1Schema,
    nodeId: IdV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('FLOW_SNAPSHOT'),
    snapshotId: IdV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('KNOWLEDGE_FRAGMENT'),
    documentId: IdV1Schema,
    fragmentId: IdV1Schema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('WORKSPACE_SOURCE'),
    sourceId: IdV1Schema,
  }).strict(),
]);

const MessageRequestBaseV1Shape = {
  clientMessageId: IdV1Schema,
  text: z.string().min(1).max(20_000),
  selectedContext: SelectedAgentContextV1Schema.optional(),
  attachmentIds: z.array(IdV1Schema).max(20),
};

export const SendConversationMessageRequestV1Schema = z.object({
  ...MessageRequestBaseV1Shape,
  sources: SourceOptionsV1Schema,
}).strict().superRefine((request, context) => {
  if (new Set(request.attachmentIds).size !== request.attachmentIds.length) {
    context.addIssue({ code: 'custom', path: ['attachmentIds'], message: '附件 ID 不能重复' });
  }
});

export const SendGlobalConversationMessageRequestV1Schema = z.object({
  clientMessageId: IdV1Schema,
  text: z.string().min(1).max(20_000),
  selectedContext: z.object({
    kind: z.literal('KNOWLEDGE_FRAGMENT'),
    documentId: IdV1Schema,
    fragmentId: IdV1Schema.optional(),
  }).strict().optional(),
  attachmentIds: z.array(IdV1Schema).length(0),
  sources: z.object({
    workspaceFlows: z.literal(false),
    workspaceDocuments: z.literal(false),
    sessionAttachments: z.literal(false),
    santexwell: z.literal(true),
  }).strict(),
}).strict();

export const CancelAgentRunRequestV1Schema = z.object({
  reason: z.string().min(1).max(2_000).optional(),
}).strict();

export const SteerAgentRunRequestV1Schema = z.object({
  clientSteerId: IdV1Schema,
  instruction: z.string().min(1).max(20_000),
}).strict();

export const AgentRunStatusV1Schema = z.enum([
  'QUEUED',
  'ROUTING',
  'RUNNING',
  'VALIDATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const AgentRunSnapshotV1Schema = z.object({
  id: IdV1Schema,
  conversationId: IdV1Schema,
  initiatingMessageId: IdV1Schema,
  runSequence: z.number().int().positive(),
  planVersion: z.number().int().positive(),
  route: z.enum(['DIRECT', 'FOCUSED', 'COMPOSITE', 'OPEN_RESEARCH']).nullable(),
  status: AgentRunStatusV1Schema,
  sources: SourceOptionsV1Schema,
  publicPlan: PublicRoutePlanV1Schema.optional(),
  lastEventSequence: z.number().int().min(0),
  createdAt: TimestampV1Schema,
  startedAt: TimestampV1Schema.nullable(),
  completedAt: TimestampV1Schema.nullable(),
  updatedAt: TimestampV1Schema,
  error: z.object({
    code: PublicErrorCodeV1Schema,
    message: z.string().min(1).max(2_000),
    retryable: z.boolean(),
  }).strict().nullable(),
}).strict().superRefine((run, context) => {
  if (run.publicPlan && run.publicPlan.route !== run.route) {
    context.addIssue({ code: 'custom', path: ['publicPlan', 'route'], message: '公开计划路线必须匹配运行路线' });
  }
  const terminal = run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED';
  if (terminal !== (run.completedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: '只有终态运行必须具有完成时间' });
  }
  if (run.status === 'FAILED') {
    if (run.error === null) {
      context.addIssue({ code: 'custom', path: ['error'], message: '失败运行必须包含公开错误信息' });
    }
  } else if (run.error !== null) {
    context.addIssue({ code: 'custom', path: ['error'], message: '非失败运行不能包含错误信息' });
  }
});

export const ConversationUserMessageV1Schema = z.object({
  id: IdV1Schema,
  role: z.literal('USER'),
  clientMessageId: IdV1Schema,
  content: z.string().min(1).max(20_000),
  sources: SourceOptionsV1Schema,
  createdAt: TimestampV1Schema,
}).strict();

export const ConversationAssistantMessageV1Schema = z.object({
  id: IdV1Schema,
  role: z.literal('ASSISTANT'),
  runId: IdV1Schema,
  answer: AgentCommittedAnswerV1Schema,
  createdAt: TimestampV1Schema,
}).strict();

export const ConversationMessageV1Schema = z.discriminatedUnion('role', [
  ConversationUserMessageV1Schema,
  ConversationAssistantMessageV1Schema,
]);

export const ConversationAttachmentSummaryV1Schema = z.object({
  id: IdV1Schema,
  originalName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
  size: z.number().int().min(0),
  status: z.enum(['UPLOADING', 'INDEXING', 'READY', 'FAILED', 'EXPIRED', 'DELETED']),
  failureMessage: z.string().min(1).max(1_000).optional(),
  expiresAt: TimestampV1Schema,
  createdAt: TimestampV1Schema,
  updatedAt: TimestampV1Schema,
}).strict();

export const ConversationDetailV1Schema = z.object({
  conversation: ConversationSummaryV1Schema,
  messages: z.array(ConversationMessageV1Schema).max(10_000),
  latestRun: AgentRunSnapshotV1Schema.nullable(),
  attachments: z.array(ConversationAttachmentSummaryV1Schema).max(100),
}).strict().superRefine((detail, context) => {
  if (detail.latestRun && detail.latestRun.conversationId !== detail.conversation.id) {
    context.addIssue({ code: 'custom', path: ['latestRun', 'conversationId'], message: '运行必须属于当前会话' });
  }
  const userMessageIds = new Set(
    detail.messages.filter((message) => message.role === 'USER').map((message) => message.id),
  );
  if (detail.latestRun && !userMessageIds.has(detail.latestRun.initiatingMessageId)) {
    context.addIssue({ code: 'custom', path: ['latestRun', 'initiatingMessageId'], message: '运行必须引用当前会话内的用户消息' });
  }
  if (detail.conversation.scope === 'GLOBAL_SANTEXWELL') {
    detail.messages.forEach((message, index) => {
      if (message.role === 'USER' && !isGlobalSantexwellSources(message.sources)) {
        context.addIssue({ code: 'custom', path: ['messages', index, 'sources'], message: '全局会话只能使用 Santexwell 来源' });
      }
    });
    if (detail.latestRun && !isGlobalSantexwellSources(detail.latestRun.sources)) {
      context.addIssue({ code: 'custom', path: ['latestRun', 'sources'], message: '全局会话运行只能使用 Santexwell 来源' });
    }
    if (detail.attachments.length > 0) {
      context.addIssue({ code: 'custom', path: ['attachments'], message: '全局 Santexwell 会话不能包含附件' });
    }
  }
});

export const ConversationListV1Schema = z.object({
  items: z.array(ConversationSummaryV1Schema).max(10_000),
}).strict();

export const AgentMessageAcceptedV1Schema = z.object({
  message: ConversationUserMessageV1Schema,
  run: AgentRunSnapshotV1Schema,
  eventsPath: z.string().min(1).max(500),
}).strict().superRefine((accepted, context) => {
  if (accepted.message.id !== accepted.run.initiatingMessageId) {
    context.addIssue({ code: 'custom', path: ['run', 'initiatingMessageId'], message: '运行必须由响应中的用户消息发起' });
  }
  if (!sameSources(accepted.message.sources, accepted.run.sources)) {
    context.addIssue({ code: 'custom', path: ['run', 'sources'], message: '消息与运行的数据源开关必须一致' });
  }
  const encodedRunId = encodeURIComponentSafely(accepted.run.id);
  if (encodedRunId === null || accepted.eventsPath !== `/agent-runs/${encodedRunId}/events`) {
    context.addIssue({
      code: 'custom',
      path: ['eventsPath'],
      message: '事件地址必须精确匹配已接受 run 的受保护 API 路径',
    });
  }
});

export const ReferenceTargetKindV1Schema = z.enum([
  'PUBLISHED_FLOW_NODE',
  'CURRENT_DRAFT_FLOW_NODE',
  'SANTEXWELL_FRAGMENT',
  'WORKSPACE_DOCUMENT',
  'CONVERSATION_MESSAGE',
]);

const ReferenceTargetV1Schema = z.object({
  kind: ReferenceTargetKindV1Schema,
  href: z.string().min(1).max(2_048),
}).strict().superRefine((target, context) => {
  if (!isAllowedReferenceTarget(target.kind, target.href)) {
    context.addIssue({ code: 'custom', path: ['href'], message: '引用目标必须匹配受支持的产品内路由' });
  }
});

export const ReferenceResolutionV1Schema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('VALID'),
    referenceId: IdV1Schema,
    source: EvidenceSourceV1Schema,
    title: ShortTextV1Schema,
    excerpt: z.string().min(1).max(10_000),
    target: ReferenceTargetV1Schema,
  }).strict(),
  z.object({
    status: z.literal('INVALID'),
    referenceId: IdV1Schema,
    title: ShortTextV1Schema,
    excerpt: z.string().min(1).max(10_000),
    reasonCode: z.enum(['NOT_FOUND', 'FORBIDDEN', 'STALE', 'SOURCE_UNAVAILABLE', 'NOT_NAVIGABLE']),
    invalidReason: z.string().min(1).max(1_000),
  }).strict(),
]).superRefine((resolution, context) => {
  if (resolution.status === 'VALID' && !sourceMatchesTarget(resolution.source, resolution.target.kind)) {
    context.addIssue({ code: 'custom', path: ['target', 'kind'], message: '引用来源必须匹配目标类型' });
  }
});

function encodeURIComponentSafely(value: string): string | null {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

function isAllowedReferenceTarget(kind: z.infer<typeof ReferenceTargetKindV1Schema>, href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\') || /[\u0000-\u001f\u007f]/u.test(href)) {
    return false;
  }

  const rawPath = href.split(/[?#]/u, 1)[0]!;
  if (/%(?:2f|5c)/iu.test(rawPath)) return false;
  let decodedPath = rawPath;
  try {
    for (let index = 0; index < 2; index += 1) decodedPath = decodeURIComponent(decodedPath);
  } catch {
    return false;
  }
  if (decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return false;

  let url: URL;
  try {
    url = new URL(href, 'https://guideanything.local');
  } catch {
    return false;
  }
  if (url.origin !== 'https://guideanything.local' || url.hash || url.pathname.startsWith('/api/')) return false;
  if (`${url.pathname}${url.search}` !== href) return false;
  if (url.pathname.split('/').some((segment) => segment === '.' || segment === '..')) return false;

  const entries = [...url.searchParams.entries()];
  if (entries.some(([key]) => /^(?:token|authorization|bridgeToken|path|locator|storageKey)$/iu.test(key))) return false;
  const hasOnly = (allowed: readonly string[]) => entries.every(([key]) => allowed.includes(key));
  const hasExactlyOne = (key: string) => url.searchParams.getAll(key).length === 1 && Boolean(url.searchParams.get(key));
  const hasOptionalOne = (key: string) => {
    const values = url.searchParams.getAll(key);
    return values.length <= 1 && (values.length === 0 || Boolean(values[0]));
  };

  if (kind === 'PUBLISHED_FLOW_NODE') {
    return /^\/versions\/[^/]+\/learn$/u.test(url.pathname)
      && hasOnly(['nodeId', 'annotationId'])
      && hasExactlyOne('nodeId')
      && hasOptionalOne('annotationId');
  }
  if (kind === 'CURRENT_DRAFT_FLOW_NODE') {
    return /^\/guides\/[^/]+\/edit$/u.test(url.pathname)
      && hasOnly(['nodeId', 'annotationId'])
      && hasExactlyOne('nodeId')
      && hasOptionalOne('annotationId');
  }
  if (kind === 'SANTEXWELL_FRAGMENT') {
    return /^\/knowledge\/santexwell\/documents\/[^/]+$/u.test(url.pathname)
      && hasOnly(['fragment'])
      && url.searchParams.getAll('fragment').length <= 1;
  }
  if (kind === 'WORKSPACE_DOCUMENT') {
    return /^\/workspaces\/[^/]+\/sources$/u.test(url.pathname)
      && hasOnly(['source', 'document', 'fragment'])
      && hasExactlyOne('document')
      && url.searchParams.getAll('source').length <= 1
      && url.searchParams.getAll('fragment').length <= 1;
  }
  return (
    url.pathname === '/knowledge/santexwell'
    || /^\/workspaces\/[^/]+\/agents$/u.test(url.pathname)
  )
    && hasOnly(['conversation', 'message'])
    && hasExactlyOne('conversation')
    && hasExactlyOne('message');
}

function sameSources(left: z.infer<typeof SourceOptionsV1Schema>, right: z.infer<typeof SourceOptionsV1Schema>): boolean {
  return left.workspaceFlows === right.workspaceFlows
    && left.workspaceDocuments === right.workspaceDocuments
    && left.sessionAttachments === right.sessionAttachments
    && left.santexwell === right.santexwell;
}

function isGlobalSantexwellSources(sources: z.infer<typeof SourceOptionsV1Schema>): boolean {
  return !sources.workspaceFlows
    && !sources.workspaceDocuments
    && !sources.sessionAttachments
    && sources.santexwell;
}

function sourceMatchesTarget(
  source: z.infer<typeof EvidenceSourceV1Schema>,
  target: z.infer<typeof ReferenceTargetKindV1Schema>,
): boolean {
  if (source === 'WORKSPACE_FLOW') {
    return target === 'PUBLISHED_FLOW_NODE' || target === 'CURRENT_DRAFT_FLOW_NODE';
  }
  if (source === 'WORKSPACE_DOCUMENT') return target === 'WORKSPACE_DOCUMENT';
  if (source === 'SANTEXWELL') return target === 'SANTEXWELL_FRAGMENT';
  if (source === 'SESSION_ATTACHMENT') return target === 'CONVERSATION_MESSAGE';
  if (source === 'PRIOR_CONVERSATION') return target === 'CONVERSATION_MESSAGE';
  return false;
}

export type ConversationSummaryV1 = z.infer<typeof ConversationSummaryV1Schema>;
export type CreateConversationRequestV1 = z.infer<typeof CreateConversationRequestV1Schema>;
export type SelectedAgentContextV1 = z.infer<typeof SelectedAgentContextV1Schema>;
export type SendConversationMessageRequestV1 = z.infer<typeof SendConversationMessageRequestV1Schema>;
export type SendGlobalConversationMessageRequestV1 = z.infer<typeof SendGlobalConversationMessageRequestV1Schema>;
export type CancelAgentRunRequestV1 = z.infer<typeof CancelAgentRunRequestV1Schema>;
export type SteerAgentRunRequestV1 = z.infer<typeof SteerAgentRunRequestV1Schema>;
export type AgentRunStatusV1 = z.infer<typeof AgentRunStatusV1Schema>;
export type AgentRunSnapshotV1 = z.infer<typeof AgentRunSnapshotV1Schema>;
export type ConversationUserMessageV1 = z.infer<typeof ConversationUserMessageV1Schema>;
export type ConversationAssistantMessageV1 = z.infer<typeof ConversationAssistantMessageV1Schema>;
export type ConversationMessageV1 = z.infer<typeof ConversationMessageV1Schema>;
export type ConversationAttachmentSummaryV1 = z.infer<typeof ConversationAttachmentSummaryV1Schema>;
export type ConversationDetailV1 = z.infer<typeof ConversationDetailV1Schema>;
export type ConversationListV1 = z.infer<typeof ConversationListV1Schema>;
export type AgentMessageAcceptedV1 = z.infer<typeof AgentMessageAcceptedV1Schema>;
export type ReferenceTargetKindV1 = z.infer<typeof ReferenceTargetKindV1Schema>;
export type ReferenceResolutionV1 = z.infer<typeof ReferenceResolutionV1Schema>;

import { z } from 'zod';

import {
  AgentCommittedAnswerV1Schema,
  EvidenceSourceV1Schema,
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
}).strict();

export const SendGlobalConversationMessageRequestV1Schema = z.object({
  ...MessageRequestBaseV1Shape,
  sources: z.object({
    workspaceFlows: z.literal(false),
    workspaceDocuments: z.literal(false),
    sessionAttachments: z.boolean(),
    santexwell: z.literal(true),
  }).strict(),
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
    code: z.string().regex(/^[A-Z0-9_]+$/).max(80),
    message: z.string().min(1).max(2_000),
    retryable: z.boolean(),
  }).strict().nullable(),
}).strict();

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
}).strict();

export const ConversationListV1Schema = z.object({
  items: z.array(ConversationSummaryV1Schema).max(10_000),
}).strict();

export const AgentMessageAcceptedV1Schema = z.object({
  message: ConversationUserMessageV1Schema,
  run: AgentRunSnapshotV1Schema,
  eventsPath: z.string().min(1).max(500),
}).strict().superRefine((accepted, context) => {
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
]);

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

  let url: URL;
  try {
    url = new URL(href, 'https://guideanything.local');
  } catch {
    return false;
  }
  if (url.origin !== 'https://guideanything.local' || url.hash || url.pathname.startsWith('/api/')) return false;
  if (url.pathname.split('/').some((segment) => segment === '.' || segment === '..')) return false;

  const entries = [...url.searchParams.entries()];
  if (entries.some(([key]) => /^(?:token|authorization|bridgeToken|path|locator|storageKey)$/iu.test(key))) return false;
  const hasOnly = (allowed: readonly string[]) => entries.every(([key]) => allowed.includes(key));
  const hasExactlyOne = (key: string) => url.searchParams.getAll(key).length === 1 && Boolean(url.searchParams.get(key));

  if (kind === 'PUBLISHED_FLOW_NODE') {
    return /^\/versions\/[^/]+\/learn$/u.test(url.pathname)
      && hasOnly(['nodeId'])
      && hasExactlyOne('nodeId');
  }
  if (kind === 'CURRENT_DRAFT_FLOW_NODE') {
    return /^\/guides\/[^/]+\/edit$/u.test(url.pathname)
      && hasOnly(['nodeId'])
      && hasExactlyOne('nodeId');
  }
  if (kind === 'SANTEXWELL_FRAGMENT') {
    return url.pathname === '/knowledge/santexwell'
      && hasOnly(['document', 'fragment'])
      && hasExactlyOne('document')
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
    && url.searchParams.getAll('message').length <= 1;
}

export type ConversationSummaryV1 = z.infer<typeof ConversationSummaryV1Schema>;
export type CreateConversationRequestV1 = z.infer<typeof CreateConversationRequestV1Schema>;
export type SelectedAgentContextV1 = z.infer<typeof SelectedAgentContextV1Schema>;
export type SendConversationMessageRequestV1 = z.infer<typeof SendConversationMessageRequestV1Schema>;
export type AgentRunSnapshotV1 = z.infer<typeof AgentRunSnapshotV1Schema>;
export type ConversationMessageV1 = z.infer<typeof ConversationMessageV1Schema>;
export type ConversationAttachmentSummaryV1 = z.infer<typeof ConversationAttachmentSummaryV1Schema>;
export type ConversationDetailV1 = z.infer<typeof ConversationDetailV1Schema>;
export type AgentMessageAcceptedV1 = z.infer<typeof AgentMessageAcceptedV1Schema>;
export type ReferenceResolutionV1 = z.infer<typeof ReferenceResolutionV1Schema>;

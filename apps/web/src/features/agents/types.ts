import type {
  AgentMessageAcceptedV1,
  AgentRunEventV1,
  AgentRunSnapshotV1,
  ConversationAttachmentSummaryV1,
  ConversationDetailV1,
  ConversationSummaryV1,
  SendConversationMessageRequestV1,
  SendGlobalConversationMessageRequestV1,
  SourceOptionsV1,
  SteerAgentRunRequestV1,
} from '@guideanything/contracts';

export type {
  AgentMessageAcceptedV1,
  AgentRunEventV1,
  AgentRunSnapshotV1,
  ConversationAttachmentSummaryV1,
  ConversationDetailV1,
  ConversationSummaryV1,
  SourceOptionsV1,
};

export interface AgentApi {
  listGlobal: () => Promise<ConversationSummaryV1[]>;
  createGlobal: (title?: string) => Promise<ConversationSummaryV1>;
  getGlobal: (conversationId: string) => Promise<ConversationDetailV1>;
  sendGlobal: (conversationId: string, request: SendGlobalConversationMessageRequestV1) => Promise<AgentMessageAcceptedV1>;
  listWorkspace: (workspaceId: string) => Promise<ConversationSummaryV1[]>;
  createWorkspace: (workspaceId: string, title?: string) => Promise<ConversationSummaryV1>;
  getWorkspace: (workspaceId: string, conversationId: string) => Promise<ConversationDetailV1>;
  sendWorkspace: (workspaceId: string, conversationId: string, request: SendConversationMessageRequestV1) => Promise<AgentMessageAcceptedV1>;
  uploadAttachment: (workspaceId: string, conversationId: string, file: File) => Promise<ConversationAttachmentSummaryV1>;
  getRun: (runId: string) => Promise<AgentRunSnapshotV1>;
  streamRun: (eventsPath: string, options: { afterSequence?: number; signal: AbortSignal }) => AsyncIterable<AgentRunEventV1>;
  cancelRun: (runId: string, reason?: string) => Promise<AgentRunSnapshotV1>;
  steerRun: (runId: string, request: SteerAgentRunRequestV1) => Promise<AgentRunSnapshotV1>;
}

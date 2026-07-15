import type { ArtifactV1, ConversationSummaryV1, ReferenceResolutionV1 } from '@guideanything/contracts';

export interface ArtifactsApi {
  listWorkspace: (workspaceId: string) => Promise<ArtifactV1[]>;
  listWorkspaceConversations: (workspaceId: string) => Promise<ConversationSummaryV1[]>;
  resolveReference: (referenceId: string) => Promise<ReferenceResolutionV1>;
}

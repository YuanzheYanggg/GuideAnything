import type { SelectedAgentContextV1, SourceOptionsV1 } from '@guideanything/contracts';

export type FastGateControl = 'CANCEL' | 'RETRY' | 'CONTINUE';

export interface FastGateInput {
  text: string;
  sources: SourceOptionsV1;
  explicitControl?: FastGateControl;
  explicitSelectedRead?: boolean;
  selectedContext?: SelectedAgentContextV1;
  requestFingerprint?: string;
  exactCache?: {
    requestFingerprint: string;
    answerMessageId: string;
  };
}

export type FastGateResult =
  | { kind: 'CONTROL'; action: FastGateControl }
  | { kind: 'EXACT_CACHE'; answerMessageId: string }
  | { kind: 'SELECTED_CONTEXT'; selectedContext: SelectedAgentContextV1 }
  | { kind: 'ROUTER_REQUIRED' };

export function evaluateFastGate(input: FastGateInput): FastGateResult {
  if (input.explicitControl) return { kind: 'CONTROL', action: input.explicitControl };

  if (
    input.requestFingerprint
    && input.exactCache
    && input.requestFingerprint === input.exactCache.requestFingerprint
  ) {
    return { kind: 'EXACT_CACHE', answerMessageId: input.exactCache.answerMessageId };
  }

  if (
    input.explicitSelectedRead
    && input.selectedContext
    && selectedContextSourceIsEnabled(input.selectedContext, input.sources)
  ) {
    return { kind: 'SELECTED_CONTEXT', selectedContext: input.selectedContext };
  }

  return { kind: 'ROUTER_REQUIRED' };
}

function selectedContextSourceIsEnabled(
  context: SelectedAgentContextV1,
  sources: SourceOptionsV1,
): boolean {
  if (context.kind === 'FLOW_NODE' || context.kind === 'FLOW_SNAPSHOT') return sources.workspaceFlows;
  if (context.kind === 'WORKSPACE_SOURCE') return sources.workspaceDocuments;
  return sources.santexwell || sources.workspaceDocuments || sources.sessionAttachments;
}

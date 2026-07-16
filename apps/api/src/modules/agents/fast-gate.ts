import {
  RouteDecisionV1Schema,
  type RouteDecisionV1,
  type SelectedAgentContextV1,
  type SourceOptionsV1,
} from '@guideanything/contracts';

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
  | { kind: 'DIRECT'; decision: RouteDecisionV1 }
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

  if (
    !input.selectedContext
    && !input.sources.sessionAttachments
    && isNoEvidenceConversation(input.text)
  ) {
    return { kind: 'DIRECT', decision: directConversationDecision() };
  }

  return { kind: 'ROUTER_REQUIRED' };
}

function directConversationDecision(): RouteDecisionV1 {
  return RouteDecisionV1Schema.parse({
    intent: '回应简单的会话或使用说明请求',
    complexity: {
      scopeBreadth: 1,
      evidenceDepth: 1,
      crossSourceNeed: 1,
      decompositionNeed: 1,
      ambiguity: 1,
    },
    contextAssessment: '请求不需要读取工作区、附件或知识库证据。',
    route: 'DIRECT',
    sources: {
      workspaceFlows: false,
      workspaceDocuments: false,
      sessionAttachments: false,
      santexwell: false,
    },
    tasks: [],
    budget: {
      maxWorkers: 0,
      maxConcurrency: 1,
      maxWorkspaceCandidates: 0,
      maxFlowHops: 0,
      maxVaultClusters: 0,
      maxVaultDigests: 0,
      allowRaw: false,
      useReducer: false,
    },
    executionMode: 'SEQUENTIAL',
    maxConcurrency: 1,
    stopConditions: ['完成简短回应，不检索任何来源'],
    confidence: 1,
    userFacingPlan: '这个请求不需要搜索资料，将直接简短回答。',
  });
}

function isNoEvidenceConversation(text: string): boolean {
  const normalized = text.normalize('NFKC').trim();
  if (!normalized || normalized.length > 40) return false;
  return /^(?:你好|您好|嗨|hi|hello|在吗|谢谢|感谢|多谢|thanks|thank you|帮助|help|你能做什么|这个助手能做什么|怎么使用(?:这个)?(?:助手|agent)?)[!！?？。,.，\s]*$/iu
    .test(normalized);
}

function selectedContextSourceIsEnabled(
  context: SelectedAgentContextV1,
  sources: SourceOptionsV1,
): boolean {
  if (context.kind === 'FLOW_NODE' || context.kind === 'FLOW_SNAPSHOT') return sources.workspaceFlows;
  if (context.kind === 'WORKSPACE_SOURCE') return sources.workspaceDocuments;
  return sources.santexwell || sources.workspaceDocuments || sources.sessionAttachments;
}

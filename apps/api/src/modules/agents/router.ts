import type { RouteDecisionV1 } from '@guideanything/contracts';

const ROUTE_SCOPE = {
  DIRECT: 0,
  FOCUSED: 1,
  COMPOSITE: 2,
  OPEN_RESEARCH: 3,
} as const;
const COMPREHENSIVE_TERM = /(?:全面|完整|系统(?:性)?|综合|彻底|深入|开放研究)/gu;
const NEGATED_COMPREHENSIVE_TERM = /(?:不需要|不必|不用|无需|不要|别|不是|并非)(?:(?:再|做|进行|展开|给出|提供|一份|一个|任何|这种|那种)|[\s，、,:：]){0,8}(?:全面|完整|系统(?:性)?|综合|彻底|深入|开放研究)/gu;

export class RouterPolicyError extends Error {
  readonly code = 'ROUTER_POLICY_VIOLATION';

  constructor(message: string) {
    super(message);
    this.name = 'RouterPolicyError';
  }
}

export interface DeepRouterReviewContext {
  requestedVaultClusters?: number;
  userRequestedComprehensive?: boolean;
  crossStagePlan?: boolean;
  conflictsWithHistory?: boolean;
}

export function requiresDeepRouterReview(
  decision: RouteDecisionV1,
  context: DeepRouterReviewContext,
): boolean {
  return decision.confidence < 0.65
    || decision.complexity.ambiguity >= 4
    || (context.requestedVaultClusters ?? 0) > 1
    || decision.tasks.length >= 4
    || decision.budget.allowRaw
    || context.userRequestedComprehensive === true
    || context.crossStagePlan === true
    || context.conflictsWithHistory === true;
}

/** Deep review is a safety/budget review. It may narrow a plan, never broaden it. */
export function assertDeepReviewTightens(
  medium: RouteDecisionV1,
  reviewed: RouteDecisionV1,
): void {
  const broadenedSource = (Object.keys(medium.sources) as Array<keyof RouteDecisionV1['sources']>)
    .find((source) => reviewed.sources[source] && !medium.sources[source]);
  if (broadenedSource) throw new RouterPolicyError(`Deep Router 必须收紧路线，不能新增来源 ${broadenedSource}`);
  if (ROUTE_SCOPE[reviewed.route] > ROUTE_SCOPE[medium.route]) {
    throw new RouterPolicyError('Deep Router 必须收紧路线，不能扩大路线复杂度');
  }
  const numericBudgetKeys = [
    'maxWorkers',
    'maxConcurrency',
    'maxWorkspaceCandidates',
    'maxFlowHops',
    'maxVaultClusters',
    'maxVaultDigests',
  ] as const;
  const broadenedBudget = numericBudgetKeys.find(
    (key) => reviewed.budget[key] > medium.budget[key],
  );
  if (broadenedBudget || reviewed.maxConcurrency > medium.maxConcurrency) {
    throw new RouterPolicyError(`Deep Router 必须收紧路线预算${broadenedBudget ? `：${broadenedBudget}` : ''}`);
  }
  if (reviewed.budget.allowRaw && !medium.budget.allowRaw) {
    throw new RouterPolicyError('Deep Router 必须收紧路线，不能新增原始资料读取');
  }
  const mediumKinds = new Set(medium.tasks.map((task) => task.kind));
  const mediumWorkerCount = medium.tasks.filter((task) => task.kind !== 'REDUCE').length;
  const reviewedWorkerCount = reviewed.tasks.filter((task) => task.kind !== 'REDUCE').length;
  if (reviewedWorkerCount > mediumWorkerCount) {
    throw new RouterPolicyError('Deep Router 必须收紧路线，不能新增工作任务');
  }
  if (reviewed.tasks.some((task) => !mediumKinds.has(task.kind))) {
    throw new RouterPolicyError('Deep Router 必须收紧路线，不能新增任务来源');
  }
}

export function userRequestsComprehensiveResearch(text: string): boolean {
  const withoutNegatedRequests = text.replace(NEGATED_COMPREHENSIVE_TERM, '');
  COMPREHENSIVE_TERM.lastIndex = 0;
  return COMPREHENSIVE_TERM.test(withoutNegatedRequests);
}

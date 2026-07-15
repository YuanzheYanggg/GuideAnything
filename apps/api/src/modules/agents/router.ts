import type { RouteDecisionV1 } from '@guideanything/contracts';

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
  const workerCount = decision.tasks.filter((task) => task.kind !== 'REDUCE').length;
  return decision.confidence < 0.65
    || decision.complexity.ambiguity >= 4
    || (context.requestedVaultClusters ?? 0) > 1
    || workerCount >= 4
    || decision.budget.allowRaw
    || context.userRequestedComprehensive === true
    || context.crossStagePlan === true
    || context.conflictsWithHistory === true;
}

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
  return decision.confidence < 0.65
    || decision.complexity.ambiguity >= 4
    || (context.requestedVaultClusters ?? 0) > 1
    || decision.tasks.length >= 4
    || decision.budget.allowRaw
    || context.userRequestedComprehensive === true
    || context.crossStagePlan === true
    || context.conflictsWithHistory === true;
}

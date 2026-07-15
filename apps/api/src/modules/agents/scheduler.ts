import {
  RouteDecisionV1Schema,
  type RouteBudgetV1,
  type RouteDecisionV1,
  type SourceOptionsV1,
} from '@guideanything/contracts';

interface SchedulePolicyOptions {
  allowedSources: SourceOptionsV1;
  allowRawApproved: boolean;
  configuredMaxConcurrency: number;
}

export class SchedulePolicyError extends Error {
  readonly code = 'SCHEDULE_POLICY_VIOLATION';

  constructor(message: string) {
    super(message);
    this.name = 'SchedulePolicyError';
  }
}

const HARD_LIMITS: Record<RouteDecisionV1['route'], Omit<RouteBudgetV1, 'maxWorkers' | 'maxConcurrency' | 'allowRaw'>> = {
  DIRECT: {
    maxWorkspaceCandidates: 1,
    maxFlowHops: 1,
    maxVaultClusters: 0,
    maxVaultDigests: 0,
    useReducer: false,
  },
  FOCUSED: {
    maxWorkspaceCandidates: 3,
    maxFlowHops: 2,
    maxVaultClusters: 1,
    maxVaultDigests: 2,
    useReducer: false,
  },
  COMPOSITE: {
    maxWorkspaceCandidates: 12,
    maxFlowHops: 2,
    maxVaultClusters: 1,
    maxVaultDigests: 2,
    useReducer: true,
  },
  OPEN_RESEARCH: {
    maxWorkspaceCandidates: 12,
    maxFlowHops: 2,
    maxVaultClusters: 2,
    maxVaultDigests: 6,
    useReducer: true,
  },
};

export function enforceSchedulePolicy(
  untrustedDecision: RouteDecisionV1,
  options: SchedulePolicyOptions,
): RouteDecisionV1 {
  const decision = RouteDecisionV1Schema.parse(untrustedDecision);
  assertConfiguredConcurrency(options.configuredMaxConcurrency);
  assertAllowedSources(decision.sources, options.allowedSources);

  const workers = decision.tasks.filter((task) => task.kind !== 'REDUCE');
  if (
    (decision.route === 'COMPOSITE' || decision.route === 'OPEN_RESEARCH')
    && options.configuredMaxConcurrency < 2
  ) {
    throw new SchedulePolicyError('并行路线至少需要两个可用并发槽位');
  }

  const hard = HARD_LIMITS[decision.route];
  const usesWorkspace = decision.sources.workspaceFlows
    || decision.sources.workspaceDocuments
    || decision.sources.sessionAttachments;
  const usesVault = decision.sources.santexwell;
  const maxConcurrency = decision.route === 'DIRECT' || decision.route === 'FOCUSED'
    ? 1
    : Math.min(3, options.configuredMaxConcurrency, workers.length);
  const budget: RouteBudgetV1 = {
    maxWorkers: workers.length,
    maxConcurrency,
    maxWorkspaceCandidates: usesWorkspace
      ? Math.min(decision.budget.maxWorkspaceCandidates, hard.maxWorkspaceCandidates)
      : 0,
    maxFlowHops: decision.sources.workspaceFlows
      ? Math.min(decision.budget.maxFlowHops, hard.maxFlowHops)
      : 0,
    maxVaultClusters: usesVault
      ? Math.min(decision.budget.maxVaultClusters, hard.maxVaultClusters)
      : 0,
    maxVaultDigests: usesVault
      ? Math.min(decision.budget.maxVaultDigests, hard.maxVaultDigests)
      : 0,
    allowRaw: decision.route === 'OPEN_RESEARCH'
      && decision.budget.allowRaw
      && options.allowRawApproved,
    useReducer: hard.useReducer,
  };

  const scheduled = {
    ...decision,
    budget,
    executionMode: decision.route === 'DIRECT' || decision.route === 'FOCUSED'
      ? 'SEQUENTIAL' as const
      : 'PARALLEL' as const,
    maxConcurrency,
  };
  return RouteDecisionV1Schema.parse(scheduled);
}

function assertConfiguredConcurrency(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new SchedulePolicyError('运行时最大并发必须是 1 到 3 的整数');
  }
}

function assertAllowedSources(requested: SourceOptionsV1, allowed: SourceOptionsV1): void {
  const entries = Object.entries(requested) as Array<[keyof SourceOptionsV1, boolean]>;
  const disallowed = entries.find(([key, enabled]) => enabled && !allowed[key]);
  if (disallowed) throw new SchedulePolicyError(`路线请求了未授权的数据源：${disallowed[0]}`);
}

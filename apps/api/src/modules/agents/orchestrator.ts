import {
  AgentInternalAnswerV1Schema,
  PublicReferenceV1Schema,
  PublicRoutePlanV1Schema,
  SourceOptionsV1Schema,
  TaskFindingV1Schema,
  ValidatedEvidenceV1Schema,
  type AgentCommittedAnswerV1,
  type AgentInternalAnswerV1,
  type AgentRunEventV1,
  type AgentRunStatusV1,
  type BridgeModelRoleV1,
  type BridgeOutputKindV1,
  type BridgeRunRequestV1,
  type InternalEvidenceLocatorV1,
  type PublicReferenceV1,
  type PublicRoutePlanV1,
  type RouteDecisionV1,
  type RouteTaskV1,
  type SelectedAgentContextV1,
  type SourceOptionsV1,
  type TaskFindingV1,
  type ValidatedEvidenceV1,
} from '@guideanything/contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { commitValidatedAnswer } from './validator';
import { evaluateFastGate } from './fast-gate';
import { buildPromptHarness } from './prompt-harness';
import {
  assertDeepReviewTightens,
  requiresDeepRouterReview,
  RouterPolicyError,
  userRequestsComprehensiveResearch,
} from './router';
import type { AgentRuntimeClient } from './runtime-client';
import { RuntimeClientError } from './runtime-client';
import { enforceSchedulePolicy, SchedulePolicyError } from './scheduler';
import { StructuredAnswerPreviewDecoder } from './structured-answer-preview';
import { loadWorkspaceQueryInstructions, workspaceQueryBundleRevisions } from './bundles/workspace-query';
import {
  AgentInvocationError,
  runFinalAnswer,
  runRouteDecision,
  runTaskFinding,
} from './typed-runtime';

export type RunEventAppendInput = AgentRunEventV1 extends infer Event
  ? Event extends AgentRunEventV1
    ? Omit<Event, 'id' | 'sequence' | 'createdAt' | 'stale'> & { stale?: boolean }
    : never
  : never;

export interface AgentRunEventSink {
  append(input: RunEventAppendInput): unknown;
  appendFailure(
    runId: string,
    payload: Extract<AgentRunEventV1, { type: 'run.failed' }>['payload'],
  ): unknown;
}

export interface AgentRunExecutionContext {
  runId: string;
  conversationId: string;
  ownerId: string;
  scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspaceId: string | null;
  /** Captured provider workspaces explicitly mounted to this business team. */
  sharedWorkspaceIds?: string[];
  planVersion: number;
  status: AgentRunStatusV1;
  text: string;
  steeringInstruction?: string;
  sources: SourceOptionsV1;
  selectedContext?: SelectedAgentContextV1;
  attachmentIds: string[];
}

export type AgentRetrievalTask = RouteTaskV1 & {
  kind: Exclude<RouteTaskV1['kind'], 'REDUCE'>;
};

export interface AgentRetrievalRequest {
  context: AgentRunExecutionContext;
  decision: RouteDecisionV1;
  task: AgentRetrievalTask;
  maxCandidates: number;
  maxFlowHops: number;
  allowRaw: boolean;
  signal: AbortSignal;
}

export interface AgentEvidenceRetriever {
  retrieve(request: AgentRetrievalRequest): Promise<readonly ValidatedEvidenceV1[]>;
  /** Clears an in-memory trace before a fresh route-plan attempt. */
  resetTrace?(runId: string): void;
  /** Transfers the bounded trace to the committer exactly once. */
  consumeTrace?(runId: string): AgentRetrievalTrace | null;
  /** Releases a trace for cancelled or failed runs. */
  discardTrace?(runId: string): void;
  isWorkspaceEvidenceSufficient?(request: {
    context: AgentRunExecutionContext;
    decision: RouteDecisionV1;
    evidence: readonly ValidatedEvidenceV1[];
    signal: AbortSignal;
  }): boolean | Promise<boolean>;
}

/**
 * Minimal deterministic retrieval telemetry. It deliberately contains neither
 * user/model text nor evidence content, so it can safely be persisted only for
 * exceptional answers.
 */
export interface AgentRetrievalTrace {
  candidates: readonly {
    fragmentId: string;
    projection: 'OVERVIEW' | 'NODE' | 'RESOURCE' | 'IMAGE_ANNOTATION' | 'OTHER';
    rank: number;
    selected: boolean;
  }[];
  closure: readonly {
    id: string;
    kind: 'OVERVIEW' | 'NODE' | 'RESOURCE';
  }[];
}

export interface ResolvedAgentReference {
  reference: PublicReferenceV1;
  /** Authoritative evidence retained server-side for reference reauthorization. */
  evidence: ValidatedEvidenceV1;
}

export interface AgentEvidenceResolver {
  resolveEvidence(
    context: AgentRunExecutionContext,
    evidence: ValidatedEvidenceV1,
    signal?: AbortSignal,
  ): Promise<ResolvedAgentReference>;
  resolveFlowFeedback(
    context: AgentRunExecutionContext,
    feedback: AgentInternalAnswerV1['flowFeedback'][number],
    evidence: ValidatedEvidenceV1,
    signal?: AbortSignal,
  ): Promise<ResolvedAgentReference>;
}

export interface CommitAgentOutputInput {
  context: AgentRunExecutionContext;
  answer: AgentCommittedAnswerV1;
  references: readonly ResolvedAgentReference[];
  retrievalTrace?: AgentRetrievalTrace;
}

export interface AgentOutputCommitter {
  commit(input: CommitAgentOutputInput): Promise<{ messageId: string }>;
}

export type AgentRunExecutionResult =
  | { status: 'COMPLETED'; messageId: string }
  | { status: 'FAILED' }
  | { status: 'CANCELLED' };

export interface AgentOrchestratorOptions {
  runtime: AgentRuntimeClient;
  eventStore: AgentRunEventSink;
  loadContext: (runId: string) => AgentRunExecutionContext | Promise<AgentRunExecutionContext>;
  retriever: AgentEvidenceRetriever;
  evidenceResolver: AgentEvidenceResolver;
  outputCommitter: AgentOutputCommitter;
  configuredMaxConcurrency?: number;
  trustedHarness?: readonly string[];
  trustedSantexwellHarness?: (
    context: AgentRunExecutionContext,
  ) => { revision: string; items: readonly string[] } | null;
  createId?: () => string;
  now?: () => Date;
  timeouts?: Partial<AgentOrchestratorTimeouts>;
}

export interface AgentOrchestratorTimeouts {
  routerMs: number;
  workerMs: number;
  reducerMs: number;
  runMs: number;
  cancelMs: number;
}

interface ActiveRun {
  runController: AbortController;
  planController: AbortController;
  childIds: Set<string>;
  planVersion: number;
  committing: boolean;
  cancelReason?: string;
  pendingSteerVersion?: number;
  timedOut: boolean;
  settled: Promise<void>;
  markSettled: () => void;
}

interface RetrievalState {
  evidenceByTaskId: Map<string, ValidatedEvidenceV1[]>;
  allEvidence: ValidatedEvidenceV1[];
  skippedTaskIds: Set<string>;
}

interface AnswerExecution {
  answer: AgentInternalAnswerV1;
  allowedFlowEvidence: readonly ValidatedEvidenceV1[];
}

class AgentOrchestrationError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly retryable: boolean,
  ) {
    super(publicMessage);
    this.name = 'AgentOrchestrationError';
  }
}

const PUBLIC_ERROR_CODE = /^[A-Z0-9_]{1,80}$/u;
const MAX_TRUSTED_HARNESS_ITEMS = 15;
const DEFAULT_TIMEOUTS: AgentOrchestratorTimeouts = {
  routerMs: 30_000,
  workerMs: 90_000,
  reducerMs: 90_000,
  runMs: 240_000,
  cancelMs: 2_000,
};

export class AgentOrchestrator {
  readonly #runtime: AgentRuntimeClient;
  readonly #eventStore: AgentRunEventSink;
  readonly #loadContext: AgentOrchestratorOptions['loadContext'];
  readonly #retriever: AgentEvidenceRetriever;
  readonly #evidenceResolver: AgentEvidenceResolver;
  readonly #outputCommitter: AgentOutputCommitter;
  readonly #configuredMaxConcurrency: number;
  readonly #trustedHarness: readonly string[];
  readonly #trustedSantexwellHarness: AgentOrchestratorOptions['trustedSantexwellHarness'];
  readonly #createId: () => string;
  readonly #now: () => Date;
  readonly #timeouts: AgentOrchestratorTimeouts;
  readonly #activeRuns = new Map<string, ActiveRun>();
  #shuttingDown = false;

  constructor(options: AgentOrchestratorOptions) {
    if (
      !Number.isInteger(options.configuredMaxConcurrency ?? 3)
      || (options.configuredMaxConcurrency ?? 3) < 1
      || (options.configuredMaxConcurrency ?? 3) > 3
    ) {
      throw new Error('Agent 最大并发必须是 1 到 3 的整数');
    }
    if ((options.trustedHarness?.length ?? 0) > MAX_TRUSTED_HARNESS_ITEMS) {
      throw new Error(`受信任 Harness 最多 ${MAX_TRUSTED_HARNESS_ITEMS} 项`);
    }
    this.#runtime = options.runtime;
    this.#eventStore = options.eventStore;
    this.#loadContext = options.loadContext;
    this.#retriever = options.retriever;
    this.#evidenceResolver = options.evidenceResolver;
    this.#outputCommitter = options.outputCommitter;
    this.#configuredMaxConcurrency = options.configuredMaxConcurrency ?? 3;
    this.#trustedHarness = options.trustedHarness ?? [];
    this.#trustedSantexwellHarness = options.trustedSantexwellHarness;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
    this.#timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    assertTimeouts(this.#timeouts);
  }

  async execute(runId: string, externalSignal?: AbortSignal): Promise<AgentRunExecutionResult> {
    if (this.#shuttingDown) {
      throw new AgentOrchestrationError(
        'AGENT_RUNTIME_SHUTTING_DOWN',
        'Agent Runtime 正在安全关闭。',
        true,
      );
    }
    if (this.#activeRuns.has(runId)) {
      throw new AgentOrchestrationError('RUN_ALREADY_ACTIVE', '运行已经在执行。', false);
    }
    let markSettled: () => void = () => {};
    const settled = new Promise<void>((resolve) => { markSettled = resolve; });
    const active: ActiveRun = {
      runController: new AbortController(),
      planController: new AbortController(),
      childIds: new Set(),
      planVersion: 1,
      committing: false,
      timedOut: false,
      settled,
      markSettled,
    };
    this.#activeRuns.set(runId, active);
    const onExternalAbort = () => {
      if (active.committing) return;
      active.runController.abort(externalSignal?.reason);
      active.planController.abort(externalSignal?.reason);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    if (externalSignal?.aborted) onExternalAbort();
    const runTimeout = setTimeout(() => {
      active.timedOut = true;
      const error = new AgentOrchestrationError('RUN_TIMEOUT', '本次只读问答超过运行时限。', true);
      active.runController.abort(error);
      active.planController.abort(error);
    }, this.#timeouts.runMs);

    try {
      while (true) {
        const context = await runBounded(
          () => Promise.resolve(this.#loadContext(runId)),
          active.runController.signal,
          this.#timeouts.runMs,
          new AgentOrchestrationError('RUN_CONTEXT_TIMEOUT', '运行上下文读取超时。', true),
        );
        assertExecutionContext(context, runId);
        active.planVersion = context.planVersion;
        active.planController = new AbortController();
        if (active.runController.signal.aborted) {
          active.planController.abort(active.runController.signal.reason);
        }
        try {
          return await this.#executePlan(active, context);
        } catch (error) {
          if (
            active.pendingSteerVersion !== undefined
            && active.pendingSteerVersion > context.planVersion
            && !active.runController.signal.aborted
          ) {
            delete active.pendingSteerVersion;
            await this.#cancelChildren(active);
            continue;
          }
          const persistedPlanVersion = await this.#readNewerPersistedPlanVersion(
            runId,
            context.planVersion,
            active,
          );
          if (persistedPlanVersion !== null) {
            active.planVersion = persistedPlanVersion;
            delete active.pendingSteerVersion;
            await this.#cancelChildren(active);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      await this.#cancelChildren(active);
      if (active.runController.signal.aborted && !active.timedOut) {
        this.#append(runId, active.planVersion, 'COMMITTED', 'run.cancelled', {
          ...(active.cancelReason ? { reason: active.cancelReason } : {}),
        });
        return { status: 'CANCELLED' };
      }
      const failure = publicFailure(
        active.timedOut ? active.runController.signal.reason : error,
      );
      this.#eventStore.appendFailure(runId, failure);
      return { status: 'FAILED' };
    } finally {
      this.#retriever.discardTrace?.(runId);
      clearTimeout(runTimeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      this.#activeRuns.delete(runId);
      active.markSettled();
    }
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    const activeRuns = [...this.#activeRuns.entries()];
    await Promise.all(activeRuns.map(async ([runId, active]) => {
      await this.cancel(runId, '服务正在安全关闭');
      await settleWithin(active.settled, this.#timeouts.cancelMs);
    }));
  }

  async cancel(runId: string, reason?: string): Promise<void> {
    const active = this.#activeRuns.get(runId);
    if (!active || active.committing) return;
    if (reason?.trim()) active.cancelReason = conciseText(reason.trim(), 2_000);
    const error = new DOMException('Agent run cancelled', 'AbortError');
    active.runController.abort(error);
    active.planController.abort(error);
    await this.#cancelChildren(active);
  }

  isActive(runId: string): boolean {
    return this.#activeRuns.has(runId);
  }

  async steer(runId: string, planVersion: number, instruction: string): Promise<void> {
    const active = this.#activeRuns.get(runId);
    if (!active || active.committing || planVersion <= active.planVersion) return;
    if (!Number.isInteger(planVersion) || planVersion < 2 || !instruction.trim()) {
      throw new Error('Steer 参数无效');
    }
    active.pendingSteerVersion = planVersion;
    active.planVersion = planVersion;
    active.planController.abort(new DOMException('Agent plan steered', 'AbortError'));
    await this.#cancelChildren(active);
  }

  async #executePlan(
    active: ActiveRun,
    context: AgentRunExecutionContext,
  ): Promise<{ status: 'COMPLETED'; messageId: string }> {
    this.#retriever.resetTrace?.(context.runId);
    this.#appendPlan(active, context, 'PROVISIONAL', 'route.started', {
      intent: conciseText(context.text, 2_000),
    });
    const fastGate = evaluateFastGate({
      text: context.text,
      sources: context.sources,
      ...(context.selectedContext ? { selectedContext: context.selectedContext } : {}),
    });
    let scheduled: RouteDecisionV1;
    if (fastGate.kind === 'DIRECT') {
      scheduled = fastGate.decision;
    } else {
      if (fastGate.kind !== 'ROUTER_REQUIRED') {
        throw new AgentOrchestrationError(
          'FAST_GATE_CONTEXT_UNAVAILABLE',
          '当前请求缺少可验证的快速路径上下文。',
          false,
        );
      }
      const mediumDecision = await this.#invokeRoute(
        active,
        context,
        'ROUTER',
        'MEDIUM',
        'medium-router',
        this.#routerPrompt(context, 'ROUTER'),
      );
      assertCurrentPlan(active, context);

      const needsDeepReview = requiresDeepRouterReview(mediumDecision, {
        requestedVaultClusters: mediumDecision.budget.maxVaultClusters,
        userRequestedComprehensive: userRequestsComprehensiveResearch(
          `${context.text}\n${context.steeringInstruction ?? ''}`,
        ),
        crossStagePlan: mediumDecision.complexity.scopeBreadth >= 4,
      });
      const finalDecision = needsDeepReview
        ? await this.#invokeRoute(
          active,
          context,
          'DEEP_ROUTER',
          'HIGH',
          'deep-router',
          this.#routerPrompt(context, 'DEEP_ROUTER', mediumDecision),
          )
        : mediumDecision;
      if (needsDeepReview) assertDeepReviewTightens(mediumDecision, finalDecision);
      scheduled = enforceSchedulePolicy(finalDecision, {
        allowedSources: context.sources,
        allowRawApproved: needsDeepReview,
        configuredMaxConcurrency: this.#configuredMaxConcurrency,
      });
    }
    assertAtMostThreeWorkers(scheduled);
    const publicPlan = toPublicPlan(scheduled);
    this.#appendPlan(active, context, 'PROVISIONAL', 'route.completed', {
      route: scheduled.route,
      userFacingPlan: scheduled.userFacingPlan,
    });
    this.#appendPlan(active, context, 'PROVISIONAL', 'plan.committed', { plan: publicPlan });

    const retrieval = await this.#retrieveEvidence(active, context, scheduled);
    assertCurrentPlan(active, context);
    const answerExecution = scheduled.budget.useReducer
      ? await this.#executeMapReduce(active, context, scheduled, retrieval)
      : await this.#executeFocused(active, context, scheduled, retrieval);
    assertCurrentPlan(active, context);
    return this.#validateAndCommit(
      active,
      context,
      answerExecution.answer,
      answerExecution.allowedFlowEvidence,
    );
  }

  async #readNewerPersistedPlanVersion(
    runId: string,
    previousPlanVersion: number,
    active: ActiveRun,
  ): Promise<number | null> {
    if (active.runController.signal.aborted) return null;
    try {
      const refreshed = await runBounded(
        () => Promise.resolve(this.#loadContext(runId)),
        active.runController.signal,
        Math.min(this.#timeouts.routerMs, 5_000),
        new AgentOrchestrationError('RUN_CONTEXT_TIMEOUT', '运行上下文读取超时。', true),
      );
      return refreshed.planVersion > previousPlanVersion ? refreshed.planVersion : null;
    } catch {
      return null;
    }
  }

  async #retrieveEvidence(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    decision: RouteDecisionV1,
  ): Promise<RetrievalState> {
    const workers = decision.tasks.filter(
      (task): task is AgentRetrievalTask => task.kind !== 'REDUCE',
    );
    const ordered = [...workers].sort((left, right) => {
      const sourceOrder = Number(left.kind === 'SANTEXWELL') - Number(right.kind === 'SANTEXWELL');
      return sourceOrder || left.priority - right.priority || left.id.localeCompare(right.id);
    });
    let remainingWorkspace = decision.budget.maxWorkspaceCandidates;
    let remainingVault = decision.budget.maxVaultDigests;
    let remainingWorkspaceTasks = ordered.filter((task) => task.kind !== 'SANTEXWELL').length;
    let remainingVaultTasks = ordered.length - remainingWorkspaceTasks;
    const evidenceByTaskId = new Map<string, ValidatedEvidenceV1[]>();
    const globallySeen = new Map<string, ValidatedEvidenceV1>();
    const skippedTaskIds = new Set<string>();
    let workspaceSufficient: boolean | undefined;
    for (const task of ordered) {
      assertCurrentPlan(active, context);
      const isVault = task.kind === 'SANTEXWELL';
      const remainingTasks = isVault ? remainingVaultTasks : remainingWorkspaceTasks;
      if (isVault) remainingVaultTasks -= 1;
      else remainingWorkspaceTasks -= 1;
      if (isVault && workspaceSufficient === undefined && this.#retriever.isWorkspaceEvidenceSufficient) {
        const workspaceEvidence = [...globallySeen.values()].filter((item) => item.source !== 'SANTEXWELL');
        workspaceSufficient = workspaceEvidence.length > 0 && await runBounded(
          (signal) => Promise.resolve(this.#retriever.isWorkspaceEvidenceSufficient!({
            context,
            decision,
            evidence: workspaceEvidence,
            signal,
          })),
          active.planController.signal,
          this.#timeouts.workerMs,
          new AgentOrchestrationError('RETRIEVAL_TIMEOUT', '工作区证据充分性判断超时。', true),
        );
      }
      if (isVault && workspaceSufficient) {
        evidenceByTaskId.set(task.id, []);
        skippedTaskIds.add(task.id);
        continue;
      }
      const remainingCandidates = isVault ? remainingVault : remainingWorkspace;
      const maxCandidates = remainingTasks === 0
        ? 0
        : Math.ceil(remainingCandidates / remainingTasks);
      const raw = maxCandidates === 0
        ? []
        : await runBounded(
            (signal) => this.#retriever.retrieve({
              context,
              decision,
              task,
              maxCandidates,
              maxFlowHops: task.kind === 'WORKSPACE_FLOW' ? decision.budget.maxFlowHops : 0,
              allowRaw: isVault && decision.budget.allowRaw,
              signal,
            }),
            active.planController.signal,
            this.#timeouts.workerMs,
            new AgentOrchestrationError('RETRIEVAL_TIMEOUT', '证据检索超过运行时限。', true),
          );
      const validated = raw.slice(0, maxCandidates).map((item) => ValidatedEvidenceV1Schema.parse(item));
      for (const item of validated) {
        if (item.source !== task.kind) {
          throw new AgentOrchestrationError(
            'EVIDENCE_VALIDATION_FAILED',
            '检索结果未通过来源校验。',
            false,
          );
        }
        const existing = globallySeen.get(item.id);
        if (existing && !sameEvidenceRecord(existing, item)) {
          throw new AgentOrchestrationError(
            'EVIDENCE_VALIDATION_FAILED',
            '检索结果包含冲突的证据标识。',
            false,
          );
        }
        globallySeen.set(item.id, item);
      }
      evidenceByTaskId.set(task.id, validated);
      if (isVault) remainingVault -= validated.length;
      else remainingWorkspace -= validated.length;
    }
    return { evidenceByTaskId, allEvidence: [...globallySeen.values()], skippedTaskIds };
  }

  async #executeFocused(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    decision: RouteDecisionV1,
    retrieval: RetrievalState,
  ): Promise<AnswerExecution> {
    const worker = decision.tasks.find((task) => task.kind !== 'REDUCE');
    const candidates = worker ? retrieval.evidenceByTaskId.get(worker.id) ?? [] : [];
    if (worker) {
      this.#appendPlan(active, context, 'PROVISIONAL', 'task.started', {
        taskId: worker.id,
        label: conciseText(worker.objective, 500),
      });
      this.#appendPlan(active, context, 'PROVISIONAL', 'task.progress', {
        taskId: worker.id,
        message: '正在核对已授权的检索结果。',
        progress: 0.5,
      });
    }
    const answer = await this.#invokeAnswer(
      active,
      context,
      'FOCUSED_WORKER',
      'MEDIUM',
      worker ? `worker-${worker.id}` : 'direct-answer',
      this.#workerPrompt(context, decision, worker, candidates, 'FOCUSED_WORKER'),
    );
    const canonical = canonicalizeAnswer(answer, candidates);
    if (worker) {
      this.#appendPlan(active, context, 'PROVISIONAL', 'task.completed', {
        taskId: worker.id,
        status: findingStatusForAnswer(canonical),
      });
    }
    return { answer: canonical, allowedFlowEvidence: candidates };
  }

  async #executeMapReduce(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    decision: RouteDecisionV1,
    retrieval: RetrievalState,
  ): Promise<AnswerExecution> {
    const allWorkers = decision.tasks.filter((task) => task.kind !== 'REDUCE');
    for (const task of allWorkers.filter((item) => retrieval.skippedTaskIds.has(item.id))) {
      this.#appendPlan(active, context, 'PROVISIONAL', 'task.started', {
        taskId: task.id,
        label: conciseText(task.objective, 500),
      });
      this.#appendPlan(active, context, 'PROVISIONAL', 'task.progress', {
        taskId: task.id,
        message: '工作区证据已经充分，本轮不再扩大到 Santexwell 检索。',
        progress: 1,
      });
      this.#appendPlan(active, context, 'PROVISIONAL', 'task.completed', {
        taskId: task.id,
        status: 'NO_EVIDENCE',
      });
    }
    const workers = allWorkers.filter((task) => !retrieval.skippedTaskIds.has(task.id));
    const findings = await mapWithConcurrency(
      workers,
      decision.maxConcurrency,
      async (task): Promise<TaskFindingV1> => {
        this.#appendPlan(active, context, 'PROVISIONAL', 'task.started', {
          taskId: task.id,
          label: conciseText(task.objective, 500),
        });
        this.#appendPlan(active, context, 'PROVISIONAL', 'task.progress', {
          taskId: task.id,
          message: '正在核对该子任务的已授权证据。',
          progress: 0.5,
        });
        const candidates = retrieval.evidenceByTaskId.get(task.id) ?? [];
        let finding: TaskFindingV1;
        try {
          const untrusted = await this.#invokeFinding(
            active,
            context,
            task,
            this.#workerPrompt(context, decision, task, candidates, 'DEEP_WORKER'),
          );
          finding = canonicalizeFinding(untrusted, task.id, candidates);
        } catch (error) {
          assertCurrentPlan(active, context);
          if (!isDegradableWorkerFailure(error)) throw error;
          finding = degradedFinding(task.id, candidates);
        }
        this.#appendPlan(active, context, 'PROVISIONAL', 'task.finding', {
          finding: toPublicFinding(finding),
        });
        this.#appendPlan(active, context, 'PROVISIONAL', 'task.completed', {
          taskId: task.id,
          status: finding.status,
        });
        return finding;
      },
    );
    assertCurrentPlan(active, context);
    this.#appendPlan(active, context, 'PROVISIONAL', 'reduce.started', {});
    const reducerCandidates = mergeFindingEvidence(findings);
    const untrustedAnswer = await this.#invokeAnswer(
      active,
      context,
      'REDUCER',
      'HIGH',
      'reducer',
      this.#reducerPrompt(context, decision, findings),
    );
    const answer = canonicalizeAnswer(untrustedAnswer, reducerCandidates);
    return { answer, allowedFlowEvidence: reducerCandidates };
  }

  async #validateAndCommit(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    answer: AgentInternalAnswerV1,
    allowedFlowEvidence: readonly ValidatedEvidenceV1[],
  ): Promise<{ status: 'COMPLETED'; messageId: string }> {
    assertFlowFeedbackWasRetrieved(answer, allowedFlowEvidence);
    const feedbackEvidence = answer.flowFeedback.map((feedback) => (
      findFlowFeedbackEvidence(feedback, allowedFlowEvidence)
    ));
    this.#appendPlan(active, context, 'COMMITTED', 'answer.validating', {});
    const [resolvedEvidence, resolvedFeedback] = await runBounded(
      (signal) => Promise.all([
        Promise.all(answer.evidence.map((item) => (
          this.#evidenceResolver.resolveEvidence(context, item, signal)
        ))),
        Promise.all(answer.flowFeedback.map((item, index) => (
          this.#evidenceResolver.resolveFlowFeedback(context, item, feedbackEvidence[index]!, signal)
        ))),
      ]),
      active.planController.signal,
      this.#timeouts.workerMs,
      new AgentOrchestrationError('REFERENCE_RESOLUTION_TIMEOUT', '引用校验超过运行时限。', true),
    );
    assertCurrentPlan(active, context);
    for (const [index, resolved] of resolvedEvidence.entries()) {
      PublicReferenceV1Schema.parse(resolved.reference);
      if (!sameEvidenceRecord(answer.evidence[index]!, resolved.evidence)) {
        throw new AgentOrchestrationError(
          'EVIDENCE_VALIDATION_FAILED',
          '证据在提交前发生变化。',
          false,
        );
      }
    }
    resolvedFeedback.forEach((resolved, index) => {
      PublicReferenceV1Schema.parse(resolved.reference);
      if (!sameEvidenceRecord(feedbackEvidence[index]!, resolved.evidence)) {
        throw new AgentOrchestrationError(
          'EVIDENCE_VALIDATION_FAILED',
          '流程反馈引用在提交前发生变化。',
          false,
        );
      }
    });
    const references = [...resolvedEvidence, ...resolvedFeedback];
    assertUniqueReferenceIds(references);
    const committed = commitValidatedAnswer(answer, {
      runId: context.runId,
      createdAt: this.#now().toISOString(),
      evidenceReferences: new Map(resolvedEvidence.map((item, index) => [
        answer.evidence[index]!.id,
        item.reference,
      ])),
      flowFeedbackReferences: resolvedFeedback.map((item) => item.reference),
      createId: this.#createId,
    });
    assertCurrentPlan(active, context);
    active.committing = true;
    const retrievalTrace = this.#retriever.consumeTrace?.(context.runId) ?? undefined;
    const persisted = await runBounded(
      () => this.#outputCommitter.commit({
        context,
        answer: committed,
        references,
        ...(retrievalTrace ? { retrievalTrace } : {}),
      }),
      active.runController.signal,
      this.#timeouts.runMs,
      new AgentOrchestrationError('COMMIT_TIMEOUT', '答案提交超过运行时限。', true),
    );
    for (const citation of committed.citations) {
      this.#appendPlan(active, context, 'COMMITTED', 'citation.committed', { citation });
    }
    this.#appendPlan(active, context, 'COMMITTED', 'answer.committed', {
      answer: committed,
    });
    for (const artifact of committed.artifacts) {
      this.#appendPlan(active, context, 'COMMITTED', 'artifact.committed', { artifact });
    }
    this.#appendPlan(active, context, 'COMMITTED', 'run.completed', {
      messageId: persisted.messageId,
    });
    return { status: 'COMPLETED', messageId: persisted.messageId };
  }

  #routerPrompt(
    context: AgentRunExecutionContext,
    role: 'ROUTER' | 'DEEP_ROUTER',
    mediumDecision?: RouteDecisionV1,
  ): string {
    return buildPromptHarness({
      role,
      trustedHarness: [
        ...this.#trustedHarness,
        ROUTE_DECISION_CROSS_FIELD_RULES,
        role === 'ROUTER'
          ? '分析任务难度并输出最小充分路线；小问题不得扩大检索范围。聚焦工作区流程问题涉及字段定义、图片标注、设置规则、多个步骤或异常链时，应将 budget.maxWorkspaceCandidates 设置为 6，并优先保留直接命中的片段。'
          : '复核初步路线的风险、来源与预算；只能收紧或给出有证据需要的并行计划。',
      ],
      retrievedContext: mediumDecision ? { initialRouteDecision: mediumDecision } : {},
      userRequest: publicUserRequest(context),
    });
  }

  #workerPrompt(
    context: AgentRunExecutionContext,
    decision: RouteDecisionV1,
    task: RouteTaskV1 | undefined,
    evidence: readonly ValidatedEvidenceV1[],
    role: 'FOCUSED_WORKER' | 'DEEP_WORKER',
  ): string {
    const workspaceQueryHarness = loadWorkspaceQueryInstructions(context, decision, task);
    const santexwellHarness = this.#workerNeedsSantexwellHarness(context, decision, task, evidence)
      ? this.#loadSantexwellHarness(context)
      : [];
    return buildPromptHarness({
      role,
      trustedHarness: [
        ...this.#trustedHarness,
        ...workspaceQueryHarness,
        ...santexwellHarness,
        '只能使用 retrievedContext 中由服务端提供的证据 ID 与 locator；不得新增、猜测或改写 locator。',
      ],
      retrievedContext: {
        task: task ?? { id: 'direct-answer', objective: '直接回答当前请求' },
        route: decision.route,
        evidence: evidence.map(compactEvidence),
      },
      userRequest: publicUserRequest(context),
    });
  }

  #workerNeedsSantexwellHarness(
    context: AgentRunExecutionContext,
    decision: RouteDecisionV1,
    task: RouteTaskV1 | undefined,
    evidence: readonly ValidatedEvidenceV1[],
  ): boolean {
    return (context.scope === 'GLOBAL_SANTEXWELL' && decision.sources.santexwell)
      || task?.kind === 'SANTEXWELL'
      || evidence.some((item) => item.source === 'SANTEXWELL');
  }

  #loadSantexwellHarness(context: AgentRunExecutionContext): readonly string[] {
    let bundle: ReturnType<NonNullable<AgentOrchestratorOptions['trustedSantexwellHarness']>>;
    try {
      bundle = this.#trustedSantexwellHarness?.(context) ?? null;
    } catch {
      bundle = null;
    }
    if (
      !bundle
      || !bundle.revision.trim()
      || bundle.revision.length > 200
      || bundle.items.length === 0
      || bundle.items.some((item) => !item.trim())
    ) {
      throw new AgentOrchestrationError(
        'SANTEXWELL_HARNESS_UNAVAILABLE',
        'Santexwell 只读问答规则仍在准备中，请稍后重试。',
        true,
      );
    }
    return bundle.items;
  }

  #reducerPrompt(
    context: AgentRunExecutionContext,
    decision: RouteDecisionV1,
    findings: readonly TaskFindingV1[],
  ): string {
    return buildPromptHarness({
      role: 'REDUCER',
      trustedHarness: [
        ...this.#trustedHarness,
        '只汇总提供的 task findings；不得检索、不得添加新的 evidence ID 或 locator。',
      ],
      retrievedContext: {
        route: decision.route,
        findings: findings.map(compactFinding),
      },
      userRequest: publicUserRequest(context),
    });
  }

  async #invokeRoute(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    role: 'ROUTER' | 'DEEP_ROUTER',
    reasoningEffort: 'MEDIUM' | 'HIGH',
    stage: string,
    prompt: string,
  ): Promise<RouteDecisionV1> {
    let repairDiagnostic: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const request = this.#request(
        active,
        context,
        role,
        reasoningEffort,
        'ROUTE_DECISION',
        attempt === 0 ? stage : `${stage}-repair`,
        attempt === 0 ? prompt : routeRepairPrompt(prompt, repairDiagnostic),
      );
      try {
        return await runBounded(
          (signal) => runRouteDecision(this.#runtime, request, signal),
          active.planController.signal,
          this.#timeouts.routerMs,
          new AgentOrchestrationError('ROUTER_TIMEOUT', '任务路由超过运行时限。', true),
        );
      } catch (error) {
        if (isPhaseTimeout(error) || (attempt === 0 && isRepairableTypedOutput(error))) {
          await this.#cancelChild(request.runId);
        }
        if (attempt === 0 && isRepairableTypedOutput(error)) {
          repairDiagnostic = error instanceof AgentInvocationError ? error.diagnostic : undefined;
          continue;
        }
        throw error;
      } finally {
        active.childIds.delete(request.runId);
      }
    }
    throw new Error('unreachable');
  }

  async #invokeFinding(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    task: RouteTaskV1,
    prompt: string,
  ): Promise<TaskFindingV1> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const request = this.#request(
        active,
        context,
        'DEEP_WORKER',
        'HIGH',
        'TASK_FINDING',
        attempt === 0 ? `worker-${task.id}` : `worker-${task.id}-repair`,
        attempt === 0 ? prompt : repairPrompt(prompt),
      );
      try {
        return await runBounded(
          (signal) => runTaskFinding(this.#runtime, request, signal),
          active.planController.signal,
          this.#timeouts.workerMs,
          new AgentOrchestrationError('WORKER_TIMEOUT', '子任务超过运行时限。', true),
        );
      } catch (error) {
        if (isPhaseTimeout(error) || (attempt === 0 && isRepairableTypedOutput(error))) {
          await this.#cancelChild(request.runId);
        }
        if (attempt === 0 && isRepairableTypedOutput(error)) continue;
        throw error;
      } finally {
        active.childIds.delete(request.runId);
      }
    }
    throw new Error('unreachable');
  }

  async #invokeAnswer(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    role: 'FOCUSED_WORKER' | 'REDUCER',
    reasoningEffort: 'MEDIUM' | 'HIGH',
    stage: string,
    prompt: string,
  ): Promise<AgentInternalAnswerV1> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const preview = new StructuredAnswerPreviewDecoder();
      let emittedDraft = false;
      const request = this.#request(
        active,
        context,
        role,
        reasoningEffort,
        'ANSWER',
        attempt === 0 ? stage : `${stage}-repair`,
        attempt === 0 ? prompt : repairPrompt(prompt),
      );
      try {
        const answer = await runBounded(
          (signal) => runFinalAnswer(this.#runtime, request, signal, (rawDelta) => {
            let publicDelta: string;
            try {
              publicDelta = preview.push(rawDelta);
            } catch {
              throw new AgentInvocationError('BRIDGE_EVENT_INVALID', true);
            }
            if (!publicDelta) return;
            this.#appendPlan(active, context, 'PROVISIONAL', 'answer.draft.delta', {
              delta: publicDelta,
            });
            emittedDraft = true;
          }),
          active.planController.signal,
          role === 'REDUCER' ? this.#timeouts.reducerMs : this.#timeouts.workerMs,
          new AgentOrchestrationError(
            role === 'REDUCER' ? 'REDUCER_TIMEOUT' : 'WORKER_TIMEOUT',
            role === 'REDUCER' ? '答案汇总超过运行时限。' : '回答生成超过运行时限。',
            true,
          ),
        );
        let remaining: string;
        try {
          remaining = preview.finalize(answer.conclusion);
        } catch {
          throw new AgentInvocationError('BRIDGE_EVENT_INVALID', true);
        }
        if (remaining) {
          this.#appendPlan(active, context, 'PROVISIONAL', 'answer.draft.delta', {
            delta: remaining,
          });
        }
        return answer;
      } catch (error) {
        await this.#cancelChild(request.runId);
        if (attempt === 0 && !emittedDraft && isRepairableTypedOutput(error)) continue;
        throw error;
      } finally {
        active.childIds.delete(request.runId);
      }
    }
    throw new Error('unreachable');
  }

  #request<TOutput extends BridgeOutputKindV1>(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    role: BridgeModelRoleV1,
    reasoningEffort: 'MEDIUM' | 'HIGH',
    outputKind: TOutput,
    stage: string,
    prompt: string,
  ): BridgeRunRequestV1 & { outputKind: TOutput } {
    assertCurrentPlan(active, context);
    const childId = childInvocationId(context.runId, stage, this.#createId());
    active.childIds.add(childId);
    return {
      type: 'RUN',
      requestId: conciseIdentifier(this.#createId()),
      runId: childId,
      planVersion: active.planVersion,
      role,
      reasoningEffort,
      outputKind,
      prompt,
      allowedRoots: [],
    } as BridgeRunRequestV1 & { outputKind: TOutput };
  }

  async #cancelChildren(active: ActiveRun): Promise<void> {
    const childIds = [...active.childIds];
    active.childIds.clear();
    await Promise.all(childIds.map((childId) => this.#cancelChild(childId)));
  }

  async #cancelChild(childId: string): Promise<void> {
    await settleWithin(this.#runtime.cancel(childId), this.#timeouts.cancelMs);
  }

  #appendPlan<TType extends AgentRunEventV1['type']>(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    phase: Extract<AgentRunEventV1, { type: TType }>['phase'],
    type: TType,
    payload: Extract<AgentRunEventV1, { type: TType }>['payload'],
  ): void {
    assertCurrentPlan(active, context);
    this.#eventStore.append({
      runId: context.runId,
      planVersion: active.planVersion,
      phase,
      type,
      payload,
    } as RunEventAppendInput);
  }

  #append<TType extends AgentRunEventV1['type']>(
    runId: string,
    planVersion: number,
    phase: Extract<AgentRunEventV1, { type: TType }>['phase'],
    type: TType,
    payload: Extract<AgentRunEventV1, { type: TType }>['payload'],
  ): void {
    this.#eventStore.append({ runId, planVersion, phase, type, payload } as RunEventAppendInput);
  }
}

function assertExecutionContext(context: AgentRunExecutionContext, runId: string): void {
  if (context.runId !== runId) throw new Error('运行上下文 ID 不匹配');
  if (context.status !== 'QUEUED') throw new Error('只有排队中的运行可以开始执行');
  if (!Number.isInteger(context.planVersion) || context.planVersion < 1) throw new Error('运行计划版本无效');
  if (!context.text.trim() || context.text.length > 20_000) throw new Error('运行消息无效');
  SourceOptionsV1Schema.parse(context.sources);
  if (new Set(context.attachmentIds).size !== context.attachmentIds.length) {
    throw new Error('运行附件 ID 不能重复');
  }
  if (context.scope === 'GLOBAL_SANTEXWELL') {
    const sources = context.sources;
    if (
      context.workspaceId !== null
      || sources.workspaceFlows
      || sources.workspaceDocuments
      || sources.sessionAttachments
      || !sources.santexwell
      || context.attachmentIds.length > 0
    ) {
      throw new Error('全局运行上下文越权');
    }
  } else if (!context.workspaceId) {
    throw new Error('工作区运行缺少 workspaceId');
  }
}

function assertAtMostThreeWorkers(decision: RouteDecisionV1): void {
  const workers = decision.tasks.filter((task) => task.kind !== 'REDUCE');
  if (workers.length > 3) {
    throw new SchedulePolicyError('每次运行最多允许三个工作任务');
  }
  if (workers.some((task) => task.dependsOn.length > 0)) {
    throw new SchedulePolicyError('Map 阶段工作任务必须彼此独立');
  }
}

function toPublicPlan(decision: RouteDecisionV1): PublicRoutePlanV1 {
  const bundleRevisions = workspaceQueryBundleRevisions(decision.tasks);
  return PublicRoutePlanV1Schema.parse({
    route: decision.route,
    userFacingPlan: decision.userFacingPlan,
    executionMode: decision.executionMode,
    tasks: decision.tasks.map((task) => ({
      id: task.id,
      label: conciseText(task.objective, 500),
      sourceKind: task.kind,
      status: 'PENDING' as const,
    })),
    ...(bundleRevisions.length > 0 ? { bundleRevisions } : {}),
  });
}

function publicUserRequest(context: AgentRunExecutionContext): Record<string, unknown> {
  return {
    text: context.text,
    ...(context.steeringInstruction ? { steeringInstruction: context.steeringInstruction } : {}),
    scope: context.scope,
    sources: context.sources,
    ...(context.selectedContext ? { selectedContext: context.selectedContext } : {}),
    attachmentIds: context.attachmentIds,
    planVersion: context.planVersion,
  };
}

function compactEvidence(evidence: ValidatedEvidenceV1): ValidatedEvidenceV1 {
  return {
    ...evidence,
    excerpt: conciseText(evidence.excerpt, 6_000),
  };
}

function compactFinding(finding: TaskFindingV1): Record<string, unknown> {
  return {
    taskId: finding.taskId,
    status: finding.status,
    findings: finding.findings.slice(0, 20).map((item) => conciseText(item, 2_000)),
    validatedEvidence: finding.validatedEvidence.slice(0, 36).map(compactEvidence),
    conflicts: finding.conflicts.slice(0, 10).map((item) => conciseText(item, 2_000)),
    gaps: finding.gaps.slice(0, 10).map((item) => conciseText(item, 2_000)),
  };
}

function canonicalizeFinding(
  finding: TaskFindingV1,
  expectedTaskId: string,
  candidates: readonly ValidatedEvidenceV1[],
): TaskFindingV1 {
  if (finding.taskId !== expectedTaskId) {
    throw new AgentOrchestrationError(
      'EVIDENCE_VALIDATION_FAILED',
      '子任务返回了错误的任务标识。',
      false,
    );
  }
  const canonical = TaskFindingV1Schema.parse({
    ...finding,
    validatedEvidence: canonicalizeEvidence(finding.validatedEvidence, candidates),
  });
  if (
    (canonical.status === 'FOUND'
      && (canonical.validatedEvidence.length === 0 || canonical.findings.length === 0))
    || (canonical.status === 'NO_EVIDENCE' && canonical.validatedEvidence.length > 0)
  ) {
    throw new AgentOrchestrationError(
      'EVIDENCE_VALIDATION_FAILED',
      '子任务结论与已验证证据不一致。',
      false,
    );
  }
  return canonical;
}

function canonicalizeAnswer(
  answer: AgentInternalAnswerV1,
  candidates: readonly ValidatedEvidenceV1[],
): AgentInternalAnswerV1 {
  return AgentInternalAnswerV1Schema.parse({
    ...answer,
    evidence: canonicalizeEvidence(answer.evidence, candidates),
  });
}

function canonicalizeEvidence(
  requested: readonly ValidatedEvidenceV1[],
  candidates: readonly ValidatedEvidenceV1[],
): ValidatedEvidenceV1[] {
  const byId = new Map<string, ValidatedEvidenceV1>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (existing && !sameEvidenceRecord(existing, candidate)) {
      throw new AgentOrchestrationError(
        'EVIDENCE_VALIDATION_FAILED',
        '候选证据标识发生冲突。',
        false,
      );
    }
    byId.set(candidate.id, candidate);
  }
  return requested.map((item) => {
    const candidate = byId.get(item.id);
    if (!candidate || !sameEvidenceIdentity(candidate, item)) {
      throw new AgentOrchestrationError(
        'EVIDENCE_VALIDATION_FAILED',
        '回答引用了未检索或已变化的证据。',
        false,
      );
    }
    return candidate;
  });
}

function sameEvidenceIdentity(left: ValidatedEvidenceV1, right: ValidatedEvidenceV1): boolean {
  return left.id === right.id
    && left.source === right.source
    && JSON.stringify(left.locator) === JSON.stringify(right.locator);
}

function sameEvidenceRecord(left: ValidatedEvidenceV1, right: ValidatedEvidenceV1): boolean {
  return sameEvidenceIdentity(left, right)
    && left.title === right.title
    && left.excerpt === right.excerpt;
}

function mergeFindingEvidence(findings: readonly TaskFindingV1[]): ValidatedEvidenceV1[] {
  const result = new Map<string, ValidatedEvidenceV1>();
  for (const finding of findings) {
    for (const evidence of finding.validatedEvidence) {
      const existing = result.get(evidence.id);
      if (existing && !sameEvidenceRecord(existing, evidence)) {
        throw new AgentOrchestrationError(
          'EVIDENCE_VALIDATION_FAILED',
          '子任务证据发生冲突。',
          false,
        );
      }
      result.set(evidence.id, evidence);
    }
  }
  return [...result.values()];
}

function toPublicFinding(finding: TaskFindingV1) {
  const text = finding.findings.length > 0
    ? finding.findings.slice(0, 3).join('\n')
    : finding.conflicts[0] ?? finding.gaps[0] ?? '该子任务没有找到足够证据。';
  return {
    taskId: finding.taskId,
    status: finding.status,
    summary: conciseText(text, 5_000),
    conflicts: finding.conflicts,
    gaps: finding.gaps,
    evidenceCount: finding.validatedEvidence.length,
  } as const;
}

function findingStatusForAnswer(answer: AgentInternalAnswerV1): TaskFindingV1['status'] {
  if (answer.evidenceStatus === 'CONFLICTING') return 'CONFLICT';
  if (answer.evidenceStatus === 'PARTIAL') return 'PARTIAL';
  return answer.evidence.length > 0 ? 'FOUND' : 'NO_EVIDENCE';
}

function degradedFinding(
  taskId: string,
  candidates: readonly ValidatedEvidenceV1[],
): TaskFindingV1 {
  return TaskFindingV1Schema.parse({
    taskId,
    status: candidates.length > 0 ? 'PARTIAL' : 'NO_EVIDENCE',
    findings: candidates.length > 0
      ? ['已保留确定性检索到的候选证据，但该子任务暂时未能完成结构化归纳。']
      : [],
    validatedEvidence: candidates,
    conflicts: [],
    gaps: ['该子任务暂时未能完成；最终答案必须明确这一证据缺口。'],
  });
}

function assertFlowFeedbackWasRetrieved(
  answer: AgentInternalAnswerV1,
  candidates: readonly ValidatedEvidenceV1[],
): void {
  const allowed = new Set(
    candidates
      .filter((item) => item.locator.kind === 'WORKSPACE_FLOW')
      .map((item) => JSON.stringify(stripLocatorKind(item.locator))),
  );
  for (const feedback of answer.flowFeedback) {
    if (!allowed.has(JSON.stringify(feedback.locator))) {
      throw new AgentOrchestrationError(
        'EVIDENCE_VALIDATION_FAILED',
        '流程反馈引用了未检索的节点。',
        false,
      );
    }
  }
}

function findFlowFeedbackEvidence(
  feedback: AgentInternalAnswerV1['flowFeedback'][number],
  candidates: readonly ValidatedEvidenceV1[],
): ValidatedEvidenceV1 {
  const expectedLocator = JSON.stringify(feedback.locator);
  const evidence = candidates.find((candidate) => (
    candidate.locator.kind === 'WORKSPACE_FLOW'
    && JSON.stringify(stripLocatorKind(candidate.locator)) === expectedLocator
  ));
  if (!evidence) {
    throw new AgentOrchestrationError(
      'EVIDENCE_VALIDATION_FAILED',
      '流程反馈引用了未检索的节点。',
      false,
    );
  }
  return evidence;
}

function stripLocatorKind(locator: InternalEvidenceLocatorV1): Record<string, unknown> {
  if (locator.kind !== 'WORKSPACE_FLOW') return {};
  const { kind: _kind, ...rest } = locator;
  return rest;
}

function assertUniqueReferenceIds(references: readonly ResolvedAgentReference[]): void {
  const ids = references.map((item) => item.reference.referenceId);
  if (new Set(ids).size !== ids.length) {
    throw new AgentOrchestrationError(
      'EVIDENCE_VALIDATION_FAILED',
      '引用标识发生冲突。',
      false,
    );
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function publicFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof AgentOrchestrationError) {
    return { code: error.code, message: error.publicMessage, retryable: error.retryable };
  }
  if (error instanceof SchedulePolicyError) {
    return {
      code: error.code,
      message: '任务调度未通过只读运行策略。',
      retryable: false,
    };
  }
  if (error instanceof RouterPolicyError) {
    return {
      code: error.code,
      message: 'Deep Router 复核未通过最小充分路线策略。',
      retryable: false,
    };
  }
  if (error instanceof AgentInvocationError || error instanceof RuntimeClientError) {
    return {
      code: PUBLIC_ERROR_CODE.test(error.code) ? error.code : 'RUNTIME_FAILED',
      message: '只读 Agent Runtime 暂时无法完成本次请求。',
      retryable: error.retryable,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'AGENT_OUTPUT_INVALID',
      message: 'Agent 返回的数据未通过结构校验。',
      retryable: true,
    };
  }
  return {
    code: 'AGENT_RUN_FAILED',
    message: '本次只读问答未能完成。',
    retryable: true,
  };
}

function childInvocationId(publicRunId: string, stage: string, generated: string): string {
  const safeStage = stage.replace(/[^A-Za-z0-9_-]/gu, '-').slice(0, 40) || 'stage';
  const safeGenerated = conciseIdentifier(generated);
  const available = 200 - safeStage.length - safeGenerated.length - 2;
  return `${publicRunId.slice(0, Math.max(1, available))}:${safeStage}:${safeGenerated}`;
}

function conciseIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('生成的运行标识不能为空');
  return trimmed.slice(0, 200);
}

function conciseText(value: string, maximum: number): string {
  const result = value.trim().slice(0, maximum);
  return result || '（无公开内容）';
}

function assertCurrentPlan(active: ActiveRun, context: AgentRunExecutionContext): void {
  if (context.planVersion !== active.planVersion) {
    throw active.planController.signal.reason ?? new DOMException('Agent plan changed', 'AbortError');
  }
  if (active.runController.signal.aborted) {
    throw active.runController.signal.reason ?? new DOMException('Agent run aborted', 'AbortError');
  }
  if (active.planController.signal.aborted) {
    throw active.planController.signal.reason ?? new DOMException('Agent plan aborted', 'AbortError');
  }
}

async function runBounded<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal,
  timeoutMs: number,
  timeoutError: Error,
): Promise<T> {
  if (parentSignal.aborted) {
    throw parentSignal.reason ?? new DOMException('Agent operation aborted', 'AbortError');
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', onAbort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onOperationAbort = () => rejectAbort?.(
    controller.signal.reason ?? new DOMException('Agent operation aborted', 'AbortError'),
  );
  controller.signal.addEventListener('abort', onOperationAbort, { once: true });
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), aborted, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', onOperationAbort);
  }
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation.catch(() => undefined),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function repairPrompt(prompt: string, diagnostic?: string): string {
  const detail = diagnostic
    ? ` 已知失败路径（仅包含字段路径和校验类型）：${diagnostic}。`
    : '';
  return `${prompt}\n\n结构修复：上一次输出未通过目标 schema。${detail} 只重新输出一个严格匹配 outputKind 的 JSON 对象，不得增加解释或新证据。`;
}

function routeRepairPrompt(prompt: string, diagnostic?: string): string {
  return `${repairPrompt(prompt, diagnostic)}\n\n${ROUTE_DECISION_CROSS_FIELD_RULES}`;
}

const ROUTE_DECISION_CROSS_FIELD_RULES = `RouteDecision 跨字段约束（JSON schema 不会表达这些约束，必须手动满足）：
- DIRECT 路线：最多一个工作任务、不能有 REDUCE；executionMode=SEQUENTIAL；maxConcurrency=1、budget.maxConcurrency=1；budget.maxWorkers=0 或 1，并且 budget.useReducer=false。
- FOCUSED 路线必须只有一个工作任务、不能有 REDUCE；executionMode=SEQUENTIAL；maxConcurrency=1、budget.maxConcurrency=1、budget.maxWorkers=1，并且 budget.useReducer=false。
- COMPOSITE 路线必须有二至三个工作任务和一个 REDUCE；executionMode=PARALLEL；budget.maxWorkers 等于工作任务数；budget.useReducer=true；汇总任务必须依赖全部工作任务。
- OPEN_RESEARCH 路线必须有二至三个工作任务和一个 REDUCE；budget.maxWorkers 等于工作任务数；budget.useReducer=true；汇总任务必须依赖全部工作任务。
- 本轮 userRequest.sources 中为 true 的来源必须在 decision.sources 中保持 true，不能关闭本轮已启用的工作区来源；任务 kind 只能使用已启用的数据源。
- 所有 tasks.id 必须唯一；dependsOn 只能指向其他 task、不能自依赖或成环；工作任务的 dependsOn 必须为空；maxConcurrency 不能超过 budget.maxConcurrency。`;

function isRepairableTypedOutput(error: unknown): boolean {
  if (error instanceof z.ZodError) return true;
  if (error instanceof AgentInvocationError || error instanceof RuntimeClientError) {
    return error.code === 'INVALID_ROUTE_DECISION'
      || error.code === 'BRIDGE_OUTPUT_KIND_INVALID'
      || error.code === 'BRIDGE_OUTPUT_MISSING'
      || error.code === 'BRIDGE_EVENT_INVALID';
  }
  return false;
}

function isPhaseTimeout(error: unknown): boolean {
  return error instanceof AgentOrchestrationError && error.code.endsWith('_TIMEOUT');
}

function isDegradableWorkerFailure(error: unknown): boolean {
  return error instanceof AgentInvocationError
    || error instanceof RuntimeClientError
    || error instanceof z.ZodError
    || isPhaseTimeout(error);
}

function assertTimeouts(timeouts: AgentOrchestratorTimeouts): void {
  for (const [name, value] of Object.entries(timeouts)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 900_000) {
      throw new Error(`Agent timeout ${name} 必须是 1 到 900000 的整数`);
    }
  }
}

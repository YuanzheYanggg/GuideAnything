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
import { buildPromptHarness } from './prompt-harness';
import { requiresDeepRouterReview } from './router';
import type { AgentRuntimeClient } from './runtime-client';
import { RuntimeClientError } from './runtime-client';
import { enforceSchedulePolicy, SchedulePolicyError } from './scheduler';
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
}

export interface AgentRunExecutionContext {
  runId: string;
  conversationId: string;
  ownerId: string;
  scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE';
  workspaceId: string | null;
  planVersion: number;
  status: AgentRunStatusV1;
  text: string;
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
  ): Promise<ResolvedAgentReference>;
  resolveFlowFeedback(
    context: AgentRunExecutionContext,
    feedback: AgentInternalAnswerV1['flowFeedback'][number],
  ): Promise<ResolvedAgentReference>;
}

export interface CommitAgentOutputInput {
  context: AgentRunExecutionContext;
  answer: AgentCommittedAnswerV1;
  references: readonly ResolvedAgentReference[];
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
  createId?: () => string;
  now?: () => Date;
}

interface ActiveRun {
  controller: AbortController;
  childIds: Set<string>;
  planVersion: number;
  committing: boolean;
  cancelReason?: string;
}

interface RetrievalState {
  evidenceByTaskId: Map<string, ValidatedEvidenceV1[]>;
  allEvidence: ValidatedEvidenceV1[];
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
const COMPREHENSIVE_REQUEST = /(?:全面|完整|系统(?:性)?|综合|彻底|深入|开放研究)/u;
const MAX_TRUSTED_HARNESS_ITEMS = 15;

export class AgentOrchestrator {
  readonly #runtime: AgentRuntimeClient;
  readonly #eventStore: AgentRunEventSink;
  readonly #loadContext: AgentOrchestratorOptions['loadContext'];
  readonly #retriever: AgentEvidenceRetriever;
  readonly #evidenceResolver: AgentEvidenceResolver;
  readonly #outputCommitter: AgentOutputCommitter;
  readonly #configuredMaxConcurrency: number;
  readonly #trustedHarness: readonly string[];
  readonly #createId: () => string;
  readonly #now: () => Date;
  readonly #activeRuns = new Map<string, ActiveRun>();

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
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  async execute(runId: string, externalSignal?: AbortSignal): Promise<AgentRunExecutionResult> {
    if (this.#activeRuns.has(runId)) {
      throw new AgentOrchestrationError('RUN_ALREADY_ACTIVE', '运行已经在执行。', false);
    }
    const active: ActiveRun = {
      controller: new AbortController(),
      childIds: new Set(),
      planVersion: 1,
      committing: false,
    };
    this.#activeRuns.set(runId, active);
    const onExternalAbort = () => {
      if (!active.committing) active.controller.abort(externalSignal?.reason);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    if (externalSignal?.aborted) onExternalAbort();

    let context: AgentRunExecutionContext | undefined;
    try {
      context = await this.#loadContext(runId);
      assertExecutionContext(context, runId);
      active.planVersion = context.planVersion;
      throwIfAborted(active.controller.signal);

      this.#append(runId, context.planVersion, 'PROVISIONAL', 'route.started', {
        intent: conciseText(context.text, 2_000),
      });
      const mediumDecision = await this.#invokeRoute(
        active,
        context,
        'ROUTER',
        'MEDIUM',
        'medium-router',
        this.#routerPrompt(context, 'ROUTER'),
      );
      throwIfAborted(active.controller.signal);

      const needsDeepReview = requiresDeepRouterReview(mediumDecision, {
        requestedVaultClusters: mediumDecision.budget.maxVaultClusters,
        userRequestedComprehensive: COMPREHENSIVE_REQUEST.test(context.text),
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
      const scheduled = enforceSchedulePolicy(finalDecision, {
        allowedSources: context.sources,
        allowRawApproved: needsDeepReview,
        configuredMaxConcurrency: this.#configuredMaxConcurrency,
      });
      assertAtMostThreeWorkers(scheduled);
      const publicPlan = toPublicPlan(scheduled);
      this.#append(runId, context.planVersion, 'PROVISIONAL', 'route.completed', {
        route: scheduled.route,
        userFacingPlan: scheduled.userFacingPlan,
      });
      this.#append(runId, context.planVersion, 'PROVISIONAL', 'plan.committed', {
        plan: publicPlan,
      });

      const retrieval = await this.#retrieveEvidence(context, scheduled, active.controller.signal);
      throwIfAborted(active.controller.signal);
      const answerExecution = scheduled.budget.useReducer
        ? await this.#executeMapReduce(active, context, scheduled, retrieval)
        : await this.#executeFocused(active, context, scheduled, retrieval);
      throwIfAborted(active.controller.signal);
      const result = await this.#validateAndCommit(
        active,
        context,
        answerExecution.answer,
        answerExecution.allowedFlowEvidence,
      );
      return result;
    } catch (error) {
      if (!context) throw error;
      if (active.controller.signal.aborted) {
        await this.#cancelChildren(active);
        this.#append(runId, context.planVersion, 'COMMITTED', 'run.cancelled', {
          ...(active.cancelReason ? { reason: active.cancelReason } : {}),
        });
        return { status: 'CANCELLED' };
      }
      const failure = publicFailure(error);
      await this.#cancelChildren(active);
      this.#append(runId, context.planVersion, 'COMMITTED', 'run.failed', failure);
      return { status: 'FAILED' };
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      this.#activeRuns.delete(runId);
    }
  }

  async cancel(runId: string, reason?: string): Promise<void> {
    const active = this.#activeRuns.get(runId);
    if (!active || active.committing) return;
    if (reason?.trim()) active.cancelReason = conciseText(reason.trim(), 2_000);
    active.controller.abort(new DOMException('Agent run cancelled', 'AbortError'));
    await this.#cancelChildren(active);
  }

  async #retrieveEvidence(
    context: AgentRunExecutionContext,
    decision: RouteDecisionV1,
    signal: AbortSignal,
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
    const evidenceByTaskId = new Map<string, ValidatedEvidenceV1[]>();
    const globallySeen = new Map<string, ValidatedEvidenceV1>();
    for (const task of ordered) {
      throwIfAborted(signal);
      const isVault = task.kind === 'SANTEXWELL';
      const maxCandidates = isVault ? remainingVault : remainingWorkspace;
      const raw = maxCandidates === 0
        ? []
        : await this.#retriever.retrieve({
            context,
            decision,
            task,
            maxCandidates,
            maxFlowHops: task.kind === 'WORKSPACE_FLOW' ? decision.budget.maxFlowHops : 0,
            allowRaw: isVault && decision.budget.allowRaw,
            signal,
          });
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
    return { evidenceByTaskId, allEvidence: [...globallySeen.values()] };
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
      this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'task.started', {
        taskId: worker.id,
        label: conciseText(worker.objective, 500),
      });
      this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'task.progress', {
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
    this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'answer.draft.delta', {
      delta: canonical.conclusion,
    });
    if (worker) {
      this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'task.completed', {
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
    const workers = decision.tasks.filter((task) => task.kind !== 'REDUCE');
    const findings = await mapWithConcurrency(
      workers,
      decision.maxConcurrency,
      async (task): Promise<TaskFindingV1> => {
        this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'task.started', {
          taskId: task.id,
          label: conciseText(task.objective, 500),
        });
        this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'task.progress', {
          taskId: task.id,
          message: '正在核对该子任务的已授权证据。',
          progress: 0.5,
        });
        const candidates = retrieval.evidenceByTaskId.get(task.id) ?? [];
        const untrusted = await this.#invokeFinding(
          active,
          context,
          task,
          this.#workerPrompt(context, decision, task, candidates, 'DEEP_WORKER'),
        );
        const finding = canonicalizeFinding(untrusted, task.id, candidates);
        this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'task.finding', {
          finding: toPublicFinding(finding),
        });
        this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'task.completed', {
          taskId: task.id,
          status: finding.status,
        });
        return finding;
      },
    );
    throwIfAborted(active.controller.signal);
    this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'reduce.started', {});
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
    this.#append(context.runId, context.planVersion, 'PROVISIONAL', 'answer.draft.delta', {
      delta: answer.conclusion,
    });
    return { answer, allowedFlowEvidence: reducerCandidates };
  }

  async #validateAndCommit(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    answer: AgentInternalAnswerV1,
    allowedFlowEvidence: readonly ValidatedEvidenceV1[],
  ): Promise<{ status: 'COMPLETED'; messageId: string }> {
    assertFlowFeedbackWasRetrieved(answer, allowedFlowEvidence);
    this.#append(context.runId, context.planVersion, 'COMMITTED', 'answer.validating', {});
    const resolvedEvidence = await Promise.all(
      answer.evidence.map((item) => this.#evidenceResolver.resolveEvidence(context, item)),
    );
    const resolvedFeedback = await Promise.all(
      answer.flowFeedback.map((item) => this.#evidenceResolver.resolveFlowFeedback(context, item)),
    );
    throwIfAborted(active.controller.signal);
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
    resolvedFeedback.forEach((resolved) => PublicReferenceV1Schema.parse(resolved.reference));
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
    throwIfAborted(active.controller.signal);
    active.committing = true;
    const persisted = await this.#outputCommitter.commit({ context, answer: committed, references });
    for (const citation of committed.citations) {
      this.#append(context.runId, context.planVersion, 'COMMITTED', 'citation.committed', { citation });
    }
    this.#append(context.runId, context.planVersion, 'COMMITTED', 'answer.committed', {
      answer: committed,
    });
    for (const artifact of committed.artifacts) {
      this.#append(context.runId, context.planVersion, 'COMMITTED', 'artifact.committed', { artifact });
    }
    this.#append(context.runId, context.planVersion, 'COMMITTED', 'run.completed', {
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
        role === 'ROUTER'
          ? '分析任务难度并输出最小充分路线；小问题不得扩大检索范围。'
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
    return buildPromptHarness({
      role,
      trustedHarness: [
        ...this.#trustedHarness,
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
    const request = this.#request(active, context, role, reasoningEffort, 'ROUTE_DECISION', stage, prompt);
    try {
      return await runRouteDecision(this.#runtime, request, active.controller.signal);
    } finally {
      active.childIds.delete(request.runId);
    }
  }

  async #invokeFinding(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    task: RouteTaskV1,
    prompt: string,
  ): Promise<TaskFindingV1> {
    const request = this.#request(
      active,
      context,
      'DEEP_WORKER',
      'HIGH',
      'TASK_FINDING',
      `worker-${task.id}`,
      prompt,
    );
    try {
      return await runTaskFinding(this.#runtime, request, active.controller.signal);
    } finally {
      active.childIds.delete(request.runId);
    }
  }

  async #invokeAnswer(
    active: ActiveRun,
    context: AgentRunExecutionContext,
    role: 'FOCUSED_WORKER' | 'REDUCER',
    reasoningEffort: 'MEDIUM' | 'HIGH',
    stage: string,
    prompt: string,
  ): Promise<AgentInternalAnswerV1> {
    const request = this.#request(active, context, role, reasoningEffort, 'ANSWER', stage, prompt);
    try {
      return await runFinalAnswer(this.#runtime, request, active.controller.signal);
    } finally {
      active.childIds.delete(request.runId);
    }
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
    throwIfAborted(active.controller.signal);
    const childId = childInvocationId(context.runId, stage, this.#createId());
    active.childIds.add(childId);
    return {
      type: 'RUN',
      requestId: conciseIdentifier(this.#createId()),
      runId: childId,
      planVersion: context.planVersion,
      role,
      reasoningEffort,
      outputKind,
      prompt,
      allowedRoots: [],
    } as BridgeRunRequestV1 & { outputKind: TOutput };
  }

  async #cancelChildren(active: ActiveRun): Promise<void> {
    const childIds = [...active.childIds];
    await Promise.allSettled(childIds.map((childId) => this.#runtime.cancel(childId)));
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
  });
}

function publicUserRequest(context: AgentRunExecutionContext): Record<string, unknown> {
  return {
    text: context.text,
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

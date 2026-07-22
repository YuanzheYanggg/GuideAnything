import { z } from 'zod';
import {
  AgentInternalAnswerV1Schema,
  BridgeEventV1Schema,
  BridgeRunRequestV1Schema,
  GuideDigestDraftV1Schema,
  RouteDecisionV1Schema,
  TaskFindingV1Schema,
  type AgentInternalAnswerV1,
  type BridgeEventV1,
  type BridgeModelRoleV1,
  type BridgeOutputKindV1,
  type BridgeRunRequestV1,
  type GuideDigestDraftV1,
  type RouteDecisionV1,
  type TaskFindingV1,
} from '@guideanything/contracts';

import type { RuntimeBridgeConfig } from './config';
import type {
  RpcNotification,
  RpcProtocolIssue,
  RpcServerRequest,
} from './json-rpc';
import type { CodexRunHandle, ModelRoleHealth, RuntimeHealth } from './types';

const ROLES: readonly BridgeModelRoleV1[] = [
  'ROUTER',
  'DEEP_ROUTER',
  'FOCUSED_WORKER',
  'DEEP_WORKER',
  'REDUCER',
];

const REQUIRED_EFFORT: Readonly<Record<BridgeModelRoleV1, 'MEDIUM' | 'HIGH'>> = {
  ROUTER: 'MEDIUM',
  DEEP_ROUTER: 'HIGH',
  FOCUSED_WORKER: 'MEDIUM',
  DEEP_WORKER: 'HIGH',
  REDUCER: 'HIGH',
};

const BRIDGE_BASE_INSTRUCTIONS = [
  'You are a read-only structured-answer synthesizer.',
  'Use only evidence present in the supplied prompt.',
  'Do not call tools, access files, use the network, or reveal hidden reasoning.',
  'The final assistant message must be JSON matching the supplied schema.',
].join(' ');

// Codex forwards this schema to the Responses API, whose structured-output
// subset accepts `anyOf` but rejects the draft-7 `oneOf` emitted by Zod for
// discriminated unions. The rewrite is semantics-preserving; every final value
// is still parsed by its original contract schema before it can leave the bridge.
export const AGENT_INTERNAL_ANSWER_JSON_SCHEMA = Object.freeze(
  makeCodexOutputSchema(z.toJSONSchema(AgentInternalAnswerV1Schema, { target: 'draft-7' })) as object,
);
export const ROUTE_DECISION_JSON_SCHEMA = Object.freeze(
  makeCodexOutputSchema(z.toJSONSchema(RouteDecisionV1Schema, { target: 'draft-7' })) as object,
);
export const TASK_FINDING_JSON_SCHEMA = Object.freeze(
  makeCodexOutputSchema(z.toJSONSchema(TaskFindingV1Schema, { target: 'draft-7' })) as object,
);
export const GUIDE_DIGEST_JSON_SCHEMA = Object.freeze(
  makeCodexOutputSchema(z.toJSONSchema(GuideDigestDraftV1Schema, { target: 'draft-7' })) as object,
);

const OUTPUT_SCHEMA_BY_KIND: Readonly<Record<BridgeOutputKindV1, object>> = Object.freeze({
  ROUTE_DECISION: ROUTE_DECISION_JSON_SCHEMA,
  TASK_FINDING: TASK_FINDING_JSON_SCHEMA,
  ANSWER: AGENT_INTERNAL_ANSWER_JSON_SCHEMA,
  GUIDE_DIGEST: GUIDE_DIGEST_JSON_SCHEMA,
});

export interface CodexRpc {
  request<T>(
    method: string,
    params: unknown,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(listener: (notification: RpcNotification) => void): () => void;
  onProtocolIssue(listener: (issue: RpcProtocolIssue) => void): () => void;
  onServerRequest(listener: (request: RpcServerRequest) => void): () => void;
  close(): Promise<void>;
}

export class CodexRuntimeError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false) {
    super(`Codex runtime failure: ${code}`);
    this.name = 'CodexRuntimeError';
    this.code = code;
    this.retryable = retryable;
  }
}

interface CodexModel {
  readonly id: string;
  readonly model: string;
  readonly supportedReasoningEfforts: readonly { readonly reasoningEffort: string }[];
}

interface ResolvedRole {
  readonly model: CodexModel;
  readonly requiredEffort: 'MEDIUM' | 'HIGH';
}

interface RunContext {
  readonly requestId: string;
  readonly runId: string;
  readonly threadId: string;
  turnId: string;
  planVersion: number;
  readonly outputKind: BridgeOutputKindV1;
  readonly queue: AsyncEventQueue<BridgeEventV1>;
  readonly itemPhases: Map<string, 'commentary' | 'final_answer' | null>;
  sequence: number;
  structuredOutput: RouteDecisionV1 | TaskFindingV1 | AgentInternalAnswerV1 | GuideDigestDraftV1 | null;
  terminal: boolean;
  cancelRequested: boolean;
  steerInFlight: boolean;
  interruptPromise: Promise<void> | null;
  timeout: NodeJS.Timeout | null;
}

export class CodexRuntime {
  readonly #rpc: CodexRpc;
  readonly #config: RuntimeBridgeConfig;
  readonly #version: string;
  readonly #runtimeHome: string;
  readonly #runtimeWorkDir: string;
  readonly #reasonCodes = new Set<string>();
  readonly #roles = new Map<BridgeModelRoleV1, ResolvedRole>();
  readonly #roleHealth = new Map<BridgeModelRoleV1, ModelRoleHealth>();
  readonly #runsById = new Map<string, RunContext>();
  readonly #runsByThread = new Map<string, RunContext>();
  readonly #startingRunIds = new Set<string>();
  readonly #startingThreadIds = new Set<string>();
  readonly #disposeListeners: (() => void)[];
  #initialized = false;
  #instructionSources = 0;
  #mcpStartups = 0;
  #unexpectedCapabilities = 0;
  #maxInputTokens = 0;

  constructor(
    rpc: CodexRpc,
    config: RuntimeBridgeConfig,
    version: string,
    runtimePaths: { readonly home: string; readonly workDir: string } = {
      home: config.runtimeHome,
      workDir: config.runtimeWorkDir,
    },
  ) {
    this.#rpc = rpc;
    this.#config = config;
    this.#version = sanitizeVersion(version);
    this.#runtimeHome = runtimePaths.home;
    this.#runtimeWorkDir = runtimePaths.workDir;
    this.#disposeListeners = [
      rpc.onNotification(this.#onNotification),
      rpc.onProtocolIssue(this.#onProtocolIssue),
      rpc.onServerRequest(this.#onServerRequest),
    ];
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    const response = await this.#rpc.request<unknown>('initialize', {
      clientInfo: {
        name: 'guideanything-runtime-bridge',
        title: 'GuideAnything Runtime Bridge',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
        // The app server may emit this status even when no MCP tool is exposed.
        // Suppress it at the protocol source so the read-only runtime does not
        // mistake startup bookkeeping for a capability invocation.
        optOutNotificationMethods: ['mcpServer/startupStatus/updated'],
      },
    }, { timeoutMs: this.#config.rpcTimeoutMs });

    if (!isRecord(response) || response.codexHome !== this.#runtimeHome) {
      this.#degrade('RUNTIME_HOME_MISMATCH');
      throw new CodexRuntimeError('RUNTIME_HOME_MISMATCH');
    }
    this.#rpc.notify('initialized');

    const models: CodexModel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const result: unknown = await this.#rpc.request<unknown>('model/list', {
        cursor,
        limit: 100,
        includeHidden: false,
      }, { timeoutMs: this.#config.rpcTimeoutMs });
      if (!isRecord(result) || !Array.isArray(result.data)) {
        this.#degrade('MODEL_LIST_INVALID');
        throw new CodexRuntimeError('MODEL_LIST_INVALID', true);
      }
      for (const candidate of result.data) {
        if (isCodexModel(candidate)) models.push(candidate);
      }
      cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null;
      if (!cursor) break;
      if (page === 19) {
        this.#degrade('MODEL_LIST_PAGINATION_LIMIT');
        throw new CodexRuntimeError('MODEL_LIST_PAGINATION_LIMIT', true);
      }
    }

    this.#resolveRoles(models);
    this.#initialized = true;
  }

  getHealth(): RuntimeHealth {
    const roles = Object.fromEntries(ROLES.map((role) => [
      role,
      this.#roleHealth.get(role) ?? {
        ready: false,
        model: null,
        requiredEffort: REQUIRED_EFFORT[role],
        supportedEfforts: [],
      },
    ])) as Record<BridgeModelRoleV1, ModelRoleHealth>;
    const reasonCodes = new Set(this.#reasonCodes);
    if (!this.#initialized) reasonCodes.add('NOT_INITIALIZED');
    return Object.freeze({
      status: this.#initialized && reasonCodes.size === 0 ? 'READY' : 'DEGRADED',
      version: this.#version,
      roles: Object.freeze(roles),
      counters: Object.freeze({
        instructionSources: this.#instructionSources,
        mcpStartups: this.#mcpStartups,
        unexpectedCapabilities: this.#unexpectedCapabilities,
        maxInputTokens: this.#maxInputTokens,
      }),
      reasonCodes: Object.freeze([...reasonCodes].sort()),
    });
  }

  async startRun(input: BridgeRunRequestV1): Promise<CodexRunHandle> {
    const request = BridgeRunRequestV1Schema.parse(input);
    if (this.getHealth().status !== 'READY') throw new CodexRuntimeError('RUNTIME_DEGRADED', true);
    if (request.allowedRoots.length > 0) throw new CodexRuntimeError('CALLER_ROOTS_FORBIDDEN');
    if (REQUIRED_EFFORT[request.role] !== request.reasoningEffort) {
      throw new CodexRuntimeError('EFFORT_ROLE_MISMATCH');
    }
    const role = this.#roles.get(request.role);
    if (!role) throw new CodexRuntimeError('MODEL_ROLE_UNAVAILABLE', true);
    if (this.#runsById.has(request.runId) || this.#startingRunIds.has(request.runId)) {
      throw new CodexRuntimeError('RUN_ALREADY_ACTIVE');
    }
    if (
      request.resumeThreadId
      && (this.#runsByThread.has(request.resumeThreadId) || this.#startingThreadIds.has(request.resumeThreadId))
    ) {
      throw new CodexRuntimeError('THREAD_ALREADY_ACTIVE');
    }
    if (this.#runsById.size + this.#startingRunIds.size >= this.#config.maxConcurrency) {
      throw new CodexRuntimeError('CONCURRENCY_LIMIT', true);
    }

    this.#startingRunIds.add(request.runId);
    if (request.resumeThreadId) this.#startingThreadIds.add(request.resumeThreadId);
    let reservationHeld = true;
    try {
      const thread = request.resumeThreadId
        ? await this.#resumeThread(request.resumeThreadId, role)
        : await this.#startThread(role);
      const threadId = this.#validateThreadResponse(thread, role);
      if (this.getHealth().status !== 'READY') {
        throw new CodexRuntimeError('RUNTIME_DEGRADED', true);
      }
      if (request.resumeThreadId && threadId !== request.resumeThreadId) {
        this.#degrade('RESUMED_THREAD_ID_MISMATCH');
        throw new CodexRuntimeError('RESUMED_THREAD_ID_MISMATCH');
      }
      const reservedByAnotherStart = this.#startingThreadIds.has(threadId)
        && threadId !== request.resumeThreadId;
      if (this.#runsByThread.has(threadId) || reservedByAnotherStart) {
        throw new CodexRuntimeError('THREAD_ALREADY_ACTIVE');
      }

      this.#startingRunIds.delete(request.runId);
      if (request.resumeThreadId) this.#startingThreadIds.delete(request.resumeThreadId);
      reservationHeld = false;

      const queue = new AsyncEventQueue<BridgeEventV1>();
      const context: RunContext = {
        requestId: request.requestId,
        runId: request.runId,
        threadId,
        turnId: '',
        planVersion: request.planVersion,
        outputKind: request.outputKind,
        queue,
        itemPhases: new Map(),
        sequence: 0,
        structuredOutput: null,
        terminal: false,
        cancelRequested: false,
        steerInFlight: false,
        interruptPromise: null,
        timeout: null,
      };
      this.#runsById.set(context.runId, context);
      this.#runsByThread.set(context.threadId, context);
      this.#push(context, 'THREAD_BOUND', { threadId });

      const turnResponse = await this.#rpc.request<unknown>('turn/start', {
        threadId,
        clientUserMessageId: request.requestId,
        input: [{ type: 'text', text: request.prompt }],
        environments: [],
        cwd: this.#runtimeWorkDir,
        runtimeWorkspaceRoots: [this.#runtimeWorkDir],
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        model: role.model.model,
        effort: request.reasoningEffort.toLowerCase(),
        summary: 'none',
        personality: 'none',
        outputSchema: OUTPUT_SCHEMA_BY_KIND[request.outputKind],
      }, { timeoutMs: this.#config.rpcTimeoutMs });
      const turn = isRecord(turnResponse) && isRecord(turnResponse.turn) ? turnResponse.turn : null;
      if (!turn || typeof turn.id !== 'string' || turn.status !== 'inProgress') {
        throw new CodexRuntimeError('TURN_START_INVALID', true);
      }
      context.turnId = turn.id;
      if (context.terminal || this.getHealth().status !== 'READY') {
        await this.#rejectCrossedStartupBoundary(context);
      }
      context.timeout = setTimeout(() => {
        void this.#handleTurnTimeout(context);
      }, this.#config.turnTimeoutMs);
      context.timeout.unref?.();
      return new RuntimeRunHandle(this, context);
    } catch (error) {
      const active = this.#runsById.get(request.runId);
      if (active) this.#finish(active);
      throw error;
    } finally {
      if (reservationHeld) {
        this.#startingRunIds.delete(request.runId);
        if (request.resumeThreadId) this.#startingThreadIds.delete(request.resumeThreadId);
      }
    }
  }

  async cancelRun(context: RunContext): Promise<void> {
    if (context.terminal || context.cancelRequested) return;
    context.cancelRequested = true;
    try {
      await this.#interruptOnce(context);
    } catch {
      this.#degrade('TURN_INTERRUPT_FAILED');
      this.#fail(context, 'TURN_INTERRUPT_FAILED', true);
      throw new CodexRuntimeError('TURN_INTERRUPT_FAILED', true);
    }
    if (!context.terminal) this.#fail(context, 'TURN_INTERRUPTED', false);
  }

  async steerRun(context: RunContext, planVersion: number, instruction: string): Promise<void> {
    if (context.terminal) throw new CodexRuntimeError('RUN_NOT_ACTIVE');
    if (context.cancelRequested) throw new CodexRuntimeError('RUN_CANCELLING');
    if (context.steerInFlight) throw new CodexRuntimeError('STEER_IN_PROGRESS', true);
    if (planVersion !== context.planVersion + 1) throw new CodexRuntimeError('PLAN_VERSION_MISMATCH');
    if (!instruction.trim() || instruction.length > 20_000) throw new CodexRuntimeError('STEER_INSTRUCTION_INVALID');
    context.steerInFlight = true;
    try {
      const result = await this.#rpc.request<unknown>('turn/steer', {
        threadId: context.threadId,
        expectedTurnId: context.turnId,
        input: [{ type: 'text', text: instruction }],
      }, { timeoutMs: this.#config.rpcTimeoutMs });
      if (context.terminal) throw new CodexRuntimeError('RUN_NOT_ACTIVE');
      if (!isRecord(result) || result.turnId !== context.turnId) {
        this.#degrade('STEER_TURN_MISMATCH');
        this.#fail(context, 'STEER_TURN_MISMATCH', false);
        throw new CodexRuntimeError('STEER_TURN_MISMATCH');
      }
      context.planVersion = planVersion;
    } finally {
      context.steerInFlight = false;
    }
  }

  async close(): Promise<void> {
    this.#disposeListeners.splice(0).forEach((dispose) => dispose());
    for (const context of [...this.#runsById.values()]) this.#fail(context, 'RUNTIME_CLOSED', true);
    await this.#rpc.close();
  }

  async #startThread(role: ResolvedRole): Promise<unknown> {
    return await this.#rpc.request('thread/start', {
      ...this.#threadSecurityParams(role),
      allowProviderModelFallback: false,
      serviceName: 'guideanything',
      ephemeral: true,
      sessionStartSource: 'startup',
      threadSource: 'guideanything-runtime-bridge',
      environments: [],
      dynamicTools: [],
      selectedCapabilityRoots: [],
      experimentalRawEvents: false,
    }, { timeoutMs: this.#config.rpcTimeoutMs });
  }

  async #resumeThread(threadId: string, role: ResolvedRole): Promise<unknown> {
    return await this.#rpc.request('thread/resume', {
      threadId,
      ...this.#threadSecurityParams(role),
      excludeTurns: true,
    }, { timeoutMs: this.#config.rpcTimeoutMs });
  }

  #threadSecurityParams(role: ResolvedRole): object {
    return {
      model: role.model.model,
      cwd: this.#runtimeWorkDir,
      runtimeWorkspaceRoots: [this.#runtimeWorkDir],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: { web_search: 'disabled' },
      baseInstructions: BRIDGE_BASE_INSTRUCTIONS,
      developerInstructions: null,
      personality: 'none',
    };
  }

  #validateThreadResponse(response: unknown, role: ResolvedRole): string {
    if (!isRecord(response)) return this.#rejectThreadSecurity('THREAD_SECURITY_MISMATCH');
    const sources = response.instructionSources;
    if (Array.isArray(sources) && sources.length > 0) {
      this.#instructionSources += sources.length;
      return this.#rejectThreadSecurity('INSTRUCTION_SOURCES_PRESENT');
    }
    const thread = isRecord(response.thread) ? response.thread : null;
    const roots = response.runtimeWorkspaceRoots;
    const sandbox = isRecord(response.sandbox) ? response.sandbox : null;
    const valid = thread
      && typeof thread.id === 'string'
      && response.model === role.model.model
      && response.cwd === this.#runtimeWorkDir
      && Array.isArray(roots)
      && roots.length === 1
      && roots[0] === this.#runtimeWorkDir
      && Array.isArray(sources)
      && response.approvalPolicy === 'never'
      && sandbox?.type === 'readOnly'
      && sandbox.networkAccess === false;
    if (!valid) return this.#rejectThreadSecurity('THREAD_SECURITY_MISMATCH');
    return thread.id as string;
  }

  #rejectThreadSecurity(code: string): never {
    this.#degrade(code);
    throw new CodexRuntimeError(code);
  }

  #resolveRoles(models: readonly CodexModel[]): void {
    for (const role of ROLES) {
      const configured = this.#config.modelRoles[role];
      const requiredEffort = REQUIRED_EFFORT[role];
      if (!configured) {
        this.#degrade('MODEL_ROLE_UNCONFIGURED');
        this.#roleHealth.set(role, Object.freeze({
          ready: false, model: null, requiredEffort, supportedEfforts: [],
        }));
        continue;
      }
      const matches = models.filter((candidate) => candidate.id === configured || candidate.model === configured);
      if (matches.length !== 1) {
        this.#degrade('MODEL_ROLE_NOT_FOUND');
        this.#roleHealth.set(role, Object.freeze({
          ready: false, model: null, requiredEffort, supportedEfforts: [],
        }));
        continue;
      }
      const selected = matches[0]!;
      const supportedEfforts = selected.supportedReasoningEfforts
        .map(({ reasoningEffort }) => reasoningEffort.toLowerCase());
      const effortReady = supportedEfforts.includes(requiredEffort.toLowerCase());
      if (!effortReady) this.#degrade('MODEL_EFFORT_UNSUPPORTED');
      this.#roleHealth.set(role, Object.freeze({
        ready: effortReady,
        model: selected.model,
        requiredEffort,
        supportedEfforts: Object.freeze([...supportedEfforts]),
      }));
      if (effortReady) this.#roles.set(role, { model: selected, requiredEffort });
    }
  }

  readonly #onNotification = (notification: RpcNotification): void => {
    const params = isRecord(notification.params) ? notification.params : null;
    const threadId = params && typeof params.threadId === 'string' ? params.threadId : null;
    const context = threadId ? this.#runsByThread.get(threadId) : undefined;
    const notificationTurnId = extractTurnId(notification.method, params);

    if (isForbiddenNotification(notification.method)) {
      if (notification.method === 'mcpServer/startupStatus/updated') {
        this.#mcpStartups += 1;
        this.#unexpectedCapability(undefined);
      } else if (
        context
        && (!context.turnId || !notificationTurnId || notificationTurnId === context.turnId)
      ) {
        this.#unexpectedCapability(context);
      }
      return;
    }
    if (!context || context.terminal) return;
    if (context.turnId && notificationTurnId && notificationTurnId !== context.turnId) return;

    switch (notification.method) {
      case 'item/started':
        this.#handleItem(context, params?.item, false);
        break;
      case 'item/completed':
        this.#handleItem(context, params?.item, true);
        break;
      case 'item/agentMessage/delta':
        this.#handleAgentDelta(context, params);
        break;
      case 'thread/tokenUsage/updated':
        this.#handleTokenUsage(context, params);
        break;
      case 'turn/completed':
        this.#handleTurnCompleted(context, params);
        break;
      case 'error':
        this.#fail(context, 'CODEX_TURN_ERROR', true);
        break;
      default:
        if (notification.method.startsWith('item/')) this.#unexpectedCapability(context);
        break;
    }
  };

  readonly #onProtocolIssue = (_issue: RpcProtocolIssue): void => {
    this.#degrade('CODEX_PROTOCOL_VIOLATION');
    for (const context of [...this.#runsById.values()]) {
      this.#fail(context, 'CODEX_PROTOCOL_VIOLATION', true);
    }
  };

  readonly #onServerRequest = (_request: RpcServerRequest): void => {
    this.#unexpectedCapabilities += 1;
    this.#degrade('UNEXPECTED_SERVER_REQUEST');
    for (const context of [...this.#runsById.values()]) {
      this.#fail(context, 'UNEXPECTED_SERVER_REQUEST', false);
    }
  };

  #handleItem(context: RunContext, value: unknown, completed: boolean): void {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
      this.#unexpectedCapability(context);
      return;
    }
    if (value.type === 'userMessage') return;
    // Codex emits its internal reasoning as a normal item even when summaries
    // are disabled. It is neither a tool invocation nor user-visible output;
    // discard it without retaining or forwarding its payload.
    if (value.type === 'reasoning') return;
    if (value.type !== 'agentMessage') {
      this.#unexpectedCapability(context);
      return;
    }
    const phase = value.phase === 'commentary' || value.phase === 'final_answer'
      ? value.phase
      : null;
    context.itemPhases.set(value.id, phase);
    if (!completed || phase !== 'final_answer') return;
    if (context.structuredOutput) {
      this.#fail(context, 'DUPLICATE_FINAL_ANSWER', false);
      return;
    }
    if (typeof value.text !== 'string') {
      this.#fail(context, invalidOutputCode(context.outputKind), false);
      return;
    }
    try {
      const normalized = removeStructuredOutputNullPlaceholders(JSON.parse(value.text));
      context.structuredOutput = parseStructuredOutput(context.outputKind, normalized);
    } catch (error) {
      this.#fail(
        context,
        invalidOutputCode(context.outputKind),
        false,
        structuredOutputFailureMessage(error),
      );
    }
  }

  #handleAgentDelta(context: RunContext, params: Record<string, unknown> | null): void {
    if (!params || typeof params.itemId !== 'string' || typeof params.delta !== 'string') {
      this.#unexpectedCapability(context);
      return;
    }
    if (!params.delta) return;
    if (context.itemPhases.get(params.itemId) === 'final_answer') {
      if (context.outputKind !== 'ANSWER') return;
      try {
        this.#push(context, 'STRUCTURED_OUTPUT_DELTA', { delta: params.delta });
      } catch {
        this.#fail(context, 'STRUCTURED_OUTPUT_DELTA_INVALID', false);
      }
      return;
    }
    try {
      this.#push(context, 'COMMENTARY', { text: params.delta });
    } catch {
      this.#fail(context, 'COMMENTARY_INVALID', false);
    }
  }

  #handleTokenUsage(context: RunContext, params: Record<string, unknown> | null): void {
    const usage = params && isRecord(params.tokenUsage) ? params.tokenUsage : null;
    const last = usage && isRecord(usage.last) ? usage.last : null;
    const inputTokens = last?.inputTokens;
    if (!Number.isSafeInteger(inputTokens) || (inputTokens as number) < 0) {
      this.#fail(context, 'TOKEN_USAGE_INVALID', false);
      return;
    }
    this.#maxInputTokens = Math.max(this.#maxInputTokens, inputTokens as number);
    if ((inputTokens as number) > this.#config.baselineInputTokenLimit) {
      this.#degrade('INPUT_TOKEN_LIMIT_EXCEEDED');
      this.#fail(context, 'INPUT_TOKEN_LIMIT_EXCEEDED', false);
    }
  }

  #handleTurnCompleted(context: RunContext, params: Record<string, unknown> | null): void {
    const turn = params && isRecord(params.turn) ? params.turn : null;
    if (!turn || turn.id !== context.turnId) return;
    if (turn.status !== 'completed') {
      this.#fail(context, turn.status === 'interrupted' ? 'TURN_INTERRUPTED' : 'TURN_FAILED', true);
      return;
    }
    if (!context.structuredOutput) {
      this.#fail(context, missingOutputCode(context.outputKind), false);
      return;
    }
    if (context.outputKind === 'ROUTE_DECISION') {
      this.#push(context, 'ROUTE_DECISION', { decision: context.structuredOutput });
    } else if (context.outputKind === 'TASK_FINDING') {
      this.#push(context, 'TASK_FINDING', { finding: context.structuredOutput });
    } else if (context.outputKind === 'GUIDE_DIGEST') {
      this.#push(context, 'GUIDE_DIGEST', { digest: context.structuredOutput });
    } else {
      this.#push(context, 'FINAL_ANSWER', { answer: context.structuredOutput });
    }
    this.#push(context, 'COMPLETED', {});
    this.#finish(context);
  }

  #unexpectedCapability(context: RunContext | undefined): void {
    this.#unexpectedCapabilities += 1;
    this.#degrade('UNEXPECTED_CAPABILITY_OUTPUT');
    if (context) this.#fail(context, 'UNEXPECTED_CAPABILITY_OUTPUT', false);
    else {
      for (const active of [...this.#runsById.values()]) {
        this.#fail(active, 'UNEXPECTED_CAPABILITY_OUTPUT', false);
      }
    }
  }

  #push(context: RunContext, type: BridgeEventV1['type'], payload: unknown): void {
    const sequence = context.sequence + 1;
    const event = BridgeEventV1Schema.parse({
      requestId: context.requestId,
      runId: context.runId,
      sequence,
      type,
      payload,
    });
    context.sequence = sequence;
    context.queue.push(event);
  }

  #fail(
    context: RunContext,
    code: string,
    retryable: boolean,
    message = 'Codex 运行时拒绝了不安全、无效或未完成的输出。',
  ): void {
    if (context.terminal) return;
    this.#push(context, 'FAILED', {
      code,
      message,
      retryable,
    });
    this.#finish(context);
  }

  #finish(context: RunContext): void {
    if (context.terminal) return;
    context.terminal = true;
    if (context.timeout) clearTimeout(context.timeout);
    context.timeout = null;
    this.#runsById.delete(context.runId);
    this.#runsByThread.delete(context.threadId);
    context.queue.close();
  }

  async #handleTurnTimeout(context: RunContext): Promise<void> {
    if (context.terminal) return;
    try {
      await this.#interruptOnce(context);
    } catch {
      if (context.terminal) return;
      this.#degrade('TURN_INTERRUPT_FAILED');
      this.#fail(context, 'TURN_INTERRUPT_FAILED', true);
      return;
    }
    if (!context.terminal) this.#fail(context, 'TURN_TIMEOUT', true);
  }

  async #rejectCrossedStartupBoundary(context: RunContext): Promise<never> {
    try {
      await this.#interruptOnce(context);
    } catch {
      this.#degrade('TURN_INTERRUPT_FAILED');
      if (!context.terminal) this.#fail(context, 'TURN_INTERRUPT_FAILED', true);
      throw new CodexRuntimeError('TURN_INTERRUPT_FAILED', true);
    }
    if (!context.terminal) this.#fail(context, 'RUNTIME_DEGRADED', true);
    throw new CodexRuntimeError(
      this.getHealth().status === 'DEGRADED' ? 'RUNTIME_DEGRADED' : 'RUN_NOT_ACTIVE',
      true,
    );
  }

  #interruptOnce(context: RunContext): Promise<void> {
    context.interruptPromise ??= this.#interrupt(context);
    return context.interruptPromise;
  }

  async #interrupt(context: RunContext): Promise<void> {
    await this.#rpc.request('turn/interrupt', {
      threadId: context.threadId,
      turnId: context.turnId,
    }, { timeoutMs: this.#config.rpcTimeoutMs });
  }

  #degrade(reason: string): void {
    this.#reasonCodes.add(reason);
  }
}

class RuntimeRunHandle implements CodexRunHandle {
  readonly #runtime: CodexRuntime;
  readonly #context: RunContext;

  constructor(runtime: CodexRuntime, context: RunContext) {
    this.#runtime = runtime;
    this.#context = context;
  }

  get requestId(): string { return this.#context.requestId; }
  get runId(): string { return this.#context.runId; }
  get threadId(): string { return this.#context.threadId; }
  get turnId(): string { return this.#context.turnId; }
  get planVersion(): number { return this.#context.planVersion; }
  get events(): AsyncIterable<BridgeEventV1> { return this.#context.queue; }

  async cancel(): Promise<void> {
    await this.#runtime.cancelRun(this.#context);
  }

  async steer(planVersion: number, instruction: string): Promise<void> {
    await this.#runtime.steerRun(this.#context, planVersion, instruction);
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #waiters: ((result: IteratorResult<T>) => void)[] = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.#values.push(value);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#waiters.splice(0).forEach((waiter) => waiter({ value: undefined, done: true }));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

function isCodexModel(value: unknown): value is CodexModel {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.model === 'string'
    && Array.isArray(value.supportedReasoningEfforts)
    && value.supportedReasoningEfforts.every((option) => (
      isRecord(option) && typeof option.reasoningEffort === 'string'
    ));
}

function isForbiddenNotification(method: string): boolean {
  const normalized = method.toLowerCase();
  return normalized.includes('mcpserver')
    || normalized.includes('mcptoolcall')
    || normalized.includes('reasoning')
    || normalized.includes('command')
    || normalized.includes('process')
    || normalized.includes('filechange')
    || normalized.includes('hook')
    || normalized.includes('websearch')
    || normalized.includes('dynamictool')
    || normalized.includes('collabagent')
    || method === 'model/rerouted'
    || method === 'rawResponseItem/completed'
    || method === 'turn/diff/updated'
    || method === 'turn/plan/updated'
    || method === 'item/plan/delta';
}

function extractTurnId(method: string, params: Record<string, unknown> | null): string | null {
  if (!params) return null;
  if (typeof params.turnId === 'string') return params.turnId;
  if (method === 'turn/completed' && isRecord(params.turn) && typeof params.turn.id === 'string') {
    return params.turn.id;
  }
  return null;
}

function sanitizeVersion(version: string): string {
  return /\d+\.\d+\.\d+/u.exec(version)?.[0] ?? 'unknown';
}

function makeCodexOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(makeCodexOutputSchema);
  if (!isRecord(value)) return value;

  const properties = isRecord(value.properties) ? value.properties : null;
  if (properties) {
    const originallyRequired = new Set(
      Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === 'string') : [],
    );
    const rewrittenProperties = Object.fromEntries(Object.entries(properties).map(([key, schema]) => {
      const rewritten = makeCodexOutputSchema(schema);
      return [
        key,
        originallyRequired.has(key)
          ? rewritten
          : { anyOf: [rewritten, { type: 'null' }] },
      ];
    }));
    return {
      ...Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'properties' && key !== 'required')
        .map(([key, nested]) => [
          key === 'oneOf' ? 'anyOf' : key,
          makeCodexOutputSchema(nested),
        ])),
      properties: rewrittenProperties,
      required: Object.keys(rewrittenProperties),
    };
  }

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key === 'oneOf' ? 'anyOf' : key,
    makeCodexOutputSchema(nested),
  ]));
}

function removeStructuredOutputNullPlaceholders(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeStructuredOutputNullPlaceholders);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, nested]) => nested !== null)
    .map(([key, nested]) => [key, removeStructuredOutputNullPlaceholders(nested)]));
}

function parseStructuredOutput(
  outputKind: BridgeOutputKindV1,
  value: unknown,
): RouteDecisionV1 | TaskFindingV1 | AgentInternalAnswerV1 | GuideDigestDraftV1 {
  if (outputKind === 'ROUTE_DECISION') return RouteDecisionV1Schema.parse(value);
  if (outputKind === 'TASK_FINDING') return TaskFindingV1Schema.parse(value);
  if (outputKind === 'GUIDE_DIGEST') return GuideDigestDraftV1Schema.parse(value);
  return AgentInternalAnswerV1Schema.parse(value);
}

function structuredOutputFailureMessage(error: unknown): string | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  const issues = error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length === 0
      ? '$'
      : issue.path.map((segment) => (
        typeof segment === 'number' && Number.isSafeInteger(segment)
          ? String(segment)
          : String(segment).replace(/[^A-Za-z0-9_-]/gu, '_')
      )).join('.');
    const code = String(issue.code).replace(/[^A-Za-z0-9_-]/gu, '_');
    return `${path}:${code}`;
  });
  if (issues.length === 0) return '结构化输出校验失败。';
  return `结构化输出校验失败：${issues.join(', ')}`.slice(0, 450);
}

function invalidOutputCode(outputKind: BridgeOutputKindV1): string {
  if (outputKind === 'ROUTE_DECISION') return 'INVALID_ROUTE_DECISION';
  if (outputKind === 'TASK_FINDING') return 'INVALID_TASK_FINDING';
  if (outputKind === 'GUIDE_DIGEST') return 'INVALID_GUIDE_DIGEST_OUTPUT';
  return 'INVALID_FINAL_ANSWER';
}

function missingOutputCode(outputKind: BridgeOutputKindV1): string {
  if (outputKind === 'ROUTE_DECISION') return 'ROUTE_DECISION_MISSING';
  if (outputKind === 'TASK_FINDING') return 'TASK_FINDING_MISSING';
  if (outputKind === 'GUIDE_DIGEST') return 'GUIDE_DIGEST_MISSING';
  return 'FINAL_ANSWER_MISSING';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

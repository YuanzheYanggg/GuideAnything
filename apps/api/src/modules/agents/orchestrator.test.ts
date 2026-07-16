import {
  AgentRunEventV1Schema,
  type AgentInternalAnswerV1,
  type AgentRunEventV1,
  type BridgeEventV1,
  type BridgeRunRequestV1,
  type RouteDecisionV1,
  type TaskFindingV1,
  type ValidatedEvidenceV1,
} from '@guideanything/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeClient } from './runtime-client';
import {
  AgentOrchestrator,
  type AgentEvidenceResolver,
  type AgentEvidenceRetriever,
  type AgentOutputCommitter,
  type AgentRetrievalRequest,
  type AgentRunExecutionContext,
  type RunEventAppendInput,
} from './orchestrator';

describe('AgentOrchestrator', () => {
  it('uses the medium router and a focused answer worker without exposing bridge commentary', async () => {
    const flowEvidence = evidence('flow-evidence', 'WORKSPACE_FLOW');
    const runtime = new ScriptedRuntime([
      routeScript(focusedDecision()),
      answerScript(answer([flowEvidence])),
    ]);
    const events = new RecordingEventSink();
    const retriever = retrieverFrom({ WORKSPACE_FLOW: [flowEvidence] });
    const committer = recordingCommitter();
    const orchestrator = createOrchestrator({ runtime, events, retriever, committer });

    const result = await orchestrator.execute('public-run-1');

    expect(result).toEqual({ status: 'COMPLETED', messageId: 'assistant-1' });
    expect(runtime.requests.map(({ role, reasoningEffort, outputKind }) => ({
      role, reasoningEffort, outputKind,
    }))).toEqual([
      { role: 'ROUTER', reasoningEffort: 'MEDIUM', outputKind: 'ROUTE_DECISION' },
      { role: 'FOCUSED_WORKER', reasoningEffort: 'MEDIUM', outputKind: 'ANSWER' },
    ]);
    expect(new Set(runtime.requests.map((request) => request.runId)).size).toBe(2);
    expect(runtime.requests.every((request) => request.runId !== 'public-run-1')).toBe(true);
    expect(retriever.retrieve).toHaveBeenCalledOnce();
    expect(events.items.map((event) => event.type)).toEqual([
      'route.started', 'route.completed', 'plan.committed',
      'task.started', 'task.progress', 'answer.draft.delta', 'task.completed',
      'answer.validating', 'citation.committed', 'answer.committed', 'run.completed',
    ]);
    expect(JSON.stringify(events.items)).not.toContain('PRIVATE CHAIN OF THOUGHT');
    expect(committer.commit).toHaveBeenCalledOnce();
  });

  it('skips the model router and every retrieval source for a deterministic no-evidence greeting', async () => {
    const runtime = new ScriptedRuntime([answerScript(answer([]))]);
    const events = new RecordingEventSink();
    const retriever = retrieverFrom({});
    const context: AgentRunExecutionContext = {
      ...executionContext(),
      text: '你好！',
      sources: {
        workspaceFlows: true,
        workspaceDocuments: true,
        sessionAttachments: false,
        santexwell: true,
      },
    };

    const result = await createOrchestrator({
      runtime,
      events,
      retriever,
      loadContext: async (runId) => ({ ...context, runId }),
    }).execute('public-run-direct');

    expect(result.status).toBe('COMPLETED');
    expect(runtime.requests.map(({ role }) => role)).toEqual(['FOCUSED_WORKER']);
    expect(retriever.retrieve).not.toHaveBeenCalled();
    expect(events.items.find((item) => item.type === 'route.completed')).toMatchObject({
      payload: { route: 'DIRECT' },
    });
  });

  it('publishes only decoded conclusion fragments while a structured answer is still streaming', async () => {
    const flowEvidence = evidence('flow-stream', 'WORKSPACE_FLOW');
    const streamed = answer([flowEvidence]);
    const runtime = new ScriptedRuntime([
      routeScript(focusedDecision()),
      streamingAnswerScript(streamed),
    ]);
    const events = new RecordingEventSink();

    const result = await createOrchestrator({
      runtime,
      events,
      retriever: retrieverFrom({ WORKSPACE_FLOW: [flowEvidence] }),
    }).execute('public-run-streaming');

    const drafts = events.items.filter((item) => item.type === 'answer.draft.delta');
    expect(result.status).toBe('COMPLETED');
    expect(drafts).toHaveLength(2);
    expect(drafts.map((item) => item.payload.delta).join('')).toBe(streamed.conclusion);
    expect(JSON.stringify(drafts)).not.toContain('flow-stream');
    expect(events.items.indexOf(drafts[0]!)).toBeLessThan(
      events.items.findIndex((item) => item.type === 'answer.validating'),
    );
  });

  it('deep-reviews a complex route, retrieves workspace before vault, then maps findings and reduces without retrieval', async () => {
    const flowEvidence = evidence('flow-evidence', 'WORKSPACE_FLOW');
    const vaultEvidence = evidence('vault-evidence', 'SANTEXWELL');
    const initial = compositeDecision({ confidence: 0.4 });
    const reviewed = compositeDecision({ confidence: 0.9 });
    const runtime = new ScriptedRuntime([
      routeScript(initial),
      routeScript(reviewed),
      findingScript(finding('flow', [flowEvidence])),
      findingScript(finding('vault', [vaultEvidence])),
      answerScript(answer([flowEvidence, vaultEvidence])),
    ]);
    const order: string[] = [];
    const retriever: AgentEvidenceRetriever = {
      retrieve: vi.fn(async ({ task }) => {
        order.push(task.kind);
        return task.kind === 'WORKSPACE_FLOW' ? [flowEvidence] : [vaultEvidence];
      }),
    };
    const events = new RecordingEventSink();
    const orchestrator = createOrchestrator({ runtime, events, retriever });

    const result = await orchestrator.execute('public-run-2');
    expect(result.status).toBe('COMPLETED');
    expect(runtime.requests.map((request) => request.role)).toEqual([
      'ROUTER', 'DEEP_ROUTER', 'DEEP_WORKER', 'DEEP_WORKER', 'REDUCER',
    ]);
    expect(order).toEqual(['WORKSPACE_FLOW', 'SANTEXWELL']);
    expect(retriever.retrieve).toHaveBeenCalledTimes(2);
    const reducer = runtime.requests.find((request) => request.role === 'REDUCER');
    expect(reducer?.prompt).toContain('flow-evidence');
    expect(reducer?.prompt).toContain('vault-evidence');
    expect(events.items.filter((event) => event.type === 'task.finding')).toHaveLength(2);
    expect(events.items.map((event) => event.type)).toContain('reduce.started');
  });

  it('reserves a fair share of one source budget for every map task', async () => {
    const firstEvidence = [1, 2, 3].map((index) => evidence(`vault-first-${index}`, 'SANTEXWELL'));
    const secondEvidence = [1, 2, 3].map((index) => evidence(`vault-second-${index}`, 'SANTEXWELL'));
    const decision = vaultOpenResearchDecision();
    const runtime = new ScriptedRuntime([
      routeScript(decision),
      findingScript(finding('vault-first', firstEvidence)),
      findingScript(finding('vault-second', secondEvidence)),
      answerScript(answer([...firstEvidence, ...secondEvidence])),
    ]);
    const retriever: AgentEvidenceRetriever = {
      retrieve: vi.fn(async ({ task, maxCandidates }) => (
        Array.from({ length: maxCandidates }, (_, index) => (
          evidence(`${task.id}-${index + 1}`, 'SANTEXWELL')
        ))
      )),
    };
    const context: AgentRunExecutionContext = {
      ...executionContext(),
      scope: 'GLOBAL_SANTEXWELL',
      workspaceId: null,
      text: '比较主题甲与主题乙的依据。',
      sources: {
        workspaceFlows: false,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: true,
      },
    };

    const result = await createOrchestrator({
      runtime,
      retriever,
      loadContext: async (runId) => ({ ...context, runId }),
    }).execute('public-run-fair-budget');

    expect(vi.mocked(retriever.retrieve).mock.calls.map(([request]) => request.maxCandidates)).toEqual([3, 3]);
    expect(result.status).toBe('COMPLETED');
  });

  it('fails closed when a worker returns evidence that deterministic retrieval did not provide', async () => {
    const retrieved = evidence('retrieved-evidence', 'WORKSPACE_FLOW');
    const fabricated = evidence('fabricated-evidence', 'WORKSPACE_FLOW');
    const runtime = new ScriptedRuntime([
      routeScript(focusedDecision()),
      answerScript(answer([fabricated])),
    ]);
    const events = new RecordingEventSink();
    const committer = recordingCommitter();
    const orchestrator = createOrchestrator({
      runtime,
      events,
      retriever: retrieverFrom({ WORKSPACE_FLOW: [retrieved] }),
      committer,
    });

    const result = await orchestrator.execute('public-run-3');

    expect(result.status).toBe('FAILED');
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.failed',
      payload: { code: 'EVIDENCE_VALIDATION_FAILED', retryable: false },
    });
    expect(committer.commit).not.toHaveBeenCalled();
  });

  it('rejects a route with more than three workers before retrieval starts', async () => {
    const decision = openDecisionWithFourWorkers();
    const runtime = new ScriptedRuntime([routeScript(decision), routeScript(decision)]);
    const events = new RecordingEventSink();
    const retriever = retrieverFrom({});
    const orchestrator = createOrchestrator({ runtime, events, retriever });

    const result = await orchestrator.execute('public-run-4');

    expect(result.status).toBe('FAILED');
    expect(retriever.retrieve).not.toHaveBeenCalled();
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.failed', payload: { code: 'SCHEDULE_POLICY_VIOLATION' },
    });
  });

  it('rejects dependent map workers instead of silently running them in parallel', async () => {
    const decision = compositeDecision();
    decision.tasks[1] = { ...decision.tasks[1]!, dependsOn: ['flow'] };
    const runtime = new ScriptedRuntime([routeScript(decision)]);
    const events = new RecordingEventSink();
    const retriever = retrieverFrom({});
    const orchestrator = createOrchestrator({ runtime, events, retriever });

    const result = await orchestrator.execute('public-run-dependent');

    expect(result.status).toBe('FAILED');
    expect(retriever.retrieve).not.toHaveBeenCalled();
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.failed', payload: { code: 'SCHEDULE_POLICY_VIOLATION' },
    });
  });

  it('fails a deep-router attempt to broaden the medium budget as a non-retryable policy error', async () => {
    const medium = compositeDecision({ confidence: 0.4 });
    medium.budget.maxWorkspaceCandidates = 6;
    const broadened = compositeDecision({ confidence: 0.9 });
    const events = new RecordingEventSink();
    const retriever = retrieverFrom({});
    const result = await createOrchestrator({
      runtime: new ScriptedRuntime([routeScript(medium), routeScript(broadened)]),
      events,
      retriever,
    }).execute('public-run-deep-broadened');

    expect(result.status).toBe('FAILED');
    expect(retriever.retrieve).not.toHaveBeenCalled();
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.failed',
      payload: { code: 'ROUTER_POLICY_VIOLATION', retryable: false },
    });
  });

  it('cancels every active child invocation and commits only a cancellation terminal event', async () => {
    const runtime = new BlockingRuntime();
    const events = new RecordingEventSink();
    const orchestrator = createOrchestrator({ runtime, events });

    const execution = orchestrator.execute('public-run-5');
    await runtime.started;
    await orchestrator.cancel('public-run-5', '用户取消');
    const result = await execution;

    expect(result).toEqual({ status: 'CANCELLED' });
    expect(runtime.cancelled).toEqual([runtime.requests[0]!.runId]);
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.cancelled', payload: { reason: '用户取消' },
    });
    expect(events.items.some((event) => event.type === 'run.failed')).toBe(false);
  });

  it('records a terminal failure even when execution context reauthorization fails', async () => {
    const events = new RecordingEventSink();
    const orchestrator = createOrchestrator({
      events,
      loadContext: async () => { throw new Error('用户已经失去工作区访问权限'); },
    });

    const result = await orchestrator.execute('public-run-context-failure');

    expect(result).toEqual({ status: 'FAILED' });
    expect(events.items.at(-1)).toMatchObject({
      runId: 'public-run-context-failure',
      type: 'run.failed',
      payload: { code: 'AGENT_RUN_FAILED' },
    });
  });

  it('skips vault retrieval when deterministic workspace evidence is already sufficient', async () => {
    const flowEvidence = evidence('flow-sufficient', 'WORKSPACE_FLOW');
    const runtime = new ScriptedRuntime([
      routeScript(compositeDecision()),
      findingScript(finding('flow', [flowEvidence])),
      answerScript(answer([flowEvidence])),
    ]);
    const retriever: AgentEvidenceRetriever = {
      retrieve: vi.fn(async ({ task }) => task.kind === 'WORKSPACE_FLOW' ? [flowEvidence] : []),
      isWorkspaceEvidenceSufficient: vi.fn(async () => true),
    };

    const result = await createOrchestrator({ runtime, retriever }).execute('public-run-sufficient');

    expect(result.status).toBe('COMPLETED');
    expect(retriever.retrieve).toHaveBeenCalledTimes(1);
    expect(retriever.retrieve).not.toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({ kind: 'SANTEXWELL' }),
    }));
    expect(runtime.requests.map((request) => request.role)).toEqual([
      'ROUTER', 'DEEP_WORKER', 'REDUCER',
    ]);
  });

  it('injects the trusted Santexwell harness only into the vault worker', async () => {
    const flowEvidence = evidence('flow-harness', 'WORKSPACE_FLOW');
    const vaultEvidence = evidence('vault-harness', 'SANTEXWELL');
    const runtime = new ScriptedRuntime([
      routeScript(compositeDecision()),
      findingScript(finding('flow', [flowEvidence])),
      findingScript(finding('vault', [vaultEvidence])),
      answerScript(answer([flowEvidence, vaultEvidence])),
    ]);
    const result = await createOrchestrator({
      runtime,
      retriever: retrieverFrom({ WORKSPACE_FLOW: [flowEvidence], SANTEXWELL: [vaultEvidence] }),
      trustedSantexwellHarness: () => ({
        revision: 'harness-r1',
        items: ['SANTEXWELL_QA_HARNESS_MARKER'],
      }),
    }).execute('public-run-harness');

    expect(result.status).toBe('COMPLETED');
    const vaultWorker = runtime.requests.find((request) => (
      request.role === 'DEEP_WORKER' && request.prompt.includes('vault-harness')
    ));
    expect(vaultWorker?.prompt).toContain('SANTEXWELL_QA_HARNESS_MARKER');
    expect(runtime.requests.filter((request) => request !== vaultWorker).every(
      (request) => !request.prompt.includes('SANTEXWELL_QA_HARNESS_MARKER'),
    )).toBe(true);
  });

  it('fails closed when a Santexwell worker has no validated last-good harness', async () => {
    const vaultEvidence = evidence('vault-no-harness', 'SANTEXWELL');
    const runtime = new ScriptedRuntime([routeScript(vaultFocusedDecision())]);
    const events = new RecordingEventSink();
    const result = await createOrchestrator({
      runtime,
      events,
      loadContext: async (runId) => ({
        ...executionContext(),
        runId,
        scope: 'GLOBAL_SANTEXWELL',
        workspaceId: null,
        sources: {
          workspaceFlows: false,
          workspaceDocuments: false,
          sessionAttachments: false,
          santexwell: true,
        },
      }),
      retriever: retrieverFrom({ SANTEXWELL: [vaultEvidence] }),
      trustedSantexwellHarness: () => null,
    }).execute('public-run-no-harness');

    expect(result.status).toBe('FAILED');
    expect(runtime.requests).toHaveLength(1);
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.failed',
      payload: { code: 'SANTEXWELL_HARNESS_UNAVAILABLE', retryable: true },
    });
  });

  it('degrades one failed map worker to a partial finding with a visible gap', async () => {
    const flowEvidence = evidence('flow-partial', 'WORKSPACE_FLOW');
    const vaultEvidence = evidence('vault-found', 'SANTEXWELL');
    const runtime = new ScriptedRuntime([
      routeScript(compositeDecision()),
      failedScript('WORKER_UNAVAILABLE'),
      findingScript(finding('vault', [vaultEvidence])),
      answerScript(answer([flowEvidence, vaultEvidence])),
    ]);
    const events = new RecordingEventSink();
    const result = await createOrchestrator({
      runtime,
      events,
      retriever: retrieverFrom({ WORKSPACE_FLOW: [flowEvidence], SANTEXWELL: [vaultEvidence] }),
    }).execute('public-run-partial');

    expect(result.status).toBe('COMPLETED');
    expect(events.items).toContainEqual(expect.objectContaining({
      type: 'task.finding',
      payload: expect.objectContaining({
        finding: expect.objectContaining({ taskId: 'flow', status: 'PARTIAL' }),
      }),
    }));
    expect(JSON.stringify(events.items)).toContain('暂时未能完成');
  });

  it('repairs an invalid typed router output exactly once', async () => {
    const flowEvidence = evidence('flow-repaired', 'WORKSPACE_FLOW');
    const runtime = new ScriptedRuntime([
      invalidRouteScript(),
      routeScript(focusedDecision()),
      answerScript(answer([flowEvidence])),
    ]);
    const result = await createOrchestrator({
      runtime,
      retriever: retrieverFrom({ WORKSPACE_FLOW: [flowEvidence] }),
    }).execute('public-run-repair');

    expect(result.status).toBe('COMPLETED');
    expect(runtime.requests.filter((request) => request.role === 'ROUTER')).toHaveLength(2);
    expect(runtime.requests[1]?.prompt).toContain('结构修复');
  });

  it('rejects flow feedback when the resolver changes its evidence locator', async () => {
    const flowEvidence = evidence('flow-feedback-source', 'WORKSPACE_FLOW');
    const feedbackAnswer = answer([flowEvidence]);
    feedbackAnswer.flowFeedback = [{
      kind: 'GAP',
      message: '补充复核节点。',
      locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'approve' },
    }];
    const mismatchedResolver = resolver();
    mismatchedResolver.resolveFlowFeedback = vi.fn(async () => ({
      reference: { referenceId: 'reference-feedback', href: '/references/reference-feedback' },
      evidence: {
        ...flowEvidence,
        locator: {
          kind: 'WORKSPACE_FLOW' as const,
          guideId: 'guide-1',
          snapshotId: 'snapshot-1',
          nodeId: 'other',
        },
      },
    }));
    const events = new RecordingEventSink();
    const result = await createOrchestrator({
      runtime: new ScriptedRuntime([
        routeScript(focusedDecision()),
        answerScript(feedbackAnswer),
      ]),
      events,
      resolver: mismatchedResolver,
      retriever: retrieverFrom({ WORKSPACE_FLOW: [flowEvidence] }),
    }).execute('public-run-feedback-mismatch');

    expect(result.status).toBe('FAILED');
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.failed', payload: { code: 'EVIDENCE_VALIDATION_FAILED' },
    });
  });

  it('reroutes an active run at the next plan version after steer', async () => {
    const flowEvidence = evidence('flow-steered', 'WORKSPACE_FLOW');
    const runtime = new BlockingFirstRuntime([
      routeScript(focusedDecision()),
      answerScript(answer([flowEvidence])),
    ]);
    let planVersion = 1;
    const events = new RecordingEventSink();
    const orchestrator = createOrchestrator({
      runtime,
      events,
      loadContext: async (runId) => ({
        ...executionContext(),
        runId,
        planVersion,
        ...(planVersion === 2 ? { steeringInstruction: '只聚焦当前复核节点。' } : {}),
      }),
      retriever: retrieverFrom({ WORKSPACE_FLOW: [flowEvidence] }),
    });

    const execution = orchestrator.execute('public-run-steer');
    await runtime.started;
    planVersion = 2;
    await orchestrator.steer('public-run-steer', 2, '只聚焦当前复核节点。');
    const result = await execution;

    expect(result.status).toBe('COMPLETED');
    expect(runtime.requests.map((request) => request.planVersion)).toEqual([1, 2, 2]);
    expect(runtime.requests[1]?.prompt).toContain('只聚焦当前复核节点');
    expect(events.items.at(-1)).toMatchObject({ type: 'run.completed', planVersion: 2 });
  });

  it('observes a transactionally persisted plan bump even before the control notification arrives', async () => {
    const flowEvidence = evidence('flow-steer-race', 'WORKSPACE_FLOW');
    let planVersion = 1;
    const runtime = new ScriptedRuntime([
      callbackFailedScript(() => { planVersion = 2; }),
      routeScript(focusedDecision()),
      answerScript(answer([flowEvidence])),
    ]);
    const result = await createOrchestrator({
      runtime,
      loadContext: async (runId) => ({
        ...executionContext(),
        runId,
        planVersion,
        ...(planVersion === 2 ? { steeringInstruction: '聚焦复核。' } : {}),
      }),
      retriever: retrieverFrom({ WORKSPACE_FLOW: [flowEvidence] }),
    }).execute('public-run-steer-race');

    expect(result.status).toBe('COMPLETED');
    expect(runtime.requests.map((request) => request.planVersion)).toEqual([1, 2, 2]);
  });

  it('settles cancel within its bound even when the bridge ignores abort and cancel', async () => {
    const runtime = new UncooperativeRuntime();
    const events = new RecordingEventSink();
    const orchestrator = createOrchestrator({
      runtime,
      events,
      timeouts: { routerMs: 5_000, workerMs: 5_000, reducerMs: 5_000, runMs: 5_000, cancelMs: 20 },
    });
    const execution = orchestrator.execute('public-run-bounded-cancel');
    await runtime.started;

    await expect(orchestrator.cancel('public-run-bounded-cancel')).resolves.toBeUndefined();
    await expect(execution).resolves.toEqual({ status: 'CANCELLED' });
    expect(events.items.at(-1)?.type).toBe('run.cancelled');
  });

  it('cancels active work and rejects new runs during graceful shutdown', async () => {
    const runtime = new BlockingRuntime();
    const events = new RecordingEventSink();
    const orchestrator = createOrchestrator({ runtime, events });
    const execution = orchestrator.execute('public-run-shutdown');
    await runtime.started;

    await orchestrator.shutdown();

    await expect(execution).resolves.toEqual({ status: 'CANCELLED' });
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.cancelled', payload: { reason: '服务正在安全关闭' },
    });
    await expect(orchestrator.execute('public-run-after-shutdown')).rejects.toThrow('安全关闭');
  });

  it('keeps the total run deadline bounded through the commit phase', async () => {
    const flowEvidence = evidence('flow-commit-timeout', 'WORKSPACE_FLOW');
    const events = new RecordingEventSink();
    const orchestrator = createOrchestrator({
      runtime: new ScriptedRuntime([
        routeScript(focusedDecision()),
        answerScript(answer([flowEvidence])),
      ]),
      events,
      retriever: retrieverFrom({ WORKSPACE_FLOW: [flowEvidence] }),
      committer: { commit: async () => new Promise(() => undefined) },
      timeouts: { routerMs: 500, workerMs: 500, reducerMs: 500, runMs: 30, cancelMs: 10 },
    });

    const settled = await Promise.race([
      orchestrator.execute('public-run-commit-timeout'),
      new Promise<'test-timeout'>((resolve) => setTimeout(() => resolve('test-timeout'), 250)),
    ]);

    expect(settled).toEqual({ status: 'FAILED' });
    expect(events.items.at(-1)).toMatchObject({
      type: 'run.failed', payload: { code: 'RUN_TIMEOUT' },
    });
  });
});

function createOrchestrator(overrides: {
  runtime?: AgentRuntimeClient;
  events?: RecordingEventSink;
  retriever?: AgentEvidenceRetriever;
  resolver?: AgentEvidenceResolver;
  committer?: AgentOutputCommitter;
  loadContext?: (runId: string) => AgentRunExecutionContext | Promise<AgentRunExecutionContext>;
  trustedSantexwellHarness?: () => { revision: string; items: readonly string[] } | null;
  timeouts?: { routerMs: number; workerMs: number; reducerMs: number; runMs: number; cancelMs: number };
} = {}): AgentOrchestrator {
  let id = 0;
  return new AgentOrchestrator({
    runtime: overrides.runtime ?? new ScriptedRuntime([]),
    eventStore: overrides.events ?? new RecordingEventSink(),
    loadContext: overrides.loadContext ?? (async (runId) => ({ ...executionContext(), runId })),
    retriever: overrides.retriever ?? retrieverFrom({}),
    evidenceResolver: overrides.resolver ?? resolver(),
    outputCommitter: overrides.committer ?? recordingCommitter(),
    configuredMaxConcurrency: 3,
    trustedHarness: ['只读回答，不得执行任何写入。'],
    trustedSantexwellHarness: overrides.trustedSantexwellHarness ?? (() => ({
      revision: 'test-harness-r1',
      items: ['测试用 Santexwell 只读 QA Harness。'],
    })),
    createId: () => `generated-${++id}`,
    ...(overrides.timeouts ? { timeouts: overrides.timeouts } : {}),
  });
}

class RecordingEventSink {
  readonly items: RunEventAppendInput[] = [];

  append(input: RunEventAppendInput): AgentRunEventV1 {
    this.items.push(input);
    return AgentRunEventV1Schema.parse({
      ...input,
      id: `event-${this.items.length}`,
      sequence: this.items.length,
      createdAt: new Date(1_752_537_600_000 + this.items.length).toISOString(),
    });
  }

  appendFailure(runId: string, payload: { code: string; message: string; retryable: boolean }): AgentRunEventV1 {
    return this.append({
      runId,
      planVersion: 1,
      phase: 'COMMITTED',
      type: 'run.failed',
      payload,
    });
  }
}

type RuntimeScript = (request: BridgeRunRequestV1) => AsyncGenerator<BridgeEventV1>;

class ScriptedRuntime implements AgentRuntimeClient {
  readonly requests: BridgeRunRequestV1[] = [];
  readonly cancelled: string[] = [];

  constructor(private readonly scripts: RuntimeScript[]) {}

  run(request: BridgeRunRequestV1, _signal?: AbortSignal): AsyncIterable<BridgeEventV1> {
    this.requests.push(request);
    const script = this.scripts.shift();
    if (!script) throw new Error(`missing runtime script for ${request.role}`);
    return script(request);
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.push(runId);
  }

  async steer(): Promise<void> {}
}

class BlockingRuntime implements AgentRuntimeClient {
  readonly requests: BridgeRunRequestV1[] = [];
  readonly cancelled: string[] = [];
  readonly started: Promise<void>;
  #markStarted!: () => void;
  #release!: () => void;

  constructor() {
    this.started = new Promise((resolve) => { this.#markStarted = resolve; });
  }

  async *run(request: BridgeRunRequestV1, signal?: AbortSignal): AsyncGenerator<BridgeEventV1> {
    this.requests.push(request);
    this.#markStarted();
    await new Promise<void>((resolve) => {
      this.#release = resolve;
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    if (signal?.aborted) throw signal.reason;
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.push(runId);
    this.#release?.();
  }

  async steer(): Promise<void> {}
}

class BlockingFirstRuntime extends ScriptedRuntime {
  readonly started: Promise<void>;
  #markStarted!: () => void;

  constructor(scripts: RuntimeScript[]) {
    super(scripts);
    this.started = new Promise((resolve) => { this.#markStarted = resolve; });
  }

  override run(request: BridgeRunRequestV1, signal?: AbortSignal): AsyncIterable<BridgeEventV1> {
    if (this.requests.length > 0) return super.run(request, signal);
    this.requests.push(request);
    this.#markStarted();
    return (async function* blocked() {
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      if (signal?.aborted) throw signal.reason;
    })();
  }
}

class UncooperativeRuntime implements AgentRuntimeClient {
  readonly started: Promise<void>;
  #markStarted!: () => void;

  constructor() {
    this.started = new Promise((resolve) => { this.#markStarted = resolve; });
  }

  run(): AsyncIterable<BridgeEventV1> {
    this.#markStarted();
    return (async function* neverEnds() {
      await new Promise(() => undefined);
    })();
  }

  async cancel(): Promise<void> {
    await new Promise(() => undefined);
  }

  async steer(): Promise<void> {}
}

function routeScript(decision: RouteDecisionV1): RuntimeScript {
  return async function* route(request) {
    yield event(request, 1, 'THREAD_BOUND', { threadId: 'thread-1' });
    yield event(request, 2, 'COMMENTARY', { text: 'PRIVATE CHAIN OF THOUGHT' });
    yield event(request, 3, 'ROUTE_DECISION', { decision });
    yield event(request, 4, 'COMPLETED', {});
  };
}

function invalidRouteScript(): RuntimeScript {
  return async function* invalidRoute(request) {
    yield event(request, 1, 'ROUTE_DECISION', { decision: {} } as never);
    yield event(request, 2, 'COMPLETED', {});
  };
}

function failedScript(code: string): RuntimeScript {
  return async function* failed(request) {
    yield event(request, 1, 'FAILED', { code, message: '子任务暂时不可用。', retryable: true });
  };
}

function callbackFailedScript(callback: () => void): RuntimeScript {
  return async function* callbackFailed(request) {
    callback();
    yield event(request, 1, 'FAILED', {
      code: 'PLAN_SUPERSEDED', message: '计划已经更新。', retryable: true,
    });
  };
}

function findingScript(value: TaskFindingV1): RuntimeScript {
  return async function* findingOutput(request) {
    yield event(request, 1, 'COMMENTARY', { text: 'PRIVATE CHAIN OF THOUGHT' });
    yield event(request, 2, 'TASK_FINDING', { finding: value });
    yield event(request, 3, 'COMPLETED', {});
  };
}

function answerScript(value: AgentInternalAnswerV1): RuntimeScript {
  return async function* answerOutput(request) {
    yield event(request, 1, 'COMMENTARY', { text: 'PRIVATE CHAIN OF THOUGHT' });
    yield event(request, 2, 'FINAL_ANSWER', { answer: value });
    yield event(request, 3, 'COMPLETED', {});
  };
}

function streamingAnswerScript(value: AgentInternalAnswerV1): RuntimeScript {
  return async function* streamingAnswerOutput(request) {
    const encoded = JSON.stringify(value);
    const marker = '"conclusion":"';
    const conclusionStart = encoded.indexOf(marker);
    if (conclusionStart < 0) throw new Error('answer conclusion missing');
    const splitAt = conclusionStart + marker.length + 4;
    yield event(request, 1, 'COMMENTARY', { text: 'PRIVATE CHAIN OF THOUGHT' });
    yield event(request, 2, 'STRUCTURED_OUTPUT_DELTA', { delta: encoded.slice(0, splitAt) });
    yield event(request, 3, 'STRUCTURED_OUTPUT_DELTA', { delta: encoded.slice(splitAt) });
    yield event(request, 4, 'FINAL_ANSWER', { answer: value });
    yield event(request, 5, 'COMPLETED', {});
  };
}

function event<T extends BridgeEventV1['type']>(
  request: BridgeRunRequestV1,
  sequence: number,
  type: T,
  payload: Extract<BridgeEventV1, { type: T }>['payload'],
): Extract<BridgeEventV1, { type: T }> {
  return { requestId: request.requestId, runId: request.runId, sequence, type, payload } as Extract<BridgeEventV1, { type: T }>;
}

function executionContext(): AgentRunExecutionContext {
  return {
    runId: 'public-run',
    conversationId: 'conversation-1',
    ownerId: 'owner-1',
    scope: 'WORKSPACE',
    workspaceId: 'workspace-1',
    planVersion: 1,
    status: 'QUEUED',
    text: '请分析当前流程并参考知识库。',
    sources: {
      workspaceFlows: true,
      workspaceDocuments: false,
      sessionAttachments: false,
      santexwell: true,
    },
    attachmentIds: [],
  };
}

function retrieverFrom(
  values: Partial<Record<RouteDecisionV1['tasks'][number]['kind'], ValidatedEvidenceV1[]>>,
): AgentEvidenceRetriever {
  return {
    retrieve: vi.fn(async ({ task }: AgentRetrievalRequest) => values[task.kind] ?? []),
  };
}

function resolver(): AgentEvidenceResolver {
  return {
    resolveEvidence: vi.fn(async (_context, value) => ({
      reference: {
        referenceId: `reference-${value.id}`,
        href: `/references/${encodeURIComponent(`reference-${value.id}`)}`,
      },
      evidence: value,
    })),
    resolveFlowFeedback: vi.fn(async (_context, _feedback, expectedEvidence) => ({
      reference: { referenceId: 'reference-feedback', href: '/references/reference-feedback' },
      evidence: expectedEvidence,
    })),
  };
}

function recordingCommitter(): AgentOutputCommitter {
  return { commit: vi.fn(async () => ({ messageId: 'assistant-1' })) };
}

function evidence(
  id: string,
  source: ValidatedEvidenceV1['source'],
): ValidatedEvidenceV1 {
  if (source === 'SANTEXWELL') {
    return {
      id, source, title: '花式纱分类', excerpt: '花式纱可按结构与工艺分类。',
      locator: {
        kind: 'SANTEXWELL', documentId: 'vault-document', fragmentId: id,
        relativePath: 'wiki_v2/concepts/fancy-yarn.md', revision: 'vault-r1', heading: '分类',
      },
    };
  }
  return {
    id, source: 'WORKSPACE_FLOW', title: '审批节点', excerpt: '复核员负责审批。',
    locator: {
      kind: 'WORKSPACE_FLOW', guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'approve',
    },
  };
}

function finding(taskId: string, validatedEvidence: ValidatedEvidenceV1[]): TaskFindingV1 {
  return {
    taskId,
    status: validatedEvidence.length > 0 ? 'FOUND' : 'NO_EVIDENCE',
    findings: validatedEvidence.length > 0 ? [`${taskId} 已找到证据。`] : [],
    validatedEvidence,
    conflicts: [],
    gaps: [],
  };
}

function answer(evidenceItems: ValidatedEvidenceV1[]): AgentInternalAnswerV1 {
  return {
    mode: 'ANSWER',
    conclusion: '复核员负责审批，知识库补充了分类依据。',
    sections: [{ id: 'summary', title: '结论', markdown: '已结合已验证资料。' }],
    evidence: evidenceItems,
    flowFeedback: [],
    evidenceStatus: evidenceItems.length > 0 ? 'SUPPORTED' : 'INSUFFICIENT',
    artifacts: [],
    suggestedQuestions: [],
  };
}

function focusedDecision(): RouteDecisionV1 {
  return {
    intent: '回答当前流程问题',
    complexity: {
      scopeBreadth: 1, evidenceDepth: 2, crossSourceNeed: 1, decompositionNeed: 1, ambiguity: 1,
    },
    contextAssessment: '问题限定在当前流程。',
    route: 'FOCUSED',
    sources: {
      workspaceFlows: true, workspaceDocuments: false, sessionAttachments: false, santexwell: false,
    },
    tasks: [{
      id: 'flow', kind: 'WORKSPACE_FLOW', objective: '检查当前流程节点', dependsOn: [], priority: 1,
    }],
    budget: {
      maxWorkers: 1, maxConcurrency: 1, maxWorkspaceCandidates: 3, maxFlowHops: 2,
      maxVaultClusters: 0, maxVaultDigests: 0, allowRaw: false, useReducer: false,
    },
    executionMode: 'SEQUENTIAL',
    maxConcurrency: 1,
    stopConditions: ['找到负责人或确认无证据'],
    confidence: 0.9,
    userFacingPlan: '先检查当前流程节点。',
  };
}

function compositeDecision(overrides: Partial<RouteDecisionV1> = {}): RouteDecisionV1 {
  const workers: RouteDecisionV1['tasks'] = [
    { id: 'flow', kind: 'WORKSPACE_FLOW', objective: '检查流程', dependsOn: [], priority: 1 },
    { id: 'vault', kind: 'SANTEXWELL', objective: '补充知识库依据', dependsOn: [], priority: 2 },
  ];
  return {
    ...focusedDecision(),
    route: 'COMPOSITE',
    sources: {
      workspaceFlows: true, workspaceDocuments: false, sessionAttachments: false, santexwell: true,
    },
    tasks: [
      ...workers,
      { id: 'reduce', kind: 'REDUCE', objective: '汇总答案', dependsOn: ['flow', 'vault'], priority: 3 },
    ],
    budget: {
      maxWorkers: 2, maxConcurrency: 2, maxWorkspaceCandidates: 12, maxFlowHops: 2,
      maxVaultClusters: 1, maxVaultDigests: 2, allowRaw: false, useReducer: true,
    },
    executionMode: 'PARALLEL',
    maxConcurrency: 2,
    userFacingPlan: '先查工作区流程，再补充知识库，最后汇总。',
    ...overrides,
  };
}

function vaultFocusedDecision(): RouteDecisionV1 {
  return {
    ...focusedDecision(),
    intent: '查询 Santexwell 知识库',
    contextAssessment: '问题限定在 Santexwell 知识库。',
    sources: {
      workspaceFlows: false,
      workspaceDocuments: false,
      sessionAttachments: false,
      santexwell: true,
    },
    tasks: [{
      id: 'vault', kind: 'SANTEXWELL', objective: '查询知识库', dependsOn: [], priority: 1,
    }],
    budget: {
      maxWorkers: 1, maxConcurrency: 1, maxWorkspaceCandidates: 0, maxFlowHops: 0,
      maxVaultClusters: 1, maxVaultDigests: 2, allowRaw: false, useReducer: false,
    },
    userFacingPlan: '查询 Santexwell 知识库后直接回答。',
  };
}

function vaultOpenResearchDecision(): RouteDecisionV1 {
  const workers: RouteDecisionV1['tasks'] = [
    {
      id: 'vault-first', kind: 'SANTEXWELL', objective: '研究主题甲', dependsOn: [], priority: 1,
    },
    {
      id: 'vault-second', kind: 'SANTEXWELL', objective: '研究主题乙', dependsOn: [], priority: 2,
    },
  ];
  return {
    ...vaultFocusedDecision(),
    intent: '比较两个知识库主题',
    complexity: {
      scopeBreadth: 3, evidenceDepth: 3, crossSourceNeed: 1, decompositionNeed: 3, ambiguity: 2,
    },
    route: 'OPEN_RESEARCH',
    tasks: [
      ...workers,
      {
        id: 'reduce', kind: 'REDUCE', objective: '汇总比较',
        dependsOn: workers.map(({ id }) => id), priority: 3,
      },
    ],
    budget: {
      maxWorkers: 2, maxConcurrency: 2, maxWorkspaceCandidates: 0, maxFlowHops: 0,
      maxVaultClusters: 1, maxVaultDigests: 6, allowRaw: false, useReducer: true,
    },
    executionMode: 'PARALLEL',
    maxConcurrency: 2,
    userFacingPlan: '分别研究两个主题，再汇总比较。',
  };
}

function openDecisionWithFourWorkers(): RouteDecisionV1 {
  const workers: RouteDecisionV1['tasks'] = [
    { id: 'flow', kind: 'WORKSPACE_FLOW', objective: '流程一', dependsOn: [], priority: 1 },
    { id: 'document', kind: 'WORKSPACE_DOCUMENT', objective: '资料二', dependsOn: [], priority: 2 },
    { id: 'attachment', kind: 'SESSION_ATTACHMENT', objective: '附件三', dependsOn: [], priority: 3 },
    { id: 'vault', kind: 'SANTEXWELL', objective: '知识库四', dependsOn: [], priority: 4 },
  ];
  return {
    ...focusedDecision(),
    route: 'OPEN_RESEARCH',
    complexity: {
      scopeBreadth: 5, evidenceDepth: 5, crossSourceNeed: 5, decompositionNeed: 5, ambiguity: 4,
    },
    sources: {
      workspaceFlows: true, workspaceDocuments: true, sessionAttachments: true, santexwell: true,
    },
    tasks: [
      ...workers,
      { id: 'reduce', kind: 'REDUCE', objective: '汇总', dependsOn: workers.map(({ id }) => id), priority: 5 },
    ],
    budget: {
      maxWorkers: 4, maxConcurrency: 3, maxWorkspaceCandidates: 12, maxFlowHops: 2,
      maxVaultClusters: 2, maxVaultDigests: 6, allowRaw: true, useReducer: true,
    },
    executionMode: 'PARALLEL',
    maxConcurrency: 3,
    confidence: 0.9,
    userFacingPlan: '执行四项研究后汇总。',
  };
}

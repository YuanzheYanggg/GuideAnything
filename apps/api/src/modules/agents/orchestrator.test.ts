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
});

function createOrchestrator(overrides: {
  runtime?: AgentRuntimeClient;
  events?: RecordingEventSink;
  retriever?: AgentEvidenceRetriever;
  resolver?: AgentEvidenceResolver;
  committer?: AgentOutputCommitter;
} = {}): AgentOrchestrator {
  let id = 0;
  return new AgentOrchestrator({
    runtime: overrides.runtime ?? new ScriptedRuntime([]),
    eventStore: overrides.events ?? new RecordingEventSink(),
    loadContext: async (runId) => ({ ...executionContext(), runId }),
    retriever: overrides.retriever ?? retrieverFrom({}),
    evidenceResolver: overrides.resolver ?? resolver(),
    outputCommitter: overrides.committer ?? recordingCommitter(),
    configuredMaxConcurrency: 3,
    trustedHarness: ['只读回答，不得执行任何写入。'],
    createId: () => `generated-${++id}`,
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
}

type RuntimeScript = (request: BridgeRunRequestV1) => AsyncGenerator<BridgeEventV1>;

class ScriptedRuntime implements AgentRuntimeClient {
  readonly requests: BridgeRunRequestV1[] = [];
  readonly cancelled: string[] = [];

  constructor(private readonly scripts: RuntimeScript[]) {}

  run(request: BridgeRunRequestV1): AsyncIterable<BridgeEventV1> {
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

function routeScript(decision: RouteDecisionV1): RuntimeScript {
  return async function* route(request) {
    yield event(request, 1, 'THREAD_BOUND', { threadId: 'thread-1' });
    yield event(request, 2, 'COMMENTARY', { text: 'PRIVATE CHAIN OF THOUGHT' });
    yield event(request, 3, 'ROUTE_DECISION', { decision });
    yield event(request, 4, 'COMPLETED', {});
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
      workspaceDocuments: true,
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
    resolveFlowFeedback: vi.fn(async (_context, feedback) => ({
      reference: { referenceId: 'reference-feedback', href: '/references/reference-feedback' },
      evidence: {
        id: 'flow-feedback',
        source: 'WORKSPACE_FLOW' as const,
        title: '流程反馈',
        excerpt: feedback.message,
        locator: { kind: 'WORKSPACE_FLOW' as const, ...feedback.locator },
      },
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

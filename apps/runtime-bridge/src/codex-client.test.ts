import { z } from 'zod';
import {
  AgentInternalAnswerV1Schema,
  type BridgeEventV1,
  type BridgeModelRoleV1,
  type BridgeRunRequestV1,
} from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { parseRuntimeBridgeEnv, type RuntimeBridgeConfig } from './config';
import {
  AGENT_INTERNAL_ANSWER_JSON_SCHEMA,
  CodexRuntime,
  CodexRuntimeError,
  type CodexRpc,
} from './codex-client';
import type { RpcNotification, RpcProtocolIssue, RpcServerRequest } from './json-rpc';

type RequestRecord = { method: string; params: unknown; options?: unknown };

class FakeRpc implements CodexRpc {
  readonly requests: RequestRecord[] = [];
  readonly notifications: { method: string; params?: unknown }[] = [];
  readonly #responses = new Map<string, ((params: unknown) => unknown | Promise<unknown>)[]>();
  readonly #notificationListeners = new Set<(notification: RpcNotification) => void>();
  readonly #issueListeners = new Set<(issue: RpcProtocolIssue) => void>();
  readonly #serverRequestListeners = new Set<(request: RpcServerRequest) => void>();

  enqueue(method: string, ...responses: (unknown | ((params: unknown) => unknown | Promise<unknown>))[]) {
    const queue = this.#responses.get(method) ?? [];
    for (const response of responses) {
      queue.push(typeof response === 'function'
        ? response as (params: unknown) => unknown | Promise<unknown>
        : () => response);
    }
    this.#responses.set(method, queue);
  }

  async request<T>(method: string, params: unknown, options?: unknown): Promise<T> {
    this.requests.push({ method, params, options });
    const response = this.#responses.get(method)?.shift();
    if (!response) throw new Error(`No fake response for ${method}`);
    return await response(params) as T;
  }

  notify(method: string, params?: unknown): void {
    this.notifications.push(params === undefined ? { method } : { method, params });
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  onProtocolIssue(listener: (issue: RpcProtocolIssue) => void): () => void {
    this.#issueListeners.add(listener);
    return () => this.#issueListeners.delete(listener);
  }

  onServerRequest(listener: (request: RpcServerRequest) => void): () => void {
    this.#serverRequestListeners.add(listener);
    return () => this.#serverRequestListeners.delete(listener);
  }

  emit(method: string, params: unknown): void {
    this.#notificationListeners.forEach((listener) => listener({ method, params }));
  }

  emitIssue(code: RpcProtocolIssue['code']): void {
    this.#issueListeners.forEach((listener) => listener({ code }));
  }

  emitServerRequest(method: string): void {
    this.#serverRequestListeners.forEach((listener) => listener({ id: 1, method }));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

const VALID_ANSWER = {
  mode: 'ANSWER' as const,
  conclusion: '结论',
  sections: [],
  evidence: [],
  flowFeedback: [],
  evidenceStatus: 'INSUFFICIENT' as const,
  artifacts: [],
  suggestedQuestions: [],
};

function config(overrides: Record<string, string | undefined> = {}): RuntimeBridgeConfig {
  return parseRuntimeBridgeEnv({
    AGENT_BRIDGE_TOKEN: 'runtime-bridge-test-token-000000000000',
    CODEX_RUNTIME_HOME: '/runtime/home',
    CODEX_RUNTIME_WORK_DIR: '/runtime/empty-work',
    AGENT_MODEL_ROUTER: 'gpt-test',
    AGENT_MODEL_DEEP_ROUTER: 'gpt-test',
    AGENT_MODEL_FOCUSED_WORKER: 'gpt-test',
    AGENT_MODEL_DEEP_WORKER: 'gpt-test',
    AGENT_MODEL_REDUCER: 'gpt-test',
    ...overrides,
  });
}

function model(efforts = ['medium', 'high']) {
  return {
    id: 'catalog-gpt-test',
    model: 'gpt-test',
    displayName: 'Test model',
    description: '',
    hidden: false,
    isDefault: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: '' })),
    defaultReasoningEffort: efforts[0],
  };
}

function threadResponse(id: string, runtimeConfig: RuntimeBridgeConfig, override: Record<string, unknown> = {}) {
  return {
    thread: { id },
    model: 'gpt-test',
    cwd: runtimeConfig.runtimeWorkDir,
    runtimeWorkspaceRoots: [runtimeConfig.runtimeWorkDir],
    instructionSources: [],
    approvalPolicy: 'never',
    sandbox: { type: 'readOnly', networkAccess: false },
    ...override,
  };
}

function runRequest(overrides: Partial<BridgeRunRequestV1> = {}): BridgeRunRequestV1 {
  return {
    type: 'RUN',
    requestId: 'request-1',
    runId: 'run-1',
    planVersion: 1,
    role: 'ROUTER',
    reasoningEffort: 'MEDIUM',
    prompt: '只使用给定证据回答。',
    allowedRoots: [],
    ...overrides,
  };
}

async function initializedRuntime(options: {
  runtimeConfig?: RuntimeBridgeConfig;
  models?: unknown[];
  rpc?: FakeRpc;
} = {}) {
  const runtimeConfig = options.runtimeConfig ?? config();
  const rpc = options.rpc ?? new FakeRpc();
  rpc.enqueue('initialize', {
    userAgent: 'codex-cli/0.144.1',
    codexHome: runtimeConfig.runtimeHome,
    platformFamily: 'unix',
    platformOs: 'macos',
  });
  rpc.enqueue('model/list', { data: options.models ?? [model()], nextCursor: null });
  const runtime = new CodexRuntime(rpc, runtimeConfig, '0.144.1');
  await runtime.initialize();
  return { runtime, rpc, runtimeConfig };
}

async function startHandle(
  runtime: CodexRuntime,
  rpc: FakeRpc,
  runtimeConfig: RuntimeBridgeConfig,
  request = runRequest(),
  threadId = 'thread-1',
  turnId = 'turn-1',
) {
  rpc.enqueue(
    request.resumeThreadId ? 'thread/resume' : 'thread/start',
    threadResponse(threadId, runtimeConfig),
  );
  rpc.enqueue('turn/start', { turn: { id: turnId, status: 'inProgress', items: [] } });
  return await runtime.startRun(request);
}

async function collectEvents(handle: { events: AsyncIterable<BridgeEventV1> }): Promise<BridgeEventV1[]> {
  const events: BridgeEventV1[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

function emitFinal(rpc: FakeRpc, threadId: string, turnId: string, answer: unknown = VALID_ANSWER): void {
  rpc.emit('item/started', {
    threadId,
    turnId,
    item: { id: 'final-item', type: 'agentMessage', text: '', phase: 'final_answer' },
  });
  rpc.emit('item/agentMessage/delta', {
    threadId,
    turnId,
    itemId: 'final-item',
    delta: JSON.stringify(answer).slice(0, 10),
  });
  rpc.emit('item/completed', {
    threadId,
    turnId,
    item: { id: 'final-item', type: 'agentMessage', text: JSON.stringify(answer), phase: 'final_answer' },
  });
}

function restoreCodexUnionKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreCodexUnionKeywords);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const properties = typeof record.properties === 'object' && record.properties !== null
    && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown>
    : null;
  if (properties) {
    const optionalKeys = new Set<string>();
    const restoredProperties = Object.fromEntries(Object.entries(properties).map(([key, schema]) => {
      const union = typeof schema === 'object' && schema !== null && !Array.isArray(schema)
        ? (schema as Record<string, unknown>).anyOf
        : null;
      if (
        Array.isArray(union)
        && union.length === 2
        && typeof union[1] === 'object'
        && union[1] !== null
        && !Array.isArray(union[1])
        && (union[1] as Record<string, unknown>).type === 'null'
      ) {
        optionalKeys.add(key);
        return [key, restoreCodexUnionKeywords(union[0])];
      }
      return [key, restoreCodexUnionKeywords(schema)];
    }));
    const required = (Array.isArray(record.required) ? record.required : [])
      .filter((key): key is string => typeof key === 'string' && !optionalKeys.has(key));
    return {
      ...Object.fromEntries(Object.entries(record)
        .filter(([key]) => key !== 'properties' && key !== 'required')
        .map(([key, nested]) => [
          key === 'anyOf' ? 'oneOf' : key,
          restoreCodexUnionKeywords(nested),
        ])),
      properties: restoredProperties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
    key === 'anyOf' ? 'oneOf' : key,
    restoreCodexUnionKeywords(nested),
  ]));
}

function findObjectsWithOptionalProperties(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((nested, index) => findObjectsWithOptionalProperties(nested, `${path}/${index}`));
  }
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const properties = typeof record.properties === 'object' && record.properties !== null
    && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown>
    : null;
  const required = new Set(Array.isArray(record.required) ? record.required : []);
  const ownFailure = properties && Object.keys(properties).some((key) => !required.has(key)) ? [path] : [];
  return [
    ...ownFailure,
    ...Object.entries(record).flatMap(([key, nested]) => (
      findObjectsWithOptionalProperties(nested, `${path}/${key}`)
    )),
  ];
}

describe('CodexRuntime initialization and model resolution', () => {
  it('uses the verified initialize/model-list lifecycle and resolves every semantic role without fallback', async () => {
    const runtimeConfig = config();
    const rpc = new FakeRpc();
    rpc.enqueue('initialize', {
      userAgent: 'codex-cli/0.144.1',
      codexHome: runtimeConfig.runtimeHome,
      platformFamily: 'unix',
      platformOs: 'macos',
    });
    rpc.enqueue(
      'model/list',
      { data: [model()], nextCursor: 'next-page' },
      { data: [], nextCursor: null },
    );
    const runtime = new CodexRuntime(rpc, runtimeConfig, '0.144.1');

    await runtime.initialize();

    expect(rpc.requests.map(({ method }) => method)).toEqual(['initialize', 'model/list', 'model/list']);
    expect(rpc.notifications).toEqual([{ method: 'initialized' }]);
    expect(rpc.requests[1]?.params).toMatchObject({ cursor: null, includeHidden: false });
    expect(rpc.requests[2]?.params).toMatchObject({ cursor: 'next-page' });
    expect(runtime.getHealth()).toMatchObject({
      status: 'READY',
      version: '0.144.1',
      roles: {
        ROUTER: { ready: true, model: 'gpt-test', requiredEffort: 'MEDIUM' },
        DEEP_ROUTER: { ready: true, requiredEffort: 'HIGH' },
      },
    });
  });

  it('degrades for missing models or unsupported required effort and never picks a default', async () => {
    const runtimeConfig = config({ AGENT_MODEL_ROUTER: '', AGENT_MODEL_DEEP_ROUTER: 'not-present' });
    const { runtime } = await initializedRuntime({ runtimeConfig, models: [model(['medium'])] });
    const health = runtime.getHealth();

    expect(health.status).toBe('DEGRADED');
    expect(health.roles.ROUTER).toMatchObject({ ready: false, model: null });
    expect(health.roles.DEEP_ROUTER).toMatchObject({ ready: false, model: null });
    expect(health.roles.DEEP_WORKER).toMatchObject({ ready: false, model: 'gpt-test' });
    expect(health.reasonCodes).toEqual(expect.arrayContaining([
      'MODEL_ROLE_UNCONFIGURED', 'MODEL_ROLE_NOT_FOUND', 'MODEL_EFFORT_UNSUPPORTED',
    ]));
    await expect(runtime.startRun(runRequest())).rejects.toMatchObject({ code: 'RUNTIME_DEGRADED' });
  });

  it('degrades when initialize reports a different Codex home without exposing either path', async () => {
    const runtimeConfig = config();
    const rpc = new FakeRpc();
    rpc.enqueue('initialize', {
      userAgent: 'codex-cli/0.144.1',
      codexHome: '/personal/.codex',
      platformFamily: 'unix',
      platformOs: 'macos',
    });
    const runtime = new CodexRuntime(rpc, runtimeConfig, '0.144.1');

    await expect(runtime.initialize()).rejects.toMatchObject({ code: 'RUNTIME_HOME_MISMATCH' });
    const serialized = JSON.stringify(runtime.getHealth());
    expect(serialized).not.toContain('/personal');
    expect(serialized).not.toContain('/runtime');
  });
});

describe('CodexRuntime thread and turn safety', () => {
  it('starts a thread and turn with read-only, no-network, no-tools parameters and the exact answer schema', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const handle = await startHandle(runtime, rpc, runtimeConfig);

    const threadStart = rpc.requests.find(({ method }) => method === 'thread/start')?.params as Record<string, unknown>;
    expect(threadStart).toMatchObject({
      model: 'gpt-test',
      allowProviderModelFallback: false,
      cwd: runtimeConfig.runtimeWorkDir,
      runtimeWorkspaceRoots: [runtimeConfig.runtimeWorkDir],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      personality: 'none',
      environments: [],
      dynamicTools: [],
      selectedCapabilityRoots: [],
      ephemeral: false,
      historyMode: 'legacy',
      experimentalRawEvents: false,
    });
    const turnStart = rpc.requests.find(({ method }) => method === 'turn/start')?.params as Record<string, unknown>;
    expect(turnStart).toMatchObject({
      threadId: 'thread-1',
      input: [{ type: 'text', text: '只使用给定证据回答。' }],
      cwd: runtimeConfig.runtimeWorkDir,
      runtimeWorkspaceRoots: [runtimeConfig.runtimeWorkDir],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      environments: [],
      model: 'gpt-test',
      effort: 'medium',
      summary: 'none',
      personality: 'none',
      outputSchema: AGENT_INTERNAL_ANSWER_JSON_SCHEMA,
    });
    const contractSchema = z.toJSONSchema(AgentInternalAnswerV1Schema, { target: 'draft-7' });
    const outputSchemaText = JSON.stringify(AGENT_INTERNAL_ANSWER_JSON_SCHEMA);
    expect(outputSchemaText).not.toContain('"oneOf"');
    expect(outputSchemaText).toContain('"anyOf"');
    expect(findObjectsWithOptionalProperties(AGENT_INTERNAL_ANSWER_JSON_SCHEMA)).toEqual([]);
    expect(restoreCodexUnionKeywords(AGENT_INTERNAL_ANSWER_JSON_SCHEMA)).toEqual(contractSchema);
    expect(handle.threadId).toBe('thread-1');
    expect(handle.turnId).toBe('turn-1');
  });

  it('resumes only bridge-created thread state with the same security overrides', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    await startHandle(
      runtime,
      rpc,
      runtimeConfig,
      runRequest({ resumeThreadId: 'existing-thread' }),
      'existing-thread',
    );

    expect(rpc.requests.find(({ method }) => method === 'thread/resume')?.params).toMatchObject({
      threadId: 'existing-thread',
      model: 'gpt-test',
      cwd: runtimeConfig.runtimeWorkDir,
      runtimeWorkspaceRoots: [runtimeConfig.runtimeWorkDir],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      personality: 'none',
      excludeTurns: true,
    });
  });

  it('rejects filesystem roots supplied by a caller and role/effort substitution', async () => {
    const { runtime } = await initializedRuntime();

    await expect(runtime.startRun(runRequest({ allowedRoots: ['/vault'] }))).rejects.toMatchObject({
      code: 'CALLER_ROOTS_FORBIDDEN',
    });
    await expect(runtime.startRun(runRequest({ reasoningEffort: 'HIGH' }))).rejects.toMatchObject({
      code: 'EFFORT_ROLE_MISMATCH',
    });
  });

  it('fails closed on instruction sources or any returned sandbox/model mismatch', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    rpc.enqueue('thread/start', threadResponse('bad-thread', runtimeConfig, {
      instructionSources: ['/private/personal/AGENTS.md'],
    }));

    await expect(runtime.startRun(runRequest())).rejects.toMatchObject({ code: 'INSTRUCTION_SOURCES_PRESENT' });
    const health = runtime.getHealth();
    expect(health.status).toBe('DEGRADED');
    expect(health.counters.instructionSources).toBe(1);
    expect(JSON.stringify(health)).not.toContain('AGENTS.md');

    const clean = await initializedRuntime();
    clean.rpc.enqueue('thread/start', threadResponse('bad-model', clean.runtimeConfig, {
      model: 'silently-rerouted-model',
    }));
    await expect(clean.runtime.startRun(runRequest())).rejects.toMatchObject({ code: 'THREAD_SECURITY_MISMATCH' });
  });
});

describe('CodexRuntime event projection and fail-closed behavior', () => {
  it('streams phase-less/commentary text provisionally and commits only one validated final answer', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const handle = await startHandle(runtime, rpc, runtimeConfig);

    rpc.emit('item/started', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: { id: 'commentary-item', type: 'agentMessage', text: '', phase: null },
    });
    rpc.emit('item/agentMessage/delta', {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'commentary-item', delta: '正在检查流程',
    });
    emitFinal(rpc, 'thread-1', 'turn-1');
    rpc.emit('turn/completed', {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] },
    });

    const events = await collectEvents(handle);
    expect(events.map(({ type }) => type)).toEqual([
      'THREAD_BOUND', 'COMMENTARY', 'FINAL_ANSWER', 'COMPLETED',
    ]);
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(events[1]).toMatchObject({ payload: { text: '正在检查流程' } });
    expect(events[2]).toMatchObject({ payload: { answer: VALID_ANSWER } });
    expect(events.filter(({ type }) => type === 'COMMENTARY')).toEqual([
      expect.objectContaining({ payload: { text: '正在检查流程' } }),
    ]);
  });

  it('removes structured-output null placeholders before validating optional contract fields', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const handle = await startHandle(runtime, rpc, runtimeConfig);
    emitFinal(rpc, 'thread-1', 'turn-1', {
      ...VALID_ANSWER,
      evidence: [{
        id: 'evidence-1',
        source: 'SANTEXWELL',
        title: '测试资料',
        excerpt: '测试摘录',
        locator: {
          kind: 'SANTEXWELL',
          documentId: 'document-1',
          fragmentId: null,
          relativePath: 'Concepts/test.md',
          revision: 'revision-1',
          heading: null,
        },
      }],
      evidenceStatus: 'SUPPORTED',
    });
    rpc.emit('turn/completed', {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] },
    });

    const events = await collectEvents(handle);
    expect(events.map(({ type }) => type)).toEqual(['THREAD_BOUND', 'FINAL_ANSWER', 'COMPLETED']);
    expect(events[1]).toMatchObject({
      payload: {
        answer: {
          evidence: [{ locator: { kind: 'SANTEXWELL', documentId: 'document-1' } }],
        },
      },
    });
    expect(JSON.stringify(events[1])).not.toContain('fragmentId');
    expect(JSON.stringify(events[1])).not.toContain('"heading"');
  });

  it.each([
    ['malformed final', '{not-json', 'INVALID_FINAL_ANSWER'],
    ['schema-invalid final', JSON.stringify({ conclusion: 'x' }), 'INVALID_FINAL_ANSWER'],
  ])('reports %s as a typed failure', async (_label, text, code) => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const handle = await startHandle(runtime, rpc, runtimeConfig);
    rpc.emit('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1',
      item: { id: 'final', type: 'agentMessage', text, phase: 'final_answer' },
    });

    const events = await collectEvents(handle);
    expect(events.at(-1)).toMatchObject({ type: 'FAILED', payload: { code } });
  });

  it('rejects duplicate finals and completion without a final', async () => {
    const first = await initializedRuntime();
    const duplicateHandle = await startHandle(first.runtime, first.rpc, first.runtimeConfig);
    emitFinal(first.rpc, 'thread-1', 'turn-1');
    first.rpc.emit('item/completed', {
      threadId: 'thread-1', turnId: 'turn-1',
      item: { id: 'another-final', type: 'agentMessage', text: JSON.stringify(VALID_ANSWER), phase: 'final_answer' },
    });
    expect((await collectEvents(duplicateHandle)).at(-1)).toMatchObject({
      type: 'FAILED', payload: { code: 'DUPLICATE_FINAL_ANSWER' },
    });

    const second = await initializedRuntime();
    const missingHandle = await startHandle(second.runtime, second.rpc, second.runtimeConfig);
    second.rpc.emit('turn/completed', {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] },
    });
    expect((await collectEvents(missingHandle)).at(-1)).toMatchObject({
      type: 'FAILED', payload: { code: 'FINAL_ANSWER_MISSING' },
    });
  });

  it('never forwards command/file/tool/MCP/reasoning payloads and latches degraded health', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const handle = await startHandle(runtime, rpc, runtimeConfig);
    rpc.emit('item/started', {
      threadId: 'thread-1', turnId: 'turn-1',
      item: { id: 'reasoning', type: 'reasoning', content: ['hidden-secret-chain'], summary: [] },
    });

    const events = await collectEvents(handle);
    expect(events.at(-1)).toMatchObject({
      type: 'FAILED', payload: { code: 'UNEXPECTED_CAPABILITY_OUTPUT' },
    });
    expect(JSON.stringify(events)).not.toContain('hidden-secret-chain');
    expect(runtime.getHealth()).toMatchObject({
      status: 'DEGRADED', counters: { unexpectedCapabilities: 1 },
    });

    const global = await initializedRuntime();
    global.rpc.emit('mcpServer/startupStatus/updated', { name: 'personal', status: 'ready' });
    expect(global.runtime.getHealth()).toMatchObject({
      status: 'DEGRADED', counters: { mcpStartups: 1, unexpectedCapabilities: 1 },
    });
    await expect(global.runtime.startRun(runRequest())).rejects.toMatchObject({ code: 'RUNTIME_DEGRADED' });
  });

  it.each([
    'command/exec/outputDelta',
    'process/outputDelta',
    'hook/started',
  ])('fails closed for the verified capability notification %s', async (method) => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const runHandle = await startHandle(runtime, rpc, runtimeConfig);

    rpc.emit(method, {
      threadId: 'thread-1', turnId: 'turn-1', delta: 'private-capability-payload',
    });
    rpc.emit('turn/completed', {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] },
    });

    const events = await collectEvents(runHandle);
    expect(events.at(-1)).toMatchObject({
      type: 'FAILED', payload: { code: 'UNEXPECTED_CAPABILITY_OUTPUT' },
    });
    expect(JSON.stringify(events)).not.toContain('private-capability-payload');
  });

  it('degrades and fails the run when input tokens exceed the configured bound', async () => {
    const runtimeConfig = config({ CODEX_BASELINE_INPUT_TOKEN_LIMIT: '1000' });
    const { runtime, rpc } = await initializedRuntime({ runtimeConfig });
    const handle = await startHandle(runtime, rpc, runtimeConfig);
    rpc.emit('thread/tokenUsage/updated', {
      threadId: 'thread-1', turnId: 'turn-1',
      tokenUsage: { last: { inputTokens: 1001 }, total: { inputTokens: 1001 } },
    });

    expect((await collectEvents(handle)).at(-1)).toMatchObject({
      type: 'FAILED', payload: { code: 'INPUT_TOKEN_LIMIT_EXCEEDED' },
    });
    expect(runtime.getHealth()).toMatchObject({
      status: 'DEGRADED', counters: { maxInputTokens: 1001 },
    });
  });

  it('fails active runs on malformed protocol or server tool requests without raw details', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const handle = await startHandle(runtime, rpc, runtimeConfig);
    rpc.emitIssue('MALFORMED_LINE');
    const events = await collectEvents(handle);
    expect(events.at(-1)).toMatchObject({ type: 'FAILED', payload: { code: 'CODEX_PROTOCOL_VIOLATION' } });

    const second = await initializedRuntime();
    const secondHandle = await startHandle(second.runtime, second.rpc, second.runtimeConfig);
    second.rpc.emitServerRequest('tool/requestUserInput');
    const secondEvents = await collectEvents(secondHandle);
    expect(secondEvents.at(-1)).toMatchObject({ type: 'FAILED', payload: { code: 'UNEXPECTED_SERVER_REQUEST' } });
    expect(JSON.stringify(secondEvents)).not.toContain('tool/requestUserInput');
  });

  it('keeps concurrent thread streams isolated', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const first = await startHandle(runtime, rpc, runtimeConfig, runRequest(), 'thread-a', 'turn-a');
    const second = await startHandle(runtime, rpc, runtimeConfig, runRequest({
      requestId: 'request-2', runId: 'run-2', role: 'FOCUSED_WORKER',
    }), 'thread-b', 'turn-b');

    for (const [threadId, turnId, itemId, text] of [
      ['thread-a', 'turn-a', 'comment-a', 'A'],
      ['thread-b', 'turn-b', 'comment-b', 'B'],
    ] as const) {
      rpc.emit('item/started', { threadId, turnId, item: { id: itemId, type: 'agentMessage', text: '', phase: 'commentary' } });
      rpc.emit('item/agentMessage/delta', { threadId, turnId, itemId, delta: text });
      emitFinal(rpc, threadId, turnId);
      rpc.emit('turn/completed', { threadId, turn: { id: turnId, status: 'completed', items: [] } });
    }

    const [firstEvents, secondEvents] = await Promise.all([collectEvents(first), collectEvents(second)]);
    expect(JSON.stringify(firstEvents)).toContain('"text":"A"');
    expect(JSON.stringify(firstEvents)).not.toContain('"text":"B"');
    expect(JSON.stringify(secondEvents)).toContain('"text":"B"');
    expect(JSON.stringify(secondEvents)).not.toContain('"text":"A"');
  });

  it('ignores forbidden item notifications belonging to another thread or turn', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const runHandle = await startHandle(runtime, rpc, runtimeConfig);

    rpc.emit('item/reasoning/textDelta', {
      threadId: 'other-thread', turnId: 'other-turn', itemId: 'reasoning', delta: 'other-secret',
    });
    rpc.emit('item/reasoning/textDelta', {
      threadId: 'thread-1', turnId: 'other-turn', itemId: 'reasoning', delta: 'stale-secret',
    });
    emitFinal(rpc, 'thread-1', 'turn-1');
    rpc.emit('turn/completed', {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] },
    });

    const events = await collectEvents(runHandle);
    expect(events.map(({ type }) => type)).toEqual(['THREAD_BOUND', 'FINAL_ANSWER', 'COMPLETED']);
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(runtime.getHealth()).toMatchObject({
      status: 'READY', counters: { unexpectedCapabilities: 0 },
    });
  });
});

describe('CodexRuntime cancel and steer', () => {
  it('maps cancel idempotently and accepts only the next owned plan version for steer', async () => {
    const { runtime, rpc, runtimeConfig } = await initializedRuntime();
    const handle = await startHandle(runtime, rpc, runtimeConfig);
    rpc.enqueue('turn/steer', { turnId: 'turn-1' });
    await handle.steer(2, '聚焦冲突证据');
    expect(rpc.requests.find(({ method }) => method === 'turn/steer')?.params).toEqual({
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: '聚焦冲突证据' }],
    });
    await expect(handle.steer(2, 'replay')).rejects.toMatchObject({ code: 'PLAN_VERSION_MISMATCH' });

    rpc.enqueue('turn/interrupt', {});
    await handle.cancel();
    await handle.cancel();
    expect(rpc.requests.filter(({ method }) => method === 'turn/interrupt')).toHaveLength(1);
    expect(rpc.requests.find(({ method }) => method === 'turn/interrupt')?.params).toEqual({
      threadId: 'thread-1', turnId: 'turn-1',
    });
  });
});

describe('CodexRuntimeError', () => {
  it('contains only a stable code and retryability', () => {
    expect(new CodexRuntimeError('RUNTIME_DEGRADED', true)).toMatchObject({
      code: 'RUNTIME_DEGRADED', retryable: true,
    });
  });
});

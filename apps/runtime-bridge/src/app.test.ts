import http from 'node:http';

import {
  BridgeEventV1Schema,
  type BridgeEventV1,
  type BridgeRunRequestV1,
} from '@guideanything/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeBridgeApp, matchesBridgeBearerToken, type RuntimeController } from './app';
import { CodexRuntimeError } from './codex-client';
import { parseRuntimeBridgeEnv } from './config';
import type { CodexRunHandle, RuntimeHealth } from './types';

const TOKEN = 'runtime-bridge-test-token-000000000000';
const config = parseRuntimeBridgeEnv({
  AGENT_BRIDGE_TOKEN: TOKEN,
  CODEX_RUNTIME_HOME: '/runtime/home',
  CODEX_RUNTIME_WORK_DIR: '/runtime/work',
  AGENT_MODEL_ROUTER: 'gpt-test',
  AGENT_MODEL_DEEP_ROUTER: 'gpt-test',
  AGENT_MODEL_FOCUSED_WORKER: 'gpt-test',
  AGENT_MODEL_DEEP_WORKER: 'gpt-test',
  AGENT_MODEL_REDUCER: 'gpt-test',
});

const health: RuntimeHealth = {
  status: 'READY',
  version: '0.144.1',
  roles: {
    ROUTER: { ready: true, model: 'gpt-test', requiredEffort: 'MEDIUM', supportedEfforts: ['medium'] },
    DEEP_ROUTER: { ready: true, model: 'gpt-test', requiredEffort: 'HIGH', supportedEfforts: ['high'] },
    FOCUSED_WORKER: { ready: true, model: 'gpt-test', requiredEffort: 'MEDIUM', supportedEfforts: ['medium'] },
    DEEP_WORKER: { ready: true, model: 'gpt-test', requiredEffort: 'HIGH', supportedEfforts: ['high'] },
    REDUCER: { ready: true, model: 'gpt-test', requiredEffort: 'HIGH', supportedEfforts: ['high'] },
  },
  counters: { instructionSources: 0, mcpStartups: 0, unexpectedCapabilities: 0, maxInputTokens: 0 },
  reasonCodes: [],
};

const completedEvents: BridgeEventV1[] = [
  BridgeEventV1Schema.parse({
    requestId: 'request-1', runId: 'run-1', sequence: 1,
    type: 'THREAD_BOUND', payload: { threadId: 'thread-1' },
  }),
  BridgeEventV1Schema.parse({
    requestId: 'request-1', runId: 'run-1', sequence: 2,
    type: 'COMMENTARY', payload: { text: '正在检查' },
  }),
  BridgeEventV1Schema.parse({
    requestId: 'request-1', runId: 'run-1', sequence: 3,
    type: 'FINAL_ANSWER', payload: { answer: {
      mode: 'ANSWER', conclusion: '结论', sections: [], evidence: [], flowFeedback: [],
      evidenceStatus: 'INSUFFICIENT', artifacts: [], suggestedQuestions: [],
    } },
  }),
  BridgeEventV1Schema.parse({
    requestId: 'request-1', runId: 'run-1', sequence: 4,
    type: 'COMPLETED', payload: {},
  }),
];

class AsyncEventSource implements AsyncIterable<BridgeEventV1> {
  readonly #events: BridgeEventV1[] = [];
  readonly #waiters: ((result: IteratorResult<BridgeEventV1>) => void)[] = [];
  #closed = false;

  push(event: BridgeEventV1): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value: event });
    else this.#events.push(event);
  }

  close(): void {
    this.#closed = true;
    this.#waiters.splice(0).forEach((waiter) => waiter({ done: true, value: undefined }));
  }

  [Symbol.asyncIterator](): AsyncIterator<BridgeEventV1> {
    return {
      next: () => {
        const event = this.#events.shift();
        if (event) return Promise.resolve({ done: false, value: event });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

function handle(events: AsyncIterable<BridgeEventV1> = (async function* () {
  yield* completedEvents;
})()): CodexRunHandle & { cancel: ReturnType<typeof vi.fn>; steer: ReturnType<typeof vi.fn> } {
  return {
    requestId: 'request-1',
    runId: 'run-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    planVersion: 1,
    events,
    cancel: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
  };
}

function runBody(overrides: Partial<BridgeRunRequestV1> = {}) {
  return {
    type: 'RUN', requestId: 'request-1', runId: 'run-1', planVersion: 1,
    role: 'FOCUSED_WORKER', reasoningEffort: 'MEDIUM', outputKind: 'ANSWER',
    prompt: '问题', allowedRoots: [],
    ...overrides,
  };
}

function authHeaders(contentType = 'application/json') {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': contentType };
}

const apps: Awaited<ReturnType<typeof createRuntimeBridgeApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fakeRuntime(runHandle = handle()): RuntimeController {
  return {
    getHealth: () => health,
    startRun: vi.fn(async () => runHandle),
  };
}

describe('runtime bridge HTTP facade', () => {
  it('exposes unauthenticated safe health without token, prompt, home, cwd, or raw error fields', async () => {
    const app = await createRuntimeBridgeApp({ config, runtime: fakeRuntime() });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'READY',
      roles: {
        ROUTER: { ready: true, requiredEffort: 'MEDIUM' },
        DEEP_ROUTER: { ready: true, requiredEffort: 'HIGH' },
        FOCUSED_WORKER: { ready: true, requiredEffort: 'MEDIUM' },
        DEEP_WORKER: { ready: true, requiredEffort: 'HIGH' },
        REDUCER: { ready: true, requiredEffort: 'HIGH' },
      },
      reasonCodes: [],
    });
    const serialized = response.body;
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('/runtime');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('error');
    expect(serialized).not.toContain('0.144.1');
    expect(serialized).not.toContain('gpt-test');
    expect(serialized).not.toContain('supportedEfforts');
    expect(serialized).not.toContain('instructionSources');
    expect(serialized).not.toContain('maxInputTokens');
  });

  it('requires a constant-time bearer token on every non-health route and ignores query auth', async () => {
    const app = await createRuntimeBridgeApp({ config, runtime: fakeRuntime() });
    apps.push(app);

    for (const authorization of [undefined, 'Bearer wrong', `Basic ${TOKEN}`]) {
      const response = await app.inject({
        method: 'POST', url: '/v1/cancel',
        headers: authorization ? { authorization, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
        payload: { type: 'CANCEL', requestId: 'cancel-1', runId: 'run-1' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain(TOKEN);
    }
    const query = await app.inject({
      method: 'POST', url: `/v1/cancel?token=${TOKEN}`,
      headers: { 'content-type': 'application/json' },
      payload: { type: 'CANCEL', requestId: 'cancel-1', runId: 'run-1' },
    });
    expect(query.statusCode).toBe(401);
    expect(matchesBridgeBearerToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(matchesBridgeBearerToken('Bearer wrong', TOKEN)).toBe(false);
  });

  it('streams strict BridgeEventV1 records in NDJSON order', async () => {
    const runtime = fakeRuntime();
    const app = await createRuntimeBridgeApp({ config, runtime });
    apps.push(app);

    const response = await app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders(), payload: runBody(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    const events = response.body.trim().split('\n').map((line) => BridgeEventV1Schema.parse(JSON.parse(line)));
    expect(events).toEqual(completedEvents);
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(runtime.startRun).toHaveBeenCalledWith(runBody());
  });

  it('synthesizes a typed failure when the runtime closes without a terminal event', async () => {
    const incomplete = handle((async function* () {
      yield completedEvents[0]!;
    })());
    const app = await createRuntimeBridgeApp({ config, runtime: fakeRuntime(incomplete) });
    apps.push(app);

    const response = await app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders(), payload: runBody(),
    });
    const events = response.body.trim().split('\n').map((line) => BridgeEventV1Schema.parse(JSON.parse(line)));

    expect(events.map(({ type }) => type)).toEqual(['THREAD_BOUND', 'FAILED']);
    expect(events.at(-1)).toMatchObject({ payload: { code: 'BRIDGE_STREAM_INCOMPLETE' } });
  });

  it('does not forward cross-run or non-monotonic runtime events', async () => {
    const crossed = handle((async function* () {
      yield BridgeEventV1Schema.parse({
        requestId: 'another-request', runId: 'another-run', sequence: 9,
        type: 'COMMENTARY', payload: { text: 'cross-run-secret' },
      });
    })());
    const app = await createRuntimeBridgeApp({ config, runtime: fakeRuntime(crossed) });
    apps.push(app);

    const response = await app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders(), payload: runBody(),
    });
    const events = response.body.trim().split('\n').map((line) => BridgeEventV1Schema.parse(JSON.parse(line)));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      requestId: 'request-1', runId: 'run-1', sequence: 1,
      type: 'FAILED', payload: { code: 'BRIDGE_STREAM_ERROR' },
    });
    expect(response.body).not.toContain('cross-run-secret');
  });

  it('rejects wrong content type, malformed/oversized JSON, and strict DTO violations', async () => {
    const app = await createRuntimeBridgeApp({ config, runtime: fakeRuntime() });
    apps.push(app);

    const wrongType = await app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders('text/plain'), payload: JSON.stringify(runBody()),
    });
    expect(wrongType.statusCode).toBe(415);

    const malformed = await app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders(), payload: '{not-json',
    });
    expect(malformed.statusCode).toBe(400);

    const strict = await app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders(), payload: { ...runBody(), secret: 'x' },
    });
    expect(strict.statusCode).toBe(400);

    const oversized = await app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders(), payload: runBody({ prompt: 'x'.repeat(config.bodyLimitBytes) }),
    });
    expect(oversized.statusCode).toBe(413);
    for (const response of [wrongType, malformed, strict, oversized]) {
      expect(response.body).not.toContain('x'.repeat(100));
      expect(response.body).not.toContain('/runtime');
    }
  });

  it('maps typed startup failures without exposing internal error text', async () => {
    const runtime: RuntimeController = {
      getHealth: () => ({ ...health, status: 'DEGRADED', reasonCodes: ['MODEL_ROLE_NOT_FOUND'] }),
      startRun: async () => { throw new CodexRuntimeError('RUNTIME_DEGRADED', true); },
    };
    const app = await createRuntimeBridgeApp({ config, runtime });
    apps.push(app);

    const response = await app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders(), payload: runBody(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: 'RUNTIME_DEGRADED', retryable: true });
  });

  it('maps cancel idempotently and steer only to the active owned run', async () => {
    const source = new AsyncEventSource();
    const runHandle = handle(source);
    const app = await createRuntimeBridgeApp({ config, runtime: fakeRuntime(runHandle) });
    apps.push(app);

    const generating = app.inject({
      method: 'POST', url: '/v1/generate', headers: authHeaders(), payload: runBody(),
    });
    await new Promise((resolve) => setImmediate(resolve));

    const steer = await app.inject({
      method: 'POST', url: '/v1/steer', headers: authHeaders(),
      payload: { type: 'STEER', requestId: 'steer-1', runId: 'run-1', planVersion: 2, instruction: '聚焦证据' },
    });
    expect(steer.statusCode).toBe(202);
    expect(runHandle.steer).toHaveBeenCalledWith(2, '聚焦证据');

    const cancel = await app.inject({
      method: 'POST', url: '/v1/cancel', headers: authHeaders(),
      payload: { type: 'CANCEL', requestId: 'cancel-1', runId: 'run-1' },
    });
    const cancelAgain = await app.inject({
      method: 'POST', url: '/v1/cancel', headers: authHeaders(),
      payload: { type: 'CANCEL', requestId: 'cancel-2', runId: 'run-1' },
    });
    expect(cancel.statusCode).toBe(202);
    expect(cancelAgain.statusCode).toBe(202);
    expect(runHandle.cancel).toHaveBeenCalledTimes(2);

    source.close();
    await generating;
    const missing = await app.inject({
      method: 'POST', url: '/v1/steer', headers: authHeaders(),
      payload: { type: 'STEER', requestId: 'steer-2', runId: 'missing', planVersion: 2, instruction: 'x' },
    });
    expect(missing.statusCode).toBe(409);
  });

  it('interrupts an active turn when the HTTP client disconnects', async () => {
    const source = new AsyncEventSource();
    const runHandle = handle(source);
    const app = await createRuntimeBridgeApp({ config, runtime: fakeRuntime(runHandle) });
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP address');

    await new Promise<void>((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1', port: address.port, path: '/v1/generate', method: 'POST',
        headers: { ...authHeaders(), 'content-length': Buffer.byteLength(JSON.stringify(runBody())) },
      }, (response) => {
        response.once('data', () => {
          request.destroy();
          response.destroy();
          resolve();
        });
      });
      request.once('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') resolve();
        else reject(error);
      });
      request.end(JSON.stringify(runBody()));
      source.push(completedEvents[0]!);
    });

    await vi.waitFor(() => expect(runHandle.cancel).toHaveBeenCalledTimes(1));
    source.close();
  });
});

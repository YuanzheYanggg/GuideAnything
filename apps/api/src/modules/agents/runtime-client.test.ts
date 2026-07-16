import {
  BridgeEventV1Schema,
  type BridgeEventV1,
  type BridgeRunRequestV1,
} from '@guideanything/contracts';
import { describe, expect, it, vi } from 'vitest';

import { HttpAgentRuntimeClient, RuntimeClientError } from './runtime-client';

const request: BridgeRunRequestV1 = {
  type: 'RUN',
  requestId: 'request-1',
  runId: 'run-1',
  planVersion: 1,
  role: 'ROUTER',
  reasoningEffort: 'MEDIUM',
  outputKind: 'ROUTE_DECISION',
  prompt: '请路由这个问题。',
  allowedRoots: [],
};

describe('HttpAgentRuntimeClient', () => {
  it('decodes split UTF-8 NDJSON and validates event ownership and sequence', async () => {
    const expected = bridgeEvents();
    const bytes = new TextEncoder().encode(`${expected.map((event) => JSON.stringify(event)).join('\n')}\n`);
    const splitAt = bytes.findIndex((byte) => byte > 0x7f) + 1;
    const fetchImpl = vi.fn(async () => responseFromChunks([
      bytes.slice(0, splitAt),
      bytes.slice(splitAt, splitAt + 2),
      bytes.slice(splitAt + 2),
    ]));
    const client = new HttpAgentRuntimeClient({
      baseUrl: 'http://127.0.0.1:3010/',
      token: 'x'.repeat(32),
      fetchImpl,
    });

    const received: BridgeEventV1[] = [];
    for await (const event of client.run(request)) received.push(event);

    expect(received).toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3010/v1/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: `Bearer ${'x'.repeat(32)}` }),
        body: JSON.stringify(request),
      }),
    );
  });

  it('rejects cross-run, non-monotonic, trailing, and incomplete streams', async () => {
    const valid = bridgeEvents();
    const completedWithoutOutput = [
      valid[0]!,
      { requestId: 'request-1', runId: 'run-1', sequence: 2, type: 'COMPLETED', payload: {} },
    ];
    const wrongOutput = [
      valid[0]!,
      {
        requestId: 'request-1', runId: 'run-1', sequence: 2, type: 'TASK_FINDING',
        payload: { finding: {
          taskId: 'vault', status: 'NO_EVIDENCE', findings: [], validatedEvidence: [],
          conflicts: [], gaps: ['没有证据。'],
        } },
      },
      { requestId: 'request-1', runId: 'run-1', sequence: 3, type: 'COMPLETED', payload: {} },
    ];
    const cases = [
      [{ ...valid[0]!, runId: 'other-run' }],
      [valid[0]!, { ...valid[1]!, sequence: 3 }],
      [valid[0]!],
      [...valid, { ...valid[0]!, sequence: 4 }],
      completedWithoutOutput,
      wrongOutput,
    ];
    for (const events of cases) {
      const client = clientForEvents(events);
      await expect(collect(client.run(request))).rejects.toBeInstanceOf(RuntimeClientError);
    }
  });

  it('bounds malformed responses and exposes only a validated bridge error code', async () => {
    const failed = new HttpAgentRuntimeClient({
      baseUrl: 'http://127.0.0.1:3010',
      token: 'x'.repeat(32),
      fetchImpl: async () => new Response(JSON.stringify({
        code: 'RUNTIME_DEGRADED',
        retryable: true,
        secret: '/private/runtime/path',
      }), { status: 503, headers: { 'content-type': 'application/json' } }),
    });
    await expect(collect(failed.run(request))).rejects.toMatchObject({
      code: 'RUNTIME_DEGRADED', retryable: true,
    });

    const oversized = new HttpAgentRuntimeClient({
      baseUrl: 'http://127.0.0.1:3010', token: 'x'.repeat(32), maxResponseBytes: 64,
      fetchImpl: async () => new Response('x'.repeat(65), {
        status: 200, headers: { 'content-type': 'application/x-ndjson' },
      }),
    });
    await expect(collect(oversized.run(request))).rejects.toMatchObject({ code: 'BRIDGE_RESPONSE_TOO_LARGE' });
  });

  it('accepts answer previews only for an ANSWER request before the structured output', async () => {
    const answerRequest: BridgeRunRequestV1 = {
      ...request,
      role: 'FOCUSED_WORKER',
      outputKind: 'ANSWER',
      prompt: '回答问题。',
    };
    const answer = {
      mode: 'ANSWER', conclusion: '结论', sections: [], evidence: [], flowFeedback: [],
      evidenceStatus: 'INSUFFICIENT', artifacts: [], suggestedQuestions: [],
    };
    const preview = {
      requestId: 'request-1', runId: 'run-1', sequence: 1,
      type: 'STRUCTURED_OUTPUT_DELTA', payload: { delta: '{"conclusion":"结' },
    };
    const events = [
      preview,
      { requestId: 'request-1', runId: 'run-1', sequence: 2, type: 'FINAL_ANSWER', payload: { answer } },
      { requestId: 'request-1', runId: 'run-1', sequence: 3, type: 'COMPLETED', payload: {} },
    ];

    await expect(collect(clientForEvents(events).run(answerRequest))).resolves.toHaveLength(3);

    const routeEvents = [
      preview,
      { requestId: 'request-1', runId: 'run-1', sequence: 2, type: 'ROUTE_DECISION', payload: {
        decision: routeDecision(),
      } },
      { requestId: 'request-1', runId: 'run-1', sequence: 3, type: 'COMPLETED', payload: {} },
    ];
    await expect(collect(clientForEvents(routeEvents).run(request)))
      .rejects.toMatchObject({ code: 'BRIDGE_OUTPUT_KIND_INVALID' });
  });

  it('sends schema-validated cancel and steer commands without callers supplying credentials', async () => {
    const requestBodies: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(String(init?.body));
      return new Response(JSON.stringify({ status: 'accepted' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = new HttpAgentRuntimeClient({
      baseUrl: 'http://127.0.0.1:3010', token: 'x'.repeat(32), fetchImpl,
    });

    await client.cancel('run-1');
    await client.steer('run-1', 2, '请聚焦流程证据。');

    const cancelBody = JSON.parse(requestBodies[0]!) as Record<string, unknown>;
    const steerBody = JSON.parse(requestBodies[1]!) as Record<string, unknown>;
    expect(cancelBody).toMatchObject({ type: 'CANCEL', runId: 'run-1' });
    expect(steerBody).toMatchObject({
      type: 'STEER', runId: 'run-1', planVersion: 2, instruction: '请聚焦流程证据。',
    });
    expect(cancelBody.requestId).toEqual(expect.any(String));
    expect(steerBody.requestId).toEqual(expect.any(String));
  });
});

function bridgeEvents(): BridgeEventV1[] {
  return [
    BridgeEventV1Schema.parse({
      requestId: 'request-1', runId: 'run-1', sequence: 1,
      type: 'THREAD_BOUND', payload: { threadId: 'thread-1' },
    }),
    BridgeEventV1Schema.parse({
      requestId: 'request-1', runId: 'run-1', sequence: 2,
      type: 'COMMENTARY', payload: { text: '正在检查花式纱分类。' },
    }),
    BridgeEventV1Schema.parse({
      requestId: 'request-1', runId: 'run-1', sequence: 3,
      type: 'FAILED', payload: { code: 'TEST_FAILURE', message: '测试终止。', retryable: true },
    }),
  ];
}

function clientForEvents(events: readonly unknown[]): HttpAgentRuntimeClient {
  return new HttpAgentRuntimeClient({
    baseUrl: 'http://127.0.0.1:3010', token: 'x'.repeat(32),
    fetchImpl: async () => responseFromChunks([
      new TextEncoder().encode(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`),
    ]),
  });
}

function responseFromChunks(chunks: readonly Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

async function collect(events: AsyncIterable<BridgeEventV1>): Promise<BridgeEventV1[]> {
  const result: BridgeEventV1[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function routeDecision() {
  return {
    intent: '直接回答',
    complexity: { scopeBreadth: 1, evidenceDepth: 1, crossSourceNeed: 1, decompositionNeed: 1, ambiguity: 1 },
    contextAssessment: '无需检索。',
    route: 'DIRECT',
    sources: { workspaceFlows: false, workspaceDocuments: false, sessionAttachments: false, santexwell: false },
    tasks: [],
    budget: {
      maxWorkers: 0, maxConcurrency: 1, maxWorkspaceCandidates: 0, maxFlowHops: 0,
      maxVaultClusters: 0, maxVaultDigests: 0, allowRaw: false, useReducer: false,
    },
    executionMode: 'SEQUENTIAL', maxConcurrency: 1,
    stopConditions: ['回答完成'], confidence: 1, userFacingPlan: '直接回答。',
  };
}

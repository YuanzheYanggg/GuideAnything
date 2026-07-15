import type { AgentRunEventV1 } from '@guideanything/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../lib/api';
import {
  agentRunReducer,
  createAgentRunState,
  decodeAgentEventStream,
} from './useAgentRunStream';

describe('agent run stream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  it('decodes split UTF-8 chunks, multiple events, and heartbeat comments', async () => {
    const source = [
      ': heartbeat\n\n',
      sse(event(1, 'route.started', { intent: '检查花式纱' })),
      sse(event(2, 'route.completed', { route: 'FOCUSED', userFacingPlan: '先定位概念页。' })),
    ].join('');
    const bytes = new TextEncoder().encode(source);
    const splitAt = source.indexOf('式') + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt, splitAt + 2));
        controller.enqueue(bytes.slice(splitAt + 2));
        controller.close();
      },
    });

    const decoded: AgentRunEventV1[] = [];
    for await (const item of decodeAgentEventStream(stream)) decoded.push(item);

    expect(decoded.map((item) => item.sequence)).toEqual([1, 2]);
    expect(decoded[0]).toMatchObject({ payload: { intent: '检查花式纱' } });
  });

  it('deduplicates sequence and drops stale provisional plan versions', () => {
    let state = createAgentRunState();
    state = agentRunReducer(state, event(1, 'route.completed', { route: 'FOCUSED', userFacingPlan: '旧计划' }, 1));
    state = agentRunReducer(state, event(2, 'answer.draft.delta', { delta: '旧草稿' }, 1));
    state = agentRunReducer(state, event(3, 'route.completed', { route: 'COMPOSITE', userFacingPlan: '新计划' }, 2));
    state = agentRunReducer(state, event(4, 'answer.draft.delta', { delta: '不应显示' }, 1, true));
    state = agentRunReducer(state, event(4, 'answer.draft.delta', { delta: '重复' }, 2));
    state = agentRunReducer(state, event(5, 'answer.draft.delta', { delta: '新草稿' }, 2));

    expect(state.planVersion).toBe(2);
    expect(state.route).toBe('COMPOSITE');
    expect(state.userFacingPlan).toBe('新计划');
    expect(state.draft).toBe('新草稿');
    expect(state.lastSequence).toBe(5);
  });

  it('never promotes a provisional draft into the committed answer', () => {
    const answer = {
      mode: 'ANSWER' as const,
      conclusion: '花式纱可按结构、成纱方式和视觉效果分类。',
      sections: [], evidenceStatus: 'SUPPORTED' as const, citations: [], flowFeedback: [], artifacts: [], suggestedQuestions: [],
    };
    let state = createAgentRunState();
    state = agentRunReducer(state, event(1, 'answer.draft.delta', { delta: '暂定结论' }));
    state = agentRunReducer(state, event(2, 'answer.committed', { answer }, 1, false, 'COMMITTED'));

    expect(state.draft).toBe('暂定结论');
    expect(state.answer?.conclusion).toBe(answer.conclusion);
    expect(state.answer?.conclusion).not.toBe(state.draft);
  });

  it('rejects an SSE id that does not match the validated event sequence', async () => {
    const payload = event(2, 'route.started', { intent: '检查流程' });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`id: 1\nevent: route.started\ndata: ${JSON.stringify(payload)}\n\n`));
        controller.close();
      },
    });

    await expect(async () => {
      for await (const _item of decodeAgentEventStream(stream)) {
        // consume
      }
    }).rejects.toThrow('SSE event id');
  });

  it('reconnects with Last-Event-ID and stops at the terminal event', async () => {
    localStorage.setItem('guideanything-token', 'private-token');
    const first = event(1, 'route.started', { intent: '检查流程' });
    const terminal = event(2, 'run.completed', { messageId: 'message-1' }, 1, false, 'COMMITTED');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(first))
      .mockResolvedValueOnce(sseResponse(terminal));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const received: AgentRunEventV1[] = [];

    for await (const item of new ApiClient().agentApi().streamRun('/agent-runs/run-1/events', { signal: controller.signal })) {
      received.push(item);
    }

    expect(received.map((item) => item.sequence)).toEqual([1, 2]);
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(firstHeaders.get('Authorization')).toBe('Bearer private-token');
    expect(firstHeaders.get('Last-Event-ID')).toBeNull();
    expect(secondHeaders.get('Last-Event-ID')).toBe('1');
  });
});

function event<T extends AgentRunEventV1['type']>(
  sequence: number,
  type: T,
  payload: Extract<AgentRunEventV1, { type: T }>['payload'],
  planVersion = 1,
  stale = false,
  phase: AgentRunEventV1['phase'] = type === 'answer.committed' ? 'COMMITTED' : 'PROVISIONAL',
): Extract<AgentRunEventV1, { type: T }> {
  return {
    id: `event-${sequence}`,
    runId: 'run-1',
    sequence,
    planVersion,
    phase,
    type,
    payload,
    ...(phase === 'PROVISIONAL' && stale ? { stale: true } : {}),
    createdAt: `2026-07-15T00:00:0${sequence}.000Z`,
  } as Extract<AgentRunEventV1, { type: T }>;
}

function sse(item: AgentRunEventV1) {
  return `id: ${item.sequence}\nevent: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`;
}

function sseResponse(item: AgentRunEventV1) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse(item)));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

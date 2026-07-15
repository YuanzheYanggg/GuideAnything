import {
  BridgeEventV1Schema,
  type AgentInternalAnswerV1,
  type BridgeEventV1,
  type BridgeRunRequestV1,
} from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import type { AgentRuntimeClient } from './runtime-client';
import { AgentInvocationError, runFinalAnswer, runRouteDecision } from './typed-runtime';

const answer: AgentInternalAnswerV1 = {
  mode: 'ANSWER',
  conclusion: '完整结论',
  sections: [],
  evidence: [],
  flowFeedback: [],
  evidenceStatus: 'INSUFFICIENT',
  artifacts: [],
  suggestedQuestions: [],
};

describe('typed runtime answer previews', () => {
  it('forwards only schema-bound answer preview deltas before the validated answer', async () => {
    const previews: string[] = [];
    const result = await runFinalAnswer(
      runtime([
        event(1, 'THREAD_BOUND', { threadId: 'thread-1' }),
        event(2, 'COMMENTARY', { text: 'private reasoning' }),
        event(3, 'STRUCTURED_OUTPUT_DELTA', { delta: '{"conclusion":"完整' }),
        event(4, 'STRUCTURED_OUTPUT_DELTA', { delta: '结论"}' }),
        event(5, 'FINAL_ANSWER', { answer }),
        event(6, 'COMPLETED', {}),
      ]),
      request('ANSWER'),
      undefined,
      (delta) => previews.push(delta),
    );

    expect(result).toEqual(answer);
    expect(previews).toEqual(['{"conclusion":"完整', '结论"}']);
    expect(previews.join('')).not.toContain('private reasoning');
  });

  it('rejects answer preview events for a non-answer invocation', async () => {
    await expect(runRouteDecision(
      runtime([event(1, 'STRUCTURED_OUTPUT_DELTA', { delta: 'wrong kind' })]),
      request('ROUTE_DECISION'),
    )).rejects.toBeInstanceOf(AgentInvocationError);
  });
});

function request<TOutput extends 'ANSWER' | 'ROUTE_DECISION'>(
  outputKind: TOutput,
): BridgeRunRequestV1 & { outputKind: TOutput } {
  return {
    type: 'RUN',
    requestId: 'request-1',
    runId: 'run-1',
    planVersion: 1,
    role: outputKind === 'ANSWER' ? 'FOCUSED_WORKER' : 'ROUTER',
    reasoningEffort: 'MEDIUM',
    outputKind,
    prompt: 'prompt',
    allowedRoots: [],
  };
}

function event<TType extends BridgeEventV1['type']>(
  sequence: number,
  type: TType,
  payload: Extract<BridgeEventV1, { type: TType }>['payload'],
): BridgeEventV1 {
  return BridgeEventV1Schema.parse({
    requestId: 'request-1', runId: 'run-1', sequence, type, payload,
  });
}

function runtime(events: readonly BridgeEventV1[]): AgentRuntimeClient {
  return {
    async *run() { yield* events; },
    async cancel() {},
    async steer() {},
  };
}

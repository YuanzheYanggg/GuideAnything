import {
  AgentInternalAnswerV1Schema,
  GuideDigestDraftV1Schema,
  RouteDecisionV1Schema,
  TaskFindingV1Schema,
  type AgentInternalAnswerV1,
  type BridgeEventV1,
  type BridgeRunRequestV1,
  type GuideDigestDraftV1,
  type RouteDecisionV1,
  type TaskFindingV1,
} from '@guideanything/contracts';

import type { AgentRuntimeClient } from './runtime-client';

export class AgentInvocationError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super('只读 Agent Runtime 调用失败');
    this.name = 'AgentInvocationError';
  }
}

/**
 * Consumes the private Runtime Bridge protocol and returns only schema-bound output.
 * COMMENTARY is intentionally discarded: it may contain private model reasoning and
 * must never be forwarded to the public run event stream.
 */
export async function runRouteDecision(
  runtime: AgentRuntimeClient,
  request: BridgeRunRequestV1 & { outputKind: 'ROUTE_DECISION' },
  signal?: AbortSignal,
): Promise<RouteDecisionV1> {
  return consumeTypedOutput(
    runtime,
    request,
    'ROUTE_DECISION',
    (event) => RouteDecisionV1Schema.parse(event.payload.decision),
    signal,
  );
}

export async function runTaskFinding(
  runtime: AgentRuntimeClient,
  request: BridgeRunRequestV1 & { outputKind: 'TASK_FINDING' },
  signal?: AbortSignal,
): Promise<TaskFindingV1> {
  return consumeTypedOutput(
    runtime,
    request,
    'TASK_FINDING',
    (event) => TaskFindingV1Schema.parse(event.payload.finding),
    signal,
  );
}

export async function runFinalAnswer(
  runtime: AgentRuntimeClient,
  request: BridgeRunRequestV1 & { outputKind: 'ANSWER' },
  signal?: AbortSignal,
  onStructuredOutputDelta?: (delta: string) => void,
): Promise<AgentInternalAnswerV1> {
  return consumeTypedOutput(
    runtime,
    request,
    'FINAL_ANSWER',
    (event) => AgentInternalAnswerV1Schema.parse(event.payload.answer),
    signal,
    onStructuredOutputDelta,
  );
}

export async function invokeGuideDigestRuntime(
  runtime: AgentRuntimeClient,
  request: BridgeRunRequestV1,
): Promise<GuideDigestDraftV1> {
  return consumeTypedOutput(
    runtime,
    request,
    'GUIDE_DIGEST',
    (event) => GuideDigestDraftV1Schema.parse(event.payload.digest),
  );
}

async function consumeTypedOutput<
  TType extends 'ROUTE_DECISION' | 'TASK_FINDING' | 'FINAL_ANSWER' | 'GUIDE_DIGEST',
  TResult,
>(
  runtime: AgentRuntimeClient,
  request: BridgeRunRequestV1,
  expectedType: TType,
  project: (event: Extract<BridgeEventV1, { type: TType }>) => TResult,
  signal?: AbortSignal,
  onStructuredOutputDelta?: (delta: string) => void,
): Promise<TResult> {
  let output: TResult | undefined;
  let completed = false;
  for await (const event of runtime.run(request, signal)) {
    if (completed) throw new AgentInvocationError('BRIDGE_TRAILING_EVENT', true);
    if (event.type === 'THREAD_BOUND' || event.type === 'COMMENTARY') continue;
    if (event.type === 'STRUCTURED_OUTPUT_DELTA') {
      if (expectedType !== 'FINAL_ANSWER' || output !== undefined) {
        throw new AgentInvocationError('BRIDGE_OUTPUT_KIND_INVALID', true);
      }
      onStructuredOutputDelta?.(event.payload.delta);
      continue;
    }
    if (event.type === 'FAILED') {
      throw new AgentInvocationError(event.payload.code, event.payload.retryable);
    }
    if (event.type === 'COMPLETED') {
      if (output === undefined) throw new AgentInvocationError('BRIDGE_OUTPUT_MISSING', true);
      completed = true;
      continue;
    }
    if (event.type !== expectedType || output !== undefined) {
      throw new AgentInvocationError('BRIDGE_OUTPUT_KIND_INVALID', true);
    }
    output = project(event as Extract<BridgeEventV1, { type: TType }>);
  }
  if (!completed || output === undefined) {
    throw new AgentInvocationError('BRIDGE_STREAM_INCOMPLETE', true);
  }
  return output;
}

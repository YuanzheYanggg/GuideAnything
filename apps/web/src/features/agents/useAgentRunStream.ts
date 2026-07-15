import {
  AgentRunEventV1Schema,
  type AgentCommittedAnswerV1,
  type AgentRunEventV1,
  type ArtifactV1,
  type CitationV1,
  type PublicRoutePlanV1,
  type PublicTaskFindingV1,
} from '@guideanything/contracts';
import { useEffect, useReducer } from 'react';

export interface AgentRunTaskState {
  id: string;
  label: string;
  sourceKind?: PublicRoutePlanV1['tasks'][number]['sourceKind'];
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  progressMessage?: string;
  progress?: number;
  finding?: PublicTaskFindingV1;
}

export interface AgentRunViewState {
  lastSequence: number;
  planVersion: number;
  route: PublicRoutePlanV1['route'] | null;
  userFacingPlan: string;
  executionMode: PublicRoutePlanV1['executionMode'] | null;
  tasks: AgentRunTaskState[];
  draft: string;
  answer: AgentCommittedAnswerV1 | null;
  citations: CitationV1[];
  artifacts: ArtifactV1[];
  status: 'IDLE' | 'CONNECTING' | 'ROUTING' | 'RUNNING' | 'VALIDATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  error: string;
}

type StreamAction = AgentRunEventV1 | { type: 'viewer.reset' } | { type: 'viewer.connecting' } | { type: 'viewer.error'; message: string };

export function createAgentRunState(): AgentRunViewState {
  return {
    lastSequence: 0,
    planVersion: 0,
    route: null,
    userFacingPlan: '',
    executionMode: null,
    tasks: [],
    draft: '',
    answer: null,
    citations: [],
    artifacts: [],
    status: 'IDLE',
    error: '',
  };
}

export function agentRunReducer(state: AgentRunViewState, action: StreamAction): AgentRunViewState {
  if (action.type === 'viewer.reset') return createAgentRunState();
  if (action.type === 'viewer.connecting') return { ...state, status: state.lastSequence > 0 ? state.status : 'CONNECTING', error: '' };
  if (action.type === 'viewer.error') return { ...state, error: action.message, status: isTerminalStatus(state.status) ? state.status : 'FAILED' };
  if (action.sequence <= state.lastSequence) return state;

  const latest = { ...state, lastSequence: action.sequence };
  if (action.phase === 'PROVISIONAL' && (action.stale === true || action.planVersion < state.planVersion)) return latest;
  const next = action.planVersion > state.planVersion
    ? { ...latest, planVersion: action.planVersion, route: null, userFacingPlan: '', executionMode: null, tasks: [], draft: '' }
    : latest;

  switch (action.type) {
    case 'route.started':
      return { ...next, status: 'ROUTING' };
    case 'route.completed':
      return { ...next, route: action.payload.route, userFacingPlan: action.payload.userFacingPlan, status: 'ROUTING' };
    case 'plan.committed':
      return {
        ...next,
        route: action.payload.plan.route,
        userFacingPlan: action.payload.plan.userFacingPlan,
        executionMode: action.payload.plan.executionMode,
        tasks: action.payload.plan.tasks.map((task) => ({
          id: task.id,
          label: task.label,
          sourceKind: task.sourceKind,
          status: task.status ?? 'PENDING',
        })),
        status: 'RUNNING',
      };
    case 'task.started':
      return { ...next, tasks: upsertTask(next.tasks, action.payload.taskId, { label: action.payload.label, status: 'RUNNING' }), status: 'RUNNING' };
    case 'task.progress':
      return { ...next, tasks: upsertTask(next.tasks, action.payload.taskId, { progressMessage: action.payload.message, ...(action.payload.progress === undefined ? {} : { progress: action.payload.progress }) }) };
    case 'task.finding':
      return { ...next, tasks: upsertTask(next.tasks, action.payload.finding.taskId, { finding: action.payload.finding }) };
    case 'task.completed':
      return { ...next, tasks: upsertTask(next.tasks, action.payload.taskId, { status: action.payload.status === 'NO_EVIDENCE' ? 'SKIPPED' : action.payload.status === 'CONFLICT' ? 'FAILED' : 'COMPLETED' }) };
    case 'reduce.started':
      return { ...next, status: 'RUNNING' };
    case 'answer.draft.delta':
      return { ...next, draft: `${next.draft}${action.payload.delta}`, status: 'RUNNING' };
    case 'answer.validating':
      return { ...next, status: 'VALIDATING' };
    case 'citation.committed':
      return { ...next, citations: replaceById(next.citations, action.payload.citation, 'referenceId') };
    case 'artifact.committed':
      return { ...next, artifacts: replaceById(next.artifacts, action.payload.artifact, 'id') };
    case 'answer.committed':
      return { ...next, answer: action.payload.answer, citations: action.payload.answer.citations, artifacts: action.payload.answer.artifacts, status: 'VALIDATING' };
    case 'run.completed':
      return { ...next, status: 'COMPLETED' };
    case 'run.failed':
      return { ...next, status: 'FAILED', error: action.payload.message };
    case 'run.cancelled':
      return { ...next, status: 'CANCELLED', error: action.payload.reason ?? '' };
  }
}

export function useAgentRunStream(
  eventsPath: string | null,
  stream: (eventsPath: string, options: { afterSequence?: number; signal: AbortSignal }) => AsyncIterable<AgentRunEventV1>,
) {
  const [state, dispatch] = useReducer(agentRunReducer, undefined, createAgentRunState);
  useEffect(() => {
    if (!eventsPath) return;
    const controller = new AbortController();
    dispatch({ type: 'viewer.reset' });
    dispatch({ type: 'viewer.connecting' });
    void (async () => {
      try {
        for await (const event of stream(eventsPath, { afterSequence: 0, signal: controller.signal })) {
          dispatch(event);
        }
      } catch (reason: unknown) {
        if (!controller.signal.aborted) dispatch({ type: 'viewer.error', message: reason instanceof Error ? reason.message : '事件流连接失败' });
      }
    })();
    return () => controller.abort();
    // Only reconnect when the authoritative events path changes. The API stream owns retry and sequence resumption.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsPath, stream]);
  return state;
}

export async function* decodeAgentEventStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<AgentRunEventV1> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n?/gu, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseBlock(block);
        if (parsed) yield parsed;
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): AgentRunEventV1 | null {
  const lines = block.split('\n');
  if (lines.every((line) => line === '' || line.startsWith(':'))) return null;
  let eventId: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /u, '');
    if (field === 'id') eventId = value;
    if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  const event = AgentRunEventV1Schema.parse(JSON.parse(data.join('\n')));
  if (eventId !== undefined && eventId !== String(event.sequence)) throw new Error('SSE event id does not match event sequence');
  return event;
}

function upsertTask(tasks: AgentRunTaskState[], id: string, patch: Partial<AgentRunTaskState>): AgentRunTaskState[] {
  const existing = tasks.find((task) => task.id === id);
  const next: AgentRunTaskState = existing
    ? { ...existing, ...patch }
    : { id, label: patch.label ?? '执行任务', status: patch.status ?? 'PENDING', ...patch };
  return existing ? tasks.map((task) => task.id === id ? next : task) : [...tasks, next];
}

function replaceById<T, K extends keyof T>(items: T[], item: T, key: K): T[] {
  return items.some((candidate) => candidate[key] === item[key])
    ? items.map((candidate) => candidate[key] === item[key] ? item : candidate)
    : [...items, item];
}

function isTerminalStatus(status: AgentRunViewState['status']) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

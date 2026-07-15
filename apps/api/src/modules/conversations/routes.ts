import {
  SendConversationMessageRequestV1Schema,
  SendGlobalConversationMessageRequestV1Schema,
} from '@guideanything/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { httpError } from '../../lib/http-error';
import { RunEventBroker, streamPersistedRunEvents } from './events';
import { getRunSnapshotForOwner } from './repository';
import { ConversationService } from './service';

export interface ConversationRouteRuntime {
  broker: RunEventBroker;
  scheduleRun: (runId: string) => Promise<void>;
  onScheduleError?: (runId: string, error: unknown) => void;
}

const ConversationParamsSchema = z.object({
  conversationId: z.string().min(1).max(200),
}).strict();
const WorkspaceConversationParamsSchema = ConversationParamsSchema.extend({
  workspaceId: z.string().min(1).max(200),
}).strict();
const RunParamsSchema = z.object({ runId: z.string().min(1).max(200) }).strict();
const CreateConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

export async function registerConversationRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  runtime: ConversationRouteRuntime,
): Promise<void> {
  const service = new ConversationService(database);

  app.get('/api/knowledge/santexwell/conversations', {
    preHandler: app.authenticateRequest,
  }, async (request) => ({ items: service.listGlobal(request.authUser!.id) }));

  app.post('/api/knowledge/santexwell/conversations', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const body = parseOrThrow(CreateConversationBodySchema, request.body);
    return reply.code(201).send({ conversation: service.createGlobal(request.authUser!.id, body.title) });
  });

  app.get('/api/knowledge/santexwell/conversations/:conversationId', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(ConversationParamsSchema, request.params);
    return { conversation: service.readGlobal(request.authUser!.id, params.conversationId) };
  });

  app.post('/api/knowledge/santexwell/conversations/:conversationId/messages', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const params = parseOrThrow(ConversationParamsSchema, request.params);
    const body = parseOrThrow(SendGlobalConversationMessageRequestV1Schema, request.body);
    const result = service.sendGlobal(request.authUser!.id, params.conversationId, body);
    scheduleIfNew(result.created, result.accepted.run.id, runtime);
    return reply.code(202).send(result.accepted);
  });

  app.get('/api/workspaces/:workspaceId/conversations', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(z.object({ workspaceId: z.string().min(1).max(200) }).strict(), request.params);
    return { items: service.listWorkspace(request.authUser!.id, params.workspaceId) };
  });

  app.post('/api/workspaces/:workspaceId/conversations', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const params = parseOrThrow(z.object({ workspaceId: z.string().min(1).max(200) }).strict(), request.params);
    const body = parseOrThrow(CreateConversationBodySchema, request.body);
    return reply.code(201).send({
      conversation: service.createWorkspace(request.authUser!.id, params.workspaceId, body.title),
    });
  });

  app.get('/api/workspaces/:workspaceId/conversations/:conversationId', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(WorkspaceConversationParamsSchema, request.params);
    return {
      conversation: service.readWorkspace(
        request.authUser!.id,
        params.workspaceId,
        params.conversationId,
      ),
    };
  });

  app.post('/api/workspaces/:workspaceId/conversations/:conversationId/messages', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const params = parseOrThrow(WorkspaceConversationParamsSchema, request.params);
    const body = parseOrThrow(SendConversationMessageRequestV1Schema, request.body);
    const result = service.sendWorkspace(
      request.authUser!.id,
      params.workspaceId,
      params.conversationId,
      body,
    );
    scheduleIfNew(result.created, result.accepted.run.id, runtime);
    return reply.code(202).send(result.accepted);
  });

  app.get('/api/agent-runs/:runId', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(RunParamsSchema, request.params);
    const run = getRunSnapshotForOwner(database, params.runId, request.authUser!.id);
    if (!run) throw httpError(404, 'RUN_NOT_FOUND', '运行不存在');
    return { run };
  });

  app.get('/api/agent-runs/:runId/events', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const params = parseOrThrow(RunParamsSchema, request.params);
    const run = getRunSnapshotForOwner(database, params.runId, request.authUser!.id);
    if (!run) throw httpError(404, 'RUN_NOT_FOUND', '运行不存在');
    const afterSequence = parseLastEventId(request.headers['last-event-id']);
    await sendEventStream(reply, database, runtime.broker, run.id, afterSequence);
  });
}

function scheduleIfNew(created: boolean, runId: string, runtime: ConversationRouteRuntime): void {
  if (!created) return;
  queueMicrotask(() => {
    void Promise.resolve()
      .then(() => runtime.scheduleRun(runId))
      .catch((error) => runtime.onScheduleError?.(runId, error));
  });
}

function parseLastEventId(value: string | string[] | undefined): number {
  if (value === undefined) return 0;
  if (Array.isArray(value) || !/^[1-9]\d*$/u.test(value)) {
    throw httpError(400, 'INVALID_LAST_EVENT_ID', 'Last-Event-ID 必须是正整数');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw httpError(400, 'INVALID_LAST_EVENT_ID', 'Last-Event-ID 超出安全范围');
  }
  return parsed;
}

async function sendEventStream(
  reply: FastifyReply,
  database: DatabaseSync,
  broker: RunEventBroker,
  runId: string,
  afterSequence: number,
): Promise<void> {
  reply.hijack();
  const response = reply.raw;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const abortController = new AbortController();
  response.once('close', () => abortController.abort());
  const iterator = streamPersistedRunEvents(
    database,
    broker,
    runId,
    afterSequence,
    abortController.signal,
  )[Symbol.asyncIterator]();
  let pending = iterator.next();
  try {
    while (!abortController.signal.aborted) {
      const result = await raceWithHeartbeat(pending, 15_000);
      if (result === 'heartbeat') {
        await writeChunk(response, ': heartbeat\n\n');
        continue;
      }
      if (result.done) break;
      await writeChunk(
        response,
        `id: ${result.value.sequence}\nevent: ${result.value.type}\ndata: ${JSON.stringify(result.value)}\n\n`,
      );
      pending = iterator.next();
    }
  } finally {
    abortController.abort();
    await iterator.return?.(undefined);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

async function raceWithHeartbeat<T>(
  pending: Promise<IteratorResult<T>>,
  heartbeatMs: number,
): Promise<IteratorResult<T> | 'heartbeat'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<'heartbeat'>((resolve) => {
        timer = setTimeout(() => resolve('heartbeat'), heartbeatMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeChunk(response: ServerResponse, chunk: string): Promise<void> {
  if (response.destroyed || response.writableEnded) return;
  if (!response.write(chunk)) await once(response, 'drain');
}

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw httpError(400, 'VALIDATION_ERROR', '请求数据格式不正确', result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  })));
}

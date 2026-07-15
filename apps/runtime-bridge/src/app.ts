import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  BridgeCancelRequestV1Schema,
  BridgeEventV1Schema,
  BridgeRunRequestV1Schema,
  BridgeSteerRequestV1Schema,
  type BridgeRunRequestV1,
} from '@guideanything/contracts';

import { CodexRuntimeError } from './codex-client';
import type { RuntimeBridgeConfig } from './config';
import type { CodexRunHandle, RuntimeHealth } from './types';

export interface RuntimeController {
  getHealth(): RuntimeHealth;
  startRun(request: BridgeRunRequestV1): Promise<CodexRunHandle>;
}

export interface RuntimeBridgeAppOptions {
  readonly config: RuntimeBridgeConfig;
  readonly runtime: RuntimeController;
}

export function createRuntimeBridgeApp(options: RuntimeBridgeAppOptions): FastifyInstance {
  const { config, runtime } = options;
  const activeRuns = new Map<string, CodexRunHandle>();
  const app = Fastify({
    logger: false,
    bodyLimit: config.bodyLimitBytes,
    requestIdHeader: false,
  });

  app.setErrorHandler((error, _request, reply) => {
    const status = normalizeHttpErrorStatus(
      typeof error === 'object' && error !== null && 'statusCode' in error
        && typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined,
    );
    void reply.code(status).send({
      code: status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      retryable: status >= 500,
    });
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?', 1)[0] === '/health') return;
    if (!matchesBridgeBearerToken(request.headers.authorization, config.bridgeToken)) {
      await reply.code(401).send({ code: 'UNAUTHORIZED', retryable: false });
      return reply;
    }
    if (request.method === 'POST' && !isApplicationJson(request.headers['content-type'])) {
      await reply.code(415).send({ code: 'UNSUPPORTED_MEDIA_TYPE', retryable: false });
      return reply;
    }
  });

  app.get('/health', async (_request, reply) => {
    const health = runtime.getHealth();
    const roles = Object.fromEntries(Object.entries(health.roles).map(([role, value]) => [
      role,
      { ready: value.ready, requiredEffort: value.requiredEffort },
    ]));
    return await reply.code(200).send({
      status: health.status,
      roles,
      reasonCodes: health.reasonCodes,
    });
  });

  app.post('/v1/generate', async (request, reply) => {
    const parsed = BridgeRunRequestV1Schema.safeParse(request.body);
    if (!parsed.success) return await reply.code(400).send({ code: 'INVALID_REQUEST', retryable: false });

    let run: CodexRunHandle;
    try {
      run = await runtime.startRun(parsed.data);
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
    activeRuns.set(run.runId, run);

    let naturallyCompleted = false;
    let cancellationRequested = false;
    const cancelOnce = () => {
      if (naturallyCompleted || cancellationRequested) return;
      cancellationRequested = true;
      void run.cancel().catch(() => undefined);
    };
    reply.raw.once('close', cancelOnce);

    const stream = Readable.from((async function* () {
      let lastSequence = 0;
      let sawTerminal = false;
      try {
        for await (const candidate of run.events) {
          const event = BridgeEventV1Schema.parse(candidate);
          if (
            event.requestId !== run.requestId
            || event.runId !== run.runId
            || event.sequence !== lastSequence + 1
          ) {
            throw new Error('runtime event ownership or sequence mismatch');
          }
          lastSequence = event.sequence;
          yield `${JSON.stringify(event)}\n`;
          if (event.type === 'COMPLETED' || event.type === 'FAILED') {
            sawTerminal = true;
            break;
          }
        }
        if (!sawTerminal) {
          const failed = BridgeEventV1Schema.parse({
            requestId: run.requestId,
            runId: run.runId,
            sequence: lastSequence + 1,
            type: 'FAILED',
            payload: {
              code: 'BRIDGE_STREAM_INCOMPLETE',
              message: 'Runtime event stream ended before a terminal event.',
              retryable: true,
            },
          });
          yield `${JSON.stringify(failed)}\n`;
        }
        naturallyCompleted = true;
      } catch {
        const failed = BridgeEventV1Schema.parse({
          requestId: run.requestId,
          runId: run.runId,
          sequence: lastSequence + 1,
          type: 'FAILED',
          payload: {
            code: 'BRIDGE_STREAM_ERROR',
            message: 'Runtime event stream ended unexpectedly.',
            retryable: true,
          },
        });
        yield `${JSON.stringify(failed)}\n`;
        naturallyCompleted = true;
      } finally {
        activeRuns.delete(run.runId);
        reply.raw.off('close', cancelOnce);
        if (!naturallyCompleted) cancelOnce();
      }
    })());

    return await reply
      .code(200)
      .header('content-type', 'application/x-ndjson; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(stream);
  });

  app.post('/v1/cancel', async (request, reply) => {
    const parsed = BridgeCancelRequestV1Schema.safeParse(request.body);
    if (!parsed.success) return await reply.code(400).send({ code: 'INVALID_REQUEST', retryable: false });
    const run = activeRuns.get(parsed.data.runId);
    if (run) {
      try {
        await run.cancel();
      } catch {
        // Cancellation is deliberately idempotent and does not expose runtime state.
      }
    }
    return await reply.code(202).send({ status: 'accepted' });
  });

  app.post('/v1/steer', async (request, reply) => {
    const parsed = BridgeSteerRequestV1Schema.safeParse(request.body);
    if (!parsed.success) return await reply.code(400).send({ code: 'INVALID_REQUEST', retryable: false });
    const run = activeRuns.get(parsed.data.runId);
    if (!run) return await reply.code(409).send({ code: 'RUN_NOT_ACTIVE', retryable: false });
    try {
      await run.steer(parsed.data.planVersion, parsed.data.instruction);
    } catch (error) {
      return sendRuntimeError(reply, error, 409);
    }
    return await reply.code(202).send({ status: 'accepted' });
  });

  return app;
}

export function matchesBridgeBearerToken(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  const prefix = 'Bearer ';
  const supplied = authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : '';
  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expectedToken, 'utf8').digest();
  return timingSafeEqual(suppliedDigest, expectedDigest)
    && authorization?.startsWith(prefix) === true;
}

function isApplicationJson(contentType: string | undefined): boolean {
  return contentType !== undefined
    && /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType.trim());
}

function normalizeHttpErrorStatus(statusCode: number | undefined): number {
  if (statusCode === 400 || statusCode === 413 || statusCode === 415) return statusCode;
  return 500;
}

function sendRuntimeError(
  reply: FastifyReply,
  error: unknown,
  fallbackStatus = 503,
) {
  if (error instanceof CodexRuntimeError) {
    const status = error.code === 'CALLER_ROOTS_FORBIDDEN' || error.code === 'EFFORT_ROLE_MISMATCH'
      ? 400
      : error.code === 'CONCURRENCY_LIMIT'
        ? 429
        : error.code === 'RUN_ALREADY_ACTIVE' || error.code === 'THREAD_ALREADY_ACTIVE'
          ? 409
          : fallbackStatus;
    return reply.code(status).send({ code: error.code, retryable: error.retryable });
  }
  return reply.code(fallbackStatus).send({ code: 'RUNTIME_UNAVAILABLE', retryable: true });
}

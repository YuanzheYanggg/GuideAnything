import { UpdateFlowRegressionCaseStatusRequestV1Schema } from '@guideanything/contracts';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { httpError } from '../../lib/http-error';
import type { ConversationRouteRuntime } from '../conversations/routes';
import { FlowRegressionService } from './service';

const ReferenceParamsSchema = z.object({
  referenceId: z.string().min(1).max(200),
}).strict();
const GuideParamsSchema = z.object({
  guideId: z.string().min(1).max(200),
}).strict();
const GuideCaseParamsSchema = GuideParamsSchema.extend({
  caseId: z.string().min(1).max(200),
}).strict();
const RunParamsSchema = z.object({
  runId: z.string().min(1).max(200),
}).strict();

export async function registerFlowRegressionRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  runtime?: ConversationRouteRuntime,
): Promise<void> {
  const service = new FlowRegressionService(database);

  app.get('/api/references/:referenceId/flow-regression-eligibility', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(ReferenceParamsSchema, request.params);
    return { eligibility: service.referenceEligibility(request.authUser!, params.referenceId) };
  });

  app.post('/api/references/:referenceId/flow-regression-cases', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    const params = parseOrThrow(ReferenceParamsSchema, request.params);
    const result = service.createFromReference(request.authUser!, params.referenceId);
    return reply.code(result.created ? 201 : 200).send({ case: result.case });
  });

  app.get('/api/guides/:guideId/flow-regression-cases', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(GuideParamsSchema, request.params);
    return { items: service.listCases(request.authUser!, params.guideId) };
  });

  app.post('/api/guides/:guideId/flow-regression-cases/:caseId/replay', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(GuideCaseParamsSchema, request.params);
    return { case: service.replay(request.authUser!, params.guideId, params.caseId) };
  });

  app.patch('/api/guides/:guideId/flow-regression-cases/:caseId/status', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(GuideCaseParamsSchema, request.params);
    const input = parseOrThrow(UpdateFlowRegressionCaseStatusRequestV1Schema, request.body);
    if (input.status !== 'ARCHIVED') throw new Error('unreachable flow regression status');
    return { case: service.archive(request.authUser!, params.guideId, params.caseId) };
  });

  app.post('/api/guides/:guideId/flow-regression-cases/:caseId/real-run', {
    preHandler: app.authenticateRequest,
  }, async (request, reply) => {
    if (!runtime) {
      throw httpError(503, 'AGENT_RUNTIME_UNAVAILABLE', 'Agent Runtime 当前不可用，无法执行真实回归试跑');
    }
    const params = parseOrThrow(GuideCaseParamsSchema, request.params);
    const result = service.createRealRun(request.authUser!, params.guideId, params.caseId);
    scheduleRunSoon(result.run.id, runtime);
    return reply.code(202).send(result);
  });

  app.get('/api/guides/:guideId/flow-annotation-health', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(GuideParamsSchema, request.params);
    return { health: service.annotationHealth(request.authUser!, params.guideId) };
  });

  app.get('/api/agent-runs/:runId/retrieval-diagnostic', {
    preHandler: app.authenticateRequest,
  }, async (request) => {
    const params = parseOrThrow(RunParamsSchema, request.params);
    const diagnostic = service.getRetrievalDiagnostic(request.authUser!, params.runId);
    if (!diagnostic) throw httpError(404, 'RETRIEVAL_DIAGNOSTIC_NOT_FOUND', '检索诊断不存在或无权查看');
    return { diagnostic };
  });
}

function scheduleRunSoon(runId: string, runtime: ConversationRouteRuntime): void {
  queueMicrotask(() => {
    void Promise.resolve()
      .then(() => runtime.scheduleRun(runId))
      .catch((error) => {
        try {
          runtime.onScheduleError?.(runId, error);
        } catch {
          // Scheduling observation must not change the persisted run outcome.
        }
      });
  });
}

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw httpError(400, 'VALIDATION_ERROR', '请求数据格式不正确', result.error.issues.map((issue) => ({
    path: issue.path.join('.'), message: issue.message,
  })));
}

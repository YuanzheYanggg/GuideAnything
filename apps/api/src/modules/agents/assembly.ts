import type { DatabaseSync } from 'node:sqlite';

import type { AppConfig } from '../../config';
import type { ConversationRouteRuntime } from '../conversations/routes';
import { AgentRunEventStore, RunEventBroker } from '../conversations/events';
import { getRunById } from '../conversations/repository';
import { loadAgentRunExecutionContext } from './execution-context';
import { DeterministicFakeAgentRuntimeClient } from './fake-runtime-client';
import {
  AgentOrchestrator,
  type AgentEvidenceResolver,
  type AgentEvidenceRetriever,
  type AgentOrchestratorOptions,
} from './orchestrator';
import { DatabaseAgentOutputCommitter } from './output-committer';
import { HttpAgentRuntimeClient, type AgentRuntimeClient } from './runtime-client';

export interface AgentKnowledgeAdapters {
  retriever: AgentEvidenceRetriever;
  evidenceResolver: AgentEvidenceResolver;
}

export interface CreateAgentRuntimeAssemblyOptions {
  database: DatabaseSync;
  config: AppConfig;
  knowledgeAdapters?: AgentKnowledgeAdapters;
  runtime?: AgentRuntimeClient;
  trustedSantexwellHarness?: AgentOrchestratorOptions['trustedSantexwellHarness'];
}

export function createAgentRuntimeAssembly(
  options: CreateAgentRuntimeAssemblyOptions,
): ConversationRouteRuntime {
  if (!options.knowledgeAdapters) {
    throw new Error('Agent production knowledge adapters must be explicitly provided');
  }
  const runtime = options.runtime ?? createRuntimeClient(options.config);
  const broker = new RunEventBroker();
  const eventStore = new AgentRunEventStore(options.database, broker);
  const orchestrator = new AgentOrchestrator({
    runtime,
    eventStore,
    loadContext: (runId) => loadAgentRunExecutionContext(options.database, runId),
    retriever: options.knowledgeAdapters.retriever,
    evidenceResolver: options.knowledgeAdapters.evidenceResolver,
    outputCommitter: new DatabaseAgentOutputCommitter(options.database),
    configuredMaxConcurrency: options.config.agentConcurrency,
    trustedHarness: [
      '所有网页用户只读；不得写回工作区、知识库、文件系统或外部系统。',
      '只能引用服务端已验证证据；不得泄露本机路径、凭据或隐藏推理。',
    ],
    ...(options.trustedSantexwellHarness
      ? { trustedSantexwellHarness: options.trustedSantexwellHarness }
      : {}),
    timeouts: {
      routerMs: options.config.routerTimeoutMs,
      workerMs: options.config.workerTimeoutMs,
      reducerMs: options.config.reducerTimeoutMs,
      runMs: options.config.runTimeoutMs,
      cancelMs: Math.min(5_000, options.config.routerTimeoutMs),
    },
  });

  const scheduleRun = async (runId: string): Promise<void> => {
    if (orchestrator.isActive(runId)) return;
    await orchestrator.execute(runId);
  };

  return {
    broker,
    scheduleRun,
    close: () => orchestrator.shutdown(),
    async cancelRun(runId, reason) {
      if (orchestrator.isActive(runId)) {
        await orchestrator.cancel(runId, reason);
        return;
      }
      const run = getRunById(options.database, runId);
      if (!run) throw new Error('运行不存在');
      eventStore.append({
        runId,
        planVersion: run.plan_version,
        phase: 'COMMITTED',
        type: 'run.cancelled',
        payload: { ...(reason?.trim() ? { reason: reason.trim().slice(0, 2_000) } : {}) },
      });
    },
    async steerRun(runId, planVersion, instruction) {
      if (orchestrator.isActive(runId)) {
        await orchestrator.steer(runId, planVersion, instruction);
        return;
      }
      queueMicrotask(() => { void scheduleRun(runId); });
    },
  };
}

/**
 * Explicit integration placeholder used until the knowledge-index branch supplies
 * the database-backed retriever and resolver. Every access fails closed.
 */
export function createUnavailableKnowledgeAdapters(): AgentKnowledgeAdapters {
  const unavailable = () => {
    throw new Error('Agent knowledge adapters are unavailable');
  };
  return {
    retriever: {
      retrieve: async () => unavailable(),
      isWorkspaceEvidenceSufficient: async () => unavailable(),
    },
    evidenceResolver: {
      resolveEvidence: async () => unavailable(),
      resolveFlowFeedback: async () => unavailable(),
    },
  };
}

function createRuntimeClient(config: AppConfig): AgentRuntimeClient {
  if (config.runtimeMode === 'fake') return new DeterministicFakeAgentRuntimeClient();
  if (!config.bridgeToken) throw new Error('Bridge runtime mode requires a token');
  return new HttpAgentRuntimeClient({
    baseUrl: config.bridgeUrl,
    token: config.bridgeToken,
  });
}

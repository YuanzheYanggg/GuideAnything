import type { AgentRunExecutionContext } from '../orchestrator';
import type { RouteDecisionV1, RouteTaskV1 } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_QUERY_BUNDLE,
  loadWorkspaceQueryInstructions,
} from './workspace-query';

describe('workspace query bundle', () => {
  it('loads the workspace-only instructions for a flow task without treating an external vault as an internal source', () => {
    const instructions = loadWorkspaceQueryInstructions(workspaceContext(), focusedDecision(), flowTask());

    expect(instructions.join('\n')).toContain('选中上下文优先');
    expect(instructions.join('\n')).not.toContain('Santexwell');
  });

  it('treats a focused field leaf and its server-supplied structural context as sufficient evidence', () => {
    const instructions = loadWorkspaceQueryInstructions(workspaceContext(), focusedDecision(), flowTask());

    expect(instructions.join('\n')).toContain('结构闭包');
    expect(instructions.join('\n')).toContain('不得仅因缺少整张流程图的摘要而声明资料缺口');
  });

  it('has a stable content-derived revision and is not selected for an external task', () => {
    expect(WORKSPACE_QUERY_BUNDLE.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(loadWorkspaceQueryInstructions(workspaceContext(), focusedDecision(), {
      ...flowTask(), kind: 'SANTEXWELL', id: 'vault',
    })).toEqual([]);
  });
});

function workspaceContext(): AgentRunExecutionContext {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    ownerId: 'owner-1',
    scope: 'WORKSPACE',
    workspaceId: 'workspace-1',
    planVersion: 1,
    status: 'QUEUED',
    text: '当前流程如何处理异常？',
    sources: {
      workspaceFlows: true,
      workspaceDocuments: false,
      sessionAttachments: false,
      santexwell: true,
    },
    attachmentIds: [],
  };
}

function flowTask(): RouteTaskV1 {
  return {
    id: 'flow',
    kind: 'WORKSPACE_FLOW',
    objective: '检查当前流程的异常处理节点',
    dependsOn: [],
    priority: 1,
  };
}

function focusedDecision(): RouteDecisionV1 {
  return {
    intent: '回答流程问题',
    complexity: { scopeBreadth: 1, evidenceDepth: 1, crossSourceNeed: 1, decompositionNeed: 1, ambiguity: 1 },
    contextAssessment: '限定在当前工作区流程。',
    route: 'FOCUSED',
    sources: {
      workspaceFlows: true,
      workspaceDocuments: false,
      sessionAttachments: false,
      santexwell: false,
    },
    tasks: [flowTask()],
    budget: {
      maxWorkers: 1, maxConcurrency: 1, maxWorkspaceCandidates: 3, maxFlowHops: 2,
      maxVaultClusters: 0, maxVaultDigests: 0, allowRaw: false, useReducer: false,
    },
    executionMode: 'SEQUENTIAL',
    maxConcurrency: 1,
    stopConditions: ['找到已授权证据或说明不足'],
    confidence: 0.9,
    userFacingPlan: '检查当前流程。',
  };
}

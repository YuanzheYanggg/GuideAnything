import { describe, expect, it } from 'vitest';

import {
  AgentInternalAnswerV1Schema,
  AgentRunEventV1Schema,
  ArtifactV1Schema,
  BridgeEventV1Schema,
  BridgeRequestV1Schema,
  CitationV1Schema,
  RouteBudgetV1Schema,
  RouteDecisionV1Schema,
  SourceOptionsV1Schema,
  TaskFindingV1Schema,
} from './agent-runtime';

describe('agent runtime contracts', () => {
  it('bounds source options and route budgets', () => {
    expect(SourceOptionsV1Schema.parse(sourceOptions())).toEqual(sourceOptions());
    expect(RouteBudgetV1Schema.parse(routeBudget()).maxFlowHops).toBe(2);
    expect(RouteBudgetV1Schema.safeParse({ ...routeBudget(), maxWorkers: 5 }).success).toBe(false);
    expect(RouteBudgetV1Schema.safeParse({ ...routeBudget(), maxConcurrency: 0 }).success).toBe(false);
    expect(RouteBudgetV1Schema.safeParse({ ...routeBudget(), maxFlowHops: 3 }).success).toBe(false);
  });

  it('parses a bounded route decision with typed dependent tasks', () => {
    const decision = RouteDecisionV1Schema.parse(routeDecision([
        { id: 'flow', kind: 'WORKSPACE_FLOW', objective: '检查流程节点与分支', dependsOn: [], priority: 1 },
        { id: 'documents', kind: 'WORKSPACE_DOCUMENT', objective: '核对流程说明', dependsOn: ['flow'], priority: 2 },
    ]));

    expect(decision.tasks[1]?.dependsOn).toEqual(['flow']);
  });

  it('rejects cyclic route task dependencies', () => {
    expect(RouteDecisionV1Schema.safeParse(routeDecision([
      { id: 'a', kind: 'WORKSPACE_FLOW', objective: 'A', dependsOn: ['b'], priority: 1 },
      { id: 'b', kind: 'WORKSPACE_DOCUMENT', objective: 'B', dependsOn: ['a'], priority: 2 },
    ])).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse(routeDecision([
      { id: 'a', kind: 'WORKSPACE_FLOW', objective: 'A', dependsOn: ['c'], priority: 1 },
      { id: 'b', kind: 'WORKSPACE_DOCUMENT', objective: 'B', dependsOn: ['a'], priority: 2 },
      { id: 'c', kind: 'SANTEXWELL', objective: 'C', dependsOn: ['b'], priority: 3 },
    ])).success).toBe(false);
  });

  it('keeps validated internal locators out of public citations', () => {
    const finding = TaskFindingV1Schema.parse({
      taskId: 'flow',
      status: 'FOUND',
      findings: ['复核节点位于提交之后。'],
      validatedEvidence: [{
        id: 'evidence-1',
        source: 'WORKSPACE_FLOW',
        title: '订单处理',
        excerpt: '提交订单 → 复核订单',
        locator: {
          kind: 'WORKSPACE_FLOW',
          guideId: 'guide-1',
          snapshotId: 'snapshot-1',
          nodeId: 'review',
        },
      }],
      conflicts: [],
      gaps: [],
    });
    const citation = CitationV1Schema.parse({
      referenceId: 'reference-1',
      source: 'WORKSPACE_FLOW',
      title: '订单处理',
      excerpt: '提交订单 → 复核订单',
      href: '/references/reference-1',
    });

    expect(finding.validatedEvidence[0]).toHaveProperty('locator');
    expect(citation).not.toHaveProperty('locator');
    expect(CitationV1Schema.safeParse({
      ...citation,
      locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'review' },
    }).success).toBe(false);
    expect(CitationV1Schema.safeParse({
      ...citation,
      relativePath: 'wiki_v2/订单.md',
    }).success).toBe(false);
  });

  it('keeps route events ordered and JSON-safe', () => {
    const event = AgentRunEventV1Schema.parse({
      id: 'event-1',
      runId: 'run-1',
      sequence: 1,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'route.completed',
      payload: { route: 'FOCUSED', userFacingPlan: '先检查当前流程节点。' },
      createdAt: '2026-07-15T00:00:00.000Z',
    });

    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  it('rejects invalid event phases, sequences, and payloads', () => {
    const routeCompleted = {
      id: 'event-1',
      runId: 'run-1',
      sequence: 1,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'route.completed',
      payload: { route: 'FOCUSED', userFacingPlan: '检查流程。' },
      createdAt: '2026-07-15T00:00:00.000Z',
    };

    expect(AgentRunEventV1Schema.safeParse({ ...routeCompleted, sequence: 0 }).success).toBe(false);
    expect(AgentRunEventV1Schema.safeParse({ ...routeCompleted, phase: 'COMMITTED' }).success).toBe(false);
    expect(AgentRunEventV1Schema.safeParse({ ...routeCompleted, payload: { route: 'FOCUSED' } }).success).toBe(false);
    expect(AgentRunEventV1Schema.safeParse({
      ...routeCompleted,
      type: 'run.failed',
      phase: 'COMMITTED',
      payload: { code: 'BRIDGE_FAILED', retryable: true },
    }).success).toBe(false);
  });

  it('discriminates all public artifact payloads', () => {
    const common = {
      id: 'artifact-1',
      runId: 'run-1',
      title: '订单流程检查',
      createdAt: '2026-07-15T00:00:00.000Z',
    };
    const artifacts = [
      { ...common, kind: 'MARKDOWN', markdown: '# 结论' },
      { ...common, id: 'artifact-2', kind: 'REPORT', summary: '流程基本完整。', sections: [{ title: '结论', markdown: '需要补充复核。' }] },
      { ...common, id: 'artifact-3', kind: 'DIAGRAM', format: 'MERMAID', source: 'flowchart LR\nA-->B' },
      {
        ...common,
        id: 'artifact-4',
        kind: 'FLOW_PROPOSAL',
        guideId: 'guide-1',
        baseSnapshotId: 'snapshot-1',
        summary: '增加复核节点。',
        changes: [{ id: 'change-1', kind: 'ADD_NODE', summary: '在提交后增加复核。' }],
      },
    ];

    expect(artifacts.map((artifact) => ArtifactV1Schema.parse(artifact).kind)).toEqual([
      'MARKDOWN',
      'REPORT',
      'DIAGRAM',
      'FLOW_PROPOSAL',
    ]);
    expect(ArtifactV1Schema.safeParse({ ...common, kind: 'DIAGRAM', markdown: '# wrong' }).success).toBe(false);
  });

  it('parses internal answers without requiring public hrefs', () => {
    const answer = AgentInternalAnswerV1Schema.parse({
      mode: 'ANSWER',
      conclusion: '现有流程缺少异常复核。',
      sections: [{ id: 'details', title: '检查结果', markdown: '退回分支没有复核节点。' }],
      evidence: [{
        id: 'evidence-vault',
        source: 'SANTEXWELL',
        title: '订单复核规范',
        excerpt: '异常订单需要人工复核。',
        locator: {
          kind: 'SANTEXWELL',
          relativePath: 'wiki_v2/订单复核规范.md',
          revision: 'revision-7',
          heading: '异常处理',
        },
      }],
      flowFeedback: [{
        kind: 'GAP',
        message: '建议在退回分支增加复核节点。',
        locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'return' },
      }],
      evidenceStatus: 'SUPPORTED',
      artifacts: [],
      suggestedQuestions: ['是否需要生成流程修改建议？'],
    });

    expect(answer.evidence[0]).not.toHaveProperty('href');
  });

  it('discriminates bridge requests and bridge events', () => {
    const request = BridgeRequestV1Schema.parse({
      type: 'RUN',
      requestId: 'bridge-request-1',
      runId: 'run-1',
      planVersion: 1,
      role: 'FOCUSED_WORKER',
      reasoningEffort: 'MEDIUM',
      prompt: '只读检查当前流程。',
      allowedRoots: ['/workspace'],
    });
    const event = BridgeEventV1Schema.parse({
      requestId: 'bridge-request-1',
      runId: 'run-1',
      sequence: 1,
      type: 'COMMENTARY',
      payload: { text: '正在检查当前流程。' },
    });

    expect(request.type).toBe('RUN');
    expect(event.type).toBe('COMMENTARY');
    expect(BridgeRequestV1Schema.safeParse({ ...request, type: 'CANCEL', prompt: 'leak' }).success).toBe(false);
  });
});

function sourceOptions() {
  return {
    workspaceFlows: true,
    workspaceDocuments: true,
    sessionAttachments: false,
    santexwell: false,
  };
}

function routeBudget() {
  return {
    maxWorkers: 1,
    maxConcurrency: 1,
    maxWorkspaceCandidates: 3,
    maxFlowHops: 2,
    maxVaultClusters: 1,
    maxVaultDigests: 2,
    allowRaw: false,
    useReducer: false,
  };
}

function routeDecision(tasks: Array<{
  id: string;
  kind: 'WORKSPACE_FLOW' | 'WORKSPACE_DOCUMENT' | 'SESSION_ATTACHMENT' | 'SANTEXWELL' | 'REDUCE';
  objective: string;
  dependsOn: string[];
  priority: number;
}>) {
  return {
    intent: '检查当前订单流程是否缺少复核步骤',
    complexity: {
      scopeBreadth: 2,
      evidenceDepth: 3,
      crossSourceNeed: 1,
      decompositionNeed: 2,
      ambiguity: 1,
    },
    contextAssessment: '问题限定在当前指南。',
    route: 'FOCUSED',
    sources: sourceOptions(),
    tasks,
    budget: routeBudget(),
    executionMode: 'SEQUENTIAL',
    maxConcurrency: 1,
    stopConditions: ['已找到足够证据支撑结论'],
    confidence: 0.84,
    userFacingPlan: '先检查当前流程节点，再核对相关说明。',
  } as const;
}

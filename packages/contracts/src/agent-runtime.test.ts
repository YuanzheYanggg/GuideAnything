import { describe, expect, it } from 'vitest';

import {
  AgentCommittedAnswerV1Schema,
  AgentInternalAnswerV1Schema,
  AgentRunEventV1Schema,
  ArtifactV1Schema,
  BridgeEventV1Schema,
  BridgeRequestV1Schema,
  CitationV1Schema,
  PublicRoutePlanV1Schema,
  PublicTaskFindingV1Schema,
  RouteBudgetV1Schema,
  RouteDecisionV1Schema,
  SourceOptionsV1Schema,
  TaskFindingV1Schema,
} from './agent-runtime';
import { GuideDigestDraftV1Schema } from './guide-digest';

describe('agent runtime contracts', () => {
  it('bounds source options and route budgets', () => {
    expect(SourceOptionsV1Schema.parse(sourceOptions())).toEqual(sourceOptions());
    expect(RouteBudgetV1Schema.parse(focusedBudget()).maxFlowHops).toBe(2);
    expect(RouteBudgetV1Schema.safeParse({ ...focusedBudget(), maxWorkers: 5 }).success).toBe(false);
    expect(RouteBudgetV1Schema.safeParse({ ...focusedBudget(), maxConcurrency: 0 }).success).toBe(false);
    expect(RouteBudgetV1Schema.safeParse({ ...focusedBudget(), maxFlowHops: 3 }).success).toBe(false);
  });

  it('parses a bounded route decision with typed dependent tasks', () => {
    const decision = RouteDecisionV1Schema.parse(validRouteDecision('COMPOSITE'));

    expect(decision.tasks.find((task) => task.id === 'documents')?.dependsOn).toEqual(['flow']);
    expect(decision.tasks.find((task) => task.kind === 'REDUCE')?.dependsOn).toEqual(['flow', 'documents']);
  });

  it('rejects cyclic route task dependencies', () => {
    expect(RouteDecisionV1Schema.safeParse(compositeDecision([
      { id: 'a', kind: 'WORKSPACE_FLOW', objective: 'A', dependsOn: ['b'], priority: 1 },
      { id: 'b', kind: 'WORKSPACE_DOCUMENT', objective: 'B', dependsOn: ['a'], priority: 2 },
      { id: 'reduce', kind: 'REDUCE', objective: '汇总', dependsOn: ['a', 'b'], priority: 3 },
    ])).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse(compositeDecision([
      { id: 'a', kind: 'WORKSPACE_FLOW', objective: 'A', dependsOn: ['c'], priority: 1 },
      { id: 'b', kind: 'WORKSPACE_DOCUMENT', objective: 'B', dependsOn: ['a'], priority: 2 },
      { id: 'c', kind: 'SANTEXWELL', objective: 'C', dependsOn: ['b'], priority: 3 },
      { id: 'reduce', kind: 'REDUCE', objective: '汇总', dependsOn: ['a', 'b', 'c'], priority: 4 },
    ])).success).toBe(false);
  });

  it('accepts route-specific worker, reducer, and budget combinations', () => {
    expect(RouteDecisionV1Schema.safeParse(validRouteDecision('DIRECT')).success).toBe(true);
    expect(RouteDecisionV1Schema.safeParse(validRouteDecision('FOCUSED')).success).toBe(true);
    expect(RouteDecisionV1Schema.safeParse(validRouteDecision('COMPOSITE')).success).toBe(true);
    expect(RouteDecisionV1Schema.safeParse(validRouteDecision('OPEN_RESEARCH')).success).toBe(true);

    const openWithFourWorkers = openResearchDecision([
      routeTask('flow', 'WORKSPACE_FLOW'),
      routeTask('documents', 'WORKSPACE_DOCUMENT'),
      routeTask('attachment', 'SESSION_ATTACHMENT'),
      routeTask('vault', 'SANTEXWELL'),
      routeTask('reduce', 'REDUCE', ['flow', 'documents', 'attachment', 'vault']),
    ], {
      sources: { workspaceFlows: true, workspaceDocuments: true, sessionAttachments: true, santexwell: true },
      budget: { ...openBudget(), maxWorkers: 4 },
    });
    expect(RouteDecisionV1Schema.safeParse(openWithFourWorkers).success).toBe(true);

    const compositeWithThreeWorkers = compositeDecision([
      routeTask('flow', 'WORKSPACE_FLOW'),
      routeTask('documents', 'WORKSPACE_DOCUMENT'),
      routeTask('vault', 'SANTEXWELL'),
      routeTask('reduce', 'REDUCE', ['flow', 'documents', 'vault']),
    ], {
      budget: { ...compositeBudget(), maxWorkers: 3, maxConcurrency: 3 },
      maxConcurrency: 3,
    });
    expect(RouteDecisionV1Schema.safeParse(compositeWithThreeWorkers).success).toBe(true);
  });

  it('requires DIRECT to execute sequentially at concurrency one', () => {
    const direct = validRouteDecision('DIRECT');
    const invalid = [
      { ...direct, executionMode: 'PARALLEL' },
      { ...direct, budget: { ...direct.budget, maxConcurrency: 2 } },
      {
        ...direct,
        executionMode: 'PARALLEL',
        maxConcurrency: 2,
        budget: { ...direct.budget, maxConcurrency: 2 },
      },
    ];

    invalid.forEach((decision) => {
      expect(RouteDecisionV1Schema.safeParse(decision).success).toBe(false);
    });
  });

  it('requires FOCUSED to reserve and schedule exactly one worker', () => {
    const invalid = [
      focusedDecision([]),
      focusedDecision([], { budget: { ...focusedBudget(), maxWorkers: 0 } }),
      focusedDecision([routeTask('flow', 'WORKSPACE_FLOW')], {
        budget: { ...focusedBudget(), maxWorkers: 0 },
      }),
      focusedDecision([
        routeTask('flow', 'WORKSPACE_FLOW'),
        routeTask('documents', 'WORKSPACE_DOCUMENT'),
      ], {
        budget: { ...focusedBudget(), maxWorkers: 2 },
      }),
    ];

    invalid.forEach((decision) => {
      expect(RouteDecisionV1Schema.safeParse(decision).success).toBe(false);
    });
  });

  it('requires COMPOSITE to use two or three workers and one bounded vault cluster', () => {
    const oneWorker = compositeDecision([
      routeTask('flow', 'WORKSPACE_FLOW'),
      routeTask('reduce', 'REDUCE', ['flow']),
    ]);
    const invalid = [
      oneWorker,
      { ...oneWorker, budget: { ...oneWorker.budget, maxWorkers: 1 } },
      {
        ...validRouteDecision('COMPOSITE'),
        budget: { ...compositeBudget(), maxVaultClusters: 2 },
      },
      {
        ...validRouteDecision('COMPOSITE'),
        budget: { ...compositeBudget(), maxVaultDigests: 3 },
      },
      compositeDecision([
        routeTask('flow', 'WORKSPACE_FLOW'),
        routeTask('documents', 'WORKSPACE_DOCUMENT'),
        routeTask('attachment', 'SESSION_ATTACHMENT'),
        routeTask('vault', 'SANTEXWELL'),
        routeTask('reduce', 'REDUCE', ['flow', 'documents', 'attachment', 'vault']),
      ], {
        budget: { ...compositeBudget(), maxWorkers: 4 },
      }),
    ];

    invalid.forEach((decision) => {
      expect(RouteDecisionV1Schema.safeParse(decision).success).toBe(false);
    });
  });

  it('requires COMPOSITE to execute in parallel with at least two-way concurrency', () => {
    const composite = validRouteDecision('COMPOSITE');
    const invalid = [
      { ...composite, executionMode: 'SEQUENTIAL', maxConcurrency: 1 },
      { ...composite, maxConcurrency: 1 },
      {
        ...composite,
        maxConcurrency: 1,
        budget: { ...composite.budget, maxConcurrency: 1 },
      },
    ];

    invalid.forEach((decision) => {
      expect(RouteDecisionV1Schema.safeParse(decision).success).toBe(false);
    });
    expect(RouteDecisionV1Schema.safeParse(composite).success).toBe(true);
    expect(RouteDecisionV1Schema.safeParse(compositeDecision([
      routeTask('flow', 'WORKSPACE_FLOW'),
      routeTask('documents', 'WORKSPACE_DOCUMENT'),
      routeTask('vault', 'SANTEXWELL'),
      routeTask('reduce', 'REDUCE', ['flow', 'documents', 'vault']),
    ], {
      budget: { ...compositeBudget(), maxWorkers: 3, maxConcurrency: 3 },
      maxConcurrency: 3,
    })).success).toBe(true);
  });

  it('rejects tasks for disabled sources', () => {
    for (const kind of ['WORKSPACE_FLOW', 'WORKSPACE_DOCUMENT', 'SESSION_ATTACHMENT', 'SANTEXWELL'] as const) {
      expect(RouteDecisionV1Schema.safeParse(focusedDecision([
        routeTask('worker', kind),
      ], {
        sources: { workspaceFlows: false, workspaceDocuments: false, sessionAttachments: false, santexwell: false },
      })).success).toBe(false);
    }
  });

  it('rejects route budgets outside deterministic route limits', () => {
    const direct = validRouteDecision('DIRECT');
    const focused = validRouteDecision('FOCUSED');
    const composite = validRouteDecision('COMPOSITE');
    const open = validRouteDecision('OPEN_RESEARCH');
    const invalid = [
      { ...direct, budget: { ...direct.budget, maxWorkers: 2 } },
      { ...direct, budget: { ...direct.budget, allowRaw: true } },
      { ...direct, budget: { ...direct.budget, useReducer: true } },
      { ...direct, budget: { ...direct.budget, maxWorkspaceCandidates: 2 } },
      { ...direct, budget: { ...direct.budget, maxFlowHops: 2 } },
      { ...direct, budget: { ...direct.budget, maxVaultClusters: 1 } },
      { ...direct, budget: { ...direct.budget, maxVaultDigests: 1 } },
      { ...focused, budget: { ...focused.budget, maxWorkers: 2 } },
      { ...focused, budget: { ...focused.budget, maxConcurrency: 2 }, executionMode: 'PARALLEL', maxConcurrency: 2 },
      { ...focused, budget: { ...focused.budget, allowRaw: true } },
      { ...focused, budget: { ...focused.budget, useReducer: true } },
      { ...focused, budget: { ...focused.budget, maxWorkspaceCandidates: 4 } },
      { ...focused, budget: { ...focused.budget, maxVaultClusters: 2 } },
      { ...focused, budget: { ...focused.budget, maxVaultDigests: 3 } },
      { ...composite, budget: { ...composite.budget, maxWorkers: 4 } },
      { ...composite, budget: { ...composite.budget, allowRaw: true } },
      { ...open, budget: { ...open.budget, maxWorkers: 1 } },
      { ...open, budget: { ...open.budget, maxVaultClusters: 3 } },
      { ...open, budget: { ...open.budget, maxVaultDigests: 7 } },
    ];

    invalid.forEach((decision) => {
      expect(RouteDecisionV1Schema.safeParse(decision).success).toBe(false);
    });
  });

  it('enforces worker counts and reducer topology', () => {
    const composite = validRouteDecision('COMPOSITE');
    const open = validRouteDecision('OPEN_RESEARCH');
    const reduce = composite.tasks.find((task) => task.kind === 'REDUCE')!;

    expect(RouteDecisionV1Schema.safeParse({
      ...focusedDecision([routeTask('flow', 'WORKSPACE_FLOW')]),
      budget: { ...focusedBudget(), maxWorkers: 0 },
    }).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse({
      ...composite,
      tasks: composite.tasks.filter((task) => task.kind !== 'REDUCE'),
    }).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse({
      ...composite,
      tasks: [...composite.tasks, { ...reduce, id: 'reduce-2' }],
    }).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse({
      ...composite,
      tasks: composite.tasks.map((task) => task.kind === 'REDUCE' ? { ...task, dependsOn: ['flow'] } : task),
    }).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse({
      ...composite,
      budget: { ...composite.budget, useReducer: false },
    }).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse({
      ...open,
      tasks: [routeTask('flow', 'WORKSPACE_FLOW'), routeTask('reduce', 'REDUCE', ['flow'])],
      budget: { ...open.budget, maxWorkers: 2 },
    }).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse({
      ...validRouteDecision('DIRECT'),
      tasks: [routeTask('flow', 'WORKSPACE_FLOW'), routeTask('reduce', 'REDUCE', ['flow'])],
    }).success).toBe(false);
  });

  it('rejects duplicate task dependencies', () => {
    const composite = validRouteDecision('COMPOSITE');

    expect(RouteDecisionV1Schema.safeParse({
      ...composite,
      tasks: composite.tasks.map((task) => task.kind === 'REDUCE'
        ? { ...task, dependsOn: ['flow', 'documents', 'flow'] }
        : task),
    }).success).toBe(false);
    expect(RouteDecisionV1Schema.safeParse({
      ...composite,
      tasks: composite.tasks.map((task) => task.id === 'documents'
        ? { ...task, dependsOn: ['flow', 'flow'] }
        : task),
    }).success).toBe(false);
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

  it('accepts only the opaque backend reference route for citation hrefs', () => {
    const referenceId = 'reference/订单 1';
    const citation = {
      referenceId,
      source: 'WORKSPACE_FLOW',
      title: '订单处理',
      excerpt: '复核订单',
      href: `/references/${encodeURIComponent(referenceId)}`,
    };

    expect(CitationV1Schema.safeParse(citation).success).toBe(true);
    for (const href of [
      '/Users/operator/private.md',
      '/guides/reference%2F%E8%AE%A2%E5%8D%95%201',
      '/references/reference%2F%E8%AE%A2%E5%8D%95%201/extra',
      '/references/reference%2F%E8%AE%A2%E5%8D%95%201?download=1',
    ]) {
      expect(CitationV1Schema.safeParse({ ...citation, href }).success).toBe(false);
    }
    expect(() => CitationV1Schema.safeParse({
      ...citation,
      referenceId: '\uD800',
      href: '/references/invalid',
    })).not.toThrow();
    expect(CitationV1Schema.safeParse({
      ...citation,
      referenceId: '\uD800',
      href: '/references/invalid',
    }).success).toBe(false);
  });

  it('parses session attachment evidence with a strict locator', () => {
    const finding = TaskFindingV1Schema.parse({
      taskId: 'attachment',
      status: 'FOUND',
      findings: ['附件包含订单复核要求。'],
      validatedEvidence: [{
        id: 'evidence-attachment',
        source: 'SESSION_ATTACHMENT',
        title: '订单说明',
        excerpt: '异常订单需要复核。',
        locator: {
          kind: 'SESSION_ATTACHMENT',
          conversationId: 'conversation-1',
          attachmentId: 'attachment-1',
          documentId: 'document-1',
          revision: 'revision-1',
          fragmentId: 'fragment-1',
        },
      }],
      conflicts: [],
      gaps: [],
    });

    expect(finding.validatedEvidence[0]?.locator.kind).toBe('SESSION_ATTACHMENT');
    expect(TaskFindingV1Schema.safeParse({
      ...finding,
      validatedEvidence: [{
        ...finding.validatedEvidence[0],
        locator: {
          kind: 'SESSION_ATTACHMENT',
          conversationId: 'conversation-1',
          attachmentId: 'attachment-1',
          documentId: 'document-1',
        },
      }],
    }).success).toBe(false);
    expect(TaskFindingV1Schema.safeParse({
      ...finding,
      validatedEvidence: [{
        ...finding.validatedEvidence[0],
        locator: { ...finding.validatedEvidence[0]?.locator, workspaceId: 'not-allowed' },
      }],
    }).success).toBe(false);
  });

  it('requires stable document identity in Santexwell locators', () => {
    const finding = santexwellFinding();
    const locator = finding.validatedEvidence[0]!.locator;
    const { fragmentId: _fragmentId, ...withoutFragment } = locator;
    const {
      documentId: _documentId,
      fragmentId: _unstableFragmentId,
      ...withoutDocumentIdentity
    } = locator;

    expect(TaskFindingV1Schema.safeParse(finding).success).toBe(true);
    expect(TaskFindingV1Schema.safeParse({
      ...finding,
      validatedEvidence: [{ ...finding.validatedEvidence[0], locator: withoutFragment }],
    }).success).toBe(true);
    expect(TaskFindingV1Schema.safeParse({
      ...finding,
      validatedEvidence: [{ ...finding.validatedEvidence[0], locator: withoutDocumentIdentity }],
    }).success).toBe(false);
  });

  it('rejects duplicate evidence IDs in task findings even when locators differ', () => {
    const finding = santexwellFinding();
    const duplicate = flowEvidence(finding.validatedEvidence[0]!.id);

    expect(duplicate.locator).not.toEqual(finding.validatedEvidence[0]!.locator);
    expect(TaskFindingV1Schema.safeParse({
      ...finding,
      validatedEvidence: [...finding.validatedEvidence, duplicate],
    }).success).toBe(false);
  });

  it('exposes only browser-safe task findings in run events', () => {
    const finding = PublicTaskFindingV1Schema.parse({
      taskId: 'flow',
      status: 'PARTIAL',
      summary: '已找到流程节点，仍需核对附件。',
      conflicts: [],
      gaps: ['附件尚未完成解析。'],
      evidenceCount: 2,
    });
    const event = AgentRunEventV1Schema.parse({
      id: 'event-finding',
      runId: 'run-1',
      sequence: 2,
      planVersion: 1,
      phase: 'PROVISIONAL',
      type: 'task.finding',
      payload: { finding },
      createdAt: '2026-07-15T00:00:01.000Z',
    });
    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain('locator');
    expect(serialized).not.toContain('relativePath');
    expect(serialized).not.toContain('validatedEvidence');
    expect(AgentRunEventV1Schema.safeParse({
      ...event,
      payload: {
        finding: {
          taskId: 'flow',
          status: 'FOUND',
          findings: ['内部发现'],
          validatedEvidence: [{
            id: 'evidence-vault',
            source: 'SANTEXWELL',
            title: '内部页面',
            excerpt: '内部证据',
            locator: {
              kind: 'SANTEXWELL',
              relativePath: 'wiki_v2/内部.md',
              revision: 'revision-1',
            },
          }],
          conflicts: [],
          gaps: [],
        },
      },
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

  it('keeps public route plans topologically consistent', () => {
    expect(PublicRoutePlanV1Schema.safeParse({
      route: 'DIRECT',
      userFacingPlan: '直接检查当前上下文。',
      executionMode: 'PARALLEL',
      tasks: [
        { id: 'same', label: '任务一', sourceKind: 'WORKSPACE_FLOW' },
        { id: 'same', label: '任务二', sourceKind: 'SANTEXWELL' },
      ],
    }).success).toBe(false);
    expect(PublicRoutePlanV1Schema.safeParse({
      route: 'COMPOSITE',
      userFacingPlan: '并行检查后汇总。',
      executionMode: 'PARALLEL',
      tasks: [
        { id: 'flow', label: '检查流程', sourceKind: 'WORKSPACE_FLOW' },
        { id: 'vault', label: '检查知识库', sourceKind: 'SANTEXWELL' },
        { id: 'reduce', label: '汇总结论', sourceKind: 'REDUCE' },
      ],
    }).success).toBe(true);
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
    expect(AgentRunEventV1Schema.safeParse({
      ...routeCompleted,
      type: 'run.failed',
      phase: 'COMMITTED',
      payload: { code: 'runtime-failed', message: '运行失败。', retryable: true },
    }).success).toBe(false);
    expect(AgentRunEventV1Schema.safeParse({
      ...routeCompleted,
      type: 'run.failed',
      phase: 'COMMITTED',
      payload: { code: 'RUNTIME_FAILED', message: '运行失败。', retryable: true },
    }).success).toBe(true);
  });

  it('discriminates exactly four browser-safe artifact payloads', () => {
    const common = {
      id: 'artifact-1',
      runId: 'run-1',
      title: '订单流程检查',
      createdAt: '2026-07-15T00:00:00.000Z',
    };
    const artifacts = [
      { ...common, kind: 'REPORT', summary: '流程基本完整。', sections: [{ title: '结论', markdown: '需要补充复核。' }] },
      {
        ...common,
        id: 'artifact-2',
        kind: 'DIAGRAM',
        direction: 'LR',
        nodes: [
          { id: 'submit', label: '提交订单' },
          { id: 'review', label: '复核订单', summary: '检查异常订单。' },
        ],
        edges: [{ id: 'submit-review', source: 'submit', target: 'review', label: '异常时' }],
      },
      {
        ...common,
        id: 'artifact-3',
        kind: 'FLOW_PROPOSAL',
        guideId: 'guide-1',
        baseSnapshotId: 'snapshot-1',
        summary: '增加复核节点。',
        changes: [{ id: 'change-1', kind: 'ADD_NODE', summary: '在提交后增加复核。' }],
      },
      {
        ...common,
        id: 'artifact-4',
        kind: 'REFERENCE_COLLECTION',
        references: [{ referenceId: 'reference-1', href: '/references/reference-1', title: '订单复核规范', summary: '异常订单需要人工复核。' }],
      },
    ];

    expect(artifacts.map((artifact) => ArtifactV1Schema.parse(artifact).kind)).toEqual([
      'REPORT',
      'DIAGRAM',
      'FLOW_PROPOSAL',
      'REFERENCE_COLLECTION',
    ]);
    expect(ArtifactV1Schema.safeParse({ ...common, kind: 'MARKDOWN', markdown: '# 结论' }).success).toBe(false);
    expect(ArtifactV1Schema.safeParse({
      ...common,
      kind: 'DIAGRAM',
      format: 'MERMAID',
      source: 'flowchart LR\nA-->B',
    }).success).toBe(false);
  });

  it('keeps reference collections bounded and free of internal locators', () => {
    const collection = {
      id: 'artifact-references',
      runId: 'run-1',
      title: '参考资料',
      createdAt: '2026-07-15T00:00:00.000Z',
      kind: 'REFERENCE_COLLECTION',
      references: [{ referenceId: 'reference-1', href: '/references/reference-1', title: '订单规范', summary: '包含订单复核要求。' }],
    };
    const parsed = ArtifactV1Schema.parse(collection);

    expect(JSON.stringify(parsed)).not.toContain('locator');
    expect(JSON.stringify(parsed)).not.toContain('relativePath');
    expect(ArtifactV1Schema.safeParse({
      ...collection,
      references: [{ ...collection.references[0], relativePath: 'wiki_v2/订单.md' }],
    }).success).toBe(false);
    expect(ArtifactV1Schema.safeParse({
      ...collection,
      references: [{ ...collection.references[0], locator: { kind: 'SANTEXWELL' } }],
    }).success).toBe(false);
    expect(ArtifactV1Schema.safeParse({
      ...collection,
      references: [{ ...collection.references[0], referenceId: '\uD800' }],
    }).success).toBe(false);
    expect(ArtifactV1Schema.safeParse({ ...collection, references: [] }).success).toBe(false);
    expect(ArtifactV1Schema.safeParse({
      ...collection,
      references: Array.from({ length: 201 }, (_, index) => ({
        referenceId: `reference-${index}`,
        href: `/references/reference-${index}`,
        title: `参考 ${index}`,
        summary: '摘要',
      })),
    }).success).toBe(false);
  });

  it('validates controlled diagram topology and bounds', () => {
    const diagram = {
      id: 'artifact-diagram',
      runId: 'run-1',
      title: '订单流程',
      createdAt: '2026-07-15T00:00:00.000Z',
      kind: 'DIAGRAM',
      direction: 'TB',
      nodes: [
        { id: 'submit', label: '提交订单' },
        { id: 'review', label: '复核订单' },
      ],
      edges: [{ id: 'submit-review', source: 'submit', target: 'review' }],
    };

    expect(ArtifactV1Schema.safeParse(diagram).success).toBe(true);
    const invalidDiagrams = [
      { ...diagram, direction: 'RL' },
      { ...diagram, nodes: [...diagram.nodes, { id: 'submit', label: '重复节点' }] },
      { ...diagram, edges: [...diagram.edges, { ...diagram.edges[0], target: 'submit' }] },
      { ...diagram, edges: [{ ...diagram.edges[0], source: 'missing' }] },
      { ...diagram, edges: [{ ...diagram.edges[0], target: 'missing' }] },
      {
        ...diagram,
        nodes: Array.from({ length: 201 }, (_, index) => ({ id: `node-${index}`, label: `节点 ${index}` })),
        edges: [],
      },
      {
        ...diagram,
        edges: Array.from({ length: 401 }, (_, index) => ({
          id: `edge-${index}`,
          source: 'submit',
          target: 'review',
        })),
      },
    ];

    invalidDiagrams.forEach((invalid) => {
      expect(ArtifactV1Schema.safeParse(invalid).success).toBe(false);
    });
  });

  it('accepts internal artifacts without backend-owned metadata', () => {
    const answer = AgentInternalAnswerV1Schema.parse(internalAnswer());

    expect(answer.evidence[0]).not.toHaveProperty('href');
    expect(answer.artifacts.map((artifact) => artifact.kind)).toEqual([
      'REPORT',
      'DIAGRAM',
      'FLOW_PROPOSAL',
      'REFERENCE_COLLECTION',
    ]);
    answer.artifacts.forEach((artifact) => {
      expect(artifact).not.toHaveProperty('id');
      expect(artifact).not.toHaveProperty('runId');
      expect(artifact).not.toHaveProperty('createdAt');
    });
  });

  it('keeps internal and public artifact payloads isolated', () => {
    const answer = internalAnswer();
    const report = answer.artifacts[0]!;
    const publicCollection = {
      id: 'artifact-references',
      runId: 'run-1',
      title: '参考资料',
      createdAt: '2026-07-15T00:00:00.000Z',
      kind: 'REFERENCE_COLLECTION',
      references: [{ referenceId: 'reference-1', href: '/references/reference-1', title: '订单规范', summary: '包含订单复核要求。' }],
    };

    expect(AgentInternalAnswerV1Schema.safeParse({
      ...answer,
      artifacts: [{
        ...report,
        id: 'artifact-report',
        runId: 'run-1',
        createdAt: '2026-07-15T00:00:00.000Z',
      }],
    }).success).toBe(false);
    expect(AgentInternalAnswerV1Schema.safeParse({
      ...answer,
      artifacts: [publicCollection],
    }).success).toBe(false);
    expect(ArtifactV1Schema.safeParse({
      ...publicCollection,
      evidenceIds: ['evidence-vault'],
    }).success).toBe(false);
    expect(ArtifactV1Schema.safeParse({
      kind: 'REPORT',
      title: '内部报告',
      summary: '缺少后端字段。',
      sections: [],
    }).success).toBe(false);
  });

  it('requires internal reference collections to use unique validated evidence IDs', () => {
    const answer = internalAnswer();
    const referenceCollection = answer.artifacts.find((artifact) => artifact.kind === 'REFERENCE_COLLECTION')!;
    const withEvidenceIds = (evidenceIds: string[]) => ({
      ...answer,
      artifacts: [{ ...referenceCollection, evidenceIds }],
    });

    expect(AgentInternalAnswerV1Schema.safeParse(withEvidenceIds([])).success).toBe(false);
    expect(AgentInternalAnswerV1Schema.safeParse(withEvidenceIds(['evidence-vault', 'evidence-vault'])).success).toBe(false);
    expect(AgentInternalAnswerV1Schema.safeParse(withEvidenceIds(['missing-evidence'])).success).toBe(false);
    expect(AgentInternalAnswerV1Schema.safeParse(withEvidenceIds(
      Array.from({ length: 201 }, (_, index) => `evidence-${index}`),
    )).success).toBe(false);
  });

  it('rejects duplicate internal evidence IDs so reference collections stay unambiguous', () => {
    const answer = internalAnswer();
    const duplicate = flowEvidence(answer.evidence[0]!.id);

    expect(duplicate.locator).not.toEqual(answer.evidence[0]!.locator);
    expect(AgentInternalAnswerV1Schema.safeParse({
      ...answer,
      evidence: [...answer.evidence, duplicate],
    }).success).toBe(false);
  });

  it('keeps flow feedback in committed answers through browser-safe references', () => {
    const referenceId = 'flow/reference 1';
    const answer = AgentCommittedAnswerV1Schema.parse(committedAnswer([
      {
        kind: 'GAP',
        message: '退回分支缺少复核节点。',
        referenceId,
        href: `/references/${encodeURIComponent(referenceId)}`,
      },
      {
        kind: 'CONFLICT',
        message: '原流程快照已不可用。',
        referenceId: 'expired-reference',
        href: null,
        invalidReason: '原流程快照已删除。',
      },
    ]));
    const serialized = JSON.stringify(answer.flowFeedback);

    expect(answer.flowFeedback).toHaveLength(2);
    expect(serialized).not.toContain('locator');
    expect(serialized).not.toContain('relativePath');
  });

  it('requires exact safe reference routes for public flow feedback', () => {
    const referenceId = 'flow/reference 1';
    const valid = {
      kind: 'IMPROVEMENT',
      message: '建议增加异常复核节点。',
      referenceId,
      href: `/references/${encodeURIComponent(referenceId)}`,
    };
    const invalid = [
      { ...valid, href: '/Users/operator/private.md' },
      { ...valid, href: '/guides/flow%2Freference%201' },
      { ...valid, href: null },
      { ...valid, invalidReason: '不应同时存在。' },
      { ...valid, locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'review' } },
      { ...valid, relativePath: 'wiki_v2/订单.md' },
    ];

    invalid.forEach((feedback) => {
      expect(AgentCommittedAnswerV1Schema.safeParse(committedAnswer([feedback])).success).toBe(false);
    });
    expect(() => AgentCommittedAnswerV1Schema.safeParse(committedAnswer([{
      ...valid,
      referenceId: '\uD800',
      href: '/references/invalid',
    }]))).not.toThrow();
    expect(AgentCommittedAnswerV1Schema.safeParse(committedAnswer([{
      ...valid,
      referenceId: '\uD800',
      href: '/references/invalid',
    }]))).toMatchObject({ success: false });
  });

  it('requires committed flow feedback while keeping internal feedback locator-only', () => {
    const committed = committedAnswer([]);
    const { flowFeedback: _flowFeedback, ...withoutFlowFeedback } = committed;
    const internal = internalAnswer();

    expect(AgentCommittedAnswerV1Schema.safeParse(withoutFlowFeedback).success).toBe(false);
    expect(AgentInternalAnswerV1Schema.safeParse({
      ...internal,
      flowFeedback: [{
        ...internal.flowFeedback[0],
        referenceId: 'reference-1',
        href: '/references/reference-1',
      }],
    }).success).toBe(false);
  });

  it('keeps stable Santexwell locator details out of committed answer events', () => {
    const finding = TaskFindingV1Schema.parse(santexwellFinding());
    const referenceId = 'vault/reference 1';
    const answer = AgentCommittedAnswerV1Schema.parse({
      ...committedAnswer([{
        kind: 'GAP',
        message: '规范要求增加异常复核。',
        referenceId,
        href: `/references/${encodeURIComponent(referenceId)}`,
      }]),
      citations: [{
        referenceId,
        source: 'SANTEXWELL',
        title: '订单复核规范',
        excerpt: '异常订单需要人工复核。',
        href: `/references/${encodeURIComponent(referenceId)}`,
      }],
    });
    const event = AgentRunEventV1Schema.parse({
      id: 'event-answer',
      runId: 'run-1',
      sequence: 3,
      planVersion: 1,
      phase: 'COMMITTED',
      type: 'answer.committed',
      payload: { answer },
      createdAt: '2026-07-15T00:00:02.000Z',
    });
    const serialized = JSON.stringify(event);

    expect(finding.validatedEvidence[0]?.locator).toMatchObject({
      documentId: 'document-orders',
      fragmentId: 'fragment-review',
      relativePath: 'wiki_v2/订单复核规范.md',
    });
    expect(serialized).not.toContain('locator');
    expect(serialized).not.toContain('relativePath');
    expect(serialized).not.toContain('documentId');
    expect(serialized).not.toContain('fragmentId');
  });

  it('discriminates bridge requests and bridge events', () => {
    const request = BridgeRequestV1Schema.parse({
      type: 'RUN',
      requestId: 'bridge-request-1',
      runId: 'run-1',
      planVersion: 1,
      role: 'FOCUSED_WORKER',
      reasoningEffort: 'MEDIUM',
      outputKind: 'TASK_FINDING',
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
    expect(BridgeRequestV1Schema.safeParse({
      ...request, role: 'ROUTER', outputKind: 'ANSWER',
    }).success).toBe(false);
    expect(BridgeRequestV1Schema.safeParse({
      ...request, role: 'REDUCER', outputKind: 'TASK_FINDING', reasoningEffort: 'HIGH',
    }).success).toBe(false);
    expect(BridgeEventV1Schema.safeParse({
      requestId: 'bridge-request-1', runId: 'run-1', sequence: 2,
      type: 'ROUTE_DECISION', payload: { decision: validRouteDecision('DIRECT') },
    }).success).toBe(true);
    expect(BridgeEventV1Schema.safeParse({
      requestId: 'bridge-request-1', runId: 'run-1', sequence: 3,
      type: 'TASK_FINDING', payload: { finding: santexwellFinding() },
    }).success).toBe(true);
    expect(BridgeEventV1Schema.parse({
      requestId: 'bridge-request-1', runId: 'run-1', sequence: 4,
      type: 'STRUCTURED_OUTPUT_DELTA', payload: { delta: '{"conclusion":"公开结论' },
    }).payload).toEqual({ delta: '{"conclusion":"公开结论' });
    expect(BridgeEventV1Schema.safeParse({
      requestId: 'bridge-request-1', runId: 'run-1', sequence: 5,
      type: 'STRUCTURED_OUTPUT_DELTA', payload: { delta: '', locator: '/private' },
    }).success).toBe(false);
  });

  it('binds bridge output kinds to model roles and validates each structured event payload', () => {
    const base = {
      type: 'RUN' as const,
      requestId: 'bridge-request-output',
      runId: 'run-output',
      planVersion: 1,
      reasoningEffort: 'MEDIUM' as const,
      prompt: '只读结构化输出。',
      allowedRoots: [],
    };
    for (const [role, outputKind] of [
      ['ROUTER', 'ROUTE_DECISION'],
      ['DEEP_ROUTER', 'ROUTE_DECISION'],
      ['FOCUSED_WORKER', 'TASK_FINDING'],
      ['FOCUSED_WORKER', 'ANSWER'],
      ['FOCUSED_WORKER', 'GUIDE_DIGEST'],
      ['DEEP_WORKER', 'TASK_FINDING'],
      ['DEEP_WORKER', 'ANSWER'],
      ['REDUCER', 'ANSWER'],
    ] as const) {
      const effort = role === 'DEEP_ROUTER' || role === 'DEEP_WORKER' || role === 'REDUCER'
        ? 'HIGH'
        : 'MEDIUM';
      expect(BridgeRequestV1Schema.safeParse({ ...base, role, reasoningEffort: effort, outputKind }).success).toBe(true);
    }
    for (const [role, outputKind] of [
      ['ROUTER', 'ANSWER'],
      ['DEEP_ROUTER', 'TASK_FINDING'],
      ['FOCUSED_WORKER', 'ROUTE_DECISION'],
      ['DEEP_WORKER', 'ROUTE_DECISION'],
      ['REDUCER', 'TASK_FINDING'],
      ['ROUTER', 'GUIDE_DIGEST'],
      ['DEEP_ROUTER', 'GUIDE_DIGEST'],
      ['DEEP_WORKER', 'GUIDE_DIGEST'],
      ['REDUCER', 'GUIDE_DIGEST'],
    ] as const) {
      expect(BridgeRequestV1Schema.safeParse({ ...base, role, outputKind }).success).toBe(false);
    }

    const eventBase = { requestId: base.requestId, runId: base.runId, sequence: 1 };
    expect(BridgeEventV1Schema.parse({
      ...eventBase,
      type: 'ROUTE_DECISION',
      payload: { decision: validRouteDecision('DIRECT') },
    }).type).toBe('ROUTE_DECISION');
    expect(BridgeEventV1Schema.parse({
      ...eventBase,
      type: 'TASK_FINDING',
      payload: { finding: santexwellFinding() },
    }).type).toBe('TASK_FINDING');
    expect(BridgeEventV1Schema.safeParse({
      ...eventBase,
      type: 'TASK_FINDING',
      payload: { finding: validRouteDecision('DIRECT') },
    }).success).toBe(false);
    const digest = validGuideDigest();
    expect(BridgeEventV1Schema.parse({
      ...eventBase,
      type: 'GUIDE_DIGEST',
      payload: { digest },
    })).toMatchObject({ type: 'GUIDE_DIGEST', payload: { digest } });
    expect(BridgeEventV1Schema.safeParse({
      ...eventBase,
      type: 'GUIDE_DIGEST',
      payload: { digest, answer: {} },
    }).success).toBe(false);
    expect(BridgeEventV1Schema.safeParse({
      ...eventBase,
      type: 'GUIDE_DIGEST',
      payload: { digest: { ...digest, unexpected: true } },
    }).success).toBe(false);
  });
});

function validGuideDigest() {
  return GuideDigestDraftV1Schema.parse({
    schemaVersion: 1,
    shortSummary: '仅基于当前流程快照生成的摘要。',
    scope: { audiences: [], businessObjects: [], systems: [] },
    stageSections: [],
    keyRules: [],
    tagSuggestions: [],
    gaps: [{ code: 'MISSING_ENTRY', message: '快照缺少入口。', sourceIds: [] }],
  });
}

function santexwellFinding() {
  return {
    taskId: 'vault',
    status: 'FOUND',
    findings: ['规范要求异常订单人工复核。'],
    validatedEvidence: [{
      id: 'evidence-vault',
      source: 'SANTEXWELL',
      title: '订单复核规范',
      excerpt: '异常订单需要人工复核。',
      locator: {
        kind: 'SANTEXWELL',
        documentId: 'document-orders',
        fragmentId: 'fragment-review',
        relativePath: 'wiki_v2/订单复核规范.md',
        revision: 'revision-7',
        heading: '异常处理',
      },
    }],
    conflicts: [],
    gaps: [],
  };
}

function flowEvidence(id: string) {
  return {
    id,
    source: 'WORKSPACE_FLOW',
    title: '订单处理流程',
    excerpt: '提交订单后进入流程复核。',
    locator: {
      kind: 'WORKSPACE_FLOW',
      guideId: 'guide-1',
      snapshotId: 'snapshot-1',
      nodeId: 'review',
    },
  };
}

function internalAnswer() {
  return {
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
        documentId: 'document-orders',
        fragmentId: 'fragment-review',
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
    artifacts: [
      {
        kind: 'REPORT',
        title: '流程检查报告',
        summary: '现有流程需要增加异常复核。',
        sections: [{ title: '发现', markdown: '退回分支没有复核节点。' }],
      },
      {
        kind: 'DIAGRAM',
        title: '建议流程',
        direction: 'LR',
        nodes: [
          { id: 'submit', label: '提交订单' },
          { id: 'review', label: '复核订单' },
        ],
        edges: [{ id: 'submit-review', source: 'submit', target: 'review' }],
      },
      {
        kind: 'FLOW_PROPOSAL',
        title: '异常复核修改建议',
        guideId: 'guide-1',
        baseSnapshotId: 'snapshot-1',
        summary: '在退回分支增加复核节点。',
        changes: [{ id: 'change-1', kind: 'ADD_NODE', summary: '增加异常复核节点。' }],
      },
      {
        kind: 'REFERENCE_COLLECTION',
        title: '结论依据',
        evidenceIds: ['evidence-vault'],
      },
    ],
    suggestedQuestions: ['是否需要生成流程修改建议？'],
  };
}

function committedAnswer(flowFeedback: unknown[]) {
  return {
    mode: 'FLOW_REVIEW',
    conclusion: '现有流程缺少异常复核。',
    sections: [{ id: 'details', title: '检查结果', markdown: '退回分支没有复核节点。' }],
    evidenceStatus: 'SUPPORTED',
    citations: [],
    flowFeedback,
    artifacts: [],
    suggestedQuestions: ['是否需要生成流程修改建议？'],
  };
}

function sourceOptions() {
  return {
    workspaceFlows: true,
    workspaceDocuments: true,
    sessionAttachments: false,
    santexwell: false,
  };
}

function focusedBudget() {
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

type RouteTaskFixture = {
  id: string;
  kind: 'WORKSPACE_FLOW' | 'WORKSPACE_DOCUMENT' | 'SESSION_ATTACHMENT' | 'SANTEXWELL' | 'REDUCE';
  objective: string;
  dependsOn: string[];
  priority: number;
};

type DecisionOverrides = {
  sources?: ReturnType<typeof sourceOptions>;
  budget?: ReturnType<typeof focusedBudget>;
  executionMode?: 'SEQUENTIAL' | 'PARALLEL';
  maxConcurrency?: number;
};

function routeTask(
  id: string,
  kind: RouteTaskFixture['kind'],
  dependsOn: string[] = [],
): RouteTaskFixture {
  return { id, kind, objective: `执行 ${id}`, dependsOn, priority: 1 };
}

function routeDecision(
  route: 'DIRECT' | 'FOCUSED' | 'COMPOSITE' | 'OPEN_RESEARCH',
  tasks: RouteTaskFixture[],
  overrides: DecisionOverrides = {},
) {
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
    route,
    sources: overrides.sources ?? sourceOptions(),
    tasks,
    budget: overrides.budget ?? focusedBudget(),
    executionMode: overrides.executionMode ?? 'SEQUENTIAL',
    maxConcurrency: overrides.maxConcurrency ?? 1,
    stopConditions: ['已找到足够证据支撑结论'],
    confidence: 0.84,
    userFacingPlan: '先检查当前流程节点，再核对相关说明。',
  } as const;
}

function focusedDecision(tasks: RouteTaskFixture[], overrides: DecisionOverrides = {}) {
  return routeDecision('FOCUSED', tasks, {
    sources: { workspaceFlows: true, workspaceDocuments: true, sessionAttachments: true, santexwell: true },
    budget: focusedBudget(),
    ...overrides,
  });
}

function compositeDecision(tasks: RouteTaskFixture[], overrides: DecisionOverrides = {}) {
  return routeDecision('COMPOSITE', tasks, {
    sources: { workspaceFlows: true, workspaceDocuments: true, sessionAttachments: true, santexwell: true },
    budget: compositeBudget(),
    executionMode: 'PARALLEL',
    maxConcurrency: 2,
    ...overrides,
  });
}

function openResearchDecision(tasks: RouteTaskFixture[], overrides: DecisionOverrides = {}) {
  return routeDecision('OPEN_RESEARCH', tasks, {
    sources: { workspaceFlows: true, workspaceDocuments: true, sessionAttachments: true, santexwell: true },
    budget: openBudget(),
    executionMode: 'PARALLEL',
    maxConcurrency: 2,
    ...overrides,
  });
}

function validRouteDecision(route: 'DIRECT' | 'FOCUSED' | 'COMPOSITE' | 'OPEN_RESEARCH') {
  if (route === 'DIRECT') {
    return routeDecision(route, [routeTask('flow', 'WORKSPACE_FLOW')], {
      sources: { workspaceFlows: true, workspaceDocuments: false, sessionAttachments: false, santexwell: false },
      budget: directBudget(),
    });
  }
  if (route === 'FOCUSED') {
    return focusedDecision([routeTask('flow', 'WORKSPACE_FLOW')], {
      sources: { workspaceFlows: true, workspaceDocuments: false, sessionAttachments: false, santexwell: false },
    });
  }
  if (route === 'COMPOSITE') {
    return compositeDecision([
      routeTask('flow', 'WORKSPACE_FLOW'),
      routeTask('documents', 'WORKSPACE_DOCUMENT', ['flow']),
      routeTask('reduce', 'REDUCE', ['flow', 'documents']),
    ], {
      sources: { workspaceFlows: true, workspaceDocuments: true, sessionAttachments: false, santexwell: false },
    });
  }
  return openResearchDecision([
    routeTask('flow', 'WORKSPACE_FLOW'),
    routeTask('vault', 'SANTEXWELL'),
    routeTask('reduce', 'REDUCE', ['flow', 'vault']),
  ], {
    sources: { workspaceFlows: true, workspaceDocuments: false, sessionAttachments: false, santexwell: true },
  });
}

function directBudget() {
  return {
    maxWorkers: 1,
    maxConcurrency: 1,
    maxWorkspaceCandidates: 1,
    maxFlowHops: 1,
    maxVaultClusters: 0,
    maxVaultDigests: 0,
    allowRaw: false,
    useReducer: false,
  };
}

function compositeBudget() {
  return {
    maxWorkers: 2,
    maxConcurrency: 2,
    maxWorkspaceCandidates: 12,
    maxFlowHops: 2,
    maxVaultClusters: 1,
    maxVaultDigests: 2,
    allowRaw: false,
    useReducer: true,
  };
}

function openBudget() {
  return {
    maxWorkers: 2,
    maxConcurrency: 2,
    maxWorkspaceCandidates: 12,
    maxFlowHops: 2,
    maxVaultClusters: 2,
    maxVaultDigests: 6,
    allowRaw: true,
    useReducer: true,
  };
}

import { z } from 'zod';

import { FlowLocatorV1Schema } from './flow-knowledge';

const IdV1Schema = z.string().min(1).max(200);
const OpaqueReferenceIdV1Schema = IdV1Schema.refine(
  (value) => encodeURIComponentSafely(value) !== null,
  '引用 ID 必须是可安全编码的 Unicode 文本',
);
const ShortTextV1Schema = z.string().min(1).max(500);
const MarkdownV1Schema = z.string().max(200_000);
const TimestampV1Schema = z.string().datetime();
export const EvidenceSourceV1Schema = z.enum([
  'WORKSPACE_FLOW',
  'WORKSPACE_DOCUMENT',
  'SESSION_ATTACHMENT',
  'SANTEXWELL',
  'PRIOR_CONVERSATION',
]);

export const SourceOptionsV1Schema = z.object({
  workspaceFlows: z.boolean(),
  workspaceDocuments: z.boolean(),
  sessionAttachments: z.boolean(),
  santexwell: z.boolean(),
}).strict();

export const RouteBudgetV1Schema = z.object({
  maxWorkers: z.number().int().min(0).max(4),
  maxConcurrency: z.number().int().min(1).max(3),
  maxWorkspaceCandidates: z.number().int().min(0).max(12),
  maxFlowHops: z.number().int().min(0).max(2),
  maxVaultClusters: z.number().int().min(0).max(2),
  maxVaultDigests: z.number().int().min(0).max(6),
  allowRaw: z.boolean(),
  useReducer: z.boolean(),
}).strict();

export const RouteComplexityV1Schema = z.object({
  scopeBreadth: z.number().int().min(1).max(5),
  evidenceDepth: z.number().int().min(1).max(5),
  crossSourceNeed: z.number().int().min(1).max(5),
  decompositionNeed: z.number().int().min(1).max(5),
  ambiguity: z.number().int().min(1).max(5),
}).strict();

export const RouteTaskV1Schema = z.object({
  id: IdV1Schema,
  kind: z.enum([
    'WORKSPACE_FLOW',
    'WORKSPACE_DOCUMENT',
    'SESSION_ATTACHMENT',
    'SANTEXWELL',
    'REDUCE',
  ]),
  objective: z.string().min(1).max(2_000),
  dependsOn: z.array(IdV1Schema).max(4),
  priority: z.number().int().min(1).max(5),
}).strict();

export const RouteDecisionV1Schema = z.object({
  intent: z.string().min(1).max(2_000),
  complexity: RouteComplexityV1Schema,
  contextAssessment: z.string().min(1).max(5_000),
  route: z.enum(['DIRECT', 'FOCUSED', 'COMPOSITE', 'OPEN_RESEARCH']),
  sources: SourceOptionsV1Schema,
  tasks: z.array(RouteTaskV1Schema).max(5),
  budget: RouteBudgetV1Schema,
  executionMode: z.enum(['SEQUENTIAL', 'PARALLEL']),
  maxConcurrency: z.number().int().min(1).max(3),
  stopConditions: z.array(z.string().min(1).max(1_000)).min(1).max(12),
  confidence: z.number().min(0).max(1),
  userFacingPlan: z.string().min(1).max(5_000),
}).strict().superRefine((decision, context) => {
  const taskIds = new Set<string>();
  decision.tasks.forEach((task, index) => {
    if (taskIds.has(task.id)) {
      context.addIssue({ code: 'custom', path: ['tasks', index, 'id'], message: '任务 ID 必须唯一' });
    }
    taskIds.add(task.id);
  });
  decision.tasks.forEach((task, taskIndex) => {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      context.addIssue({
        code: 'custom',
        path: ['tasks', taskIndex, 'dependsOn'],
        message: '任务依赖不能重复',
      });
    }
    task.dependsOn.forEach((dependency, dependencyIndex) => {
      if (dependency === task.id || !taskIds.has(dependency)) {
        context.addIssue({
          code: 'custom',
          path: ['tasks', taskIndex, 'dependsOn', dependencyIndex],
          message: '任务依赖必须指向其他已提交任务',
        });
      }
    });
  });
  const indegreeByTaskId = new Map(decision.tasks.map((task) => [task.id, 0]));
  const dependentsByTaskId = new Map<string, string[]>();
  decision.tasks.forEach((task) => {
    new Set(task.dependsOn).forEach((dependency) => {
      if (dependency === task.id || !taskIds.has(dependency)) return;
      indegreeByTaskId.set(task.id, (indegreeByTaskId.get(task.id) ?? 0) + 1);
      const dependents = dependentsByTaskId.get(dependency);
      if (dependents) dependents.push(task.id);
      else dependentsByTaskId.set(dependency, [task.id]);
    });
  });
  const ready = [...indegreeByTaskId]
    .filter(([, indegree]) => indegree === 0)
    .map(([taskId]) => taskId);
  let visited = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const taskId = ready[index]!;
    visited += 1;
    (dependentsByTaskId.get(taskId) ?? []).forEach((dependentId) => {
      const nextIndegree = (indegreeByTaskId.get(dependentId) ?? 0) - 1;
      indegreeByTaskId.set(dependentId, nextIndegree);
      if (nextIndegree === 0) ready.push(dependentId);
    });
  }
  if (visited !== decision.tasks.length) {
    context.addIssue({ code: 'custom', path: ['tasks'], message: '任务依赖不能形成循环' });
  }
  if (decision.maxConcurrency > decision.budget.maxConcurrency) {
    context.addIssue({ code: 'custom', path: ['maxConcurrency'], message: '执行并发不能超过路线预算' });
  }
  if (decision.executionMode === 'SEQUENTIAL' && decision.maxConcurrency !== 1) {
    context.addIssue({ code: 'custom', path: ['maxConcurrency'], message: '顺序执行的最大并发必须为 1' });
  }

  const sourceEnabledByTaskKind = {
    WORKSPACE_FLOW: decision.sources.workspaceFlows,
    WORKSPACE_DOCUMENT: decision.sources.workspaceDocuments,
    SESSION_ATTACHMENT: decision.sources.sessionAttachments,
    SANTEXWELL: decision.sources.santexwell,
  } as const;
  decision.tasks.forEach((task, index) => {
    if (task.kind !== 'REDUCE' && !sourceEnabledByTaskKind[task.kind]) {
      context.addIssue({
        code: 'custom',
        path: ['tasks', index, 'kind'],
        message: '任务不能使用已禁用的数据源',
      });
    }
  });

  const workers = decision.tasks.filter((task) => task.kind !== 'REDUCE');
  const reducers = decision.tasks.filter((task) => task.kind === 'REDUCE');
  if (workers.length > decision.budget.maxWorkers) {
    context.addIssue({ code: 'custom', path: ['tasks'], message: '工作任务数量不能超过路线预算' });
  }
  if (decision.tasks.length > decision.budget.maxWorkers + 1) {
    context.addIssue({ code: 'custom', path: ['tasks'], message: '总任务数不能超过工作任务预算加一个汇总任务' });
  }

  if (decision.route === 'DIRECT') {
    if (workers.length > 1 || decision.budget.maxWorkers > 1) {
      context.addIssue({ code: 'custom', path: ['budget', 'maxWorkers'], message: 'DIRECT 路线最多允许一个工作任务' });
    }
    if (decision.executionMode !== 'SEQUENTIAL') {
      context.addIssue({ code: 'custom', path: ['executionMode'], message: 'DIRECT 路线必须顺序执行' });
    }
    if (decision.maxConcurrency !== 1 || decision.budget.maxConcurrency !== 1) {
      context.addIssue({ code: 'custom', path: ['maxConcurrency'], message: 'DIRECT 路线的最大并发必须为 1' });
    }
    if (reducers.length > 0 || decision.budget.useReducer) {
      context.addIssue({ code: 'custom', path: ['budget', 'useReducer'], message: 'DIRECT 路线不能使用汇总任务' });
    }
    if (decision.budget.allowRaw) {
      context.addIssue({ code: 'custom', path: ['budget', 'allowRaw'], message: 'DIRECT 路线不能读取原始资料' });
    }
    if (decision.budget.maxWorkspaceCandidates > 1) {
      context.addIssue({ code: 'custom', path: ['budget', 'maxWorkspaceCandidates'], message: 'DIRECT 路线最多检查一个工作区候选项' });
    }
    if (decision.budget.maxFlowHops > 1) {
      context.addIssue({ code: 'custom', path: ['budget', 'maxFlowHops'], message: 'DIRECT 路线最多遍历一跳流程' });
    }
    if (decision.budget.maxVaultClusters !== 0 || decision.budget.maxVaultDigests !== 0) {
      context.addIssue({ code: 'custom', path: ['budget'], message: 'DIRECT 路线不能使用知识库聚类或摘要' });
    }
  }

  if (decision.route === 'FOCUSED') {
    if (workers.length !== 1 || decision.budget.maxWorkers !== 1) {
      context.addIssue({ code: 'custom', path: ['budget', 'maxWorkers'], message: 'FOCUSED 路线必须且只能安排一个工作任务' });
    }
    if (decision.maxConcurrency !== 1 || decision.budget.maxConcurrency !== 1) {
      context.addIssue({ code: 'custom', path: ['maxConcurrency'], message: 'FOCUSED 路线的最大并发必须为 1' });
    }
    if (reducers.length > 0 || decision.budget.useReducer) {
      context.addIssue({ code: 'custom', path: ['budget', 'useReducer'], message: 'FOCUSED 路线不能使用汇总任务' });
    }
    if (decision.budget.allowRaw) {
      context.addIssue({ code: 'custom', path: ['budget', 'allowRaw'], message: 'FOCUSED 路线不能读取原始资料' });
    }
    if (decision.budget.maxWorkspaceCandidates > 3) {
      context.addIssue({ code: 'custom', path: ['budget', 'maxWorkspaceCandidates'], message: 'FOCUSED 路线最多检查三个工作区候选项' });
    }
    if (decision.budget.maxFlowHops > 2) {
      context.addIssue({ code: 'custom', path: ['budget', 'maxFlowHops'], message: 'FOCUSED 路线最多遍历两跳流程' });
    }
    if (decision.budget.maxVaultClusters > 1 || decision.budget.maxVaultDigests > 2) {
      context.addIssue({ code: 'custom', path: ['budget'], message: 'FOCUSED 路线的知识库预算超出上限' });
    }
  }

  if (decision.route === 'COMPOSITE') {
    if (
      workers.length < 2
      || workers.length > 3
      || decision.budget.maxWorkers < 2
      || decision.budget.maxWorkers > 3
    ) {
      context.addIssue({ code: 'custom', path: ['budget', 'maxWorkers'], message: 'COMPOSITE 路线必须允许并安排二至三个工作任务' });
    }
    if (decision.budget.allowRaw) {
      context.addIssue({ code: 'custom', path: ['budget', 'allowRaw'], message: 'COMPOSITE 路线不能读取原始资料' });
    }
    if (decision.budget.maxVaultClusters > 1 || decision.budget.maxVaultDigests > 2) {
      context.addIssue({ code: 'custom', path: ['budget'], message: 'COMPOSITE 路线最多使用一个主要知识库聚类及两个摘要' });
    }
    validateReducerTopology(decision.budget.useReducer, workers, reducers, context);
  }

  if (decision.route === 'OPEN_RESEARCH') {
    if (workers.length < 2 || workers.length > 4 || decision.budget.maxWorkers < 2 || decision.budget.maxWorkers > 4) {
      context.addIssue({ code: 'custom', path: ['budget', 'maxWorkers'], message: 'OPEN_RESEARCH 路线必须允许并安排二至四个工作任务' });
    }
    if (decision.budget.maxVaultClusters > 2 || decision.budget.maxVaultDigests > 6) {
      context.addIssue({ code: 'custom', path: ['budget'], message: 'OPEN_RESEARCH 路线的知识库预算超出上限' });
    }
    validateReducerTopology(decision.budget.useReducer, workers, reducers, context);
  }
});

function validateReducerTopology(
  useReducer: boolean,
  workers: readonly { id: string }[],
  reducers: readonly { dependsOn: readonly string[] }[],
  context: z.RefinementCtx,
): void {
  if (!useReducer) {
    context.addIssue({ code: 'custom', path: ['budget', 'useReducer'], message: '该路线必须启用汇总任务' });
  }
  if (reducers.length !== 1) {
    context.addIssue({ code: 'custom', path: ['tasks'], message: '该路线必须且只能包含一个汇总任务' });
    return;
  }

  const workerIds = new Set(workers.map((worker) => worker.id));
  const reducerDependencies = reducers[0]!.dependsOn;
  if (
    reducerDependencies.length !== workerIds.size
    || reducerDependencies.some((dependency) => !workerIds.has(dependency))
  ) {
    context.addIssue({ code: 'custom', path: ['tasks'], message: '汇总任务必须依赖全部且仅依赖工作任务' });
  }
}

const WorkspaceFlowLocatorV1Schema = z.object({
  kind: z.literal('WORKSPACE_FLOW'),
  ...FlowLocatorV1Schema.shape,
}).strict();

const WorkspaceDocumentLocatorV1Schema = z.object({
  kind: z.literal('WORKSPACE_DOCUMENT'),
  workspaceId: IdV1Schema,
  sourceItemId: IdV1Schema,
  documentId: IdV1Schema,
  revision: IdV1Schema,
  fragmentId: IdV1Schema.optional(),
}).strict();

export const SessionAttachmentLocatorV1Schema = z.object({
  kind: z.literal('SESSION_ATTACHMENT'),
  conversationId: IdV1Schema,
  attachmentId: IdV1Schema,
  documentId: IdV1Schema,
  revision: IdV1Schema,
  fragmentId: IdV1Schema.optional(),
}).strict();

export const SantexwellLocatorV1Schema = z.object({
  kind: z.literal('SANTEXWELL'),
  documentId: IdV1Schema,
  fragmentId: IdV1Schema.optional(),
  relativePath: z.string().min(1).max(2_048).refine(isSafeVaultRelativePath, '知识路径必须是安全的 Markdown 相对路径'),
  revision: IdV1Schema,
  heading: z.string().min(1).max(500).optional(),
}).strict();

const PriorConversationLocatorV1Schema = z.object({
  kind: z.literal('PRIOR_CONVERSATION'),
  conversationId: IdV1Schema,
  messageId: IdV1Schema,
}).strict();

export const InternalEvidenceLocatorV1Schema = z.discriminatedUnion('kind', [
  WorkspaceFlowLocatorV1Schema,
  WorkspaceDocumentLocatorV1Schema,
  SessionAttachmentLocatorV1Schema,
  SantexwellLocatorV1Schema,
  PriorConversationLocatorV1Schema,
]);

export const ValidatedEvidenceV1Schema = z.object({
  id: IdV1Schema,
  source: EvidenceSourceV1Schema,
  title: ShortTextV1Schema,
  excerpt: z.string().min(1).max(10_000),
  locator: InternalEvidenceLocatorV1Schema,
}).strict().superRefine((evidence, context) => {
  if (evidence.source !== evidence.locator.kind) {
    context.addIssue({ code: 'custom', path: ['locator', 'kind'], message: '证据来源必须匹配 locator 类型' });
  }
});

export const TaskFindingStatusV1Schema = z.enum(['FOUND', 'NO_EVIDENCE', 'PARTIAL', 'CONFLICT']);

export const TaskFindingV1Schema = z.object({
  taskId: IdV1Schema,
  status: TaskFindingStatusV1Schema,
  findings: z.array(z.string().min(1).max(5_000)).max(100),
  validatedEvidence: z.array(ValidatedEvidenceV1Schema).max(100),
  conflicts: z.array(z.string().min(1).max(5_000)).max(50),
  gaps: z.array(z.string().min(1).max(5_000)).max(50),
}).strict();

export const PublicTaskFindingV1Schema = z.object({
  taskId: IdV1Schema,
  status: TaskFindingStatusV1Schema,
  summary: z.string().min(1).max(5_000),
  conflicts: z.array(z.string().min(1).max(5_000)).max(50),
  gaps: z.array(z.string().min(1).max(5_000)).max(50),
  evidenceCount: z.number().int().min(0).max(100),
}).strict();

const PublicReferenceV1Shape = {
  referenceId: OpaqueReferenceIdV1Schema,
  href: z.string().min(1).max(2_048).nullable(),
  invalidReason: z.string().min(1).max(1_000).optional(),
};

export const PublicReferenceV1Schema = z.object(PublicReferenceV1Shape)
  .strict()
  .superRefine(validatePublicReference);

export const CitationV1Schema = z.object({
  ...PublicReferenceV1Shape,
  source: EvidenceSourceV1Schema,
  title: ShortTextV1Schema,
  excerpt: z.string().min(1).max(10_000),
}).strict().superRefine(validatePublicReference);

function validatePublicReference(
  reference: { referenceId: string; href: string | null; invalidReason?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (reference.href === null && !reference.invalidReason) {
    context.addIssue({ code: 'custom', path: ['invalidReason'], message: '不可导航的引用必须说明失效原因' });
  }
  if (reference.href !== null && reference.invalidReason) {
    context.addIssue({ code: 'custom', path: ['invalidReason'], message: '有效引用不能同时标记失效原因' });
  }
  if (reference.href !== null) {
    const encodedReferenceId = encodeURIComponentSafely(reference.referenceId);
    if (encodedReferenceId === null || reference.href !== `/references/${encodedReferenceId}`) {
      context.addIssue({ code: 'custom', path: ['href'], message: '引用地址必须精确匹配不透明 reference 路由' });
    }
  }
}

const InternalArtifactBaseV1Shape = {
  title: z.string().min(1).max(200),
};

const ArtifactBaseV1Shape = {
  id: IdV1Schema,
  runId: IdV1Schema,
  ...InternalArtifactBaseV1Shape,
  createdAt: TimestampV1Schema,
};

export const FlowProposalChangeV1Schema = z.object({
  id: IdV1Schema,
  kind: z.enum(['ADD_NODE', 'UPDATE_NODE', 'REMOVE_NODE', 'ADD_EDGE', 'UPDATE_EDGE', 'REMOVE_EDGE']),
  summary: z.string().min(1).max(2_000),
}).strict();

export const DiagramNodeV1Schema = z.object({
  id: IdV1Schema,
  label: ShortTextV1Schema,
  summary: z.string().min(1).max(2_000).optional(),
}).strict();

export const DiagramEdgeV1Schema = z.object({
  id: IdV1Schema,
  source: IdV1Schema,
  target: IdV1Schema,
  label: ShortTextV1Schema.optional(),
}).strict();

const ReportArtifactContentV1Shape = {
  summary: z.string().max(5_000),
  sections: z.array(z.object({
    title: z.string().min(1).max(200),
    markdown: MarkdownV1Schema,
  }).strict()).max(100),
};

const DiagramArtifactContentV1Shape = {
  direction: z.enum(['LR', 'TB']),
  nodes: z.array(DiagramNodeV1Schema).min(1).max(200),
  edges: z.array(DiagramEdgeV1Schema).max(400),
};

const FlowProposalArtifactContentV1Shape = {
  guideId: IdV1Schema,
  baseSnapshotId: IdV1Schema,
  summary: z.string().min(1).max(5_000),
  changes: z.array(FlowProposalChangeV1Schema).min(1).max(500),
};

export const DiagramArtifactV1Schema = z.object({
  ...ArtifactBaseV1Shape,
  kind: z.literal('DIAGRAM'),
  ...DiagramArtifactContentV1Shape,
}).strict().superRefine(validateDiagramTopology);

export const InternalDiagramArtifactV1Schema = z.object({
  ...InternalArtifactBaseV1Shape,
  kind: z.literal('DIAGRAM'),
  ...DiagramArtifactContentV1Shape,
}).strict().superRefine(validateDiagramTopology);

export const ReferenceCollectionEntryV1Schema = z.object({
  referenceId: OpaqueReferenceIdV1Schema,
  title: ShortTextV1Schema,
  summary: z.string().min(1).max(2_000),
}).strict();

export const ReferenceCollectionArtifactV1Schema = z.object({
  ...ArtifactBaseV1Shape,
  kind: z.literal('REFERENCE_COLLECTION'),
  references: z.array(ReferenceCollectionEntryV1Schema).min(1).max(200),
}).strict();

const InternalEvidenceIdsV1Schema = z.array(IdV1Schema).min(1).max(200).superRefine((evidenceIds, context) => {
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    context.addIssue({ code: 'custom', message: '内部参考资料的 evidence ID 必须唯一' });
  }
});

export const InternalReferenceCollectionArtifactV1Schema = z.object({
  ...InternalArtifactBaseV1Shape,
  kind: z.literal('REFERENCE_COLLECTION'),
  evidenceIds: InternalEvidenceIdsV1Schema,
}).strict();

export const InternalArtifactV1Schema = z.discriminatedUnion('kind', [
  z.object({
    ...InternalArtifactBaseV1Shape,
    kind: z.literal('REPORT'),
    ...ReportArtifactContentV1Shape,
  }).strict(),
  InternalDiagramArtifactV1Schema,
  z.object({
    ...InternalArtifactBaseV1Shape,
    kind: z.literal('FLOW_PROPOSAL'),
    ...FlowProposalArtifactContentV1Shape,
  }).strict(),
  InternalReferenceCollectionArtifactV1Schema,
]);

export const PublicArtifactV1Schema = z.discriminatedUnion('kind', [
  z.object({
    ...ArtifactBaseV1Shape,
    kind: z.literal('REPORT'),
    ...ReportArtifactContentV1Shape,
  }).strict(),
  DiagramArtifactV1Schema,
  z.object({
    ...ArtifactBaseV1Shape,
    kind: z.literal('FLOW_PROPOSAL'),
    ...FlowProposalArtifactContentV1Shape,
  }).strict(),
  ReferenceCollectionArtifactV1Schema,
]);

export const ArtifactV1Schema = PublicArtifactV1Schema;

function validateDiagramTopology(
  diagram: {
    nodes: readonly { id: string }[];
    edges: readonly { id: string; source: string; target: string }[];
  },
  context: z.RefinementCtx,
): void {
  const nodeIds = new Set<string>();
  diagram.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) {
      context.addIssue({ code: 'custom', path: ['nodes', index, 'id'], message: '图示节点 ID 必须唯一' });
    }
    nodeIds.add(node.id);
  });

  const edgeIds = new Set<string>();
  diagram.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      context.addIssue({ code: 'custom', path: ['edges', index, 'id'], message: '图示连线 ID 必须唯一' });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) {
      context.addIssue({ code: 'custom', path: ['edges', index, 'source'], message: '图示连线起点必须引用已有节点' });
    }
    if (!nodeIds.has(edge.target)) {
      context.addIssue({ code: 'custom', path: ['edges', index, 'target'], message: '图示连线终点必须引用已有节点' });
    }
  });
}

export const AgentAnswerSectionV1Schema = z.object({
  id: IdV1Schema,
  title: z.string().min(1).max(200),
  markdown: MarkdownV1Schema,
}).strict();

export const FlowFeedbackKindV1Schema = z.enum(['GAP', 'CONFLICT', 'IMPROVEMENT']);

export const InternalFlowFeedbackV1Schema = z.object({
  kind: FlowFeedbackKindV1Schema,
  message: z.string().min(1).max(5_000),
  locator: FlowLocatorV1Schema,
}).strict();

export const FlowFeedbackV1Schema = InternalFlowFeedbackV1Schema;

export const PublicFlowFeedbackV1Schema = z.object({
  kind: FlowFeedbackKindV1Schema,
  message: z.string().min(1).max(5_000),
  ...PublicReferenceV1Shape,
}).strict().superRefine(validatePublicReference);

export const EvidenceStatusV1Schema = z.enum(['SUPPORTED', 'PARTIAL', 'INSUFFICIENT', 'CONFLICTING']);
export const AgentAnswerModeV1Schema = z.enum(['ANSWER', 'REPORT', 'FLOW_REVIEW', 'FLOW_PROPOSAL']);

export const AgentInternalAnswerV1Schema = z.object({
  mode: AgentAnswerModeV1Schema,
  conclusion: z.string().min(1).max(20_000),
  sections: z.array(AgentAnswerSectionV1Schema).max(100),
  evidence: z.array(ValidatedEvidenceV1Schema).max(200),
  flowFeedback: z.array(FlowFeedbackV1Schema).max(100),
  evidenceStatus: EvidenceStatusV1Schema,
  artifacts: z.array(InternalArtifactV1Schema).max(20),
  suggestedQuestions: z.array(z.string().min(1).max(1_000)).max(12),
}).strict().superRefine((answer, context) => {
  const evidenceIds = new Set(answer.evidence.map((evidence) => evidence.id));
  answer.artifacts.forEach((artifact, artifactIndex) => {
    if (artifact.kind !== 'REFERENCE_COLLECTION') return;
    artifact.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      if (!evidenceIds.has(evidenceId)) {
        context.addIssue({
          code: 'custom',
          path: ['artifacts', artifactIndex, 'evidenceIds', evidenceIndex],
          message: '内部参考资料必须引用当前答案中的 validated evidence',
        });
      }
    });
  });
});

export const AgentCommittedAnswerV1Schema = z.object({
  mode: AgentAnswerModeV1Schema,
  conclusion: z.string().min(1).max(20_000),
  sections: z.array(AgentAnswerSectionV1Schema).max(100),
  evidenceStatus: EvidenceStatusV1Schema,
  citations: z.array(CitationV1Schema).max(200),
  flowFeedback: z.array(PublicFlowFeedbackV1Schema).max(100),
  artifacts: z.array(ArtifactV1Schema).max(20),
  suggestedQuestions: z.array(z.string().min(1).max(1_000)).max(12),
}).strict();

const AgentRunEventBaseV1Shape = {
  id: IdV1Schema,
  runId: IdV1Schema,
  sequence: z.number().int().positive(),
  planVersion: z.number().int().positive(),
  createdAt: TimestampV1Schema,
};
const ProvisionalEventV1Shape = {
  ...AgentRunEventBaseV1Shape,
  phase: z.literal('PROVISIONAL'),
  stale: z.boolean().optional(),
};
const CommittedEventV1Shape = {
  ...AgentRunEventBaseV1Shape,
  phase: z.literal('COMMITTED'),
};

export const AgentRunEventV1Schema = z.discriminatedUnion('type', [
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('route.started'),
    payload: z.object({ intent: z.string().min(1).max(2_000).optional() }).strict(),
  }).strict(),
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('route.completed'),
    payload: z.object({
      route: z.enum(['DIRECT', 'FOCUSED', 'COMPOSITE', 'OPEN_RESEARCH']),
      userFacingPlan: z.string().min(1).max(5_000),
    }).strict(),
  }).strict(),
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('plan.committed'),
    payload: z.object({ decision: RouteDecisionV1Schema }).strict(),
  }).strict(),
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('task.started'),
    payload: z.object({ taskId: IdV1Schema, label: ShortTextV1Schema }).strict(),
  }).strict(),
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('task.progress'),
    payload: z.object({
      taskId: IdV1Schema,
      message: z.string().min(1).max(5_000),
      progress: z.number().min(0).max(1).optional(),
    }).strict(),
  }).strict(),
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('task.finding'),
    payload: z.object({ finding: PublicTaskFindingV1Schema }).strict(),
  }).strict(),
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('task.completed'),
    payload: z.object({
      taskId: IdV1Schema,
      status: z.enum(['FOUND', 'NO_EVIDENCE', 'PARTIAL', 'CONFLICT']),
    }).strict(),
  }).strict(),
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('reduce.started'),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...ProvisionalEventV1Shape,
    type: z.literal('answer.draft.delta'),
    payload: z.object({ delta: z.string().min(1).max(50_000) }).strict(),
  }).strict(),
  z.object({
    ...CommittedEventV1Shape,
    type: z.literal('answer.validating'),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...CommittedEventV1Shape,
    type: z.literal('citation.committed'),
    payload: z.object({ citation: CitationV1Schema }).strict(),
  }).strict(),
  z.object({
    ...CommittedEventV1Shape,
    type: z.literal('answer.committed'),
    payload: z.object({ answer: AgentCommittedAnswerV1Schema }).strict(),
  }).strict(),
  z.object({
    ...CommittedEventV1Shape,
    type: z.literal('artifact.committed'),
    payload: z.object({ artifact: ArtifactV1Schema }).strict(),
  }).strict(),
  z.object({
    ...CommittedEventV1Shape,
    type: z.literal('run.completed'),
    payload: z.object({ messageId: IdV1Schema }).strict(),
  }).strict(),
  z.object({
    ...CommittedEventV1Shape,
    type: z.literal('run.failed'),
    payload: z.object({
      code: IdV1Schema,
      message: z.string().min(1).max(5_000),
      retryable: z.boolean(),
    }).strict(),
  }).strict(),
  z.object({
    ...CommittedEventV1Shape,
    type: z.literal('run.cancelled'),
    payload: z.object({ reason: z.string().min(1).max(2_000).optional() }).strict(),
  }).strict(),
]);

export const BridgeModelRoleV1Schema = z.enum([
  'ROUTER',
  'DEEP_ROUTER',
  'FOCUSED_WORKER',
  'DEEP_WORKER',
  'REDUCER',
]);

export const BridgeRunRequestV1Schema = z.object({
  type: z.literal('RUN'),
  requestId: IdV1Schema,
  runId: IdV1Schema,
  planVersion: z.number().int().positive(),
  role: BridgeModelRoleV1Schema,
  reasoningEffort: z.enum(['MEDIUM', 'HIGH']),
  prompt: z.string().min(1).max(500_000),
  allowedRoots: z.array(z.string().min(1).max(4_096)).max(16),
  resumeThreadId: IdV1Schema.optional(),
}).strict();

export const BridgeCancelRequestV1Schema = z.object({
  type: z.literal('CANCEL'),
  requestId: IdV1Schema,
  runId: IdV1Schema,
}).strict();

export const BridgeSteerRequestV1Schema = z.object({
  type: z.literal('STEER'),
  requestId: IdV1Schema,
  runId: IdV1Schema,
  planVersion: z.number().int().positive(),
  instruction: z.string().min(1).max(20_000),
}).strict();

export const BridgeRequestV1Schema = z.discriminatedUnion('type', [
  BridgeRunRequestV1Schema,
  BridgeCancelRequestV1Schema,
  BridgeSteerRequestV1Schema,
]);

const BridgeEventBaseV1Shape = {
  requestId: IdV1Schema,
  runId: IdV1Schema,
  sequence: z.number().int().positive(),
};

export const BridgeEventV1Schema = z.discriminatedUnion('type', [
  z.object({
    ...BridgeEventBaseV1Shape,
    type: z.literal('THREAD_BOUND'),
    payload: z.object({ threadId: IdV1Schema }).strict(),
  }).strict(),
  z.object({
    ...BridgeEventBaseV1Shape,
    type: z.literal('COMMENTARY'),
    payload: z.object({ text: z.string().min(1).max(100_000) }).strict(),
  }).strict(),
  z.object({
    ...BridgeEventBaseV1Shape,
    type: z.literal('FINAL_ANSWER'),
    payload: z.object({ answer: AgentInternalAnswerV1Schema }).strict(),
  }).strict(),
  z.object({
    ...BridgeEventBaseV1Shape,
    type: z.literal('COMPLETED'),
    payload: z.object({}).strict(),
  }).strict(),
  z.object({
    ...BridgeEventBaseV1Shape,
    type: z.literal('FAILED'),
    payload: z.object({
      code: IdV1Schema,
      message: z.string().min(1).max(5_000),
      retryable: z.boolean(),
    }).strict(),
  }).strict(),
]);

function isSafeVaultRelativePath(value: string): boolean {
  if (value.startsWith('/') || value.includes('\\') || !value.toLowerCase().endsWith('.md')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function encodeURIComponentSafely(value: string): string | null {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

export type SourceOptionsV1 = z.infer<typeof SourceOptionsV1Schema>;
export type RouteBudgetV1 = z.infer<typeof RouteBudgetV1Schema>;
export type RouteComplexityV1 = z.infer<typeof RouteComplexityV1Schema>;
export type RouteTaskV1 = z.infer<typeof RouteTaskV1Schema>;
export type RouteDecisionV1 = z.infer<typeof RouteDecisionV1Schema>;
export type EvidenceSourceV1 = z.infer<typeof EvidenceSourceV1Schema>;
export type SessionAttachmentLocatorV1 = z.infer<typeof SessionAttachmentLocatorV1Schema>;
export type SantexwellLocatorV1 = z.infer<typeof SantexwellLocatorV1Schema>;
export type InternalEvidenceLocatorV1 = z.infer<typeof InternalEvidenceLocatorV1Schema>;
export type ValidatedEvidenceV1 = z.infer<typeof ValidatedEvidenceV1Schema>;
export type TaskFindingStatusV1 = z.infer<typeof TaskFindingStatusV1Schema>;
export type TaskFindingV1 = z.infer<typeof TaskFindingV1Schema>;
export type PublicTaskFindingV1 = z.infer<typeof PublicTaskFindingV1Schema>;
export type PublicReferenceV1 = z.infer<typeof PublicReferenceV1Schema>;
export type CitationV1 = z.infer<typeof CitationV1Schema>;
export type FlowProposalChangeV1 = z.infer<typeof FlowProposalChangeV1Schema>;
export type DiagramNodeV1 = z.infer<typeof DiagramNodeV1Schema>;
export type DiagramEdgeV1 = z.infer<typeof DiagramEdgeV1Schema>;
export type DiagramArtifactV1 = z.infer<typeof DiagramArtifactV1Schema>;
export type InternalDiagramArtifactV1 = z.infer<typeof InternalDiagramArtifactV1Schema>;
export type ReferenceCollectionEntryV1 = z.infer<typeof ReferenceCollectionEntryV1Schema>;
export type ReferenceCollectionArtifactV1 = z.infer<typeof ReferenceCollectionArtifactV1Schema>;
export type InternalReferenceCollectionArtifactV1 = z.infer<typeof InternalReferenceCollectionArtifactV1Schema>;
export type InternalArtifactV1 = z.infer<typeof InternalArtifactV1Schema>;
export type PublicArtifactV1 = z.infer<typeof PublicArtifactV1Schema>;
export type ArtifactV1 = z.infer<typeof ArtifactV1Schema>;
export type AgentAnswerSectionV1 = z.infer<typeof AgentAnswerSectionV1Schema>;
export type FlowFeedbackKindV1 = z.infer<typeof FlowFeedbackKindV1Schema>;
export type InternalFlowFeedbackV1 = z.infer<typeof InternalFlowFeedbackV1Schema>;
export type FlowFeedbackV1 = z.infer<typeof FlowFeedbackV1Schema>;
export type PublicFlowFeedbackV1 = z.infer<typeof PublicFlowFeedbackV1Schema>;
export type EvidenceStatusV1 = z.infer<typeof EvidenceStatusV1Schema>;
export type AgentAnswerModeV1 = z.infer<typeof AgentAnswerModeV1Schema>;
export type AgentInternalAnswerV1 = z.infer<typeof AgentInternalAnswerV1Schema>;
export type AgentCommittedAnswerV1 = z.infer<typeof AgentCommittedAnswerV1Schema>;
export type AgentRunEventV1 = z.infer<typeof AgentRunEventV1Schema>;
export type BridgeModelRoleV1 = z.infer<typeof BridgeModelRoleV1Schema>;
export type BridgeRunRequestV1 = z.infer<typeof BridgeRunRequestV1Schema>;
export type BridgeCancelRequestV1 = z.infer<typeof BridgeCancelRequestV1Schema>;
export type BridgeSteerRequestV1 = z.infer<typeof BridgeSteerRequestV1Schema>;
export type BridgeRequestV1 = z.infer<typeof BridgeRequestV1Schema>;
export type BridgeEventV1 = z.infer<typeof BridgeEventV1Schema>;

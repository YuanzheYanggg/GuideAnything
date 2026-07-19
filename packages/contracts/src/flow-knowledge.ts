import { z } from 'zod';

const IdV1Schema = z.string().min(1).max(200);
const ShortTextV1Schema = z.string().min(1).max(200);
const OptionalLongTextV1Schema = z.string().max(100_000).optional();
const IdListV1Schema = z.array(IdV1Schema).max(40_000);

export const FlowSnapshotOriginV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('DRAFT'),
    revision: z.number().int().min(0),
  }).strict(),
  z.object({
    kind: z.literal('PUBLISHED'),
    versionId: IdV1Schema,
    version: z.number().int().positive(),
  }).strict(),
]);

export const FlowLocatorV1Schema = z.object({
  guideId: IdV1Schema,
  snapshotId: IdV1Schema,
  nodeId: IdV1Schema,
}).strict();

export const FlowKnowledgeStageV1Schema = z.object({
  id: IdV1Schema,
  title: z.string().min(1).max(120),
  order: z.number().int().min(0).max(10_000),
  description: z.string().max(1_000).optional(),
}).strict();

export const FlowKnowledgeLaneV1Schema = z.object({
  id: IdV1Schema,
  title: z.string().min(1).max(120),
  kind: z.enum(['ROLE', 'SYSTEM']),
  order: z.number().int().min(0).max(10_000),
}).strict();

const FlowKnowledgeTargetV1Schema = z.object({
  targetNodeId: IdV1Schema.optional(),
  targetLocator: FlowLocatorV1Schema.optional(),
}).strict();

const NormalizedCoordinateV1Schema = z.number().min(0).max(1);
const ImageAnnotationRegionV1Schema = z.object({
  x: NormalizedCoordinateV1Schema,
  y: NormalizedCoordinateV1Schema,
  width: z.number().positive().max(1).optional(),
  height: z.number().positive().max(1).optional(),
}).strict();

const ImageAnnotationCameraV1Schema = z.object({
  centerX: NormalizedCoordinateV1Schema,
  centerY: NormalizedCoordinateV1Schema,
  zoom: z.number().min(1).max(8),
}).strict();

export const FlowKnowledgeImageAnnotationSupplementV1Schema = z.object({
  assetId: IdV1Schema,
  alt: z.string().min(1).max(500),
  caption: z.string().max(1_000).optional(),
}).strict();

export const FlowKnowledgeImageAnnotationV1Schema = z.object({
  id: IdV1Schema,
  order: z.number().int().min(0),
  title: ShortTextV1Schema,
  body: z.string().max(5_000).optional(),
  shape: z.enum(['POINT', 'RECT']),
  region: ImageAnnotationRegionV1Schema,
  camera: ImageAnnotationCameraV1Schema.optional(),
  supplementalImages: z.array(FlowKnowledgeImageAnnotationSupplementV1Schema).max(8).optional(),
  ...FlowKnowledgeTargetV1Schema.shape,
}).strict().superRefine((annotation, context) => {
  const { width, height, x, y } = annotation.region;
  if (annotation.shape === 'POINT' && (width !== undefined || height !== undefined)) {
    context.addIssue({ code: 'custom', path: ['region'], message: '点标注不能包含区域尺寸' });
  }
  if (annotation.shape === 'RECT' && (width === undefined || height === undefined)) {
    context.addIssue({ code: 'custom', path: ['region'], message: '矩形标注必须包含宽度和高度' });
  }
  if (width !== undefined && x + width > 1) {
    context.addIssue({ code: 'custom', path: ['region', 'width'], message: '标注区域不能超出图片宽度' });
  }
  if (height !== undefined && y + height > 1) {
    context.addIssue({ code: 'custom', path: ['region', 'height'], message: '标注区域不能超出图片高度' });
  }
});

export const FlowKnowledgeVideoKeypointV1Schema = z.object({
  id: IdV1Schema,
  title: ShortTextV1Schema,
  timeSeconds: z.number().min(0).max(86_400),
  stepId: IdV1Schema.optional(),
  ...FlowKnowledgeTargetV1Schema.shape,
}).strict();

const AttachmentBaseV1Shape = {
  nodeId: IdV1Schema,
  locator: FlowLocatorV1Schema,
  order: z.number().int().min(0).max(20_000),
};

export const FlowKnowledgeAttachmentV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('MARKDOWN'),
    ...AttachmentBaseV1Shape,
    markdown: z.string().max(100_000),
  }).strict(),
  z.object({
    kind: z.literal('IMAGE'),
    ...AttachmentBaseV1Shape,
    assetId: IdV1Schema.optional(),
    alt: z.string().min(1).max(500),
    caption: z.string().max(1_000).optional(),
    annotations: z.array(FlowKnowledgeImageAnnotationV1Schema).max(500),
  }).strict(),
  z.object({
    kind: z.literal('VIDEO'),
    ...AttachmentBaseV1Shape,
    assetId: IdV1Schema.optional(),
    caption: z.string().max(1_000).optional(),
    keypoints: z.array(FlowKnowledgeVideoKeypointV1Schema).max(500),
  }).strict(),
]);

export const FlowKnowledgeEdgeRefV1Schema = z.object({
  edgeId: IdV1Schema,
  nodeId: IdV1Schema,
  label: z.string().max(200).optional(),
  branchLabel: z.string().min(1).max(200).optional(),
}).strict();

export const FlowKnowledgeNodeV1Schema = z.object({
  id: IdV1Schema,
  locator: FlowLocatorV1Schema,
  kind: z.enum(['start', 'end', 'process', 'decision', 'data', 'subguide']),
  title: ShortTextV1Schema,
  description: z.string().max(5_000).optional(),
  stage: FlowKnowledgeStageV1Schema.nullable(),
  responsibility: FlowKnowledgeLaneV1Schema.nullable(),
  isEntry: z.boolean(),
  isExit: z.boolean(),
  incoming: z.array(FlowKnowledgeEdgeRefV1Schema).max(40_000),
  outgoing: z.array(FlowKnowledgeEdgeRefV1Schema).max(40_000),
  neighborhood: z.object({
    oneHopNodeIds: IdListV1Schema,
    twoHopNodeIds: IdListV1Schema,
  }).strict(),
  attachments: z.array(FlowKnowledgeAttachmentV1Schema).max(20_000),
  subguide: z.object({
    guideId: IdV1Schema,
    versionId: IdV1Schema,
    version: z.number().int().positive(),
    title: ShortTextV1Schema,
  }).strict().optional(),
}).strict().superRefine((node, context) => {
  if (node.kind === 'subguide' && !node.subguide) {
    context.addIssue({ code: 'custom', path: ['subguide'], message: '子指南节点必须包含固定版本摘要' });
  }
  if (node.kind !== 'subguide' && node.subguide) {
    context.addIssue({ code: 'custom', path: ['subguide'], message: '只有子指南节点可以包含子指南摘要' });
  }
});

export const FlowKnowledgeDiagnosticsV1Schema = z.object({
  danglingEdgeIds: IdListV1Schema,
  danglingAttachmentParentIds: IdListV1Schema,
  danglingTargetNodeIds: IdListV1Schema,
  danglingStageIds: IdListV1Schema,
  danglingLaneIds: IdListV1Schema,
  danglingEntryNodeIds: IdListV1Schema,
  danglingExitNodeIds: IdListV1Schema,
}).strict();

export const FlowKnowledgeSnapshotV1Schema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: IdV1Schema,
  workspaceId: IdV1Schema,
  workspaceItemId: IdV1Schema,
  guideId: IdV1Schema,
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000),
  tags: z.array(z.string().min(1).max(50)).max(20),
  origin: FlowSnapshotOriginV1Schema,
  stages: z.array(FlowKnowledgeStageV1Schema).max(200),
  lanes: z.array(FlowKnowledgeLaneV1Schema).max(200),
  entryNodeId: IdV1Schema.optional(),
  exitNodeIds: z.array(IdV1Schema).max(1_000),
  nodes: z.array(FlowKnowledgeNodeV1Schema).max(20_000),
  unattachedResources: z.array(FlowKnowledgeAttachmentV1Schema).max(20_000),
  diagnostics: FlowKnowledgeDiagnosticsV1Schema,
}).strict().superRefine((snapshot, context) => {
  const stageById = uniqueById(snapshot.stages, context, ['stages']);
  const laneById = uniqueById(snapshot.lanes, context, ['lanes']);
  const nodeById = uniqueById(snapshot.nodes, context, ['nodes']);
  const exitNodeIds = new Set<string>();
  snapshot.exitNodeIds.forEach((nodeId, index) => {
    if (exitNodeIds.has(nodeId)) {
      context.addIssue({ code: 'custom', path: ['exitNodeIds', index], message: '出口节点 ID 必须唯一' });
    }
    exitNodeIds.add(nodeId);
  });
  const addressableIds = new Set(nodeById.keys());
  const attachments: Array<{ attachment: FlowKnowledgeAttachmentV1; path: (string | number)[] }> = [];

  snapshot.nodes.forEach((node, nodeIndex) => {
    node.attachments.forEach((attachment, attachmentIndex) => {
      attachments.push({ attachment, path: ['nodes', nodeIndex, 'attachments', attachmentIndex] });
    });
  });
  snapshot.unattachedResources.forEach((attachment, attachmentIndex) => {
    attachments.push({ attachment, path: ['unattachedResources', attachmentIndex] });
  });
  attachments.forEach(({ attachment, path }) => {
    if (addressableIds.has(attachment.nodeId)) {
      context.addIssue({ code: 'custom', path: [...path, 'nodeId'], message: '流程快照中的节点与资料 ID 必须唯一' });
    }
    addressableIds.add(attachment.nodeId);
  });

  snapshot.nodes.forEach((node, nodeIndex) => {
    validateLocator(node.locator, node.id, snapshot, context, ['nodes', nodeIndex, 'locator']);
    if (node.isEntry !== (node.id === snapshot.entryNodeId)) {
      context.addIssue({ code: 'custom', path: ['nodes', nodeIndex, 'isEntry'], message: '节点入口标志必须匹配快照入口' });
    }
    if (node.isExit !== exitNodeIds.has(node.id)) {
      context.addIssue({ code: 'custom', path: ['nodes', nodeIndex, 'isExit'], message: '节点出口标志必须匹配快照出口' });
    }
    if (node.stage) {
      const stage = stageById.get(node.stage.id);
      if (!stage || stage.title !== node.stage.title || stage.order !== node.stage.order || stage.description !== node.stage.description) {
        context.addIssue({ code: 'custom', path: ['nodes', nodeIndex, 'stage'], message: '节点阶段必须匹配快照阶段' });
      }
    }
    if (node.responsibility) {
      const lane = laneById.get(node.responsibility.id);
      if (!lane || lane.title !== node.responsibility.title || lane.kind !== node.responsibility.kind || lane.order !== node.responsibility.order) {
        context.addIssue({ code: 'custom', path: ['nodes', nodeIndex, 'responsibility'], message: '节点责任必须匹配快照泳道' });
      }
    }
    [...node.incoming, ...node.outgoing].forEach((edge, edgeIndex) => {
      if (!nodeById.has(edge.nodeId)) {
        context.addIssue({ code: 'custom', path: ['nodes', nodeIndex, 'relations', edgeIndex, 'nodeId'], message: '邻接关系必须指向快照业务节点' });
      }
    });
    [...node.neighborhood.oneHopNodeIds, ...node.neighborhood.twoHopNodeIds].forEach((nodeId, neighborhoodIndex) => {
      if (!nodeById.has(nodeId)) {
        context.addIssue({ code: 'custom', path: ['nodes', nodeIndex, 'neighborhood', neighborhoodIndex], message: '邻域必须指向快照业务节点' });
      }
    });
  });

  attachments.forEach(({ attachment, path }) => {
    validateLocator(attachment.locator, attachment.nodeId, snapshot, context, [...path, 'locator']);
    const targets = attachment.kind === 'IMAGE' ? attachment.annotations : attachment.kind === 'VIDEO' ? attachment.keypoints : [];
    targets.forEach((target, targetIndex) => {
      if (!target.targetLocator) return;
      if (!target.targetNodeId || target.targetLocator.nodeId !== target.targetNodeId || !addressableIds.has(target.targetNodeId)) {
        context.addIssue({ code: 'custom', path: [...path, 'targets', targetIndex, 'targetLocator'], message: '目标 locator 必须指向快照中的目标节点' });
      }
      validateLocator(target.targetLocator, target.targetNodeId ?? '', snapshot, context, [...path, 'targets', targetIndex, 'targetLocator']);
    });
  });

  if (snapshot.entryNodeId && !nodeById.has(snapshot.entryNodeId)) {
    context.addIssue({ code: 'custom', path: ['entryNodeId'], message: '入口必须指向快照业务节点' });
  }
  snapshot.exitNodeIds.forEach((nodeId, index) => {
    if (!nodeById.has(nodeId)) {
      context.addIssue({ code: 'custom', path: ['exitNodeIds', index], message: '出口必须指向快照业务节点' });
    }
  });
});

export const FlowKnowledgeNodeV2Schema = z.object({
  id: IdV1Schema,
  locator: FlowLocatorV1Schema,
  kind: z.enum(['start', 'end', 'process', 'decision', 'data', 'subguide']),
  title: ShortTextV1Schema,
  description: z.string().max(5_000).optional(),
  stage: FlowKnowledgeStageV1Schema.nullable(),
  responsibility: FlowKnowledgeLaneV1Schema.nullable(),
  isEntry: z.boolean(),
  isExit: z.boolean(),
  subguide: z.object({
    guideId: IdV1Schema,
    versionId: IdV1Schema,
    version: z.number().int().positive(),
    title: ShortTextV1Schema,
  }).strict().optional(),
}).strict().superRefine((node, context) => {
  if (node.kind === 'subguide' && !node.subguide) {
    context.addIssue({ code: 'custom', path: ['subguide'], message: '子指南节点必须包含固定版本摘要' });
  }
  if (node.kind !== 'subguide' && node.subguide) {
    context.addIssue({ code: 'custom', path: ['subguide'], message: '只有子指南节点可以包含子指南摘要' });
  }
});

const FlowKnowledgeResourceBaseV2Shape = {
  id: IdV1Schema,
  locator: FlowLocatorV1Schema,
  order: z.number().int().min(0).max(20_000),
};

export const FlowKnowledgeResourceV2Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('MARKDOWN'),
    ...FlowKnowledgeResourceBaseV2Shape,
    markdown: z.string().max(100_000),
  }).strict(),
  z.object({
    kind: z.literal('IMAGE'),
    ...FlowKnowledgeResourceBaseV2Shape,
    assetId: IdV1Schema.optional(),
    alt: z.string().min(1).max(500),
    caption: z.string().max(1_000).optional(),
    annotations: z.array(FlowKnowledgeImageAnnotationV1Schema).max(500),
  }).strict(),
  z.object({
    kind: z.literal('VIDEO'),
    ...FlowKnowledgeResourceBaseV2Shape,
    assetId: IdV1Schema.optional(),
    caption: z.string().max(1_000).optional(),
    keypoints: z.array(FlowKnowledgeVideoKeypointV1Schema).max(500),
  }).strict(),
]);

export const FlowKnowledgeRelationKindV2Schema = z.enum([
  'FLOW',
  'USES_RESOURCE',
  'RESOURCE_REFERENCE',
]);

export const FlowKnowledgeRelationV2Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('FLOW'),
    id: IdV1Schema,
    sourceNodeId: IdV1Schema,
    targetNodeId: IdV1Schema,
    label: z.string().max(200).optional(),
    branchLabel: z.string().min(1).max(200).optional(),
  }).strict(),
  z.object({
    kind: z.literal('USES_RESOURCE'),
    id: IdV1Schema,
    sourceNodeId: IdV1Schema,
    resourceId: IdV1Schema,
    label: z.string().max(200).optional(),
  }).strict(),
  z.object({
    kind: z.literal('RESOURCE_REFERENCE'),
    id: IdV1Schema,
    sourceResourceId: IdV1Schema,
    targetNodeId: IdV1Schema.optional(),
    targetResourceId: IdV1Schema.optional(),
  }).strict().superRefine((relation, context) => {
    if ((relation.targetNodeId === undefined) === (relation.targetResourceId === undefined)) {
      context.addIssue({ code: 'custom', message: '资料引用必须且只能指向一个节点或资料' });
    }
  }),
]);

export const FlowKnowledgeLearningStepV2Schema = z.object({
  id: IdV1Schema,
  order: z.number().int().min(0).max(20_000),
  targetNodeId: IdV1Schema.optional(),
  targetResourceId: IdV1Schema.optional(),
}).strict().superRefine((step, context) => {
  if ((step.targetNodeId === undefined) === (step.targetResourceId === undefined)) {
    context.addIssue({ code: 'custom', message: '学习步骤必须且只能指向一个节点或资料' });
  }
});

export const FlowKnowledgeDiagnosticsV2Schema = z.object({
  danglingFlowEdgeIds: IdListV1Schema,
  invalidResourceRelationIds: IdListV1Schema,
  unreferencedResourceIds: IdListV1Schema,
  invalidLearningTargetIds: IdListV1Schema,
  excludedDerivedNodeIds: IdListV1Schema,
}).strict();

export const FlowKnowledgeSnapshotV2Schema = z.object({
  schemaVersion: z.literal(2),
  snapshotId: IdV1Schema,
  workspaceId: IdV1Schema,
  workspaceItemId: IdV1Schema,
  guideId: IdV1Schema,
  title: z.string().min(1),
  summary: z.string(),
  tags: z.array(z.string()),
  origin: FlowSnapshotOriginV1Schema,
  stages: z.array(FlowKnowledgeStageV1Schema),
  lanes: z.array(FlowKnowledgeLaneV1Schema),
  nodes: z.array(FlowKnowledgeNodeV2Schema),
  resources: z.array(FlowKnowledgeResourceV2Schema),
  relations: z.array(FlowKnowledgeRelationV2Schema),
  learningPath: z.array(FlowKnowledgeLearningStepV2Schema),
  diagnostics: FlowKnowledgeDiagnosticsV2Schema,
}).strict().superRefine(validateSnapshotGraph);

export const FlowKnowledgeSnapshotSchema = z.discriminatedUnion('schemaVersion', [
  FlowKnowledgeSnapshotV1Schema,
  FlowKnowledgeSnapshotV2Schema,
]);

function validateSnapshotGraph(
  snapshot: FlowKnowledgeSnapshotV2,
  context: z.core.$RefinementCtx<unknown>,
): void {
  const stageById = uniqueById(snapshot.stages, context, ['stages']);
  const laneById = uniqueById(snapshot.lanes, context, ['lanes']);
  const nodeById = uniqueById(snapshot.nodes, context, ['nodes']);
  const resourceById = uniqueById(snapshot.resources, context, ['resources']);
  resourceById.forEach((resource, id) => {
    if (nodeById.has(id)) {
      context.addIssue({ code: 'custom', path: ['resources'], message: '流程快照中的节点与资料 ID 必须唯一' });
    }
    validateLocator(resource.locator, id, snapshot, context, ['resources', id, 'locator']);
  });

  snapshot.nodes.forEach((node, nodeIndex) => {
    validateLocator(node.locator, node.id, snapshot, context, ['nodes', nodeIndex, 'locator']);
    validateNodeStageAndLane(node, stageById, laneById, context, nodeIndex);
  });

  uniqueById(snapshot.relations, context, ['relations']);
  snapshot.relations.forEach((relation, relationIndex) => {
    if (relation.kind === 'FLOW') {
      if (!nodeById.has(relation.sourceNodeId) || !nodeById.has(relation.targetNodeId)) {
        context.addIssue({ code: 'custom', path: ['relations', relationIndex], message: '流程关系必须连接快照业务节点' });
      }
      return;
    }
    if (relation.kind === 'USES_RESOURCE') {
      if (!nodeById.has(relation.sourceNodeId) || !resourceById.has(relation.resourceId)) {
        context.addIssue({ code: 'custom', path: ['relations', relationIndex], message: '资料使用关系必须从业务节点指向资料' });
      }
      return;
    }
    const targetExists = relation.targetNodeId
      ? nodeById.has(relation.targetNodeId)
      : relation.targetResourceId ? resourceById.has(relation.targetResourceId) : false;
    if (!resourceById.has(relation.sourceResourceId) || !targetExists) {
      context.addIssue({ code: 'custom', path: ['relations', relationIndex], message: '资料引用必须指向快照中的节点或资料' });
    }
  });

  const learningOrders = new Set<number>();
  uniqueById(snapshot.learningPath, context, ['learningPath']);
  snapshot.learningPath.forEach((step, stepIndex) => {
    if (learningOrders.has(step.order)) {
      context.addIssue({ code: 'custom', path: ['learningPath', stepIndex, 'order'], message: '学习步骤顺序必须唯一' });
    }
    learningOrders.add(step.order);
    const targetExists = step.targetNodeId
      ? nodeById.has(step.targetNodeId)
      : step.targetResourceId ? resourceById.has(step.targetResourceId) : false;
    if (!targetExists) {
      context.addIssue({ code: 'custom', path: ['learningPath', stepIndex], message: '学习步骤必须指向快照中的节点或资料' });
    }
  });

  snapshot.diagnostics.unreferencedResourceIds.forEach((resourceId, index) => {
    if (!resourceById.has(resourceId)) {
      context.addIssue({ code: 'custom', path: ['diagnostics', 'unreferencedResourceIds', index], message: '未引用资料必须存在于快照中' });
    }
  });
}

function validateNodeStageAndLane(
  node: FlowKnowledgeNodeV2,
  stageById: Map<string, FlowKnowledgeStageV1>,
  laneById: Map<string, FlowKnowledgeLaneV1>,
  context: z.core.$RefinementCtx<unknown>,
  nodeIndex: number,
): void {
  if (node.stage) {
    const stage = stageById.get(node.stage.id);
    if (!stage || stage.title !== node.stage.title || stage.order !== node.stage.order || stage.description !== node.stage.description) {
      context.addIssue({ code: 'custom', path: ['nodes', nodeIndex, 'stage'], message: '节点阶段必须匹配快照阶段' });
    }
  }
  if (node.responsibility) {
    const lane = laneById.get(node.responsibility.id);
    if (!lane || lane.title !== node.responsibility.title || lane.kind !== node.responsibility.kind || lane.order !== node.responsibility.order) {
      context.addIssue({ code: 'custom', path: ['nodes', nodeIndex, 'responsibility'], message: '节点责任必须匹配快照泳道' });
    }
  }
}

function uniqueById<T extends { id: string }>(
  values: T[],
  context: z.core.$RefinementCtx<unknown>,
  path: (string | number)[],
): Map<string, T> {
  const byId = new Map<string, T>();
  values.forEach((value, index) => {
    if (byId.has(value.id)) {
      context.addIssue({ code: 'custom', path: [...path, index, 'id'], message: 'ID 必须唯一' });
    } else {
      byId.set(value.id, value);
    }
  });
  return byId;
}

function validateLocator(
  locator: FlowLocatorV1,
  expectedNodeId: string,
  snapshot: { guideId: string; snapshotId: string },
  context: z.core.$RefinementCtx<unknown>,
  path: (string | number)[],
): void {
  if (locator.guideId !== snapshot.guideId || locator.snapshotId !== snapshot.snapshotId || locator.nodeId !== expectedNodeId) {
    context.addIssue({ code: 'custom', path, message: 'locator 必须匹配快照与节点 identity' });
  }
}

export type FlowSnapshotOriginV1 = z.infer<typeof FlowSnapshotOriginV1Schema>;
export type FlowLocatorV1 = z.infer<typeof FlowLocatorV1Schema>;
export type FlowKnowledgeStageV1 = z.infer<typeof FlowKnowledgeStageV1Schema>;
export type FlowKnowledgeLaneV1 = z.infer<typeof FlowKnowledgeLaneV1Schema>;
export type FlowKnowledgeImageAnnotationV1 = z.infer<typeof FlowKnowledgeImageAnnotationV1Schema>;
export type FlowKnowledgeVideoKeypointV1 = z.infer<typeof FlowKnowledgeVideoKeypointV1Schema>;
export type FlowKnowledgeAttachmentV1 = z.infer<typeof FlowKnowledgeAttachmentV1Schema>;
export type FlowKnowledgeEdgeRefV1 = z.infer<typeof FlowKnowledgeEdgeRefV1Schema>;
export type FlowKnowledgeNodeV1 = z.infer<typeof FlowKnowledgeNodeV1Schema>;
export type FlowKnowledgeDiagnosticsV1 = z.infer<typeof FlowKnowledgeDiagnosticsV1Schema>;
export type FlowKnowledgeSnapshotV1 = z.infer<typeof FlowKnowledgeSnapshotV1Schema>;
export type FlowKnowledgeNodeV2 = z.infer<typeof FlowKnowledgeNodeV2Schema>;
export type FlowKnowledgeResourceV2 = z.infer<typeof FlowKnowledgeResourceV2Schema>;
export type FlowKnowledgeRelationKindV2 = z.infer<typeof FlowKnowledgeRelationKindV2Schema>;
export type FlowKnowledgeRelationV2 = z.infer<typeof FlowKnowledgeRelationV2Schema>;
export type FlowKnowledgeLearningStepV2 = z.infer<typeof FlowKnowledgeLearningStepV2Schema>;
export type FlowKnowledgeDiagnosticsV2 = z.infer<typeof FlowKnowledgeDiagnosticsV2Schema>;
export type FlowKnowledgeSnapshotV2 = z.infer<typeof FlowKnowledgeSnapshotV2Schema>;
export type FlowKnowledgeSnapshot = z.infer<typeof FlowKnowledgeSnapshotSchema>;

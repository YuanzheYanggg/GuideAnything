import {
  CanvasDocumentSchema,
  FlowKnowledgeSnapshotV1Schema,
  FlowKnowledgeSnapshotV2Schema,
  FlowSnapshotOriginV1Schema,
  LessonStepSchema,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type FlowKnowledgeAttachmentV1,
  type FlowKnowledgeDiagnosticsV1,
  type FlowKnowledgeEdgeRefV1,
  type FlowKnowledgeLaneV1,
  type FlowKnowledgeNodeV1,
  type FlowKnowledgeNodeV2,
  type FlowKnowledgeResourceV2,
  type FlowKnowledgeRelationV2,
  type FlowKnowledgeLearningStepV2,
  type FlowKnowledgeSnapshotV1,
  type FlowKnowledgeSnapshotV2,
  type FlowKnowledgeStageV1,
  type FlowSnapshotOriginV1,
  type LessonStep,
} from '@guideanything/contracts';

const PRIMARY_TYPES = new Set<CanvasNode['type']>(['start', 'end', 'process', 'decision', 'data', 'subguide']);
const CONTENT_TYPES = new Set<CanvasNode['type']>(['markdown', 'image', 'video']);

export interface CompileFlowKnowledgeSnapshotInputV1 {
  snapshotId: string;
  workspaceId: string;
  workspaceItemId: string;
  guideId: string;
  title: string;
  summary: string;
  tags: string[];
  origin: FlowSnapshotOriginV1;
  document: CanvasDocument;
}

export interface CompileFlowKnowledgeSnapshotInputV2 extends CompileFlowKnowledgeSnapshotInputV1 {}

export function compileFlowKnowledgeSnapshotV2(
  input: CompileFlowKnowledgeSnapshotInputV2,
): FlowKnowledgeSnapshotV2 {
  const steps = input.document.steps.map((step) => LessonStepSchema.parse(step));
  const document = CanvasDocumentSchema.parse({
    ...input.document,
    steps: steps.filter((step) => input.document.nodes.some((node) => node.id === step.nodeId)),
  });
  const stages = [...(document.stages ?? [])].map(projectStage).sort(compareOrderThenId);
  const lanes = [...(document.lanes ?? [])].map(projectLane).sort(compareOrderThenId);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const primary = document.nodes.filter(isPrimaryNode);
  const resourcesWithOrder = document.nodes
    .map((node, order) => ({ node, order }))
    .filter((item): item is { node: CanvasNode<'markdown' | 'image' | 'video'>; order: number } => isResourceNode(item.node));
  const primaryIds = new Set(primary.map((node) => node.id));
  const resourceIds = new Set(resourcesWithOrder.map(({ node }) => node.id));
  const addressableIds = new Set([...primaryIds, ...resourceIds]);
  const diagnostics = v2DiagnosticsSets();
  document.nodes.forEach((node) => {
    if (node.source) diagnostics.excludedDerivedNodeIds.add(node.id);
  });

  const nodes = primary
    .map((node) => projectNode(node, input.guideId, input.snapshotId, stageById, laneById, document))
    .sort((left, right) => compareId(left.id, right.id));
  const resources = resourcesWithOrder
    .map(({ node, order }) => projectResource(node, order, addressableIds, input.guideId, input.snapshotId))
    .sort((left, right) => left.order - right.order || compareId(left.id, right.id));
  const relations = compileV2Relations(document, primary, resourcesWithOrder, primaryIds, resourceIds, diagnostics);
  const learningPath = compileLearningPath(steps, primaryIds, resourceIds, diagnostics);
  const usedResourceIds = new Set(relations.flatMap((relation) => relation.kind === 'USES_RESOURCE' ? [relation.resourceId] : []));

  return FlowKnowledgeSnapshotV2Schema.parse({
    schemaVersion: 2,
    snapshotId: input.snapshotId,
    workspaceId: input.workspaceId,
    workspaceItemId: input.workspaceItemId,
    guideId: input.guideId,
    title: input.title,
    summary: input.summary,
    tags: [...input.tags],
    origin: FlowSnapshotOriginV1Schema.parse(input.origin),
    stages,
    lanes,
    nodes,
    resources,
    relations,
    learningPath,
    diagnostics: {
      danglingFlowEdgeIds: sorted(diagnostics.danglingFlowEdgeIds),
      invalidResourceRelationIds: sorted(diagnostics.invalidResourceRelationIds),
      unreferencedResourceIds: resources.filter((resource) => !usedResourceIds.has(resource.id)).map((resource) => resource.id),
      invalidLearningTargetIds: sorted(diagnostics.invalidLearningTargetIds),
      excludedDerivedNodeIds: sorted(diagnostics.excludedDerivedNodeIds),
    },
  });
}

interface V2DiagnosticsSets {
  danglingFlowEdgeIds: Set<string>;
  invalidResourceRelationIds: Set<string>;
  invalidLearningTargetIds: Set<string>;
  excludedDerivedNodeIds: Set<string>;
}

function v2DiagnosticsSets(): V2DiagnosticsSets {
  return {
    danglingFlowEdgeIds: new Set(),
    invalidResourceRelationIds: new Set(),
    invalidLearningTargetIds: new Set(),
    excludedDerivedNodeIds: new Set(),
  };
}

function projectStage(stage: NonNullable<CanvasDocument['stages']>[number]): FlowKnowledgeStageV1 {
  return {
    id: stage.id,
    title: stage.title,
    order: stage.order,
    ...(stage.description ? { description: stage.description } : {}),
  };
}

function projectLane(lane: NonNullable<CanvasDocument['lanes']>[number]): FlowKnowledgeLaneV1 {
  return {
    id: lane.id,
    title: lane.title,
    kind: lane.kind,
    order: lane.order,
  };
}

function isResourceNode(node: CanvasNode): node is CanvasNode<'markdown' | 'image' | 'video'> {
  return isContentNode(node) && node.source === undefined;
}

function projectNode(
  node: CanvasNode<'start' | 'end' | 'process' | 'decision' | 'data' | 'subguide'>,
  guideId: string,
  snapshotId: string,
  stageById: Map<string, FlowKnowledgeStageV1>,
  laneById: Map<string, FlowKnowledgeLaneV1>,
  document: CanvasDocument,
): FlowKnowledgeNodeV2 {
  const stage = node.stageId ? stageById.get(node.stageId) ?? null : null;
  const responsibility = node.laneId ? laneById.get(node.laneId) ?? null : null;
  const common = {
    id: node.id,
    locator: { guideId, snapshotId, nodeId: node.id },
    kind: node.type,
    title: node.type === 'subguide' ? node.data.title : node.data.label,
    ...(node.type !== 'subguide' && node.data.description ? { description: node.data.description } : {}),
    stage,
    responsibility,
    isEntry: document.entryNodeId === node.id,
    isExit: document.exitNodeIds.includes(node.id),
  };
  if (node.type !== 'subguide') return common;
  return {
    ...common,
    subguide: {
      guideId: node.data.guideId,
      versionId: node.data.guideVersionId,
      version: node.data.version,
      title: node.data.title,
    },
  };
}

function projectResource(
  node: CanvasNode<'markdown' | 'image' | 'video'>,
  order: number,
  addressableIds: Set<string>,
  guideId: string,
  snapshotId: string,
): FlowKnowledgeResourceV2 {
  const base = {
    id: node.id,
    locator: { guideId, snapshotId, nodeId: node.id },
    order,
  };
  if (node.type === 'markdown') return { kind: 'MARKDOWN', ...base, markdown: node.data.markdown };
  if (node.type === 'image') {
    return {
      kind: 'IMAGE',
      ...base,
      ...(node.data.assetId ? { assetId: node.data.assetId } : {}),
      alt: node.data.alt,
      ...(node.data.caption ? { caption: node.data.caption } : {}),
      annotations: [...(node.data.annotations ?? [])]
        .sort((left, right) => left.order - right.order || compareId(left.id, right.id))
        .map((annotation) => ({
          id: annotation.id,
          order: annotation.order,
          title: annotation.title,
          ...(annotation.body ? { body: annotation.body } : {}),
          shape: annotation.shape,
          region: { ...annotation.region },
          ...(annotation.supplementalImages?.length ? {
            supplementalImages: [...annotation.supplementalImages]
              .sort((left, right) => left.order - right.order || compareId(left.id, right.id))
              .map(({ assetId, alt, caption }) => ({ assetId, alt, ...(caption ? { caption } : {}) })),
          } : {}),
          ...projectTargetReference(annotation.targetNodeId, addressableIds, guideId, snapshotId),
        })),
    };
  }
  return {
    kind: 'VIDEO',
    ...base,
    ...(node.data.assetId ? { assetId: node.data.assetId } : {}),
    ...(node.data.caption ? { caption: node.data.caption } : {}),
    keypoints: [...node.data.keypoints]
      .sort((left, right) => left.timeSeconds - right.timeSeconds || compareId(left.id, right.id))
      .map((keypoint) => ({
        id: keypoint.id,
        title: keypoint.title,
        timeSeconds: keypoint.timeSeconds,
        ...(keypoint.stepId ? { stepId: keypoint.stepId } : {}),
        ...projectTargetReference(keypoint.targetNodeId, addressableIds, guideId, snapshotId),
      })),
  };
}

function projectTargetReference(
  targetNodeId: string | undefined,
  addressableIds: Set<string>,
  guideId: string,
  snapshotId: string,
): { targetNodeId?: string; targetLocator?: { guideId: string; snapshotId: string; nodeId: string } } {
  if (!targetNodeId) return {};
  if (!addressableIds.has(targetNodeId)) return {};
  return {
    targetNodeId,
    targetLocator: { guideId, snapshotId, nodeId: targetNodeId },
  };
}

function compileV2Relations(
  document: CanvasDocument,
  primary: CanvasNode<'start' | 'end' | 'process' | 'decision' | 'data' | 'subguide'>[],
  resources: Array<{ node: CanvasNode<'markdown' | 'image' | 'video'>; order: number }>,
  primaryIds: Set<string>,
  resourceIds: Set<string>,
  diagnostics: V2DiagnosticsSets,
): FlowKnowledgeRelationV2[] {
  const primaryById = new Map(primary.map((node) => [node.id, node]));
  const relationsById = new Map<string, FlowKnowledgeRelationV2>();
  const actualResourceUses = new Set<string>();
  const continuationsByEdgeId = collectContinuations(primary);
  document.edges.forEach((edge) => {
    if (!isSemanticV2Edge(edge, continuationsByEdgeId)) return;
    const sourceIsPrimary = primaryIds.has(edge.source);
    const targetIsPrimary = primaryIds.has(edge.target);
    const sourceIsResource = resourceIds.has(edge.source);
    const targetIsResource = resourceIds.has(edge.target);
    if (sourceIsPrimary && targetIsPrimary) {
      const branchLabel = branchLabelFor(primaryById.get(edge.source), edge);
      addV2Relation(relationsById, {
        kind: 'FLOW',
        id: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        ...(edge.label ? { label: edge.label } : {}),
        ...(branchLabel ? { branchLabel } : {}),
      });
      return;
    }
    if (sourceIsPrimary && targetIsResource) {
      addV2Relation(relationsById, {
        kind: 'USES_RESOURCE',
        id: edge.id,
        sourceNodeId: edge.source,
        resourceId: edge.target,
        ...(edge.label ? { label: edge.label } : {}),
      });
      actualResourceUses.add(resourceUseKey(edge.source, edge.target));
      return;
    }
    if (sourceIsResource || targetIsResource) {
      diagnostics.invalidResourceRelationIds.add(edge.id);
      return;
    }
    diagnostics.danglingFlowEdgeIds.add(edge.id);
  });

  resources.forEach(({ node }) => {
    if (node.contentParentId && primaryIds.has(node.contentParentId) && !actualResourceUses.has(resourceUseKey(node.contentParentId, node.id))) {
      addV2Relation(relationsById, {
        kind: 'USES_RESOURCE',
        id: synthesizedRelationId('USES_RESOURCE', node.contentParentId, node.id),
        sourceNodeId: node.contentParentId,
        resourceId: node.id,
      });
    }
    if (node.contentParentId && !primaryIds.has(node.contentParentId)) diagnostics.invalidResourceRelationIds.add(node.contentParentId);
    resourceReferencesForNode(node, primaryIds, resourceIds, diagnostics).forEach((relation) => addV2Relation(relationsById, relation));
  });

  return [...relationsById.values()].sort(compareV2Relation);
}

function isSemanticV2Edge(edge: CanvasEdge, continuationsByEdgeId: ContinuationsByEdgeId): boolean {
  if (!edge.hidden) return true;
  return continuationsByEdgeId.get(edge.id)?.get(edge.source) === false;
}

function resourceReferencesForNode(
  node: CanvasNode<'markdown' | 'image' | 'video'>,
  primaryIds: Set<string>,
  resourceIds: Set<string>,
  diagnostics: V2DiagnosticsSets,
): FlowKnowledgeRelationV2[] {
  const references = node.type === 'image'
    ? (node.data.annotations ?? []).map((annotation) => ({ id: annotation.id, targetId: annotation.targetNodeId }))
    : node.type === 'video'
      ? node.data.keypoints.map((keypoint) => ({ id: keypoint.id, targetId: keypoint.targetNodeId }))
      : [];
  return references.flatMap<FlowKnowledgeRelationV2>(({ id, targetId }) => {
    if (!targetId) return [];
    if (primaryIds.has(targetId)) {
      return [{
        kind: 'RESOURCE_REFERENCE' as const,
        id: synthesizedRelationId('RESOURCE_REFERENCE', node.id, id),
        sourceResourceId: node.id,
        targetNodeId: targetId,
      }];
    }
    if (resourceIds.has(targetId)) {
      return [{
        kind: 'RESOURCE_REFERENCE' as const,
        id: synthesizedRelationId('RESOURCE_REFERENCE', node.id, id),
        sourceResourceId: node.id,
        targetResourceId: targetId,
      }];
    }
    diagnostics.invalidResourceRelationIds.add(id);
    return [];
  });
}

function compileLearningPath(
  steps: LessonStep[],
  primaryIds: Set<string>,
  resourceIds: Set<string>,
  diagnostics: V2DiagnosticsSets,
): FlowKnowledgeLearningStepV2[] {
  return steps
    .map((step, sourceOrder) => ({ step, sourceOrder }))
    .sort((left, right) => left.step.order - right.step.order || left.sourceOrder - right.sourceOrder || compareId(left.step.id, right.step.id))
    .flatMap<FlowKnowledgeLearningStepV2>(({ step }) => {
      if (primaryIds.has(step.nodeId)) return [{ id: step.id, order: step.order, targetNodeId: step.nodeId }];
      if (resourceIds.has(step.nodeId)) return [{ id: step.id, order: step.order, targetResourceId: step.nodeId }];
      diagnostics.invalidLearningTargetIds.add(step.nodeId);
      return [];
    })
    .map((step, order) => ({ ...step, order }));
}

function resourceUseKey(sourceNodeId: string, resourceId: string): string {
  return `${sourceNodeId}\u0000${resourceId}`;
}

function synthesizedRelationId(kind: 'USES_RESOURCE' | 'RESOURCE_REFERENCE', sourceId: string, targetId: string): string {
  const prefix = kind === 'USES_RESOURCE' ? 'uses' : 'reference';
  return `${prefix}:${stableTupleHash([kind, sourceId, targetId])}`;
}

function stableTupleHash(values: string[]): string {
  let hash = 2_166_136_261;
  for (const character of values.join('\u0000')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function addV2Relation(relationsById: Map<string, FlowKnowledgeRelationV2>, relation: FlowKnowledgeRelationV2): void {
  let id = relation.id;
  let suffix = 2;
  while (relationsById.has(id)) {
    const suffixText = `:${suffix}`;
    id = `${relation.id.slice(0, 200 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  relationsById.set(id, id === relation.id ? relation : { ...relation, id });
}

function compareV2Relation(left: FlowKnowledgeRelationV2, right: FlowKnowledgeRelationV2): number {
  return v2RelationSource(left).localeCompare(v2RelationSource(right))
    || v2RelationTarget(left).localeCompare(v2RelationTarget(right))
    || compareId(left.id, right.id);
}

function v2RelationSource(relation: FlowKnowledgeRelationV2): string {
  return relation.kind === 'RESOURCE_REFERENCE' ? relation.sourceResourceId : relation.sourceNodeId;
}

function v2RelationTarget(relation: FlowKnowledgeRelationV2): string {
  if (relation.kind === 'FLOW') return relation.targetNodeId;
  if (relation.kind === 'USES_RESOURCE') return relation.resourceId;
  return relation.targetNodeId ?? relation.targetResourceId ?? '';
}

export function compileFlowKnowledgeSnapshotV1(
  input: CompileFlowKnowledgeSnapshotInputV1,
): FlowKnowledgeSnapshotV1 {
  const document = CanvasDocumentSchema.parse(input.document);
  const primary = document.nodes.filter(isPrimaryNode);
  const primaryById = new Map(primary.map((node) => [node.id, node]));
  const primaryIds = new Set(primaryById.keys());
  const stages = [...(document.stages ?? [])].sort(compareOrderThenId);
  const lanes = [...(document.lanes ?? [])].sort(compareOrderThenId);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const continuationsByEdgeId = collectContinuations(primary);
  const diagnostics = diagnosticsSets();
  const logicalEdges = collectLogicalEdges(document, primaryIds, continuationsByEdgeId, diagnostics.danglingEdgeIds);
  const { incomingById, outgoingById, adjacencyById } = buildLogicalAdjacency(primaryIds, primaryById, logicalEdges);
  const content = document.nodes
    .map((node, order) => ({ node, order }))
    .filter((item): item is { node: CanvasNode<'markdown' | 'image' | 'video'>; order: number } => isContentNode(item.node));
  const addressableIds = new Set([...primaryIds, ...content.map(({ node }) => node.id)]);
  const { attachmentsByParent, unattachedResources } = collectAttachments(
    content,
    primaryIds,
    addressableIds,
    input.guideId,
    input.snapshotId,
    diagnostics,
  );
  const entryNodeId = primaryIds.has(document.entryNodeId ?? '') ? document.entryNodeId : undefined;
  if (document.entryNodeId && !entryNodeId) diagnostics.danglingEntryNodeIds.add(document.entryNodeId);
  const exitNodeIds = [...new Set(document.exitNodeIds.filter((nodeId) => {
    const included = primaryIds.has(nodeId);
    if (!included) diagnostics.danglingExitNodeIds.add(nodeId);
    return included;
  }))].sort(compareId);

  const nodes = primary
    .map((node) => buildKnowledgeNode({
      node,
      guideId: input.guideId,
      snapshotId: input.snapshotId,
      stageById,
      laneById,
      incoming: incomingById.get(node.id) ?? [],
      outgoing: outgoingById.get(node.id) ?? [],
      adjacencyById,
      attachments: attachmentsByParent.get(node.id) ?? [],
      entryNodeId,
      exitNodeIds: new Set(exitNodeIds),
      diagnostics,
    }))
    .sort((left, right) => compareId(left.id, right.id));

  return FlowKnowledgeSnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotId: input.snapshotId,
    workspaceId: input.workspaceId,
    workspaceItemId: input.workspaceItemId,
    guideId: input.guideId,
    title: input.title,
    summary: input.summary,
    tags: [...input.tags],
    origin: FlowSnapshotOriginV1Schema.parse(input.origin),
    stages,
    lanes,
    ...(entryNodeId ? { entryNodeId } : {}),
    exitNodeIds,
    nodes,
    unattachedResources,
    diagnostics: materializeDiagnostics(diagnostics),
  });
}

interface DiagnosticsSets {
  danglingEdgeIds: Set<string>;
  danglingAttachmentParentIds: Set<string>;
  danglingTargetNodeIds: Set<string>;
  danglingStageIds: Set<string>;
  danglingLaneIds: Set<string>;
  danglingEntryNodeIds: Set<string>;
  danglingExitNodeIds: Set<string>;
}

function diagnosticsSets(): DiagnosticsSets {
  return {
    danglingEdgeIds: new Set(),
    danglingAttachmentParentIds: new Set(),
    danglingTargetNodeIds: new Set(),
    danglingStageIds: new Set(),
    danglingLaneIds: new Set(),
    danglingEntryNodeIds: new Set(),
    danglingExitNodeIds: new Set(),
  };
}

function materializeDiagnostics(diagnostics: DiagnosticsSets): FlowKnowledgeDiagnosticsV1 {
  return {
    danglingEdgeIds: sorted(diagnostics.danglingEdgeIds),
    danglingAttachmentParentIds: sorted(diagnostics.danglingAttachmentParentIds),
    danglingTargetNodeIds: sorted(diagnostics.danglingTargetNodeIds),
    danglingStageIds: sorted(diagnostics.danglingStageIds),
    danglingLaneIds: sorted(diagnostics.danglingLaneIds),
    danglingEntryNodeIds: sorted(diagnostics.danglingEntryNodeIds),
    danglingExitNodeIds: sorted(diagnostics.danglingExitNodeIds),
  };
}

function isPrimaryNode(node: CanvasNode): node is CanvasNode<'start' | 'end' | 'process' | 'decision' | 'data' | 'subguide'> {
  return PRIMARY_TYPES.has(node.type) && node.source === undefined;
}

function isContentNode(node: CanvasNode): node is CanvasNode<'markdown' | 'image' | 'video'> {
  return CONTENT_TYPES.has(node.type) && node.source === undefined;
}

type ContinuationsByEdgeId = Map<string, Map<string, boolean>>;

function collectContinuations(primary: CanvasNode[]): ContinuationsByEdgeId {
  const result: ContinuationsByEdgeId = new Map();
  primary.forEach((node) => {
    if (node.type !== 'subguide') return;
    node.data.expandedContinuationEdges?.forEach((edge) => {
      const bySource = result.get(edge.id) ?? new Map<string, boolean>();
      bySource.set(node.id, edge.hidden);
      result.set(edge.id, bySource);
    });
  });
  return result;
}

function collectLogicalEdges(
  document: CanvasDocument,
  primaryIds: Set<string>,
  continuationsByEdgeId: ContinuationsByEdgeId,
  danglingEdgeIds: Set<string>,
): CanvasEdge[] {
  const result: CanvasEdge[] = [];
  const resolvedContinuationIds = new Set<string>();
  document.edges.forEach((edge) => {
    if (edge.sourceTrace) return;
    const continuationBySource = continuationsByEdgeId.get(edge.id);
    const isDeclaredContinuation = continuationBySource?.has(edge.source) ?? false;
    const wasOriginallyVisible = isDeclaredContinuation && continuationBySource?.get(edge.source) === false;
    if (!primaryIds.has(edge.source) || !primaryIds.has(edge.target)) {
      if (!edge.hidden || wasOriginallyVisible) danglingEdgeIds.add(edge.id);
      return;
    }
    if (isDeclaredContinuation) resolvedContinuationIds.add(edge.id);
    if (!edge.hidden || wasOriginallyVisible) result.push(edge);
  });
  continuationsByEdgeId.forEach((_bySource, edgeId) => {
    if (!resolvedContinuationIds.has(edgeId)) danglingEdgeIds.add(edgeId);
  });
  return result.sort((left, right) => compareId(left.id, right.id));
}

function buildLogicalAdjacency(
  primaryIds: Set<string>,
  primaryById: Map<string, CanvasNode>,
  edges: CanvasEdge[],
): {
  incomingById: Map<string, FlowKnowledgeEdgeRefV1[]>;
  outgoingById: Map<string, FlowKnowledgeEdgeRefV1[]>;
  adjacencyById: Map<string, Set<string>>;
} {
  const incomingById = new Map<string, FlowKnowledgeEdgeRefV1[]>();
  const outgoingById = new Map<string, FlowKnowledgeEdgeRefV1[]>();
  const adjacencyById = new Map<string, Set<string>>();
  primaryIds.forEach((nodeId) => adjacencyById.set(nodeId, new Set()));

  edges.forEach((edge) => {
    const branchLabel = branchLabelFor(primaryById.get(edge.source), edge);
    append(outgoingById, edge.source, {
      edgeId: edge.id,
      nodeId: edge.target,
      ...(edge.label ? { label: edge.label } : {}),
      ...(branchLabel ? { branchLabel } : {}),
    });
    append(incomingById, edge.target, {
      edgeId: edge.id,
      nodeId: edge.source,
      ...(edge.label ? { label: edge.label } : {}),
      ...(branchLabel ? { branchLabel } : {}),
    });
    if (edge.source !== edge.target) {
      adjacencyById.get(edge.source)?.add(edge.target);
      adjacencyById.get(edge.target)?.add(edge.source);
    }
  });

  incomingById.forEach((relations) => relations.sort(compareRelation));
  outgoingById.forEach((relations) => relations.sort(compareRelation));
  return { incomingById, outgoingById, adjacencyById };
}

function branchLabelFor(source: CanvasNode | undefined, edge: CanvasEdge): string | undefined {
  if (source?.type !== 'decision') return undefined;
  if (edge.label?.trim()) return edge.label;
  const handle = edge.sourceHandle?.trim();
  if (!handle) return undefined;
  const normalizedHandle = normalizeBranchLabel(handle);
  const configured = source.data.branchLabels?.find((label) => normalizeBranchLabel(label) === normalizedHandle);
  if (configured) return configured;
  if (normalizedHandle === 'yes') return source.data.branchLabels?.[0] ?? '是';
  if (normalizedHandle === 'no') return source.data.branchLabels?.[1] ?? '否';
  return handle === 'out' ? undefined : handle;
}

function normalizeBranchLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === '是' || normalized === 'yes') return 'yes';
  if (normalized === '否' || normalized === 'no') return 'no';
  return normalized;
}

function collectAttachments(
  content: Array<{ node: CanvasNode<'markdown' | 'image' | 'video'>; order: number }>,
  primaryIds: Set<string>,
  addressableIds: Set<string>,
  guideId: string,
  snapshotId: string,
  diagnostics: DiagnosticsSets,
): { attachmentsByParent: Map<string, FlowKnowledgeAttachmentV1[]>; unattachedResources: FlowKnowledgeAttachmentV1[] } {
  const attachmentsByParent = new Map<string, FlowKnowledgeAttachmentV1[]>();
  const unattachedResources: FlowKnowledgeAttachmentV1[] = [];

  content.forEach(({ node, order }) => {
    const attachment = buildAttachment(node, order, addressableIds, guideId, snapshotId, diagnostics.danglingTargetNodeIds);
    if (node.contentParentId && primaryIds.has(node.contentParentId)) {
      append(attachmentsByParent, node.contentParentId, attachment);
      return;
    }
    if (node.contentParentId) diagnostics.danglingAttachmentParentIds.add(node.contentParentId);
    unattachedResources.push(attachment);
  });
  attachmentsByParent.forEach((attachments) => attachments.sort(compareAttachment));
  unattachedResources.sort(compareAttachment);
  return { attachmentsByParent, unattachedResources };
}

function buildAttachment(
  node: CanvasNode<'markdown' | 'image' | 'video'>,
  order: number,
  addressableIds: Set<string>,
  guideId: string,
  snapshotId: string,
  danglingTargetNodeIds: Set<string>,
): FlowKnowledgeAttachmentV1 {
  const base = {
    nodeId: node.id,
    locator: { guideId, snapshotId, nodeId: node.id },
    order,
  };
  if (node.type === 'markdown') {
    return { kind: 'MARKDOWN', ...base, markdown: node.data.markdown };
  }
  if (node.type === 'image') {
    return {
      kind: 'IMAGE',
      ...base,
      ...(node.data.assetId ? { assetId: node.data.assetId } : {}),
      alt: node.data.alt,
      ...(node.data.caption ? { caption: node.data.caption } : {}),
      annotations: [...(node.data.annotations ?? [])]
        .sort((left, right) => left.order - right.order || compareId(left.id, right.id))
        .map((annotation) => ({
          id: annotation.id,
          order: annotation.order,
          title: annotation.title,
          ...(annotation.body ? { body: annotation.body } : {}),
          shape: annotation.shape,
          region: { ...annotation.region },
          ...(annotation.camera ? { camera: { ...annotation.camera } } : {}),
          ...(annotation.supplementalImages?.length ? {
            supplementalImages: [...annotation.supplementalImages]
              .sort((left, right) => left.order - right.order || compareId(left.id, right.id))
              .map(({ assetId, alt, caption }) => ({
                assetId,
                alt,
                ...(caption ? { caption } : {}),
              })),
          } : {}),
          ...targetReference(annotation.targetNodeId, addressableIds, guideId, snapshotId, danglingTargetNodeIds),
        })),
    };
  }
  return {
    kind: 'VIDEO',
    ...base,
    ...(node.data.assetId ? { assetId: node.data.assetId } : {}),
    ...(node.data.caption ? { caption: node.data.caption } : {}),
    keypoints: [...node.data.keypoints]
      .sort((left, right) => left.timeSeconds - right.timeSeconds || compareId(left.id, right.id))
      .map((keypoint) => ({
        id: keypoint.id,
        title: keypoint.title,
        timeSeconds: keypoint.timeSeconds,
        ...(keypoint.stepId ? { stepId: keypoint.stepId } : {}),
        ...targetReference(keypoint.targetNodeId, addressableIds, guideId, snapshotId, danglingTargetNodeIds),
      })),
  };
}

function targetReference(
  targetNodeId: string | undefined,
  addressableIds: Set<string>,
  guideId: string,
  snapshotId: string,
  danglingTargetNodeIds: Set<string>,
): { targetNodeId?: string; targetLocator?: { guideId: string; snapshotId: string; nodeId: string } } {
  if (!targetNodeId) return {};
  if (!addressableIds.has(targetNodeId)) {
    danglingTargetNodeIds.add(targetNodeId);
    return { targetNodeId };
  }
  return {
    targetNodeId,
    targetLocator: { guideId, snapshotId, nodeId: targetNodeId },
  };
}

interface BuildKnowledgeNodeInput {
  node: CanvasNode<'start' | 'end' | 'process' | 'decision' | 'data' | 'subguide'>;
  guideId: string;
  snapshotId: string;
  stageById: Map<string, FlowKnowledgeStageV1>;
  laneById: Map<string, FlowKnowledgeLaneV1>;
  incoming: FlowKnowledgeEdgeRefV1[];
  outgoing: FlowKnowledgeEdgeRefV1[];
  adjacencyById: Map<string, Set<string>>;
  attachments: FlowKnowledgeAttachmentV1[];
  entryNodeId: string | undefined;
  exitNodeIds: Set<string>;
  diagnostics: DiagnosticsSets;
}

function buildKnowledgeNode({
  node,
  guideId,
  snapshotId,
  stageById,
  laneById,
  incoming,
  outgoing,
  adjacencyById,
  attachments,
  entryNodeId,
  exitNodeIds,
  diagnostics,
}: BuildKnowledgeNodeInput): FlowKnowledgeNodeV1 {
  const stage = node.stageId ? stageById.get(node.stageId) ?? null : null;
  const responsibility = node.laneId ? laneById.get(node.laneId) ?? null : null;
  if (node.stageId && !stage) diagnostics.danglingStageIds.add(node.stageId);
  if (node.laneId && !responsibility) diagnostics.danglingLaneIds.add(node.laneId);
  const oneHopNodeIds = sorted(adjacencyById.get(node.id) ?? new Set());
  const oneHopIds = new Set(oneHopNodeIds);
  const twoHopIds = new Set<string>();
  oneHopNodeIds.forEach((neighborId) => {
    adjacencyById.get(neighborId)?.forEach((candidateId) => {
      if (candidateId !== node.id && !oneHopIds.has(candidateId)) twoHopIds.add(candidateId);
    });
  });
  const common = {
    id: node.id,
    locator: { guideId, snapshotId, nodeId: node.id },
    kind: node.type,
    title: node.type === 'subguide' ? node.data.title : node.data.label,
    ...(node.type !== 'subguide' && node.data.description ? { description: node.data.description } : {}),
    stage,
    responsibility,
    isEntry: node.id === entryNodeId,
    isExit: exitNodeIds.has(node.id),
    incoming,
    outgoing,
    neighborhood: { oneHopNodeIds, twoHopNodeIds: sorted(twoHopIds) },
    attachments,
  };
  if (node.type !== 'subguide') return common;
  return {
    ...common,
    subguide: {
      guideId: node.data.guideId,
      versionId: node.data.guideVersionId,
      version: node.data.version,
      title: node.data.title,
    },
  };
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function compareOrderThenId<T extends { order: number; id: string }>(left: T, right: T): number {
  return left.order - right.order || compareId(left.id, right.id);
}

function compareId(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRelation(left: FlowKnowledgeEdgeRefV1, right: FlowKnowledgeEdgeRefV1): number {
  return compareId(left.edgeId, right.edgeId) || compareId(left.nodeId, right.nodeId);
}

function compareAttachment(left: FlowKnowledgeAttachmentV1, right: FlowKnowledgeAttachmentV1): number {
  return left.order - right.order || compareId(left.nodeId, right.nodeId);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareId);
}

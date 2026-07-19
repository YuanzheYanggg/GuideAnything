import {
  FlowKnowledgeSnapshotSchema,
  FlowKnowledgeSnapshotV2Schema,
  type FlowKnowledgeAttachmentV1,
  type FlowKnowledgeRelationV2,
  type FlowKnowledgeSnapshotV1,
  type FlowKnowledgeSnapshotV2,
} from '@guideanything/contracts';

export function normalizeFlowKnowledgeSnapshot(snapshot: unknown): FlowKnowledgeSnapshotV2 {
  const parsed = FlowKnowledgeSnapshotSchema.parse(snapshot);
  if (parsed.schemaVersion === 2) {
    return FlowKnowledgeSnapshotV2Schema.parse(parsed);
  }

  return FlowKnowledgeSnapshotV2Schema.parse(normalizeV1Snapshot(parsed));
}

function normalizeV1Snapshot(snapshot: FlowKnowledgeSnapshotV1): FlowKnowledgeSnapshotV2 {
  const nodes = snapshot.nodes.map(({ incoming: _incoming, outgoing: _outgoing, neighborhood: _neighborhood, attachments: _attachments, ...node }) => node);
  const embeddedResources = snapshot.nodes.flatMap((node) => node.attachments.map((attachment) => ({
    attachment,
    parentNodeId: node.id,
  })));
  const looseResources = snapshot.unattachedResources.map((attachment) => ({ attachment, parentNodeId: undefined }));
  const resources = [...embeddedResources, ...looseResources]
    .map(({ attachment }) => normalizeResource(attachment))
    .sort((left, right) => compareId(left.id, right.id));
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relations = normalizeRelations(snapshot, embeddedResources, nodeIds, resourceIds);

  return {
    schemaVersion: 2,
    snapshotId: snapshot.snapshotId,
    workspaceId: snapshot.workspaceId,
    workspaceItemId: snapshot.workspaceItemId,
    guideId: snapshot.guideId,
    title: snapshot.title,
    summary: snapshot.summary,
    tags: [...snapshot.tags],
    origin: snapshot.origin,
    stages: snapshot.stages,
    lanes: snapshot.lanes,
    nodes,
    resources,
    relations,
    learningPath: [],
    diagnostics: {
      danglingFlowEdgeIds: sorted(snapshot.diagnostics.danglingEdgeIds),
      invalidResourceRelationIds: sorted([
        ...snapshot.diagnostics.danglingAttachmentParentIds,
        ...snapshot.diagnostics.danglingTargetNodeIds,
      ]),
      unreferencedResourceIds: looseResources.map(({ attachment }) => attachment.nodeId).sort(compareId),
      invalidLearningTargetIds: [],
      excludedDerivedNodeIds: [],
    },
  };
}

function normalizeResource(attachment: FlowKnowledgeAttachmentV1) {
  const { nodeId, ...resource } = attachment;
  return { id: nodeId, ...resource };
}

function normalizeRelations(
  snapshot: FlowKnowledgeSnapshotV1,
  embeddedResources: Array<{ attachment: FlowKnowledgeAttachmentV1; parentNodeId: string }>,
  nodeIds: Set<string>,
  resourceIds: Set<string>,
): FlowKnowledgeRelationV2[] {
  const flowCandidates: FlowKnowledgeRelationV2[] = snapshot.nodes.flatMap((node) => [
    ...node.outgoing.map((edge) => ({
      kind: 'FLOW' as const,
      id: edge.edgeId,
      sourceNodeId: node.id,
      targetNodeId: edge.nodeId,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.branchLabel ? { branchLabel: edge.branchLabel } : {}),
    })),
    ...node.incoming.map((edge) => ({
      kind: 'FLOW' as const,
      id: edge.edgeId,
      sourceNodeId: edge.nodeId,
      targetNodeId: node.id,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.branchLabel ? { branchLabel: edge.branchLabel } : {}),
    })),
  ]);
  const relationsById = new Map<string, FlowKnowledgeRelationV2>();
  flowCandidates.sort(compareRelation).forEach((relation) => relationsById.set(relation.id, relation));

  embeddedResources.forEach(({ attachment, parentNodeId }) => {
    addSynthesizedRelation(relationsById, {
      kind: 'USES_RESOURCE',
      id: `uses:${parentNodeId}:${attachment.nodeId}`,
      sourceNodeId: parentNodeId,
      resourceId: attachment.nodeId,
    });
    resourceReferences(attachment, nodeIds, resourceIds).forEach((relation) => {
      addSynthesizedRelation(relationsById, relation);
    });
  });
  return [...relationsById.values()].sort(compareRelation);
}

function addSynthesizedRelation(
  relationsById: Map<string, FlowKnowledgeRelationV2>,
  relation: FlowKnowledgeRelationV2,
): void {
  let id = relation.id;
  let suffix = 2;
  while (relationsById.has(id)) {
    id = `${relation.id}:${suffix}`;
    suffix += 1;
  }
  relationsById.set(id, id === relation.id ? relation : { ...relation, id });
}

function resourceReferences(
  attachment: FlowKnowledgeAttachmentV1,
  nodeIds: Set<string>,
  resourceIds: Set<string>,
): FlowKnowledgeRelationV2[] {
  const targets = attachment.kind === 'IMAGE'
    ? attachment.annotations.map((annotation) => ({ id: annotation.id, targetId: annotation.targetNodeId }))
    : attachment.kind === 'VIDEO'
      ? attachment.keypoints.map((keypoint) => ({ id: keypoint.id, targetId: keypoint.targetNodeId }))
      : [];
  const relations: FlowKnowledgeRelationV2[] = [];
  targets.forEach(({ id, targetId }) => {
    if (!targetId) return [];
    if (nodeIds.has(targetId)) {
      relations.push({ kind: 'RESOURCE_REFERENCE', id: `reference:${attachment.nodeId}:${id}`, sourceResourceId: attachment.nodeId, targetNodeId: targetId });
      return;
    }
    if (resourceIds.has(targetId)) {
      relations.push({ kind: 'RESOURCE_REFERENCE', id: `reference:${attachment.nodeId}:${id}`, sourceResourceId: attachment.nodeId, targetResourceId: targetId });
    }
  });
  return relations;
}

function compareRelation(left: FlowKnowledgeRelationV2, right: FlowKnowledgeRelationV2): number {
  return relationSource(left).localeCompare(relationSource(right))
    || relationTarget(left).localeCompare(relationTarget(right))
    || left.id.localeCompare(right.id);
}

function relationSource(relation: FlowKnowledgeRelationV2): string {
  return relation.kind === 'RESOURCE_REFERENCE' ? relation.sourceResourceId : relation.sourceNodeId;
}

function relationTarget(relation: FlowKnowledgeRelationV2): string {
  if (relation.kind === 'FLOW') return relation.targetNodeId;
  if (relation.kind === 'USES_RESOURCE') return relation.resourceId;
  return relation.targetNodeId ?? relation.targetResourceId ?? '';
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareId);
}

function compareId(left: string, right: string): number {
  return left.localeCompare(right);
}

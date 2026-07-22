import type {
  FlowKnowledgeImageAnnotationV1,
  FlowKnowledgeResourceV2,
  FlowKnowledgeSnapshotV2,
} from '@guideanything/contracts';

export interface FlowAnnotationTarget {
  resourceNodeId: string;
  resource: Extract<FlowKnowledgeResourceV2, { kind: 'IMAGE' }>;
  annotation: FlowKnowledgeImageAnnotationV1;
  ownerNodeIds: string[];
}

/**
 * Resolves the stable business identity of an image annotation. It never
 * substitutes a same-title annotation from another image or snapshot.
 */
export function resolveFlowAnnotationTarget(
  snapshot: FlowKnowledgeSnapshotV2,
  resourceNodeId: string,
  annotationId: string,
): FlowAnnotationTarget {
  const candidate = snapshot.resources.find((resource) => resource.id === resourceNodeId);
  if (!candidate || candidate.kind !== 'IMAGE') {
    throw new Error('图片资料不存在或不是可标注图片');
  }
  const annotation = candidate.annotations.find((item) => item.id === annotationId);
  if (!annotation) throw new Error('图片标注不属于当前图片资料');

  const ownerNodeIds = [...new Set(snapshot.relations.flatMap((relation) => {
    if (relation.kind === 'USES_RESOURCE' && relation.resourceId === candidate.id) {
      return [relation.sourceNodeId];
    }
    if (relation.kind === 'RESOURCE_REFERENCE' && relation.sourceResourceId === candidate.id && relation.targetNodeId) {
      return [relation.targetNodeId];
    }
    return [];
  }))].sort();

  return {
    resourceNodeId,
    resource: candidate,
    annotation,
    ownerNodeIds,
  };
}

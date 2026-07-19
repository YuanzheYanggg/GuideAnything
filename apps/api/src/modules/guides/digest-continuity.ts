import {
  FlowKnowledgeLaneV1Schema,
  FlowKnowledgeLearningStepV2Schema,
  FlowKnowledgeNodeV2Schema,
  FlowKnowledgeRelationV2Schema,
  FlowKnowledgeResourceV2Schema,
  FlowKnowledgeSnapshotV2Schema,
  FlowKnowledgeStageV1Schema,
  type FlowKnowledgeSnapshotV2,
} from '@guideanything/contracts';
import { z } from 'zod';

export interface GuideDigestValueChange<T> {
  before: T;
  after: T;
}

export interface GuideDigestUpdatedValue<T extends { id: string }> {
  id: string;
  before: T;
  after: T;
}

export interface GuideDigestCollectionDiff<T extends { id: string }> {
  added: T[];
  removed: T[];
  updated: Array<GuideDigestUpdatedValue<T>>;
}

const GuideDigestIdV1Schema = z.string().min(1).max(200);
const GuideDigestRevisionV1Schema = z.number().int().min(0);

function guideDigestValueChangeSchema<T extends z.ZodType>(valueSchema: T) {
  return z.object({
    before: valueSchema,
    after: valueSchema,
  }).strict();
}

function guideDigestCollectionDiffSchema<T extends z.ZodType>(valueSchema: T) {
  return z.object({
    added: z.array(valueSchema),
    removed: z.array(valueSchema),
    updated: z.array(z.object({
      id: GuideDigestIdV1Schema,
      before: valueSchema,
      after: valueSchema,
    }).strict()),
  }).strict();
}

export const GuideDigestSnapshotDiffV1Schema = z.object({
  schemaVersion: z.literal(1),
  fromSnapshotId: GuideDigestIdV1Schema,
  fromRevision: GuideDigestRevisionV1Schema,
  toSnapshotId: GuideDigestIdV1Schema,
  toRevision: GuideDigestRevisionV1Schema,
  metadata: z.object({
    title: guideDigestValueChangeSchema(z.string()).optional(),
    summary: guideDigestValueChangeSchema(z.string()).optional(),
    tags: guideDigestValueChangeSchema(z.array(z.string())).optional(),
  }).strict(),
  stages: guideDigestCollectionDiffSchema(FlowKnowledgeStageV1Schema),
  lanes: guideDigestCollectionDiffSchema(FlowKnowledgeLaneV1Schema),
  nodes: guideDigestCollectionDiffSchema(FlowKnowledgeNodeV2Schema),
  resources: guideDigestCollectionDiffSchema(FlowKnowledgeResourceV2Schema),
  relations: guideDigestCollectionDiffSchema(FlowKnowledgeRelationV2Schema),
  learningPath: guideDigestCollectionDiffSchema(FlowKnowledgeLearningStepV2Schema),
  affectedSourceIds: z.array(GuideDigestIdV1Schema),
}).strict();

export type GuideDigestSnapshotDiffV1 = z.infer<typeof GuideDigestSnapshotDiffV1Schema>;

type Resource = FlowKnowledgeSnapshotV2['resources'][number];
type Relation = FlowKnowledgeSnapshotV2['relations'][number];
type LearningStep = FlowKnowledgeSnapshotV2['learningPath'][number];

export function buildGuideDigestSnapshotDiff(
  previousInput: unknown,
  currentInput: unknown,
): GuideDigestSnapshotDiffV1 {
  const previous = FlowKnowledgeSnapshotV2Schema.parse(previousInput);
  const current = FlowKnowledgeSnapshotV2Schema.parse(currentInput);
  assertSameSnapshotIdentity(previous, current);

  const stages = diffCollection(previous.stages, current.stages);
  const lanes = diffCollection(previous.lanes, current.lanes);
  const nodes = diffCollection(previous.nodes, current.nodes);
  const resources = diffCollection(previous.resources, current.resources);
  const relations = diffCollection(previous.relations, current.relations);
  const learningPath = diffCollection(previous.learningPath, current.learningPath);
  const diff: GuideDigestSnapshotDiffV1 = {
    schemaVersion: 1,
    fromSnapshotId: previous.snapshotId,
    fromRevision: snapshotRevision(previous),
    toSnapshotId: current.snapshotId,
    toRevision: snapshotRevision(current),
    metadata: buildMetadataDiff(previous, current),
    stages,
    lanes,
    nodes,
    resources,
    relations,
    learningPath,
    affectedSourceIds: [],
  };

  diff.affectedSourceIds = [...collectAffectedSourceIds(previous, current, diff)].sort(compareCodePoints);
  return diff;
}

export function hasGuideDigestBusinessChanges(diff: GuideDigestSnapshotDiffV1): boolean {
  return collectionHasChanges(diff.stages)
    || collectionHasChanges(diff.lanes)
    || collectionHasChanges(diff.nodes)
    || collectionHasChanges(diff.resources)
    || collectionHasChanges(diff.relations)
    || collectionHasChanges(diff.learningPath);
}

function assertSameSnapshotIdentity(previous: FlowKnowledgeSnapshotV2, current: FlowKnowledgeSnapshotV2): void {
  if (previous.guideId !== current.guideId) {
    throw new Error('Guide digest snapshots must share guideId');
  }
  if (previous.workspaceId !== current.workspaceId) {
    throw new Error('Guide digest snapshots must share workspaceId');
  }
}

function snapshotRevision(snapshot: FlowKnowledgeSnapshotV2): number {
  return snapshot.origin.kind === 'DRAFT' ? snapshot.origin.revision : snapshot.origin.version;
}

function buildMetadataDiff(
  previous: FlowKnowledgeSnapshotV2,
  current: FlowKnowledgeSnapshotV2,
): GuideDigestSnapshotDiffV1['metadata'] {
  return {
    ...(valuesDiffer(previous.title, current.title) ? { title: { before: previous.title, after: current.title } } : {}),
    ...(valuesDiffer(previous.summary, current.summary) ? { summary: { before: previous.summary, after: current.summary } } : {}),
    ...(valuesDiffer(previous.tags, current.tags) ? { tags: { before: previous.tags, after: current.tags } } : {}),
  };
}

function diffCollection<T extends { id: string }>(previous: T[], current: T[]): GuideDigestCollectionDiff<T> {
  const previousById = new Map(previous.map((value) => [value.id, value]));
  const currentById = new Map(current.map((value) => [value.id, value]));

  return {
    added: current.filter(({ id }) => !previousById.has(id)),
    removed: previous.filter(({ id }) => !currentById.has(id)),
    updated: current.flatMap((after) => {
      const before = previousById.get(after.id);
      return before && valuesDiffer(before, after) ? [{ id: after.id, before, after }] : [];
    }),
  };
}

function collectAffectedSourceIds(
  previous: FlowKnowledgeSnapshotV2,
  current: FlowKnowledgeSnapshotV2,
  diff: GuideDigestSnapshotDiffV1,
): Set<string> {
  const affected = new Set<string>();
  const changedStages = new Set(collectChangedValues(diff.stages, affected).map(({ id }) => id));
  const changedLanes = new Set(collectChangedValues(diff.lanes, affected).map(({ id }) => id));
  collectChangedValues(diff.nodes, affected).forEach(collectNodeReferences);
  collectChangedResources(diff.resources, affected);
  collectChangedValues(diff.relations, affected).forEach(collectRelationReferences);
  collectChangedValues(diff.learningPath, affected).forEach(collectLearningReferences);

  for (const node of [...previous.nodes, ...current.nodes]) {
    if (node.stage && changedStages.has(node.stage.id)) affected.add(node.id);
    if (node.responsibility && changedLanes.has(node.responsibility.id)) affected.add(node.id);
  }

  return affected;

  function collectNodeReferences(node: FlowKnowledgeSnapshotV2['nodes'][number]): void {
    if (node.stage) affected.add(node.stage.id);
    if (node.responsibility) affected.add(node.responsibility.id);
  }

  function collectRelationReferences(relation: Relation): void {
    if (relation.kind === 'FLOW') {
      affected.add(relation.sourceNodeId);
      affected.add(relation.targetNodeId);
    } else if (relation.kind === 'USES_RESOURCE') {
      affected.add(relation.sourceNodeId);
      affected.add(relation.resourceId);
    } else {
      affected.add(relation.sourceResourceId);
      affected.add(relation.targetNodeId ?? relation.targetResourceId!);
    }
  }

  function collectLearningReferences(step: LearningStep): void {
    affected.add(step.targetNodeId ?? step.targetResourceId!);
  }
}

function collectChangedResources(
  diff: GuideDigestCollectionDiff<Resource>,
  affected: Set<string>,
): void {
  for (const resource of [...diff.added, ...diff.removed]) {
    affected.add(resource.id);
    collectResourceChildren(resource, affected);
  }
  for (const { after, before } of diff.updated) {
    affected.add(after.id);
    collectChangedResourceChildren(before, after, affected);
  }
}

function collectResourceChildren(resource: Resource, affected: Set<string>): void {
  if (resource.kind === 'IMAGE') {
    resource.annotations.forEach((annotation) => {
      affected.add(annotation.id);
      if (annotation.targetNodeId) affected.add(annotation.targetNodeId);
    });
  } else if (resource.kind === 'VIDEO') {
    resource.keypoints.forEach((keypoint) => {
      affected.add(keypoint.id);
      if (keypoint.targetNodeId) affected.add(keypoint.targetNodeId);
    });
  }
}

function collectChangedResourceChildren(before: Resource, after: Resource, affected: Set<string>): void {
  if (before.kind !== after.kind) {
    collectResourceChildren(before, affected);
    collectResourceChildren(after, affected);
    return;
  }
  if (before.kind === 'IMAGE' && after.kind === 'IMAGE') {
    collectChangedValues(diffCollection(before.annotations, after.annotations), affected)
      .forEach((annotation) => {
        if (annotation.targetNodeId) affected.add(annotation.targetNodeId);
      });
  } else if (before.kind === 'VIDEO' && after.kind === 'VIDEO') {
    collectChangedValues(diffCollection(before.keypoints, after.keypoints), affected)
      .forEach((keypoint) => {
        if (keypoint.targetNodeId) affected.add(keypoint.targetNodeId);
      });
  }
}

function collectChangedValues<T extends { id: string }>(
  diff: GuideDigestCollectionDiff<T>,
  affected: Set<string>,
): T[] {
  const values = [...diff.added, ...diff.removed, ...diff.updated.flatMap(({ before, after }) => [before, after])];
  values.forEach(({ id }) => affected.add(id));
  return values;
}

function collectionHasChanges<T extends { id: string }>(diff: GuideDigestCollectionDiff<T>): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.updated.length > 0;
}

function valuesDiffer(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeComparableValue(left)) !== JSON.stringify(normalizeComparableValue(right));
}

function normalizeComparableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeComparableValue);
  if (!value || typeof value !== 'object') return value;
  if (isFlowLocator(value)) {
    const { snapshotId: _snapshotId, ...stableLocator } = value;
    return stableLocator;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeComparableValue(item)]));
}

function isFlowLocator(value: object): value is { guideId: string; snapshotId: string; nodeId: string } {
  return 'guideId' in value
    && typeof value.guideId === 'string'
    && 'snapshotId' in value
    && typeof value.snapshotId === 'string'
    && 'nodeId' in value
    && typeof value.nodeId === 'string';
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

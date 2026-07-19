import {
  FlowKnowledgeSnapshotV2Schema,
  GuideDigestDraftV1Schema,
  type FlowKnowledgeResourceV2,
  type FlowKnowledgeSnapshotV2,
  type GuideDigestDraftV1,
} from '@guideanything/contracts';

export const DIGEST_RENDERER_VERSION = 2;

const MAX_ID_MANIFEST_CHARACTERS = 80_000;

/** The sole source of truth for model-addressable digest IDs. */
export interface GuideDigestIdManifest {
  stageId: string[];
  targetId: string[];
  resourceIds: string[];
  sourceIds: string[];
}

export class GuideDigestIdManifestTooLargeError extends Error {
  constructor() {
    super('Guide digest ID manifest exceeds the safe size limit');
    this.name = 'GuideDigestIdManifestTooLargeError';
  }
}

export function buildGuideDigestIdManifest(snapshot: FlowKnowledgeSnapshotV2): GuideDigestIdManifest {
  const stageId = sortedIds(snapshot.stages.map((stage) => stage.id));
  const targetId = sortedIds([
    ...snapshot.nodes.map((node) => node.id),
    ...snapshot.resources.map((resource) => resource.id),
  ]);
  const resourceIds = sortedIds(snapshot.resources.map((resource) => resource.id));
  const sourceIds = sortedIds([
    ...stageId,
    ...snapshot.lanes.map((lane) => lane.id),
    ...snapshot.nodes.map((node) => node.id),
    ...snapshot.relations.map((relation) => relation.id),
    ...snapshot.learningPath.map((step) => step.id),
    ...resourceIds,
    ...snapshot.resources.flatMap((resource) => {
      if (resource.kind === 'IMAGE') return resource.annotations.map((annotation) => annotation.id);
      if (resource.kind === 'VIDEO') return resource.keypoints.map((keypoint) => keypoint.id);
      return [];
    }),
  ]);
  const manifest = { stageId, targetId, resourceIds, sourceIds };
  if (JSON.stringify(manifest).length > MAX_ID_MANIFEST_CHARACTERS) {
    throw new GuideDigestIdManifestTooLargeError();
  }
  return manifest;
}

export type GuideDigestSourceValidationReason =
  | 'UNKNOWN_STAGE_ID'
  | 'UNKNOWN_TARGET_ID'
  | 'UNKNOWN_RESOURCE_ID'
  | 'UNKNOWN_SOURCE_ID'
  | 'UNANCHORED_GAP'
  | 'DUPLICATE_TAG'
  | 'CONTRADICTORY_STRUCTURAL_GAP'
  | 'STEP_STAGE_MISMATCH'
  | 'STEP_RESOURCE_MISMATCH';

export class GuideDigestSourceValidationError extends Error {
  readonly code: GuideDigestSourceValidationReason;

  constructor(code: GuideDigestSourceValidationReason) {
    super(`Guide digest source validation failed: ${code}`);
    this.code = code;
    this.name = 'GuideDigestSourceValidationError';
  }
}

export function validateGuideDigestSources(
  untrustedSnapshot: FlowKnowledgeSnapshotV2,
  untrustedDraft: GuideDigestDraftV1,
): GuideDigestDraftV1 {
  const snapshot = FlowKnowledgeSnapshotV2Schema.parse(untrustedSnapshot);
  const draft = GuideDigestDraftV1Schema.parse(untrustedDraft);
  const idManifest = buildGuideDigestIdManifest(snapshot);
  const stageIds = new Set(idManifest.stageId);
  const targetIds = new Set(idManifest.targetId);
  const resourceIds = new Set(idManifest.resourceIds);
  const allowedSourceIds = new Set(idManifest.sourceIds);
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const resourceById = new Map(snapshot.resources.map((resource) => [resource.id, resource]));
  const resourceIdsByNodeId = new Map<string, Set<string>>();
  const stageIdsByResourceId = new Map<string, Set<string>>();
  const usedResourceIds = new Set<string>();
  for (const relation of snapshot.relations) {
    if (relation.kind !== 'USES_RESOURCE') continue;
    addToSetMap(resourceIdsByNodeId, relation.sourceNodeId, relation.resourceId);
    usedResourceIds.add(relation.resourceId);
    const stageId = nodeById.get(relation.sourceNodeId)?.stage?.id;
    if (stageId) addToSetMap(stageIdsByResourceId, relation.resourceId, stageId);
  }
  const diagnosticIds = Object.values(snapshot.diagnostics).flat();
  const addressableDiagnosticIds = new Set(
    diagnosticIds.filter((id) => allowedSourceIds.has(id)),
  );

  for (const section of draft.stageSections) {
    assertKnownId(stageIds, section.stageId, 'UNKNOWN_STAGE_ID');
    for (const step of section.steps) {
      assertKnownId(targetIds, step.targetId, 'UNKNOWN_TARGET_ID');
      step.resourceIds.forEach((id) => assertKnownId(resourceIds, id, 'UNKNOWN_RESOURCE_ID'));
      const node = nodeById.get(step.targetId);
      if (node && node.stage?.id !== section.stageId) {
        throw new GuideDigestSourceValidationError('STEP_STAGE_MISMATCH');
      }
      const resource = resourceById.get(step.targetId);
      const representedStageIds = resource ? stageIdsByResourceId.get(resource.id) : undefined;
      if (
        resource
        && usedResourceIds.has(resource.id)
        && !representedStageIds?.has(section.stageId)
      ) {
        throw new GuideDigestSourceValidationError('STEP_STAGE_MISMATCH');
      }
      if (node) {
        const representedResourceIds = resourceIdsByNodeId.get(node.id) ?? new Set<string>();
        if (step.resourceIds.some((id) => !representedResourceIds.has(id))) {
          throw new GuideDigestSourceValidationError('STEP_RESOURCE_MISMATCH');
        }
      }
    }
  }

  draft.keyRules.forEach((rule) => assertSourceIds(allowedSourceIds, rule.sourceIds));
  draft.tagSuggestions.forEach((tag) => assertSourceIds(allowedSourceIds, tag.sourceIds));
  const structuralGaps = deterministicStructuralGaps(snapshot);
  const structuralGapKeys = new Set(structuralGaps.map(structuralGapKey));
  const modelGaps = draft.gaps.filter((gap) => {
    if (!isStructuralGap(gap.code)) return true;
    if (!structuralGapKeys.has(structuralGapKey(gap))) {
      throw new GuideDigestSourceValidationError('CONTRADICTORY_STRUCTURAL_GAP');
    }
    return false;
  });
  modelGaps.forEach((gap) => {
    if (gap.sourceIds.length === 0 && !canBeUnanchoredGap(
      gap.code,
      diagnosticIds.length,
      addressableDiagnosticIds.size,
    )) {
      throw new GuideDigestSourceValidationError('UNANCHORED_GAP');
    }
    assertSourceIds(allowedSourceIds, gap.sourceIds);
  });

  const normalizedTagLabels = new Set(snapshot.tags.map(normalizeLabel));
  for (const tag of draft.tagSuggestions) {
    const key = normalizeLabel(tag.label);
    if (normalizedTagLabels.has(key)) {
      throw new GuideDigestSourceValidationError('DUPLICATE_TAG');
    }
    normalizedTagLabels.add(key);
  }

  return { ...draft, gaps: [...modelGaps, ...structuralGaps] };
}

function deterministicStructuralGaps(
  snapshot: FlowKnowledgeSnapshotV2,
): GuideDigestDraftV1['gaps'] {
  const result: GuideDigestDraftV1['gaps'] = [];
  if (!snapshot.nodes.some((node) => node.isEntry)) {
    result.push({ code: 'MISSING_ENTRY', message: '流程没有明确入口节点。', sourceIds: [] });
  }
  if (!snapshot.nodes.some((node) => node.isExit)) {
    result.push({ code: 'MISSING_EXIT', message: '流程没有明确出口节点。', sourceIds: [] });
  }
  const occupiedStageIds = new Set(
    snapshot.nodes.flatMap((node) => node.stage ? [node.stage.id] : []),
  );
  [...snapshot.stages]
    .sort((left, right) => left.order - right.order || compareCodePoints(left.id, right.id))
    .filter((stage) => !occupiedStageIds.has(stage.id))
    .forEach((stage) => result.push({
      code: 'EMPTY_STAGE',
      message: `阶段“${stage.title}”没有业务节点。`,
      sourceIds: [stage.id],
    }));
  return result;
}

function isStructuralGap(code: GuideDigestDraftV1['gaps'][number]['code']): boolean {
  return code === 'MISSING_ENTRY' || code === 'MISSING_EXIT' || code === 'EMPTY_STAGE';
}

function structuralGapKey(gap: GuideDigestDraftV1['gaps'][number]): string {
  return `${gap.code}\u0000${gap.sourceIds.join('\u0000')}`;
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function canBeUnanchoredGap(
  code: GuideDigestDraftV1['gaps'][number]['code'],
  diagnosticCount: number,
  addressableDiagnosticCount: number,
): boolean {
  return code === 'MISSING_ENTRY'
    || code === 'MISSING_EXIT'
    || (code === 'SNAPSHOT_DIAGNOSTIC' && diagnosticCount > 0 && addressableDiagnosticCount === 0);
}

export interface RenderGuideDigestInput {
  snapshot: FlowKnowledgeSnapshotV2;
  draft: GuideDigestDraftV1;
  baseRevision: number;
}

export function renderGuideDigestMarkdown(input: RenderGuideDigestInput): string {
  const snapshot = FlowKnowledgeSnapshotV2Schema.parse(input.snapshot);
  const draft = validateGuideDigestSources(snapshot, input.draft);
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new Error('baseRevision 必须是非负安全整数');
  }

  const tags = renderTags(snapshot, draft);
  const lines: string[] = [
    '---',
    'schema: guide-digest-v1',
    `guideId: ${yamlScalar(snapshot.guideId)}`,
    `snapshotId: ${yamlScalar(snapshot.snapshotId)}`,
    `baseRevision: ${input.baseRevision}`,
    'reviewStatus: DRAFT',
    ...(tags.length === 0 ? ['tags: []'] : ['tags:', ...tags.map((tag) => `  - ${JSON.stringify(tag)}`)]),
    '---',
    '',
    `# ${markdownText(snapshot.title)}`,
    '',
    '## 流程摘要',
    '',
    markdownText(draft.shortSummary),
    '',
    '## 适用范围',
    '',
    `- 适用对象：${listText(draft.scope.audiences)}`,
    `- 业务对象：${listText(draft.scope.businessObjects)}`,
    `- 涉及系统：${listText(draft.scope.systems)}`,
    '',
    '## 流程阶段',
    '',
    ...renderStageSections(snapshot, draft),
    '## 关键规则',
    '',
    ...renderRules(draft),
    '',
    '## 关联资料索引',
    '',
    ...renderResourceIndex(snapshot),
    '',
    '## 图片标注与视频关键点索引',
    '',
    ...renderMediaIndex(snapshot),
    '',
    '## 待完善项',
    '',
    ...renderGaps(draft),
    '',
    '## 可追溯引用',
    '',
    ...renderTraceability(draft),
    '',
  ];

  return lines.join('\n');
}

function assertKnownId(allowed: Set<string>, id: string, reason: GuideDigestSourceValidationReason): void {
  if (!allowed.has(id)) throw new GuideDigestSourceValidationError(reason);
}

function assertSourceIds(allowed: Set<string>, ids: readonly string[]): void {
  ids.forEach((id) => assertKnownId(allowed, id, 'UNKNOWN_SOURCE_ID'));
}

function renderTags(snapshot: FlowKnowledgeSnapshotV2, draft: GuideDigestDraftV1): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const label of [...snapshot.tags, ...draft.tagSuggestions.map((tag) => tag.label)]) {
    const clean = label.normalize('NFC').trim().slice(0, 50);
    const key = normalizeLabel(clean);
    if (!clean || seen.has(key)) continue;
    tags.push(clean);
    seen.add(key);
    if (tags.length === 20) break;
  }
  return tags;
}

function renderStageSections(snapshot: FlowKnowledgeSnapshotV2, draft: GuideDigestDraftV1): string[] {
  const stageOrder = new Map(snapshot.stages.map((stage, index) => [stage.id, index]));
  const stageById = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
  const learningOrder = new Map(snapshot.learningPath.map((step) => [step.targetNodeId ?? step.targetResourceId ?? '', step.order]));
  const targetOrder = new Map<string, number>([
    ...snapshot.nodes.map((node, index) => [node.id, index] as const),
    ...orderedResources(snapshot).map((resource, index) => [resource.id, snapshot.nodes.length + index] as const),
  ]);
  const resourceOrder = new Map(orderedResources(snapshot).map((resource, index) => [resource.id, index]));
  const sections = [...draft.stageSections].sort((left, right) => (
    (stageOrder.get(left.stageId) ?? Number.MAX_SAFE_INTEGER) - (stageOrder.get(right.stageId) ?? Number.MAX_SAFE_INTEGER)
  ));
  const rendered: string[] = [];

  sections.forEach((section, sectionIndex) => {
    const stage = stageById.get(section.stageId);
    if (!stage) return;
    rendered.push(`### ${sectionIndex + 1}. ${markdownText(stage.title)} ${sourceMarker([stage.id])}`, '');
    rendered.push(markdownText(section.overview), '');
    const steps = [...section.steps].sort((left, right) => (
      (learningOrder.get(left.targetId) ?? Number.MAX_SAFE_INTEGER) - (learningOrder.get(right.targetId) ?? Number.MAX_SAFE_INTEGER)
      || (targetOrder.get(left.targetId) ?? Number.MAX_SAFE_INTEGER) - (targetOrder.get(right.targetId) ?? Number.MAX_SAFE_INTEGER)
      || compareCodePoints(left.targetId, right.targetId)
    ));
    steps.forEach((step, stepIndex) => {
      const sortedResources = [...step.resourceIds].sort((left, right) => (
        (resourceOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (resourceOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
        || compareCodePoints(left, right)
      ));
      rendered.push(
        `${stepIndex + 1}. **${markdownText(step.title)}** ${sourceMarker([step.targetId])}`,
        `   - 说明：${markdownText(step.description)}`,
        `   - 输入：${listText(step.inputs)}`,
        `   - 操作：${listText(step.actions)}`,
        `   - 输出：${listText(step.outputs)}`,
        `   - 关联资料：${listText(sortedResources)}`,
        '',
      );
    });
  });

  return rendered.length > 0 ? rendered : ['- 无', ''];
}

function renderRules(draft: GuideDigestDraftV1): string[] {
  return draft.keyRules.length > 0
    ? draft.keyRules.map((rule) => `- ${markdownText(rule.statement)} ${sourceMarker(rule.sourceIds)}`)
    : ['- 无'];
}

function renderResourceIndex(snapshot: FlowKnowledgeSnapshotV2): string[] {
  const resources = orderedResources(snapshot);
  if (resources.length === 0) return ['- 无'];
  return resources.map((resource) => {
    if (resource.kind === 'MARKDOWN') return `- ${markdownText(resource.id)}（Markdown） ${sourceMarker([resource.id])}`;
    if (resource.kind === 'IMAGE') return `- ${markdownText(resource.alt)}（图片） ${sourceMarker([resource.id])}`;
    return `- ${markdownText(resource.caption?.trim() || resource.id)}（视频） ${sourceMarker([resource.id])}`;
  });
}

function renderMediaIndex(snapshot: FlowKnowledgeSnapshotV2): string[] {
  const items: string[] = [];
  for (const resource of orderedResources(snapshot)) {
    if (resource.kind === 'IMAGE') {
      [...resource.annotations]
        .sort((left, right) => left.order - right.order || compareCodePoints(left.id, right.id))
        .forEach((annotation) => {
          items.push(`- ${markdownText(annotation.title)}（图片标注，${markdownText(resource.id)}） ${sourceMarker([annotation.id])}`);
        });
    }
    if (resource.kind === 'VIDEO') {
      [...resource.keypoints]
        .sort((left, right) => left.timeSeconds - right.timeSeconds || compareCodePoints(left.id, right.id))
        .forEach((keypoint) => {
          items.push(`- ${markdownText(keypoint.title)}（视频 ${formatSeconds(keypoint.timeSeconds)} 秒，${markdownText(resource.id)}） ${sourceMarker([keypoint.id])}`);
        });
    }
  }
  return items.length > 0 ? items : ['- 无'];
}

function renderGaps(draft: GuideDigestDraftV1): string[] {
  return draft.gaps.length > 0
    ? draft.gaps.map((gap) => `- ${markdownText(gap.message)}${gap.sourceIds.length > 0 ? ` ${sourceMarker(gap.sourceIds)}` : ''}`)
    : ['- 无'];
}

function renderTraceability(draft: GuideDigestDraftV1): string[] {
  const items = [
    ...draft.tagSuggestions.map((tag) => `- ${tag.category} / ${markdownText(tag.label)} ${sourceMarker(tag.sourceIds)}`),
    ...draft.keyRules.map((rule, index) => `- 规则 ${index + 1} ${sourceMarker(rule.sourceIds)}`),
    ...draft.gaps.map((gap, index) => (
      gap.sourceIds.length > 0 ? `- 待完善项 ${index + 1} ${sourceMarker(gap.sourceIds)}` : `- 待完善项 ${index + 1}（无可定位锚点）`
    )),
  ];
  return items.length > 0 ? items : ['- 无'];
}

function orderedResources(snapshot: FlowKnowledgeSnapshotV2): FlowKnowledgeResourceV2[] {
  return [...snapshot.resources].sort((left, right) => left.order - right.order || compareCodePoints(left.id, right.id));
}

function sourceMarker(sourceIds: readonly string[]): string {
  return `〔${sourceIds.map(markdownText).join(', ')}〕`;
}

function listText(values: readonly string[]): string {
  return values.length > 0 ? values.map(markdownText).join('、') : '无';
}

function markdownText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~\-]/gu, '\\$&');
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9._-]+$/u.test(value) ? value : JSON.stringify(value.normalize('NFC'));
}

function normalizeLabel(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('und');
}

function sortedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(compareCodePoints);
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

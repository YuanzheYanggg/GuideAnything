import {
  FlowKnowledgeSnapshotV2Schema,
  GuideDigestDraftV1Schema,
  type FlowKnowledgeResourceV2,
  type FlowKnowledgeSnapshotV2,
  type GuideDigestDraftV1,
} from '@guideanything/contracts';

export const DIGEST_RENDERER_VERSION = 1;

export class GuideDigestSourceValidationError extends Error {
  readonly code = 'DIGEST_SOURCE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'GuideDigestSourceValidationError';
  }
}

export function validateGuideDigestSources(
  untrustedSnapshot: FlowKnowledgeSnapshotV2,
  untrustedDraft: GuideDigestDraftV1,
): GuideDigestDraftV1 {
  const snapshot = FlowKnowledgeSnapshotV2Schema.parse(untrustedSnapshot);
  const draft = GuideDigestDraftV1Schema.parse(untrustedDraft);
  const stageIds = new Set(snapshot.stages.map((stage) => stage.id));
  const targetIds = new Set([
    ...snapshot.nodes.map((node) => node.id),
    ...snapshot.resources.map((resource) => resource.id),
  ]);
  const resourceIds = new Set(snapshot.resources.map((resource) => resource.id));
  const allowedSourceIds = buildAllowedSourceIds(snapshot);
  const diagnosticIds = Object.values(snapshot.diagnostics).flat();
  const addressableDiagnosticIds = new Set(
    diagnosticIds.filter((id) => allowedSourceIds.has(id)),
  );

  for (const section of draft.stageSections) {
    assertKnownId(stageIds, section.stageId, 'stageId');
    for (const step of section.steps) {
      assertKnownId(targetIds, step.targetId, 'targetId');
      step.resourceIds.forEach((id) => assertKnownId(resourceIds, id, 'resourceId'));
    }
  }

  draft.keyRules.forEach((rule) => assertSourceIds(allowedSourceIds, rule.sourceIds));
  draft.tagSuggestions.forEach((tag) => assertSourceIds(allowedSourceIds, tag.sourceIds));
  draft.gaps.forEach((gap) => {
    if (gap.sourceIds.length === 0 && !canBeUnanchoredGap(
      gap.code,
      diagnosticIds.length,
      addressableDiagnosticIds.size,
    )) {
      throw new GuideDigestSourceValidationError(`待完善项必须引用快照证据：${gap.code}`);
    }
    assertSourceIds(allowedSourceIds, gap.sourceIds);
  });

  const normalizedTagLabels = new Set(snapshot.tags.map(normalizeLabel));
  for (const tag of draft.tagSuggestions) {
    const key = normalizeLabel(tag.label);
    if (normalizedTagLabels.has(key)) {
      throw new GuideDigestSourceValidationError(`标签建议重复：${tag.label}`);
    }
    normalizedTagLabels.add(key);
  }

  return draft;
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

function buildAllowedSourceIds(snapshot: FlowKnowledgeSnapshotV2): Set<string> {
  const ids = new Set<string>();
  snapshot.stages.forEach((stage) => ids.add(stage.id));
  snapshot.lanes.forEach((lane) => ids.add(lane.id));
  snapshot.nodes.forEach((node) => ids.add(node.id));
  snapshot.relations.forEach((relation) => ids.add(relation.id));
  snapshot.learningPath.forEach((step) => ids.add(step.id));
  snapshot.resources.forEach((resource) => {
    ids.add(resource.id);
    if (resource.kind === 'IMAGE') resource.annotations.forEach((annotation) => ids.add(annotation.id));
    if (resource.kind === 'VIDEO') resource.keypoints.forEach((keypoint) => ids.add(keypoint.id));
  });
  return ids;
}

function assertKnownId(allowed: Set<string>, id: string, field: string): void {
  if (!allowed.has(id)) throw new GuideDigestSourceValidationError(`${field} 不属于当前快照：${id}`);
}

function assertSourceIds(allowed: Set<string>, ids: readonly string[]): void {
  ids.forEach((id) => assertKnownId(allowed, id, 'sourceId'));
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

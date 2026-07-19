import type { FlowKnowledgeSnapshotV2, GuideDigestDraftV1 } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import {
  DIGEST_RENDERER_VERSION,
  renderGuideDigestMarkdown,
  validateGuideDigestSources,
} from './digest-renderer';

describe('guide digest source validation', () => {
  it('accepts every snapshot-owned evidence anchor, including annotations and keypoints', () => {
    const parsed = validateGuideDigestSources(snapshot(), draft({
      keyRules: [{
        statement: '全部证据锚点均来自快照。',
        sourceIds: [
          'stage-prepare', 'lane-maker', 'node-start', 'resource-note', 'relation-flow',
          'learning-start', 'annotation-field', 'keypoint-submit',
        ],
      }],
    }));

    expect(parsed.keyRules[0]?.sourceIds).toContain('annotation-field');
  });

  it.each([
    ['invented stage', { stageSections: [{ ...draft().stageSections[0]!, stageId: 'invented-stage' }] }, 'UNKNOWN_STAGE_ID'],
    ['invented step target', { stageSections: [{ ...draft().stageSections[0]!, steps: [{ ...draft().stageSections[0]!.steps[0]!, targetId: 'invented-target' }] }] }, 'UNKNOWN_TARGET_ID'],
    ['invented resource', { stageSections: [{ ...draft().stageSections[0]!, steps: [{ ...draft().stageSections[0]!.steps[0]!, resourceIds: ['invented-resource'] }] }] }, 'UNKNOWN_RESOURCE_ID'],
    ['invented tag evidence', { tagSuggestions: [{ label: '打样', category: 'PROCESS', sourceIds: ['invented-source'] }] }, 'UNKNOWN_SOURCE_ID'],
    ['supplied invalid gap evidence', { gaps: [{ code: 'INCOMPLETE_DESCRIPTION', message: '缺少说明。', sourceIds: ['invented-source'] }] }, 'UNKNOWN_SOURCE_ID'],
  ])('rejects %s with a safe reason', (_label, overrides, code) => {
    expect(() => validateGuideDigestSources(snapshot(), draft(overrides))).toThrow(expect.objectContaining({
      code,
    }));
  });

  it('rejects duplicate tag labels after Unicode normalization and case folding with a safe reason', () => {
    expect(() => validateGuideDigestSources(snapshot(), draft({
      tagSuggestions: [
        { label: 'ＰＬＭ', category: 'SYSTEM', sourceIds: ['node-start'] },
        { label: 'plm', category: 'SYSTEM', sourceIds: ['node-start'] },
      ],
    }))).toThrow(expect.objectContaining({ code: 'DUPLICATE_TAG' }));
  });

  it('rejects a suggested tag that duplicates an existing snapshot tag with a safe reason', () => {
    expect(() => validateGuideDigestSources(snapshot(), draft({
      tagSuggestions: [{ label: '既有:标签', category: 'DOMAIN', sourceIds: ['node-start'] }],
    }))).toThrow(expect.objectContaining({ code: 'DUPLICATE_TAG' }));
  });

  it('allows empty gap evidence only for a condition without an addressable anchor', () => {
    expect(() => validateGuideDigestSources(snapshot(), draft({
      gaps: [{ code: 'INCOMPLETE_DESCRIPTION', message: '说明不完整。', sourceIds: [] }],
    }))).toThrow(expect.objectContaining({ code: 'UNANCHORED_GAP' }));
    const missingExit = snapshot();
    missingExit.nodes = missingExit.nodes.map((node) => ({ ...node, isExit: false }));
    expect(validateGuideDigestSources(missingExit, draft({
      gaps: [{ code: 'MISSING_EXIT', message: '缺少出口。', sourceIds: [] }],
    })).gaps).toContainEqual({ code: 'MISSING_EXIT', message: '流程没有明确出口节点。', sourceIds: [] });
  });

  it('requires evidence for a snapshot diagnostic when its diagnostic ID is addressable', () => {
    const addressable = snapshot();
    addressable.diagnostics.unreferencedResourceIds = ['resource-note'];

    expect(() => validateGuideDigestSources(addressable, draft({
      gaps: [{ code: 'SNAPSHOT_DIAGNOSTIC', message: '存在未引用资料。', sourceIds: [] }],
    }))).toThrow(expect.objectContaining({ code: 'UNANCHORED_GAP' }));
    expect(validateGuideDigestSources(addressable, draft({
      gaps: [{ code: 'SNAPSHOT_DIAGNOSTIC', message: '存在未引用资料。', sourceIds: ['resource-note'] }],
    })).gaps[0]?.sourceIds).toEqual(['resource-note']);
  });

  it('allows an unanchored snapshot diagnostic only when no diagnostic ID is addressable', () => {
    const unaddressable = snapshot();
    unaddressable.diagnostics.danglingFlowEdgeIds = ['excluded-edge'];

    expect(validateGuideDigestSources(unaddressable, draft({
      gaps: [{ code: 'SNAPSHOT_DIAGNOSTIC', message: '存在悬空边。', sourceIds: [] }],
    })).gaps[0]?.sourceIds).toEqual([]);
  });

  it('rejects an unanchored snapshot diagnostic when the snapshot has no diagnostics', () => {
    expect(() => validateGuideDigestSources(snapshot(), draft({
      gaps: [{ code: 'SNAPSHOT_DIAGNOSTIC', message: '模型虚构的诊断。', sourceIds: [] }],
    }))).toThrow(expect.objectContaining({ code: 'UNANCHORED_GAP' }));
  });

  it('replaces model structural gaps with exact deterministic missing-entry, missing-exit, and empty-stage facts', () => {
    const structurallyIncomplete = snapshot();
    const emptyStage = { id: 'stage-empty', title: '归档', order: 2 };
    structurallyIncomplete.stages.push(emptyStage);
    structurallyIncomplete.nodes = structurallyIncomplete.nodes.map((node) => ({
      ...node,
      isEntry: false,
      isExit: false,
    }));

    const parsed = validateGuideDigestSources(structurallyIncomplete, draft({ gaps: [] }));

    expect(parsed.gaps).toEqual([
      { code: 'MISSING_ENTRY', message: '流程没有明确入口节点。', sourceIds: [] },
      { code: 'MISSING_EXIT', message: '流程没有明确出口节点。', sourceIds: [] },
      { code: 'EMPTY_STAGE', message: '阶段“归档”没有业务节点。', sourceIds: ['stage-empty'] },
    ]);
  });

  it('rejects a model-authored structural gap that contradicts the snapshot graph', () => {
    expect(() => validateGuideDigestSources(snapshot(), draft({
      gaps: [{ code: 'MISSING_ENTRY', message: '模型声称缺少入口。', sourceIds: [] }],
    }))).toThrow(expect.objectContaining({ code: 'CONTRADICTORY_STRUCTURAL_GAP' }));
  });

  it.each([
    ['node stage', {
      stageSections: [{
        ...draft().stageSections[0]!,
        stageId: 'stage-prepare',
        steps: [{ ...draft().stageSections[0]!.steps[0]!, targetId: 'node-review' }],
      }],
    }, 'STEP_STAGE_MISMATCH'],
    ['resource stage', {
      stageSections: [{
        ...draft().stageSections[0]!,
        stageId: 'stage-prepare',
        steps: [{ ...draft().stageSections[0]!.steps[0]!, targetId: 'resource-image', resourceIds: [] }],
      }],
    }, 'STEP_STAGE_MISMATCH'],
    ['node resource relation', {
      stageSections: [{
        ...draft().stageSections[0]!,
        steps: [{ ...draft().stageSections[0]!.steps[0]!, resourceIds: ['resource-note'] }],
      }],
    }, 'STEP_RESOURCE_MISMATCH'],
  ])('rejects a deterministic %s mismatch instead of trusting the model', (_label, overrides, code) => {
    expect(() => validateGuideDigestSources(snapshot(), draft(overrides))).toThrow(expect.objectContaining({ code }));
  });

  it.each([
    ['unassigned node', 'node-start'],
    ['resource used only by an unassigned node', 'resource-note'],
  ])('does not let the model assign an %s to a stage', (_label, targetId) => {
    const unassigned = snapshot();
    unassigned.nodes = unassigned.nodes.map((node) => (
      node.id === 'node-start' ? { ...node, stage: null } : node
    ));
    const section = draft().stageSections.find(({ stageId }) => stageId === 'stage-prepare')!;
    const untrusted = draft({
      stageSections: [{
        ...section,
        steps: [{ ...section.steps[0]!, targetId, resourceIds: targetId === 'node-start' ? ['resource-note'] : [] }],
      }],
    });

    expect(() => validateGuideDigestSources(unassigned, untrusted)).toThrow(expect.objectContaining({
      code: 'STEP_STAGE_MISMATCH',
    }));
  });
});

describe('guide digest Markdown renderer', () => {
  it('renders the exact server-owned golden document in snapshot order', () => {
    const markdown = renderGuideDigestMarkdown({
      snapshot: snapshot(),
      draft: draft(),
      baseRevision: 180,
    });

    expect(DIGEST_RENDERER_VERSION).toBe(2);
    expect(markdown).toBe(String.raw`---
schema: guide-digest-v1
guideId: guide-id
snapshotId: snapshot-id
baseRevision: 180
reviewStatus: DRAFT
tags:
  - "既有:标签"
  - "打样"
---

# 打样提案流程

## 流程摘要

从需求确认到样衣评审的打样流程。

## 适用范围

- 适用对象：版师
- 业务对象：样衣
- 涉及系统：PLM

## 流程阶段

### 1. 准备 〔stage\-prepare〕

确认输入。

1. **确认需求** 〔node\-start〕
   - 说明：核对订单和设计要求。
   - 输入：设计稿
   - 操作：核对字段
   - 输出：打样任务
   - 关联资料：resource\-note

### 2. 评审 〔stage\-review〕

完成评审。

1. **评审样衣** 〔node\-review〕
   - 说明：确认评审结论，并转义 &lt;script&gt;。
   - 输入：样衣
   - 操作：记录结论
   - 输出：评审结果
   - 关联资料：resource\-image、resource\-video

## 关键规则

- 提交前核对订单。 〔node\-start, resource\-note〕

## 关联资料索引

- resource\-note（Markdown） 〔resource\-note〕
- 成衣类型页面（图片） 〔resource\-image〕
- 评审演示（视频） 〔resource\-video〕

## 图片标注与视频关键点索引

- 客户字段（图片标注，resource\-image） 〔annotation\-field〕
- 提交订单（视频 12 秒，resource\-video） 〔keypoint\-submit〕

## 待完善项

- 缺少完整的异常处理说明。 〔node\-review〕

## 可追溯引用

- DOMAIN / 打样 〔node\-start〕
- 规则 1 〔node\-start, resource\-note〕
- 待完善项 1 〔node\-review〕
`);
  });

  it('renders untrusted Markdown-looking prose as deterministic single-line literal text', () => {
    const injectedSnapshot = snapshot();
    const injectedPrepare = { ...injectedSnapshot.stages[0]!, title: '---\n+ stage' };
    injectedSnapshot.stages[0] = injectedPrepare;
    injectedSnapshot.nodes = injectedSnapshot.nodes.map((node) => (
      node.stage?.id === injectedPrepare.id ? { ...node, stage: injectedPrepare } : node
    ));
    const baseDraft = draft();
    const injectedDraft = draft({
      shortSummary: '---\n- item\t  + item\n1. item\n~~~',
      stageSections: baseDraft.stageSections.map((section) => section.stageId === 'stage-prepare' ? {
        ...section,
        title: '~~~ model stage title',
        overview: '+ overview\n~~~',
        steps: section.steps.map((step) => ({ ...step, title: '1. step\n- item' })),
      } : section),
      keyRules: [{ statement: '- rule\n+ continuation\n1. item\n~~~', sourceIds: ['node-start'] }],
    });

    const markdown = renderGuideDigestMarkdown({ snapshot: injectedSnapshot, draft: injectedDraft, baseRevision: 180 });

    expect(markdown).toContain('\\-\\-\\- \\- item \\+ item 1\\. item \\~\\~\\~');
    expect(markdown).toContain('### 1. \\-\\-\\- \\+ stage 〔stage\\-prepare〕');
    expect(markdown).toContain('\\+ overview \\~\\~\\~');
    expect(markdown).toContain('1. **1\\. step \\- item** 〔node\\-start〕');
    expect(markdown).toContain('- \\- rule \\+ continuation 1\\. item \\~\\~\\~ 〔node\\-start〕');
    expect(markdown).not.toContain('~~~ model stage title');
  });

  it('renders an exact empty tags sequence instead of a null YAML key', () => {
    const emptyTagsSnapshot = snapshot();
    emptyTagsSnapshot.tags = [];
    const markdown = renderGuideDigestMarkdown({
      snapshot: emptyTagsSnapshot,
      draft: draft({ tagSuggestions: [] }),
      baseRevision: 180,
    });

    expect(markdown.slice(0, markdown.indexOf('\n---\n\n#'))).toBe(`---
schema: guide-digest-v1
guideId: guide-id
snapshotId: snapshot-id
baseRevision: 180
reviewStatus: DRAFT
tags: []`);
  });

  it('uses code-point order for same-order resource IDs', () => {
    const tiedSnapshot = snapshot();
    tiedSnapshot.resources = [
      { kind: 'MARKDOWN', id: 'resource-😀', locator: locator('resource-😀'), order: 4, markdown: 'emoji' },
      { kind: 'MARKDOWN', id: 'resource-', locator: locator('resource-'), order: 4, markdown: 'private-use' },
    ];
    tiedSnapshot.relations = [
      { kind: 'FLOW', id: 'relation-flow', sourceNodeId: 'node-start', targetNodeId: 'node-review' },
      { kind: 'USES_RESOURCE', id: 'relation-emoji', sourceNodeId: 'node-start', resourceId: 'resource-😀' },
      { kind: 'USES_RESOURCE', id: 'relation-private', sourceNodeId: 'node-start', resourceId: 'resource-' },
    ];
    const tiedDraft = draft({
      stageSections: draft().stageSections.map((section) => ({
        ...section,
        steps: section.steps.map((step) => ({ ...step, resourceIds: step.targetId === 'node-start' ? ['resource-😀', 'resource-'] : [] })),
      })),
      keyRules: [{ statement: '核对资料。', sourceIds: ['node-start'] }],
    });

    const markdown = renderGuideDigestMarkdown({ snapshot: tiedSnapshot, draft: tiedDraft, baseRevision: 180 });

    expect(markdown.indexOf('resource\\-（Markdown）')).toBeLessThan(markdown.indexOf('resource\\-😀（Markdown）'));
  });

  it('is byte-identical for the same snapshot and structured draft', () => {
    const input = { snapshot: snapshot(), draft: draft(), baseRevision: 180 };

    expect(Buffer.from(renderGuideDigestMarkdown(input))).toEqual(Buffer.from(renderGuideDigestMarkdown(input)));
  });
});

function locator(nodeId: string) {
  return { guideId: 'guide-id', snapshotId: 'snapshot-id', nodeId };
}

function snapshot(): FlowKnowledgeSnapshotV2 {
  const prepare = { id: 'stage-prepare', title: '准备', order: 0 };
  const review = { id: 'stage-review', title: '评审', order: 1 };
  const maker = { id: 'lane-maker', title: '版师', kind: 'ROLE' as const, order: 0 };
  return {
    schemaVersion: 2,
    snapshotId: 'snapshot-id',
    workspaceId: 'workspace-id',
    workspaceItemId: 'item-id',
    guideId: 'guide-id',
    title: '打样提案流程',
    summary: '旧摘要',
    tags: ['既有:标签'],
    origin: { kind: 'DRAFT', revision: 180 },
    stages: [prepare, review],
    lanes: [maker],
    nodes: [
      { id: 'node-start', locator: locator('node-start'), kind: 'start', title: '确认需求', stage: prepare, responsibility: maker, isEntry: true, isExit: false },
      { id: 'node-review', locator: locator('node-review'), kind: 'end', title: '评审样衣', stage: review, responsibility: maker, isEntry: false, isExit: true },
    ],
    resources: [
      { kind: 'MARKDOWN', id: 'resource-note', locator: locator('resource-note'), order: 0, markdown: '核对订单字段。' },
      {
        kind: 'IMAGE', id: 'resource-image', locator: locator('resource-image'), order: 1, alt: '成衣类型页面', annotations: [{
          id: 'annotation-field', order: 0, title: '客户字段', body: '核对客户字段。', shape: 'POINT', region: { x: 0.2, y: 0.4 },
        }],
      },
      {
        kind: 'VIDEO', id: 'resource-video', locator: locator('resource-video'), order: 2, caption: '评审演示', keypoints: [{
          id: 'keypoint-submit', title: '提交订单', timeSeconds: 12,
        }],
      },
    ],
    relations: [
      { kind: 'FLOW', id: 'relation-flow', sourceNodeId: 'node-start', targetNodeId: 'node-review' },
      { kind: 'USES_RESOURCE', id: 'relation-note', sourceNodeId: 'node-start', resourceId: 'resource-note' },
      { kind: 'USES_RESOURCE', id: 'relation-image', sourceNodeId: 'node-review', resourceId: 'resource-image' },
      { kind: 'USES_RESOURCE', id: 'relation-video', sourceNodeId: 'node-review', resourceId: 'resource-video' },
    ],
    learningPath: [
      { id: 'learning-start', order: 0, targetNodeId: 'node-start' },
      { id: 'learning-review', order: 1, targetNodeId: 'node-review' },
    ],
    diagnostics: {
      danglingFlowEdgeIds: [], invalidResourceRelationIds: [], unreferencedResourceIds: [],
      invalidLearningTargetIds: [], excludedDerivedNodeIds: [],
    },
  };
}

function draft(overrides: Record<string, unknown> = {}): GuideDigestDraftV1 {
  return {
    schemaVersion: 1,
    shortSummary: '从需求确认到样衣评审的打样流程。',
    scope: { audiences: ['版师'], businessObjects: ['样衣'], systems: ['PLM'] },
    stageSections: [
      {
        stageId: 'stage-review', title: '模型给出的评审标题', overview: '完成评审。',
        steps: [{
          targetId: 'node-review', title: '评审样衣', description: '确认评审结论，并转义 <script>。',
          inputs: ['样衣'], actions: ['记录结论'], outputs: ['评审结果'], resourceIds: ['resource-video', 'resource-image'],
        }],
      },
      {
        stageId: 'stage-prepare', title: '模型给出的准备标题', overview: '确认输入。',
        steps: [{
          targetId: 'node-start', title: '确认需求', description: '核对订单和设计要求。',
          inputs: ['设计稿'], actions: ['核对字段'], outputs: ['打样任务'], resourceIds: ['resource-note'],
        }],
      },
    ],
    keyRules: [{ statement: '提交前核对订单。', sourceIds: ['node-start', 'resource-note'] }],
    tagSuggestions: [{ label: '打样', category: 'DOMAIN', sourceIds: ['node-start'] }],
    gaps: [{ code: 'INCOMPLETE_DESCRIPTION', message: '缺少完整的异常处理说明。', sourceIds: ['node-review'] }],
    ...overrides,
  } as GuideDigestDraftV1;
}

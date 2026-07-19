import { describe, expect, it } from 'vitest';

import { GuideDigestDraftV1Schema } from './guide-digest';

describe('guide digest contracts', () => {
  it('accepts the strict structured digest output', () => {
    expect(GuideDigestDraftV1Schema.parse(draft())).toEqual(draft());
  });

  it('caps the short Chinese summary at 200 characters', () => {
    expect(GuideDigestDraftV1Schema.safeParse(draft({ shortSummary: '流'.repeat(200) })).success).toBe(true);
    expect(GuideDigestDraftV1Schema.safeParse(draft({ shortSummary: '流'.repeat(201) })).success).toBe(false);
  });

  it('requires evidence for rules and tags while allowing an unanchored gap', () => {
    expect(GuideDigestDraftV1Schema.safeParse(draft({
      keyRules: [{ statement: '提交前核对订单。', sourceIds: [] }],
    })).success).toBe(false);
    expect(GuideDigestDraftV1Schema.safeParse(draft({
      tagSuggestions: [{ label: '打样', category: 'PROCESS', sourceIds: [] }],
    })).success).toBe(false);
    expect(GuideDigestDraftV1Schema.safeParse(draft({
      gaps: [{ code: 'MISSING_EXIT', message: '缺少出口节点。', sourceIds: [] }],
    })).success).toBe(true);
  });

  it.each(['DOMAIN', 'PROCESS', 'SYSTEM', 'OBJECT', 'ROLE', 'RISK'])('accepts the %s tag category', (category) => {
    expect(GuideDigestDraftV1Schema.safeParse(draft({
      tagSuggestions: [{ label: '打样', category, sourceIds: ['node-1'] }],
    })).success).toBe(true);
  });

  it('rejects unknown keys, blank labels, excessive tags, and free-form Markdown', () => {
    expect(GuideDigestDraftV1Schema.safeParse({ ...draft(), unexpected: true }).success).toBe(false);
    expect(GuideDigestDraftV1Schema.safeParse(draft({
      tagSuggestions: [{ label: '   ', category: 'PROCESS', sourceIds: ['node-1'] }],
    })).success).toBe(false);
    expect(GuideDigestDraftV1Schema.safeParse(draft({
      tagSuggestions: Array.from({ length: 21 }, (_, index) => ({
        label: `标签${index}`,
        category: 'PROCESS',
        sourceIds: ['node-1'],
      })),
    })).success).toBe(false);
    expect(GuideDigestDraftV1Schema.safeParse({ ...draft(), markdown: '# 模型生成的文档' }).success).toBe(false);
  });
});

function draft(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    shortSummary: '从需求确认到样衣评审的打样流程。',
    scope: {
      audiences: ['版师'],
      businessObjects: ['样衣'],
      systems: ['PLM'],
    },
    stageSections: [{
      stageId: 'stage-1',
      title: '准备',
      overview: '确认打样输入。',
      steps: [{
        targetId: 'node-1',
        title: '确认需求',
        description: '核对订单和设计要求。',
        inputs: ['设计稿'],
        actions: ['核对字段'],
        outputs: ['打样任务'],
        resourceIds: ['resource-1'],
      }],
    }],
    keyRules: [{ statement: '提交前核对订单。', sourceIds: ['node-1'] }],
    tagSuggestions: [{ label: '打样', category: 'PROCESS', sourceIds: ['node-1'] }],
    gaps: [{ code: 'INCOMPLETE_DESCRIPTION', message: '评审标准尚未描述。', sourceIds: ['node-1'] }],
    ...overrides,
  };
}

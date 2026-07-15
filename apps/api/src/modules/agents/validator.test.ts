import type {
  AgentInternalAnswerV1,
  PublicReferenceV1,
} from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { commitValidatedAnswer } from './validator';

describe('commitValidatedAnswer', () => {
  it('projects internal locators into backend-owned citations, feedback, and artifact ids', () => {
    let sequence = 0;
    const committed = commitValidatedAnswer(internalAnswer(), {
      runId: 'run-1',
      createdAt: '2026-07-15T00:00:00.000Z',
      evidenceReferences: new Map([
        ['evidence-flow', reference('reference-flow')],
        ['evidence-vault', reference('reference-vault')],
      ]),
      flowFeedbackReferences: [reference('reference-feedback')],
      createId: () => `artifact-${++sequence}`,
    });

    expect(committed.citations.map((citation) => citation.referenceId)).toEqual([
      'reference-flow', 'reference-vault',
    ]);
    expect(committed.flowFeedback[0]).toMatchObject({
      referenceId: 'reference-feedback', href: '/references/reference-feedback',
    });
    expect(committed.artifacts.map((artifact) => artifact.id)).toEqual(['artifact-1', 'artifact-2']);
    expect(committed.artifacts[1]).toMatchObject({
      kind: 'REFERENCE_COLLECTION',
      references: [
        expect.objectContaining({ referenceId: 'reference-flow' }),
        expect.objectContaining({ referenceId: 'reference-vault' }),
      ],
    });
    expect(JSON.stringify(committed)).not.toMatch(/locator|relativePath|snapshotId/u);
  });

  it('degrades unsupported claims and keeps non-navigable evidence explicit', () => {
    const invalid: PublicReferenceV1 = {
      referenceId: 'reference-invalid',
      href: null,
      invalidReason: '来源版本已经失效。',
    };
    let sequence = 0;
    const committed = commitValidatedAnswer(internalAnswer(), {
      runId: 'run-1',
      createdAt: '2026-07-15T00:00:00.000Z',
      evidenceReferences: new Map([
        ['evidence-flow', invalid],
        ['evidence-vault', invalid],
      ]),
      flowFeedbackReferences: [invalid],
      createId: () => `artifact-${++sequence}`,
    });

    expect(committed.evidenceStatus).toBe('INSUFFICIENT');
    expect(committed.citations).toHaveLength(2);
    expect(committed.citations.every((citation) => citation.href === null)).toBe(true);
    expect(committed.flowFeedback[0]).toMatchObject({ href: null, invalidReason: '来源版本已经失效。' });
  });

  it('rejects mismatched or missing resolver results instead of inventing references', () => {
    expect(() => commitValidatedAnswer(internalAnswer(), {
      runId: 'run-1',
      createdAt: '2026-07-15T00:00:00.000Z',
      evidenceReferences: new Map([['evidence-flow', reference('reference-flow')]]),
      flowFeedbackReferences: [],
      createId: () => 'artifact-1',
    })).toThrow(/证据|流程反馈/u);
  });
});

function reference(referenceId: string): PublicReferenceV1 {
  return { referenceId, href: `/references/${referenceId}` };
}

function internalAnswer(): AgentInternalAnswerV1 {
  return {
    mode: 'FLOW_REVIEW',
    conclusion: '流程需要增加复核。',
    sections: [{ id: 'detail', title: '检查结果', markdown: '退回分支没有复核节点。' }],
    evidence: [
      {
        id: 'evidence-flow',
        source: 'WORKSPACE_FLOW',
        title: '订单流程',
        excerpt: '退回后直接结束。',
        locator: { kind: 'WORKSPACE_FLOW', guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'return' },
      },
      {
        id: 'evidence-vault',
        source: 'SANTEXWELL',
        title: '复核规范',
        excerpt: '异常订单需要人工复核。',
        locator: {
          kind: 'SANTEXWELL', documentId: 'document-1', fragmentId: 'fragment-1',
          relativePath: 'wiki_v2/复核规范.md', revision: 'revision-1',
        },
      },
    ],
    flowFeedback: [{
      kind: 'GAP',
      message: '建议在退回分支增加复核节点。',
      locator: { guideId: 'guide-1', snapshotId: 'snapshot-1', nodeId: 'return' },
    }],
    evidenceStatus: 'SUPPORTED',
    artifacts: [
      {
        kind: 'REPORT', title: '流程报告', summary: '需要增加复核。',
        sections: [{ title: '发现', markdown: '退回分支没有复核节点。' }],
      },
      {
        kind: 'REFERENCE_COLLECTION', title: '依据',
        evidenceIds: ['evidence-flow', 'evidence-vault'],
      },
    ],
    suggestedQuestions: ['需要生成流程修改建议吗？'],
  };
}

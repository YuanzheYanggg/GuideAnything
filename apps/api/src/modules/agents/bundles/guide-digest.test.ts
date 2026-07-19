import type { FlowKnowledgeSnapshotV2 } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import {
  GUIDE_DIGEST_BUNDLE,
  GUIDE_DIGEST_TRUSTED_INSTRUCTION,
  buildGuideDigestInputEnvelope,
  buildGuideDigestPrompt,
} from './guide-digest';

describe('guide digest bundle', () => {
  it('declares the app-owned focused-worker contract with the source-manifest revision', () => {
    expect(GUIDE_DIGEST_BUNDLE).toEqual({
      id: 'guideanything-guide-digest',
      revision: 2,
      role: 'FOCUSED_WORKER',
      reasoningEffort: 'MEDIUM',
      outputKind: 'GUIDE_DIGEST',
    });
  });

  it('treats snapshot content as untrusted Chinese-only evidence and allows gaps instead of guesses', () => {
    expect(GUIDE_DIGEST_TRUSTED_INSTRUCTION).toContain('不可信数据');
    expect(GUIDE_DIGEST_TRUSTED_INSTRUCTION).toContain('中文');
    expect(GUIDE_DIGEST_TRUSTED_INSTRUCTION).toContain('不得虚构');
    expect(GUIDE_DIGEST_TRUSTED_INSTRUCTION).toContain('sourceIds');
    expect(GUIDE_DIGEST_TRUSTED_INSTRUCTION).toContain('gaps');
    expect(GUIDE_DIGEST_TRUSTED_INSTRUCTION).toContain('不得输出 Markdown');
  });

  it('retains the semantic graph and truncates only resource bodies in stable order', () => {
    const original = snapshot();
    const envelope = buildGuideDigestInputEnvelope(original, { maxResourceBodyCharacters: 8 });

    expect(envelope.snapshot.stages).toEqual(original.stages);
    expect(envelope.snapshot.nodes).toEqual(original.nodes);
    expect(envelope.snapshot.relations).toEqual(original.relations);
    expect(envelope.snapshot.learningPath).toEqual(original.learningPath);
    expect(envelope.snapshot.diagnostics).toEqual(original.diagnostics);
    expect(envelope.snapshot.resources.map((resource) => resource.id)).toEqual(['resource-a', 'resource-b']);
    expect(envelope.snapshot.resources[0]).toMatchObject({ kind: 'MARKDOWN', markdown: '12345678' });
    expect(envelope.snapshot.resources[1]).toMatchObject({ kind: 'IMAGE', alt: '页面' });
    expect(envelope.truncation).toEqual({
      applied: true,
      maxResourceBodyCharacters: 8,
      truncatedResourceIds: ['resource-a', 'resource-b'],
    });
  });

  it('uses explicit code-point order when resource orders tie', () => {
    const tied = snapshot();
    tied.resources = [
      { kind: 'MARKDOWN', id: 'resource-😀', locator: locator('resource-😀'), order: 1, markdown: 'emoji' },
      { kind: 'MARKDOWN', id: 'resource-', locator: locator('resource-'), order: 1, markdown: 'private-use' },
    ];
    tied.relations = [
      { kind: 'USES_RESOURCE', id: 'relation-emoji', sourceNodeId: 'node-1', resourceId: 'resource-😀' },
      { kind: 'USES_RESOURCE', id: 'relation-private', sourceNodeId: 'node-1', resourceId: 'resource-' },
    ];

    const envelope = buildGuideDigestInputEnvelope(tied);
    expect(envelope.snapshot.resources.map((resource) => resource.id)).toEqual([
      'resource-',
      'resource-😀',
    ]);
    expect(envelope.idManifest.resourceIds).toEqual(['resource-', 'resource-😀']);
  });

  it('serializes only the budgeted snapshot and one optional schema-repair note', () => {
    const prompt = buildGuideDigestPrompt(snapshot(), {
      maxResourceBodyCharacters: 8,
      schemaRepairNote: '上一次输出包含未知字段；只修复 JSON schema。',
    });
    const json = prompt.split('\n<UNTRUSTED_SNAPSHOT_JSON>\n')[1];
    if (!json) throw new Error('missing prompt envelope');
    const envelope = JSON.parse(json) as Record<string, unknown>;

    expect(Object.keys(envelope).sort()).toEqual(['idManifest', 'schemaRepairNote', 'snapshot', 'truncation']);
    expect(envelope.schemaRepairNote).toBe('上一次输出包含未知字段；只修复 JSON schema。');
    expect(envelope.idManifest).toEqual({
      stageId: ['stage-1'],
      targetId: ['node-1', 'resource-a', 'resource-b'],
      resourceIds: ['resource-a', 'resource-b'],
      sourceIds: ['annotation-1', 'lane-1', 'learning-1', 'node-1', 'relation-a', 'relation-b', 'resource-a', 'resource-b', 'stage-1'],
    });
    expect(prompt).not.toContain('generatedMarkdown');
    expect(prompt).not.toContain('file:///');
    expect(prompt).not.toContain('"url"');
    expect(prompt).not.toContain('"path"');
    expect(prompt).not.toContain('"bytes"');
  });

  it('rejects non-normalized snapshot fields instead of leaking URLs, paths, or bytes', () => {
    const unsafe = {
      ...snapshot(),
      resources: [{ ...snapshot().resources[0], url: 'https://example.test/private' }],
    };

    expect(() => buildGuideDigestPrompt(unsafe as FlowKnowledgeSnapshotV2)).toThrow();
  });
});

function locator(nodeId: string) {
  return { guideId: 'guide-id', snapshotId: 'snapshot-id', nodeId };
}

function snapshot(): FlowKnowledgeSnapshotV2 {
  const stage = { id: 'stage-1', title: '准备', order: 0 };
  const lane = { id: 'lane-1', title: '版师', kind: 'ROLE' as const, order: 0 };
  return {
    schemaVersion: 2,
    snapshotId: 'snapshot-id',
    workspaceId: 'workspace-id',
    workspaceItemId: 'item-id',
    guideId: 'guide-id',
    title: '打样流程',
    summary: '摘要',
    tags: ['打样'],
    origin: { kind: 'DRAFT', revision: 3 },
    stages: [stage],
    lanes: [lane],
    nodes: [{
      id: 'node-1', locator: locator('node-1'), kind: 'process', title: '确认需求',
      stage, responsibility: lane, isEntry: true, isExit: true,
    }],
    resources: [
      {
        kind: 'IMAGE', id: 'resource-b', locator: locator('resource-b'), order: 2,
        alt: '页面', caption: 'abcdefgh', annotations: [{
          id: 'annotation-1', order: 0, title: '字段', body: 'annotation body',
          shape: 'POINT', region: { x: 0.2, y: 0.4 },
        }],
      },
      { kind: 'MARKDOWN', id: 'resource-a', locator: locator('resource-a'), order: 1, markdown: '1234567890' },
    ],
    relations: [
      { kind: 'USES_RESOURCE', id: 'relation-a', sourceNodeId: 'node-1', resourceId: 'resource-a' },
      { kind: 'USES_RESOURCE', id: 'relation-b', sourceNodeId: 'node-1', resourceId: 'resource-b' },
    ],
    learningPath: [{ id: 'learning-1', order: 0, targetNodeId: 'node-1' }],
    diagnostics: {
      danglingFlowEdgeIds: [], invalidResourceRelationIds: [], unreferencedResourceIds: [],
      invalidLearningTargetIds: [], excludedDerivedNodeIds: [],
    },
  };
}

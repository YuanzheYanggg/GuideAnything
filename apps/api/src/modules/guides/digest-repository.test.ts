import type { GuideDigestDraftV1 } from '@guideanything/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import {
  applyGuideDigestProposal,
  createFailedGuideDigestProposal,
  createGuideDigestProposal,
  findGuideDigestContinuityBaseline,
  findDraftGuideDigestProposal,
  getGuideDigestProposal,
  listGuideDigestAuditEvents,
  listGuideDigestProposals,
  markGuideDigestProposalStale,
  regenerateGuideDigestProposal,
  rejectGuideDigestProposal,
} from './digest-repository';

const now = '2026-07-19T00:00:00.000Z';

describe('guide digest repository', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seed(database);
  });

  afterEach(() => {
    vi.useRealTimers();
    database.close();
  });

  it('creates, parses, gets, lists, and finds the one duplicate-generation DRAFT', () => {
    const created = createGuideDigestProposal(database, generatedInput());

    expect(created).toMatchObject({
      guideId: 'guide-one',
      workspaceId: 'workspace-one',
      baseSnapshotId: 'snapshot-one',
      baseRevision: 4,
      bundleRevision: 1,
      rendererVersion: 'guide-digest-markdown-v1',
      generationMetadata: generationMetadata(),
      status: 'DRAFT',
      draft: draft(),
      markdown: '# 指南摘要',
      failureCode: null,
      supersedesProposalId: null,
      appliedRevision: null,
      selectedSummary: null,
      acceptedTags: null,
      acceptedMarkdown: null,
      createdBy: 'user-one',
    });
    expect(getGuideDigestProposal(database, 'guide-one', created.id)).toEqual(created);
    expect(listGuideDigestProposals(database, 'guide-one')).toEqual([created]);
    expect(findDraftGuideDigestProposal(database, {
      guideId: 'guide-one', baseSnapshotId: 'snapshot-one', bundleRevision: 1,
      rendererVersion: 'guide-digest-markdown-v1',
    })).toEqual(created);
    expect(() => createGuideDigestProposal(database, generatedInput())).toThrow(/UNIQUE/);
    expect(listGuideDigestAuditEvents(database, 'guide-one', created.id)).toEqual([
      expect.objectContaining({
        event: 'GENERATED',
        actorId: 'user-one',
        metadata: {
          bundleRevision: 1,
          rendererVersion: 'guide-digest-markdown-v1',
          supersededProposalId: null,
          attemptCount: 1,
        },
      }),
    ]);
  });

  it('treats renderer version as part of the DRAFT generation identity', () => {
    const rendererOne = createGuideDigestProposal(database, generatedInput());
    const rendererTwo = createGuideDigestProposal(database, {
      ...generatedInput(),
      rendererVersion: 'guide-digest-markdown-v2',
    });

    expect(findDraftGuideDigestProposal(database, {
      guideId: 'guide-one', baseSnapshotId: 'snapshot-one', bundleRevision: 1,
      rendererVersion: 'guide-digest-markdown-v1',
    })).toEqual(rendererOne);
    expect(findDraftGuideDigestProposal(database, {
      guideId: 'guide-one', baseSnapshotId: 'snapshot-one', bundleRevision: 1,
      rendererVersion: 'guide-digest-markdown-v2',
    })).toEqual(rendererTwo);
  });

  it('persists a safe FAILED proposal without invalid generated output', () => {
    const proposal = createFailedGuideDigestProposal(database, {
      ...generationIdentity(),
      failureCode: 'SCHEMA_INVALID',
      createdBy: 'user-one',
    });

    expect(proposal).toMatchObject({
      status: 'FAILED', draft: null, markdown: null, failureCode: 'SCHEMA_INVALID',
    });
    expect(listGuideDigestAuditEvents(database, 'guide-one', proposal.id)).toEqual([
      expect.objectContaining({
        event: 'VALIDATION_FAILED',
        metadata: {
          bundleRevision: 1,
          rendererVersion: 'guide-digest-markdown-v1',
          failureCode: 'SCHEMA_INVALID',
          supersededProposalId: null,
          attemptCount: 1,
        },
      }),
    ]);
    expect(() => createFailedGuideDigestProposal(database, {
      ...generationIdentity(), failureCode: 'raw model output', createdBy: 'user-one',
    })).toThrow(/failure code/i);
  });

  it('rejects only a DRAFT and writes allowlisted scalar audit metadata', () => {
    const proposal = createGuideDigestProposal(database, generatedInput());
    const rejected = rejectGuideDigestProposal(database, 'guide-one', proposal.id, 'user-one', {
      reasonCode: 'USER_REJECTED',
    });

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.draft).toEqual(proposal.draft);
    expect(rejected.markdown).toBe(proposal.markdown);
    expect(listGuideDigestAuditEvents(database, 'guide-one', proposal.id).at(-1)).toMatchObject({
      event: 'REJECTED',
      metadata: { reasonCode: 'USER_REJECTED' },
    });
    expect(() => rejectGuideDigestProposal(database, 'guide-one', proposal.id, 'user-one'))
      .toThrow(expect.objectContaining({ code: 'GUIDE_DIGEST_INVALID_STATE' }));
  });

  it.each([
    ['rawOutput', { rawOutput: 'raw model output' }],
    ['reasoning', { reasoning: 'hidden reasoning' }],
    ['completion', { completion: 'model completion' }],
    ['modelResponse', { modelResponse: 'model response' }],
    ['unknown key', { runtime: 'fake' }],
    ['nested object', { runtimeMode: { value: 'fake' } }],
    ['nested array', { attemptCount: [1] }],
    ['unbounded string', { runtimeMode: 'x'.repeat(201) }],
    ['undefined value', { runtimeMode: undefined }],
  ])('rejects unsafe generation metadata: %s', (_label, generationMetadata) => {
    expect(() => createGuideDigestProposal(database, {
      ...generatedInput(), generationMetadata,
    })).toThrow(/generation metadata/i);
    expect(listGuideDigestProposals(database, 'guide-one')).toEqual([]);
  });

  it.each([
    ['rawOutput', { rawOutput: 'raw model output' }],
    ['reasoning', { reasoning: 'hidden reasoning' }],
    ['completion', { completion: 'model completion' }],
    ['modelResponse', { modelResponse: 'model response' }],
    ['unknown key', { arbitrary: true }],
    ['nested object', { reasonCode: { code: 'USER_REJECTED' } }],
    ['nested array', { reasonCode: ['USER_REJECTED'] }],
    ['unbounded string', { reasonCode: 'x'.repeat(201) }],
    ['undefined value', { reasonCode: undefined }],
  ])('rejects unsafe audit metadata before changing state: %s', (_label, auditMetadata) => {
    const proposal = createGuideDigestProposal(database, generatedInput());
    expect(() => rejectGuideDigestProposal(
      database, 'guide-one', proposal.id, 'user-one', auditMetadata,
    )).toThrow(/audit metadata/i);
    expect(getGuideDigestProposal(database, 'guide-one', proposal.id)?.status).toBe('DRAFT');
    expect(listGuideDigestAuditEvents(database, 'guide-one', proposal.id)).toHaveLength(1);
  });

  it('marks only a DRAFT stale and preserves immutable generated content', () => {
    const proposal = createGuideDigestProposal(database, generatedInput());
    const stale = markGuideDigestProposalStale(database, 'guide-one', proposal.id, 'user-one', {
      reasonCode: 'BASE_REVISION_CHANGED',
    });

    expect(stale).toMatchObject({ status: 'STALE', draft: proposal.draft, markdown: proposal.markdown });
    expect(listGuideDigestAuditEvents(database, 'guide-one', proposal.id).at(-1)).toMatchObject({
      event: 'MARKED_STALE', metadata: { reasonCode: 'BASE_REVISION_CHANGED' },
    });
    expect(() => applyGuideDigestProposal(database, 'guide-one', proposal.id, 'user-one', {
      appliedRevision: 5, selectedSummary: true, acceptedTags: [], acceptedMarkdown: true,
    })).toThrow(expect.objectContaining({ code: 'GUIDE_DIGEST_INVALID_STATE' }));
    expect(() => database.prepare(
      `UPDATE guide_digest_proposals SET draft_json = '{}' WHERE id = ?`,
    ).run(proposal.id)).toThrow(/immutable/i);
  });

  it('applies selected summary, accepted tags, and Markdown without rewriting generation output', () => {
    const proposal = createGuideDigestProposal(database, generatedInput());
    const applied = applyGuideDigestProposal(database, 'guide-one', proposal.id, 'user-one', {
      appliedRevision: 5,
      selectedSummary: true,
      acceptedTags: ['审批', '风险'],
      acceptedMarkdown: false,
    });

    expect(applied).toMatchObject({
      status: 'APPLIED',
      appliedRevision: 5,
      selectedSummary: true,
      acceptedTags: ['审批', '风险'],
      acceptedMarkdown: false,
      draft: proposal.draft,
      markdown: proposal.markdown,
    });
    expect(listGuideDigestAuditEvents(database, 'guide-one', proposal.id).at(-1)).toMatchObject({
      event: 'APPLIED',
      metadata: {
        appliedRevision: 5,
        summaryApplied: true,
        acceptedTagCount: 2,
        markdownAccepted: false,
      },
    });
  });

  it('regenerates by staling and linking the prior DRAFT inside the caller transaction', () => {
    const prior = createGuideDigestProposal(database, generatedInput());
    database.exec('BEGIN IMMEDIATE');
    const successor = regenerateGuideDigestProposal(database, prior.id, {
      ...generatedInput(),
      draft: draft({ shortSummary: '第二次生成' }),
      markdown: '# 第二次生成',
    });
    expect(successor.supersedesProposalId).toBe(prior.id);
    expect(getGuideDigestProposal(database, 'guide-one', prior.id)?.status).toBe('STALE');
    database.exec('ROLLBACK');

    expect(getGuideDigestProposal(database, 'guide-one', prior.id)?.status).toBe('DRAFT');
    expect(getGuideDigestProposal(database, 'guide-one', successor.id)).toBeNull();

    database.exec('BEGIN IMMEDIATE');
    const committed = regenerateGuideDigestProposal(database, prior.id, {
      ...generatedInput(),
      draft: draft({ shortSummary: '已提交再生成' }),
      markdown: '# 已提交再生成',
    });
    database.exec('COMMIT');
    expect(getGuideDigestProposal(database, 'guide-one', prior.id)?.status).toBe('STALE');
    expect(getGuideDigestProposal(database, 'guide-one', committed.id)?.supersedesProposalId).toBe(prior.id);
  });

  it('rejects cross-guide lookup and invalid persisted contract JSON', () => {
    const proposal = createGuideDigestProposal(database, generatedInput());
    expect(() => getGuideDigestProposal(database, 'guide-two', proposal.id))
      .toThrow(expect.objectContaining({ code: 'GUIDE_DIGEST_SCOPE_MISMATCH' }));
    expect(() => listGuideDigestAuditEvents(database, 'guide-two', proposal.id))
      .toThrow(expect.objectContaining({ code: 'GUIDE_DIGEST_SCOPE_MISMATCH' }));

    database.prepare(
      `INSERT INTO guide_digest_proposals (
        id, guide_id, workspace_id, base_snapshot_id, base_revision, bundle_revision,
        renderer_version, generation_metadata_json, status, draft_json, markdown,
        created_by, created_at, updated_at
      ) VALUES ('invalid-contract', 'guide-one', 'workspace-one', 'snapshot-one', 4, 2,
        'guide-digest-markdown-v1', '{}', 'DRAFT', '{"schemaVersion":1}', '# invalid',
        'user-one', ?, ?)`,
    ).run(now, now);
    expect(() => getGuideDigestProposal(database, 'guide-one', 'invalid-contract')).toThrow();
  });

  it.each([
    ['DRAFT', (proposalId: string) => proposalId],
    ['APPLIED', (proposalId: string) => {
      applyGuideDigestProposal(database, 'guide-one', proposalId, 'user-one', {
        appliedRevision: 6, selectedSummary: true, acceptedTags: [], acceptedMarkdown: true,
      });
      return proposalId;
    }],
    ['STALE', (proposalId: string) => {
      markGuideDigestProposalStale(database, 'guide-one', proposalId, 'user-one');
      return proposalId;
    }],
  ])('selects the latest %s baseline in the exact guide and workspace scope', (_status, transition) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T00:00:01.000Z'));
    const older = createGuideDigestProposal(database, generatedInput());
    vi.setSystemTime(new Date('2026-07-19T00:00:02.000Z'));
    const latestTrusted = createGuideDigestProposal(database, {
      ...generatedInput(),
      baseSnapshotId: 'snapshot-two',
      baseRevision: 5,
      draft: draft({ shortSummary: '最新可信摘要' }),
    });
    transition(latestTrusted.id);

    vi.setSystemTime(new Date('2026-07-19T00:00:03.000Z'));
    const rejected = createGuideDigestProposal(database, {
      ...generatedInput(),
      baseSnapshotId: 'snapshot-two',
      baseRevision: 5,
      bundleRevision: 2,
      draft: draft({ shortSummary: '不应返回的已拒绝摘要' }),
    });
    rejectGuideDigestProposal(database, 'guide-one', rejected.id, 'user-one');
    vi.setSystemTime(new Date('2026-07-19T00:00:04.000Z'));
    createFailedGuideDigestProposal(database, {
      ...generationIdentity(), baseSnapshotId: 'snapshot-two', baseRevision: 5,
      failureCode: 'SCHEMA_INVALID', createdBy: 'user-one',
    });

    const otherScope = createGuideDigestProposal(database, {
      ...generatedInput(),
      guideId: 'guide-three', workspaceId: 'workspace-two', baseSnapshotId: 'snapshot-three',
      baseRevision: 8, draft: draft({ shortSummary: '其他工作区摘要' }),
    });

    expect(findGuideDigestContinuityBaseline(database, {
      guideId: 'guide-one', workspaceId: 'workspace-one', excludeProposalId: rejected.id,
    })).toMatchObject({
      proposal: { id: latestTrusted.id, status: _status },
      snapshotJson: expect.stringContaining('"schemaVersion":2'),
    });
    expect(findGuideDigestContinuityBaseline(database, {
      guideId: 'guide-one', workspaceId: 'workspace-one', excludeProposalId: latestTrusted.id,
    })?.proposal.id).toBe(older.id);
    expect(findGuideDigestContinuityBaseline(database, {
      guideId: 'guide-three', workspaceId: 'workspace-one',
    })).toBeNull();
    expect(findGuideDigestContinuityBaseline(database, {
      guideId: 'guide-one', workspaceId: 'workspace-two',
    })).toBeNull();
    expect(otherScope.status).toBe('DRAFT');
  });

  it('returns null when only REJECTED and FAILED proposals exist', () => {
    const rejected = createGuideDigestProposal(database, generatedInput());
    rejectGuideDigestProposal(database, 'guide-one', rejected.id, 'user-one');
    createFailedGuideDigestProposal(database, {
      ...generationIdentity(), failureCode: 'SCHEMA_INVALID', createdBy: 'user-one',
    });

    expect(findGuideDigestContinuityBaseline(database, {
      guideId: 'guide-one', workspaceId: 'workspace-one',
    })).toBeNull();
  });

  it('skips a malformed newer historical draft and returns the next trusted baseline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T00:00:01.000Z'));
    const safe = createGuideDigestProposal(database, generatedInput());
    vi.setSystemTime(new Date('2026-07-19T00:00:02.000Z'));
    const malformed = createGuideDigestProposal(database, {
      ...generatedInput(), baseSnapshotId: 'snapshot-two', baseRevision: 5,
    });
    database.exec('DROP TRIGGER guide_digest_proposals_immutable_content');
    database.prepare('UPDATE guide_digest_proposals SET draft_json = ? WHERE id = ?')
      .run('{"schemaVersion":1}', malformed.id);

    expect(findGuideDigestContinuityBaseline(database, {
      guideId: 'guide-one', workspaceId: 'workspace-one',
    })).toMatchObject({ proposal: { id: safe.id } });
  });
});

function generationIdentity() {
  return {
    guideId: 'guide-one',
    workspaceId: 'workspace-one',
    baseSnapshotId: 'snapshot-one',
    baseRevision: 4,
    bundleRevision: 1,
    rendererVersion: 'guide-digest-markdown-v1',
    generationMetadata: generationMetadata(),
  } as const;
}

function generationMetadata() {
  return {
    modelRole: 'FOCUSED_WORKER',
    reasoningEffort: 'MEDIUM',
    outputSchemaVersion: 1,
    attemptCount: 1,
    repairAttempted: false,
    truncatedResourceCount: 0,
    runtimeMode: 'fake',
  } as const;
}

function generatedInput() {
  return {
    ...generationIdentity(),
    draft: draft(),
    markdown: '# 指南摘要',
    createdBy: 'user-one',
  };
}

function draft(overrides: Partial<GuideDigestDraftV1> = {}): GuideDigestDraftV1 {
  return {
    schemaVersion: 1,
    shortSummary: '从申请到审批的流程',
    scope: { audiences: ['申请人'], businessObjects: ['申请单'], systems: ['OA'] },
    stageSections: [{
      stageId: 'stage-one',
      title: '审批阶段',
      overview: '申请人提交申请并等待审批。',
      steps: [{
        targetId: 'node-one', title: '提交申请', description: '填写并提交申请单。',
        inputs: ['申请信息'], actions: ['提交'], outputs: ['待审批申请'], resourceIds: [],
      }],
    }],
    keyRules: [{ statement: '提交前必须填写完整。', sourceIds: ['node-one'] }],
    tagSuggestions: [{ label: '审批', category: 'PROCESS', sourceIds: ['node-one'] }],
    gaps: [],
    ...overrides,
  };
}

function seed(database: DatabaseSync): void {
  database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES ('user-one', 'one@example.com', 'hash', '用户一', 'AUTHOR', ?)`,
  ).run(now);
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, status, created_at, updated_at
    ) VALUES ('workspace-one', 'one', '工作区一', '', 'SquaresFour', 'general', 'user-one', 'ACTIVE', ?, ?)`,
  ).run(now, now);
  for (const guideId of ['guide-one', 'guide-two']) {
    database.prepare(
      `INSERT INTO guides (
        id, owner_id, title, summary, tags_json, status, visibility, revision,
        draft_document, created_at, updated_at
      ) VALUES (?, 'user-one', ?, '', '[]', 'DRAFT', 'INTERNAL', 4, '{}', ?, ?)`,
    ).run(guideId, guideId, now, now);
    database.prepare(
      `INSERT INTO workspace_items (
        id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
      ) VALUES (?, 'workspace-one', 'GUIDE', ?, ?, '', 'user-one', ?, ?)`,
    ).run(`${guideId}-item`, guideId, guideId, now, now);
  }
  database.prepare(
    `INSERT INTO flow_knowledge_snapshots (
      id, guide_id, workspace_id, origin_type, revision, document_checksum, snapshot_json, created_at
    ) VALUES ('snapshot-one', 'guide-one', 'workspace-one', 'DRAFT', 4, 'checksum', '{"schemaVersion":2}', ?)`,
  ).run(now);
  database.prepare(
    `INSERT INTO flow_knowledge_snapshots (
      id, guide_id, workspace_id, origin_type, revision, document_checksum, snapshot_json, created_at
    ) VALUES ('snapshot-two', 'guide-one', 'workspace-one', 'DRAFT', 5, 'checksum-two', '{"schemaVersion":2}', ?)`,
  ).run(now);
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, status, created_at, updated_at
    ) VALUES ('workspace-two', 'two', '工作区二', '', 'SquaresFour', 'general', 'user-one', 'ACTIVE', ?, ?)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO guides (
      id, owner_id, title, summary, tags_json, status, visibility, revision,
      draft_document, created_at, updated_at
    ) VALUES ('guide-three', 'user-one', 'guide-three', '', '[]', 'DRAFT', 'INTERNAL', 8, '{}', ?, ?)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO workspace_items (
      id, workspace_id, kind, entity_id, title, summary, created_by, created_at, updated_at
    ) VALUES ('guide-three-item', 'workspace-two', 'GUIDE', 'guide-three', 'guide-three', '', 'user-one', ?, ?)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO flow_knowledge_snapshots (
      id, guide_id, workspace_id, origin_type, revision, document_checksum, snapshot_json, created_at
    ) VALUES ('snapshot-three', 'guide-three', 'workspace-two', 'DRAFT', 8, 'checksum-three', '{"schemaVersion":2}', ?)`,
  ).run(now);
}

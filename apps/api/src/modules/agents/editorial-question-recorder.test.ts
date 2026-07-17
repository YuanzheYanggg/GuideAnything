import type { AgentCommittedAnswerV1 } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../db/client';
import { migrateDatabase } from '../../db/migrate';
import { listOwnerQuestionExamples, listQuestionClusters } from '../editorial/repository';
import { createConversation, enqueueConversationRun } from '../conversations/repository';
import { recordWorkspaceQuestionGap } from './editorial-question-recorder';

describe('recordWorkspaceQuestionGap', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = createDatabase(':memory:');
    migrateDatabase(database);
    seedWorkspace(database);
  });

  afterEach(() => database.close());

  it('records a PARTIAL workspace answer as a sanitized aggregate and owner-only raw sample', () => {
    const context = workspaceRun(database, '异常流程应该由谁处理？');
    const input = { context, answer: answer('PARTIAL') };

    recordWorkspaceQuestionGap(database, input);
    recordWorkspaceQuestionGap(database, input);

    const clusters = listQuestionClusters(database, 'workspace-1');
    expect(clusters).toEqual([
      expect.objectContaining({
        status: 'OPEN',
        occurrenceCount: 1,
        ownerVisibleExampleCount: 1,
        summary: '工作区问答存在待补充的内部证据覆盖。',
      }),
    ]);
    expect(clusters[0]!.summary).not.toContain('异常流程');
    expect(listOwnerQuestionExamples(database, 'workspace-1', clusters[0]!.id))
      .toEqual([expect.objectContaining({ content: '异常流程应该由谁处理？' })]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM knowledge_sources').get()).toEqual({ count: 0 });
  });

  it('does not record supported answers, global vault runs, or workspace requests with no internal source enabled', () => {
    const workspaceContext = workspaceRun(database, '异常流程应该由谁处理？');
    recordWorkspaceQuestionGap(database, { context: workspaceContext, answer: answer('SUPPORTED') });
    recordWorkspaceQuestionGap(database, {
      context: { ...workspaceContext, sources: { ...workspaceContext.sources, workspaceFlows: false } },
      answer: answer('INSUFFICIENT'),
    });
    recordWorkspaceQuestionGap(database, {
      context: { ...workspaceContext, scope: 'GLOBAL_SANTEXWELL', workspaceId: null },
      answer: answer('INSUFFICIENT'),
    });

    expect(listQuestionClusters(database, 'workspace-1')).toEqual([]);
  });
});

function workspaceRun(database: DatabaseSync, text: string) {
  const conversation = createConversation(database, {
    scope: 'WORKSPACE', workspaceId: 'workspace-1', ownerId: 'owner-1', title: '问题聚类',
  });
  const queued = enqueueConversationRun(database, {
    conversationId: conversation.id,
    ownerId: 'owner-1',
    request: {
      clientMessageId: `client-${conversation.id}`,
      text,
      sources: {
        workspaceFlows: true,
        workspaceDocuments: false,
        sessionAttachments: false,
        santexwell: true,
      },
      attachmentIds: [],
    },
  });
  return {
    runId: queued.accepted.run.id,
    conversationId: conversation.id,
    ownerId: 'owner-1',
    scope: 'WORKSPACE' as const,
    workspaceId: 'workspace-1',
    planVersion: 1,
    status: 'VALIDATING' as const,
    text,
    sources: queued.accepted.run.sources,
    attachmentIds: [],
  };
}

function answer(evidenceStatus: AgentCommittedAnswerV1['evidenceStatus']): AgentCommittedAnswerV1 {
  return {
    mode: 'ANSWER',
    conclusion: '当前授权来源的证据不足。',
    sections: [],
    evidenceStatus,
    citations: [],
    flowFeedback: [],
    artifacts: [],
    suggestedQuestions: [],
  };
}

function seedWorkspace(database: DatabaseSync): void {
  const now = '2026-07-17T00:00:00.000Z';
  database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES ('owner-1', 'owner@example.com', 'hash', '所有者', 'AUTHOR', ?)`,
  ).run(now);
  database.prepare(
    `INSERT INTO workspaces (
      id, slug, name, description, icon_key, color_key, owner_id, created_at, updated_at
    ) VALUES ('workspace-1', 'workspace-1', '测试工作区', '', 'SquaresFour', 'general', 'owner-1', ?, ?)`,
  ).run(now, now);
  database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES ('workspace-1', 'owner-1', 'OWNER', ?)`,
  ).run(now);
}

import type { AgentCommittedAnswerV1, SourceOptionsV1 } from '@guideanything/contracts';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { recordQuestionClusterOccurrence } from '../editorial/repository';
import type { AgentRunExecutionContext } from './orchestrator';

export interface EditorialQuestionGapInput {
  context: Pick<
    AgentRunExecutionContext,
    'runId' | 'conversationId' | 'ownerId' | 'scope' | 'workspaceId' | 'sources'
  >;
  answer: AgentCommittedAnswerV1;
}

const GAP_STATUSES = new Set<AgentCommittedAnswerV1['evidenceStatus']>([
  'PARTIAL',
  'INSUFFICIENT',
  'CONFLICTING',
]);

/**
 * Records a minimal editorial signal from a committed workspace answer.
 * It never stores model reasoning or indexes editorial records for retrieval.
 */
export function recordWorkspaceQuestionGap(database: DatabaseSync, input: EditorialQuestionGapInput): void {
  const { context, answer } = input;
  if (
    context.scope !== 'WORKSPACE'
    || !context.workspaceId
    || !GAP_STATUSES.has(answer.evidenceStatus)
    || !hasInternalWorkspaceSource(context.sources)
  ) {
    return;
  }

  const initiatingMessage = database.prepare(
    `SELECT message.id, message.content
     FROM agent_runs AS run
     JOIN conversations AS conversation ON conversation.id = run.conversation_id
     JOIN conversation_messages AS message
       ON message.id = run.initiating_message_id AND message.conversation_id = run.conversation_id
     WHERE run.id = ?
       AND run.conversation_id = ?
       AND conversation.owner_id = ?
       AND conversation.scope = 'WORKSPACE'
       AND conversation.workspace_id = ?
       AND message.role = 'USER'`,
  ).get(context.runId, context.conversationId, context.ownerId, context.workspaceId) as
    | { id: string; content: string }
    | undefined;
  if (!initiatingMessage) return;

  const normalized = normalizeQuestionForCluster(initiatingMessage.content);
  if (!normalized) return;
  const anchor = primaryWorkspaceAnchor(answer);
  const clusterKey = sha256([context.workspaceId, anchor, normalized].join('\u0000'));
  recordQuestionClusterOccurrence(database, {
    workspaceId: context.workspaceId,
    clusterKey,
    summary: '工作区问答存在待补充的内部证据覆盖。',
    messageId: initiatingMessage.id,
    ownerId: context.ownerId,
  });
}

function hasInternalWorkspaceSource(sources: SourceOptionsV1): boolean {
  return sources.workspaceFlows || sources.workspaceDocuments || sources.sessionAttachments;
}

function primaryWorkspaceAnchor(answer: AgentCommittedAnswerV1): string {
  const feedbackReference = answer.flowFeedback[0]?.referenceId;
  if (feedbackReference) return `flow-feedback:${feedbackReference}`;
  const flowCitation = answer.citations.find((citation) => citation.source === 'WORKSPACE_FLOW');
  if (flowCitation) return `flow:${flowCitation.referenceId}`;
  const documentCitation = answer.citations.find((citation) => (
    citation.source === 'WORKSPACE_DOCUMENT' || citation.source === 'SESSION_ATTACHMENT'
  ));
  return documentCitation ? `workspace:${documentCitation.referenceId}` : 'workspace:unanchored';
}

function normalizeQuestionForCluster(question: string): string {
  return question
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, ' ')
    .replace(/[？?！!。；;，,、:：()（）「」『』“”"']/gu, '')
    .trim()
    .slice(0, 2_000);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

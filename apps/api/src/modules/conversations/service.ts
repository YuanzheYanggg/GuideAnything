import {
  FlowKnowledgeSnapshotSchema,
  SendConversationMessageRequestV1Schema,
  SendGlobalConversationMessageRequestV1Schema,
  type SendConversationMessageRequestV1,
  type SendGlobalConversationMessageRequestV1,
} from '@guideanything/contracts';
import { normalizeFlowKnowledgeSnapshot } from '@guideanything/canvas-core';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import { ConversationAttachmentService } from '../conversation-attachments/service';
import { getWorkspacePermission } from '../workspaces/repository';
import {
  createConversation,
  enqueueConversationRun,
  getConversationDetailForOwner,
  getConversationForOwner,
  listConversationsForOwner,
  type EnqueueConversationRunResult,
} from './repository';

export class ConversationService {
  private readonly attachmentService: ConversationAttachmentService;

  constructor(
    private readonly database: DatabaseSync,
    attachmentService?: ConversationAttachmentService,
  ) {
    this.attachmentService = attachmentService ?? new ConversationAttachmentService(database, '');
  }

  createGlobal(ownerId: string, title?: string) {
    return createConversation(this.database, {
      scope: 'GLOBAL_SANTEXWELL',
      workspaceId: null,
      ownerId,
      title: normalizedTitle(title),
    });
  }

  createWorkspace(ownerId: string, workspaceId: string, title?: string) {
    this.requireWorkspaceAccess(ownerId, workspaceId);
    return createConversation(this.database, {
      scope: 'WORKSPACE',
      workspaceId,
      ownerId,
      title: normalizedTitle(title),
    });
  }

  listGlobal(ownerId: string) {
    return listConversationsForOwner(this.database, {
      ownerId,
      scope: 'GLOBAL_SANTEXWELL',
      workspaceId: null,
    });
  }

  listWorkspace(ownerId: string, workspaceId: string) {
    this.requireWorkspaceAccess(ownerId, workspaceId);
    return listConversationsForOwner(this.database, {
      ownerId,
      scope: 'WORKSPACE',
      workspaceId,
    });
  }

  readGlobal(ownerId: string, conversationId: string) {
    this.requireConversation(ownerId, conversationId, 'GLOBAL_SANTEXWELL', null);
    return getConversationDetailForOwner(this.database, conversationId, ownerId)!;
  }

  readWorkspace(ownerId: string, workspaceId: string, conversationId: string) {
    this.requireWorkspaceAccess(ownerId, workspaceId);
    this.requireConversation(ownerId, conversationId, 'WORKSPACE', workspaceId);
    return getConversationDetailForOwner(this.database, conversationId, ownerId)!;
  }

  sendGlobal(
    ownerId: string,
    conversationId: string,
    untrustedRequest: SendGlobalConversationMessageRequestV1,
  ): EnqueueConversationRunResult {
    const request = SendGlobalConversationMessageRequestV1Schema.parse(untrustedRequest);
    this.requireConversation(ownerId, conversationId, 'GLOBAL_SANTEXWELL', null);
    if (request.selectedContext) {
      this.requireKnowledgeContext({
        conversationId,
        workspaceId: null,
        request,
        documentId: request.selectedContext.documentId,
        ...(request.selectedContext.fragmentId ? { fragmentId: request.selectedContext.fragmentId } : {}),
      });
    }
    return enqueueConversationRun(this.database, {
      conversationId,
      ownerId,
      request,
    });
  }

  sendWorkspace(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    untrustedRequest: SendConversationMessageRequestV1,
  ): EnqueueConversationRunResult {
    this.requireWorkspaceAccess(ownerId, workspaceId);
    const request = SendConversationMessageRequestV1Schema.parse(untrustedRequest);
    this.requireConversation(ownerId, conversationId, 'WORKSPACE', workspaceId);
    this.requireAttachments(ownerId, workspaceId, conversationId, request);
    this.requireSelectedContext(conversationId, workspaceId, request);
    return enqueueConversationRun(this.database, {
      conversationId,
      ownerId,
      request,
    });
  }

  private requireWorkspaceAccess(userId: string, workspaceId: string): void {
    if (!getWorkspacePermission(this.database, workspaceId, userId)) {
      throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    }
  }

  private requireConversation(
    ownerId: string,
    conversationId: string,
    scope: 'GLOBAL_SANTEXWELL' | 'WORKSPACE',
    workspaceId: string | null,
  ) {
    const conversation = getConversationForOwner(this.database, conversationId, ownerId);
    if (
      !conversation
      || conversation.scope !== scope
      || conversation.workspaceId !== workspaceId
      || conversation.status !== 'ACTIVE'
    ) {
      throw httpError(404, 'CONVERSATION_NOT_FOUND', '会话不存在');
    }
    return conversation;
  }

  private requireAttachments(
    ownerId: string,
    workspaceId: string,
    conversationId: string,
    request: SendConversationMessageRequestV1,
  ): void {
    if (request.attachmentIds.length === 0) {
      if (request.sources.sessionAttachments) {
        throw httpError(400, 'ATTACHMENT_SELECTION_REQUIRED', '启用附件来源时必须选择至少一个已就绪附件');
      }
      return;
    }
    if (!request.sources.sessionAttachments) {
      throw httpError(400, 'ATTACHMENT_SOURCE_DISABLED', '本轮未启用会话附件');
    }
    this.attachmentService.requireReadyForMessage(
      ownerId,
      workspaceId,
      conversationId,
      request.attachmentIds,
    );
  }

  private requireSelectedContext(
    conversationId: string,
    workspaceId: string,
    request: SendConversationMessageRequestV1,
  ): void {
    const context = request.selectedContext;
    if (!context) return;
    if (context.kind === 'FLOW_NODE' || context.kind === 'FLOW_SNAPSHOT') {
      if (!request.sources.workspaceFlows) {
        throw httpError(400, 'FLOW_SOURCE_DISABLED', '本轮未启用工作区流程');
      }
      const row = this.database.prepare(
        `SELECT snapshot_json FROM flow_knowledge_snapshots
         WHERE id = ? AND workspace_id = ?`,
      ).get(context.snapshotId, workspaceId) as { snapshot_json: string } | undefined;
      if (!row) throw httpError(400, 'SELECTED_CONTEXT_INVALID', '选中的流程快照不存在或无权访问');
      if (context.kind === 'FLOW_NODE') {
        let nodeExists = false;
        try {
          const snapshot = normalizeFlowKnowledgeSnapshot(
            FlowKnowledgeSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
          );
          nodeExists = snapshot.nodes.some((node) => node.id === context.nodeId);
        } catch {
          nodeExists = false;
        }
        if (!nodeExists) throw httpError(400, 'SELECTED_CONTEXT_INVALID', '选中的流程节点不存在');
      }
      return;
    }
    if (context.kind === 'WORKSPACE_SOURCE') {
      if (!request.sources.workspaceDocuments) {
        throw httpError(400, 'DOCUMENT_SOURCE_DISABLED', '本轮未启用工作区资料');
      }
      const source = this.database.prepare(
        `SELECT id FROM knowledge_sources
         WHERE id = ? AND scope = 'WORKSPACE' AND kind = 'WORKSPACE_DOCUMENT' AND workspace_id = ?`,
      ).get(context.sourceId, workspaceId);
      if (!source) throw httpError(400, 'SELECTED_CONTEXT_INVALID', '选中的工作区资料不存在或无权访问');
      return;
    }
    this.requireKnowledgeContext({
      conversationId,
      workspaceId,
      request,
      documentId: context.documentId,
      ...(context.fragmentId ? { fragmentId: context.fragmentId } : {}),
    });
  }

  private requireKnowledgeContext(input: {
    conversationId: string;
    workspaceId: string | null;
    request: SendConversationMessageRequestV1 | SendGlobalConversationMessageRequestV1;
    documentId: string;
    fragmentId?: string;
  }): void {
    const row = this.database.prepare(
      `SELECT source.scope, source.kind, source.workspace_id, source.conversation_id
       FROM knowledge_documents AS document
       JOIN knowledge_sources AS source ON source.id = document.source_id
       WHERE document.id = ?
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM knowledge_fragments AS fragment
           WHERE fragment.id = ? AND fragment.document_id = document.id
         ))`,
    ).get(
      input.documentId,
      input.fragmentId ?? null,
      input.fragmentId ?? null,
    ) as {
      scope: 'GLOBAL' | 'WORKSPACE' | 'SESSION';
      kind: 'SANTEXWELL_VAULT' | 'WORKSPACE_DOCUMENT' | 'WORKSPACE_FLOW' | 'SESSION_ATTACHMENT';
      workspace_id: string | null;
      conversation_id: string | null;
    } | undefined;
    if (!row) throw httpError(400, 'SELECTED_CONTEXT_INVALID', '选中的知识片段不存在');

    const allowed = row.scope === 'GLOBAL'
      ? row.kind === 'SANTEXWELL_VAULT' && input.request.sources.santexwell
      : row.scope === 'WORKSPACE'
        ? row.workspace_id === input.workspaceId && (
            (row.kind === 'WORKSPACE_DOCUMENT' && input.request.sources.workspaceDocuments)
            || (row.kind === 'WORKSPACE_FLOW' && input.request.sources.workspaceFlows)
          )
        : row.conversation_id === input.conversationId && input.request.sources.sessionAttachments;
    if (!allowed) throw httpError(400, 'SELECTED_CONTEXT_INVALID', '选中的知识片段不属于本轮可用来源');
  }
}

function normalizedTitle(value?: string): string {
  const title = value?.trim();
  return title || '新对话';
}

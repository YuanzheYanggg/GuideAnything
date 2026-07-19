import type { CanvasDocument, GuideReferenceUpdate } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import { getWorkspaceFolder, getWorkspacePermission, listMountedResourceWorkspaceIds } from '../workspaces/repository';
import {
  recordFlowIndexFailure,
  syncGuideFlowSnapshot,
  FlowIndexError,
  type GuideFlowContext,
} from '../knowledge/flow-indexer';
import {
  addCollaborator,
  canSeeGuideMetadata,
  createGuide,
  getGuide,
  getGuideAccess,
  getVersion,
  listDraftHistory,
  listGuides,
  publishGuide,
  restoreGuideDraft,
  updateGuide,
  type GuideListScope,
} from './repository';

export class GuideService {
  constructor(private readonly database: DatabaseSync) {}

  create(
    user: { id: string; role: string },
    input: { workspaceId: string; folderId?: string; title: string; summary: string; tags: string[] },
  ) {
    if (!['AUTHOR', 'EDITOR'].includes(user.role)) throw httpError(403, 'FORBIDDEN', '只有作者或编辑者可以创建指南');
    const permission = getWorkspacePermission(this.database, input.workspaceId, user.id);
    if (!permission) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    if (!['OWNER', 'EDIT'].includes(permission)) {
      throw httpError(403, 'FORBIDDEN', '只有工作区所有者或编辑者可以创建指南');
    }
    if (input.folderId && !getWorkspaceFolder(this.database, input.workspaceId, input.folderId)) {
      throw httpError(400, 'FOLDER_NOT_FOUND', '目标文件夹不存在或不属于当前工作区');
    }
    const { workspaceId, ...guideInput } = input;
    return createGuide(this.database, user.id, workspaceId, guideInput);
  }

  list(userId: string, options: { workspaceId?: string; scope?: GuideListScope }) {
    return listGuides(this.database, userId, options);
  }

  readDraft(user: { id: string; role: string }, guideId: string) {
    this.requireEditAccess(user, guideId);
    return getGuide(this.database, guideId)!;
  }

  draftHistory(user: { id: string; role: string }, guideId: string) {
    this.requireEditAccess(user, guideId);
    return listDraftHistory(this.database, guideId);
  }

  restoreDraft(user: { id: string; role: string }, guideId: string, sourceRevision: number, revision: number) {
    this.requireEditAccess(user, guideId);
    const guide = restoreGuideDraft(this.database, guideId, sourceRevision, user.id, revision);
    this.bestEffortFlowSync({
      workspaceId: guide.workspaceId,
      workspaceItemId: guide.workspaceItemId,
      guideId: guide.id,
      ownerId: guide.ownerId,
      title: guide.title,
      summary: guide.summary,
      tags: guide.tags,
      origin: { kind: 'DRAFT', revision: guide.revision },
      document: guide.document,
    });
    return guide;
  }

  save(
    user: { id: string; role: string },
    guideId: string,
    revision: number,
    input: { title?: string; summary?: string; tags?: string[]; document?: CanvasDocument },
  ) {
    this.requireEditAccess(user, guideId);
    const guide = updateGuide(this.database, guideId, user.id, revision, input);
    this.bestEffortFlowSync({
      workspaceId: guide.workspaceId,
      workspaceItemId: guide.workspaceItemId,
      guideId: guide.id,
      ownerId: guide.ownerId,
      title: guide.title,
      summary: guide.summary,
      tags: guide.tags,
      origin: { kind: 'DRAFT', revision: guide.revision },
      document: guide.document,
    });
    return guide;
  }

  publish(user: { id: string; role: string }, guideId: string) {
    if (getGuideAccess(this.database, guideId, user.id) !== 'OWNER') {
      if (!canSeeGuideMetadata(this.database, guideId, user)) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
      throw httpError(403, 'FORBIDDEN', '只有指南作者可以发布');
    }
    const guide = getGuide(this.database, guideId)!;
    const version = publishGuide(this.database, guideId, user.id);
    this.bestEffortFlowSync({
      workspaceId: guide.workspaceId,
      workspaceItemId: guide.workspaceItemId,
      guideId: guide.id,
      ownerId: guide.ownerId,
      title: version.title,
      summary: version.summary,
      tags: version.tags,
      origin: { kind: 'PUBLISHED', versionId: version.id, version: version.version },
      document: version.document,
    });
    return version;
  }

  invite(user: { id: string; role: string }, guideId: string, collaboratorId: string) {
    if (getGuideAccess(this.database, guideId, user.id) !== 'OWNER') {
      if (!canSeeGuideMetadata(this.database, guideId, user)) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
      throw httpError(403, 'FORBIDDEN', '只有指南作者可以管理协作者');
    }
    addCollaborator(this.database, guideId, user.id, collaboratorId);
  }

  readVersion(versionId: string) {
    const version = getVersion(this.database, versionId);
    if (!version) throw httpError(404, 'VERSION_NOT_FOUND', '发布版本不存在');
    return version;
  }

  referenceUpdates(user: { id: string; role: string }, guideId: string): GuideReferenceUpdate[] {
    this.requireEditAccess(user, guideId);
    const host = getGuide(this.database, guideId)!;
    const mountedWorkspaceIds = new Set(listMountedResourceWorkspaceIds(this.database, host.workspaceId));
    const updates: GuideReferenceUpdate[] = [];
    for (const node of host.document.nodes) {
      if (node.type !== 'subguide' || node.source) continue;
      const latest = this.database.prepare(
        `SELECT version.id, version.version, version.title, item.workspace_id
         FROM guide_versions AS version
         JOIN guides AS source_guide ON source_guide.id = version.guide_id
         JOIN workspace_items AS item
           ON item.kind = 'GUIDE' AND item.entity_id = source_guide.id AND item.deleted_at IS NULL
         JOIN workspaces AS workspace ON workspace.id = item.workspace_id AND workspace.status = 'ACTIVE'
         WHERE version.guide_id = ? AND source_guide.status != 'ARCHIVED'
         ORDER BY version.version DESC
         LIMIT 1`,
      ).get(node.data.guideId) as {
        id: string;
        version: number;
        title: string;
        workspace_id: string;
      } | undefined;
      if (!latest || latest.version <= node.data.version) continue;
      const availableInHost = latest.workspace_id === host.workspaceId
        || mountedWorkspaceIds.has(latest.workspace_id);
      if (!availableInHost && !canSeeGuideMetadata(this.database, node.data.guideId, user)) continue;
      updates.push({
        referenceNodeId: node.id,
        sourceGuideId: node.data.guideId,
        currentVersionId: node.data.guideVersionId,
        currentVersion: node.data.version,
        currentTitle: node.data.title,
        latestVersionId: latest.id,
        latestVersion: latest.version,
        latestTitle: latest.title,
      });
    }
    return updates;
  }

  private requireEditAccess(user: { id: string; role: string }, guideId: string): void {
    const access = getGuideAccess(this.database, guideId, user.id);
    if (!access) {
      if (!canSeeGuideMetadata(this.database, guideId, user)) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
      throw httpError(403, 'FORBIDDEN', '没有查看或编辑此草稿的权限');
    }
  }

  private bestEffortFlowSync(context: GuideFlowContext): void {
    try {
      syncGuideFlowSnapshot(this.database, context);
    } catch (error) {
      try {
        recordFlowIndexFailure(
          this.database,
          context,
          error instanceof FlowIndexError
            ? error.code
            : 'FLOW_INDEX_FAILED',
        );
      } catch {
        // The guide mutation is authoritative; indexing is repaired by reconcile.
      }
    }
  }
}

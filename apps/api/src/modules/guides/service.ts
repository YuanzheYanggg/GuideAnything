import type { CanvasDocument } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import {
  addCollaborator,
  createGuide,
  getGuide,
  getGuideAccess,
  getVersion,
  listEditableGuides,
  publishGuide,
  updateGuide,
} from './repository';

export class GuideService {
  constructor(private readonly database: DatabaseSync) {}

  create(user: { id: string; role: string }, input: { title: string; summary: string; tags: string[] }) {
    if (user.role !== 'AUTHOR') throw httpError(403, 'FORBIDDEN', '只有作者可以创建指南');
    return createGuide(this.database, user.id, input);
  }

  list(userId: string) {
    return listEditableGuides(this.database, userId);
  }

  readDraft(userId: string, guideId: string) {
    this.requireEditAccess(userId, guideId);
    return getGuide(this.database, guideId)!;
  }

  save(
    userId: string,
    guideId: string,
    revision: number,
    input: { title?: string; summary?: string; tags?: string[]; document?: CanvasDocument },
  ) {
    this.requireEditAccess(userId, guideId);
    return updateGuide(this.database, guideId, revision, input);
  }

  publish(userId: string, guideId: string) {
    if (getGuideAccess(this.database, guideId, userId) !== 'OWNER') {
      throw httpError(403, 'FORBIDDEN', '只有指南作者可以发布');
    }
    return publishGuide(this.database, guideId, userId);
  }

  invite(userId: string, guideId: string, collaboratorId: string) {
    if (getGuideAccess(this.database, guideId, userId) !== 'OWNER') {
      throw httpError(403, 'FORBIDDEN', '只有指南作者可以管理协作者');
    }
    addCollaborator(this.database, guideId, collaboratorId);
  }

  readVersion(versionId: string) {
    const version = getVersion(this.database, versionId);
    if (!version) throw httpError(404, 'VERSION_NOT_FOUND', '发布版本不存在');
    return version;
  }

  private requireEditAccess(userId: string, guideId: string): void {
    const access = getGuideAccess(this.database, guideId, userId);
    if (!access) {
      if (!getGuide(this.database, guideId)) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
      throw httpError(403, 'FORBIDDEN', '没有查看或编辑此草稿的权限');
    }
  }
}


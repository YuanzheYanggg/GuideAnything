import type { UserRole, WorkspaceItemSummary } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import {
  getWorkspaceItemForUser,
  getItemSummary,
  listFavorites,
  listRecentViews,
  listSharedItems,
  listTrash,
  permanentlyRemoveItem,
  recordRecentView,
  removeFavorite,
  requesterCanAccessItem,
  restoreItem,
  setFavorite,
  trashItem,
  type WorkspaceItemRecord,
} from './repository';

export class PersonalService {
  constructor(private readonly database: DatabaseSync) {}

  listFavorites(user: PersonalUser) {
    return listFavorites(this.database, user.id, user.role);
  }

  setFavorite(user: PersonalUser, itemId: string): WorkspaceItemSummary {
    this.requireItemAccess(user, itemId);
    setFavorite(this.database, user.id, itemId);
    return this.requireSummary(user.id, itemId);
  }

  removeFavorite(user: PersonalUser, itemId: string): WorkspaceItemSummary {
    this.requireItemAccess(user, itemId);
    removeFavorite(this.database, user.id, itemId);
    return this.requireSummary(user.id, itemId);
  }

  recordRecentView(
    user: PersonalUser,
    itemId: string,
    context: Record<string, unknown>,
  ): WorkspaceItemSummary {
    this.requireItemAccess(user, itemId);
    recordRecentView(this.database, user.id, itemId, context);
    return this.requireSummary(user.id, itemId);
  }

  listRecentViews(user: PersonalUser) {
    return listRecentViews(this.database, user.id, user.role);
  }

  listSharedItems(userId: string) {
    return listSharedItems(this.database, userId);
  }

  listTrash(userId: string) {
    return listTrash(this.database, userId);
  }

  trashItem(userId: string, itemId: string): WorkspaceItemSummary {
    const item = this.requireLifecycleAccess(userId, itemId);
    if (!item.deletedAt) trashItem(this.database, item, userId);
    return this.requireSummary(userId, itemId);
  }

  restoreItem(userId: string, itemId: string): WorkspaceItemSummary {
    const item = this.requireLifecycleAccess(userId, itemId);
    if (item.deletedAt) restoreItem(this.database, item, userId);
    return this.requireSummary(userId, itemId);
  }

  permanentlyRemoveItem(userId: string, itemId: string): void {
    const item = this.requireLifecycleAccess(userId, itemId);
    if (!item.deletedAt) throw httpError(409, 'ITEM_NOT_TRASHED', '请先将项目移入回收站');
    permanentlyRemoveItem(this.database, item);
  }

  private requireItemAccess(user: PersonalUser, itemId: string): void {
    if (!requesterCanAccessItem(this.database, user.id, user.role, itemId)) {
      throw httpError(404, 'ITEM_NOT_FOUND', '项目不存在或无权访问');
    }
  }

  private requireLifecycleAccess(userId: string, itemId: string): WorkspaceItemRecord {
    const item = getWorkspaceItemForUser(this.database, itemId, userId);
    if (!item) throw httpError(404, 'ITEM_NOT_FOUND', '项目不存在');
    const ownsResource = item.kind === 'GUIDE'
      ? item.guideOwnerId === userId
      : item.createdBy === userId;
    if (item.workspacePermission !== 'OWNER' && !ownsResource) {
      throw httpError(403, 'FORBIDDEN', '只有资源所有者或工作区所有者可以执行此操作');
    }
    return item;
  }

  private requireSummary(userId: string, itemId: string): WorkspaceItemSummary {
    const item = getItemSummary(this.database, userId, itemId);
    if (!item) throw httpError(404, 'ITEM_NOT_FOUND', '项目不存在');
    return item;
  }
}

interface PersonalUser {
  id: string;
  role: UserRole;
}

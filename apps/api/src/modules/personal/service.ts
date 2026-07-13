import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import {
  getWorkspaceItemForUser,
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

  listFavorites(userId: string) {
    return listFavorites(this.database, userId);
  }

  setFavorite(userId: string, itemId: string): void {
    this.requireItemAccess(userId, itemId);
    setFavorite(this.database, userId, itemId);
  }

  removeFavorite(userId: string, itemId: string): void {
    this.requireItemAccess(userId, itemId);
    removeFavorite(this.database, userId, itemId);
  }

  recordRecentView(userId: string, itemId: string, context: Record<string, unknown>): void {
    this.requireItemAccess(userId, itemId);
    recordRecentView(this.database, userId, itemId, context);
  }

  listRecentViews(userId: string) {
    return listRecentViews(this.database, userId);
  }

  listSharedItems(userId: string) {
    return listSharedItems(this.database, userId);
  }

  listTrash(userId: string) {
    return listTrash(this.database, userId);
  }

  trashItem(userId: string, itemId: string): void {
    const item = this.requireLifecycleAccess(userId, itemId);
    if (item.deletedAt) throw httpError(409, 'ITEM_ALREADY_TRASHED', '项目已在回收站中');
    trashItem(this.database, item, userId);
  }

  restoreItem(userId: string, itemId: string): void {
    const item = this.requireLifecycleAccess(userId, itemId);
    if (!item.deletedAt) throw httpError(409, 'ITEM_NOT_TRASHED', '项目不在回收站中');
    restoreItem(this.database, item, userId);
  }

  permanentlyRemoveItem(userId: string, itemId: string): void {
    const item = this.requireLifecycleAccess(userId, itemId);
    if (!item.deletedAt) throw httpError(409, 'ITEM_NOT_TRASHED', '请先将项目移入回收站');
    permanentlyRemoveItem(this.database, item);
  }

  private requireItemAccess(userId: string, itemId: string): void {
    if (!requesterCanAccessItem(this.database, userId, itemId)) {
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
}

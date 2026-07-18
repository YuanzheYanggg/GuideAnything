import type { WorkspaceItemKind, WorkspacePermission } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import {
  addWorkspaceMember,
  countWorkspaceItems,
  createWorkspaceFolder,
  createWorkspaceResourceMount,
  createWorkspace,
  deleteWorkspaceFolder,
  deleteWorkspaceResourceMount,
  getWorkspaceFolder,
  getWorkspaceResourceMount,
  getWorkspaceForUser,
  getWorkspacePermission,
  listWorkspaceActivity,
  listWorkspaceFolders,
  listWorkspaceItems,
  listWorkspaceMembers,
  listWorkspaceResourceMounts,
  listWorkspacesForUser,
  moveWorkspaceItemToFolder,
  recordActivity,
  renameWorkspaceFolder,
  removeWorkspaceMember,
  updateWorkspace,
  workspaceFolderHasContents,
  type CreateWorkspaceInput,
} from './repository';

export class WorkspaceService {
  constructor(private readonly database: DatabaseSync) {}

  create(user: { id: string; role: string }, input: CreateWorkspaceInput) {
    if (user.role !== 'AUTHOR') throw httpError(403, 'FORBIDDEN', '只有作者可以创建工作区');
    return createWorkspace(this.database, user.id, input);
  }

  list(userId: string) {
    return listWorkspacesForUser(this.database, userId);
  }

  read(userId: string, workspaceId: string) {
    return {
      workspace: this.requireReadAccess(userId, workspaceId),
      counts: countWorkspaceItems(this.database, workspaceId, userId),
    };
  }

  update(userId: string, workspaceId: string, input: Partial<CreateWorkspaceInput>) {
    this.requireOwner(userId, workspaceId);
    return updateWorkspace(this.database, workspaceId, userId, input);
  }

  items(userId: string, workspaceId: string, kind?: WorkspaceItemKind) {
    this.requireReadAccess(userId, workspaceId);
    return listWorkspaceItems(this.database, workspaceId, userId, kind);
  }

  activity(userId: string, workspaceId: string) {
    this.requireReadAccess(userId, workspaceId);
    return listWorkspaceActivity(this.database, workspaceId);
  }

  folders(userId: string, workspaceId: string) {
    this.requireReadAccess(userId, workspaceId);
    return listWorkspaceFolders(this.database, workspaceId);
  }

  createFolder(userId: string, workspaceId: string, input: { name: string; parentId: string | null }) {
    this.requireEdit(userId, workspaceId);
    if (input.parentId && !getWorkspaceFolder(this.database, workspaceId, input.parentId)) {
      throw httpError(400, 'FOLDER_NOT_FOUND', '父文件夹不存在或不属于当前工作区');
    }
    return createWorkspaceFolder(this.database, {
      workspaceId, parentId: input.parentId, name: input.name, createdBy: userId,
    });
  }

  renameFolder(userId: string, workspaceId: string, folderId: string, name: string) {
    this.requireEdit(userId, workspaceId);
    const folder = renameWorkspaceFolder(this.database, { workspaceId, folderId, name });
    if (!folder) throw httpError(404, 'FOLDER_NOT_FOUND', '文件夹不存在');
    return folder;
  }

  deleteFolder(userId: string, workspaceId: string, folderId: string): void {
    this.requireEdit(userId, workspaceId);
    if (!getWorkspaceFolder(this.database, workspaceId, folderId)) {
      throw httpError(404, 'FOLDER_NOT_FOUND', '文件夹不存在');
    }
    if (workspaceFolderHasContents(this.database, workspaceId, folderId)) {
      throw httpError(400, 'FOLDER_NOT_EMPTY', '文件夹仍包含资源或子文件夹');
    }
    deleteWorkspaceFolder(this.database, workspaceId, folderId);
  }

  moveItemToFolder(userId: string, workspaceId: string, itemId: string, folderId: string | null) {
    this.requireEdit(userId, workspaceId);
    if (folderId && !getWorkspaceFolder(this.database, workspaceId, folderId)) {
      throw httpError(400, 'FOLDER_NOT_FOUND', '目标文件夹不存在或不属于当前工作区');
    }
    const moved = moveWorkspaceItemToFolder(this.database, { workspaceId, itemId, folderId });
    if (moved === null) {
      const items = listWorkspaceItems(this.database, workspaceId, userId);
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) throw httpError(404, 'WORKSPACE_ITEM_NOT_FOUND', '工作区资源不存在');
      return item;
    }
    return moved;
  }

  resourceMounts(userId: string, workspaceId: string) {
    this.requireReadAccess(userId, workspaceId);
    return listWorkspaceResourceMounts(this.database, workspaceId);
  }

  createResourceMount(userId: string, consumerWorkspaceId: string, providerWorkspaceId: string) {
    this.requireOwner(userId, consumerWorkspaceId);
    const providerPermission = getWorkspacePermission(this.database, providerWorkspaceId, userId);
    if (!providerPermission) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    if (!['OWNER', 'EDIT'].includes(providerPermission)) {
      throw httpError(403, 'FORBIDDEN', '需要资源中心的编辑或所有者权限才能挂载共享资源');
    }
    if (listWorkspaceResourceMounts(this.database, consumerWorkspaceId)
      .some((mount) => mount.providerWorkspaceId === providerWorkspaceId)) {
      throw httpError(400, 'RESOURCE_MOUNT_EXISTS', '该共享资源中心已经挂载到当前业务团队');
    }
    try {
      return createWorkspaceResourceMount(this.database, {
        consumerWorkspaceId, providerWorkspaceId, createdBy: userId,
      });
    } catch {
      throw httpError(400, 'RESOURCE_MOUNT_INVALID', '共享资源必须从资源中心挂载到业务团队');
    }
  }

  deleteResourceMount(userId: string, consumerWorkspaceId: string, mountId: string): void {
    const mount = getWorkspaceResourceMount(this.database, consumerWorkspaceId, mountId);
    if (!mount) throw httpError(404, 'RESOURCE_MOUNT_NOT_FOUND', '共享资源挂载不存在');
    const consumerPermission = getWorkspacePermission(this.database, mount.consumerWorkspaceId, userId);
    const providerPermission = getWorkspacePermission(this.database, mount.providerWorkspaceId, userId);
    if (!consumerPermission && !providerPermission) throw httpError(404, 'RESOURCE_MOUNT_NOT_FOUND', '共享资源挂载不存在');
    if (consumerPermission !== 'OWNER' && providerPermission !== 'OWNER') {
      throw httpError(403, 'FORBIDDEN', '只有业务团队或资源中心所有者可以移除挂载');
    }
    deleteWorkspaceResourceMount(this.database, mountId);
  }

  members(userId: string, workspaceId: string) {
    this.requireReadAccess(userId, workspaceId);
    return listWorkspaceMembers(this.database, workspaceId);
  }

  addMember(
    actorId: string,
    workspaceId: string,
    userId: string,
    permission: Exclude<WorkspacePermission, 'OWNER'>,
  ) {
    this.requireOwner(actorId, workspaceId);
    if (getWorkspacePermission(this.database, workspaceId, userId) === 'OWNER') {
      throw httpError(400, 'OWNER_CANNOT_BE_CHANGED', '不能更改工作区所有者权限');
    }
    const user = this.database.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) throw httpError(400, 'USER_NOT_FOUND', '用户不存在');
    const member = addWorkspaceMember(this.database, workspaceId, userId, permission);
    recordActivity(this.database, {
      workspaceId,
      actorId,
      action: 'COLLABORATOR_ADDED',
      metadata: { userId, permission },
    });
    return member;
  }

  removeMember(actorId: string, workspaceId: string, userId: string): void {
    this.requireOwner(actorId, workspaceId);
    if (getWorkspacePermission(this.database, workspaceId, userId) === 'OWNER') {
      throw httpError(400, 'OWNER_CANNOT_BE_REMOVED', '不能移除工作区所有者');
    }
    removeWorkspaceMember(this.database, workspaceId, userId);
  }

  private requireReadAccess(userId: string, workspaceId: string) {
    const workspace = getWorkspaceForUser(this.database, workspaceId, userId);
    if (!workspace) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    return workspace;
  }

  private requireOwner(userId: string, workspaceId: string): void {
    const permission = getWorkspacePermission(this.database, workspaceId, userId);
    if (!permission) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    if (permission !== 'OWNER') throw httpError(403, 'FORBIDDEN', '只有工作区所有者可以执行此操作');
  }

  private requireEdit(userId: string, workspaceId: string): void {
    const permission = getWorkspacePermission(this.database, workspaceId, userId);
    if (!permission) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
    if (!['OWNER', 'EDIT'].includes(permission)) {
      throw httpError(403, 'FORBIDDEN', '只有工作区所有者或编辑者可以整理资源');
    }
  }
}

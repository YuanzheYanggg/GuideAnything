import type { WorkspaceItemKind, WorkspacePermission } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import { httpError } from '../../lib/http-error';
import {
  addWorkspaceMember,
  countWorkspaceItems,
  createWorkspace,
  getWorkspaceForUser,
  getWorkspacePermission,
  listWorkspaceActivity,
  listWorkspaceItems,
  listWorkspaceMembers,
  listWorkspacesForUser,
  recordActivity,
  removeWorkspaceMember,
  updateWorkspace,
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
      counts: countWorkspaceItems(this.database, workspaceId),
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
}

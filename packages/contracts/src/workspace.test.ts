import { expect, it } from 'vitest';

import {
  WorkspaceFolderSchema,
  GuideReferenceUpdateSchema,
  WorkspaceItemSummarySchema,
  WorkspaceKindSchema,
  WorkspaceResourceMountSchema,
} from './workspace';

it('validates a generic guide workspace item', () => {
  expect(WorkspaceItemSummarySchema.parse({
    id: 'item-1',
    workspaceId: 'workspace-materials',
    workspaceName: '物料管理',
    kind: 'GUIDE',
    entityId: 'guide-1',
    title: '物料主数据检查',
    summary: '检查销售视图',
    updatedAt: '2026-07-13T00:00:00.000Z',
    favorite: true,
    permission: 'EDIT',
    canEdit: true,
    folderId: null,
  }).kind).toBe('GUIDE');
});

it('keeps workspace roles, folder identities, and mounts explicit', () => {
  expect(WorkspaceKindSchema.options).toEqual([
    'BUSINESS_TEAM', 'FINANCE', 'TECHNICAL', 'FOLLOW_UP', 'PRODUCTION',
  ]);
  expect(WorkspaceFolderSchema.parse({
    id: 'folder-sampling', workspaceId: 'workspace-sales', parentId: null,
    name: '打样工序', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
  }).name).toBe('打样工序');
  expect(WorkspaceFolderSchema.safeParse({
    id: 'folder-sampling', workspaceId: 'workspace-sales', parentId: 'folder-foreign',
    name: '打样工序', createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
    storagePath: '/private/folder',
  }).success).toBe(false);
  expect(WorkspaceResourceMountSchema.parse({
    id: 'mount-finance', consumerWorkspaceId: 'workspace-sales', providerWorkspaceId: 'workspace-finance',
    providerName: '财务资源中心', providerKind: 'FINANCE', createdAt: '2026-07-18T00:00:00.000Z',
  }).providerKind).toBe('FINANCE');
  expect(WorkspaceResourceMountSchema.safeParse({
    id: 'mount-invalid', consumerWorkspaceId: 'workspace-sales', providerWorkspaceId: 'workspace-finance',
    providerName: '财务资源中心', providerKind: 'BUSINESS_TEAM', createdAt: '2026-07-18T00:00:00.000Z',
  }).success).toBe(false);
  expect(GuideReferenceUpdateSchema.parse({
    referenceNodeId: 'subguide-finance', sourceGuideId: 'guide-finance',
    currentVersionId: 'version-finance-v1', currentVersion: 1, currentTitle: '付款条款',
    latestVersionId: 'version-finance-v2', latestVersion: 2, latestTitle: '付款条款（新版）',
  }).latestVersion).toBe(2);
});

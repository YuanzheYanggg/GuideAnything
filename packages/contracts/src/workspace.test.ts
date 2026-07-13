import { expect, it } from 'vitest';

import { WorkspaceItemSummarySchema } from './workspace';

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
  }).kind).toBe('GUIDE');
});

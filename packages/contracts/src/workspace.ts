import { z } from 'zod';

export const WorkspacePermissionSchema = z.enum(['OWNER', 'EDIT', 'VIEW']);
export const WorkspaceItemKindSchema = z.enum([
  'GUIDE',
  'SOURCE',
  'AGENT',
  'ONTOLOGY',
  'CONVERSATION',
  'ARTIFACT',
]);

export const WorkspaceSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(2_000),
  iconKey: z.string().min(1).max(50),
  colorKey: z.string().min(1).max(50),
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  permission: WorkspacePermissionSchema,
  guideCount: z.number().int().min(0),
  updatedAt: z.string().datetime(),
});

export const WorkspaceItemSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  kind: WorkspaceItemKindSchema,
  entityId: z.string().min(1),
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000),
  updatedAt: z.string().datetime(),
  favorite: z.boolean(),
  permission: WorkspacePermissionSchema,
  deletedAt: z.string().datetime().nullable().optional(),
  deletedByName: z.string().nullable().optional(),
  authorName: z.string().nullable().optional(),
  publishedVersionId: z.string().nullable().optional(),
  lastViewedAt: z.string().datetime().nullable().optional(),
  viewCount: z.number().int().min(0).optional(),
});

export const WorkspaceActivitySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
  action: z.enum([
    'GUIDE_CREATED',
    'GUIDE_UPDATED',
    'GUIDE_PUBLISHED',
    'COLLABORATOR_ADDED',
    'ITEM_TRASHED',
    'ITEM_RESTORED',
  ]),
  itemId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type WorkspacePermission = z.infer<typeof WorkspacePermissionSchema>;
export type WorkspaceItemKind = z.infer<typeof WorkspaceItemKindSchema>;
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type WorkspaceItemSummary = z.infer<typeof WorkspaceItemSummarySchema>;
export type WorkspaceActivity = z.infer<typeof WorkspaceActivitySchema>;

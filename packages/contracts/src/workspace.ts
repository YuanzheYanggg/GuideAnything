import { z } from 'zod';

export const WorkspacePermissionSchema = z.enum(['OWNER', 'EDIT', 'VIEW']);
export const WorkspaceKindSchema = z.enum([
  'BUSINESS_TEAM',
  'FINANCE',
  'TECHNICAL',
  'FOLLOW_UP',
  'PRODUCTION',
]);
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
  kind: WorkspaceKindSchema.optional(),
  guideCount: z.number().int().min(0),
  updatedAt: z.string().datetime(),
});

export const WorkspaceItemSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  folderId: z.string().min(1).max(200).nullable().optional(),
  kind: WorkspaceItemKindSchema,
  entityId: z.string().min(1),
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000),
  updatedAt: z.string().datetime(),
  favorite: z.boolean(),
  permission: WorkspacePermissionSchema,
  canEdit: z.boolean(),
  canManageLifecycle: z.boolean().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
  deletedByName: z.string().nullable().optional(),
  authorName: z.string().nullable().optional(),
  publishedVersionId: z.string().nullable().optional(),
  lastViewedAt: z.string().datetime().nullable().optional(),
  viewCount: z.number().int().min(0).optional(),
});

export const WorkspaceFolderSchema = z.object({
  id: z.string().min(1).max(200),
  workspaceId: z.string().min(1).max(200),
  parentId: z.string().min(1).max(200).nullable(),
  name: z.string().trim().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const WorkspaceResourceMountSchema = z.object({
  id: z.string().min(1).max(200),
  consumerWorkspaceId: z.string().min(1).max(200),
  providerWorkspaceId: z.string().min(1).max(200),
  providerName: z.string().min(1).max(100),
  providerKind: WorkspaceKindSchema.exclude(['BUSINESS_TEAM']),
  createdAt: z.string().datetime(),
}).strict();

/** A newer published version exists for one pinned subguide reference. */
export const GuideReferenceUpdateSchema = z.object({
  referenceNodeId: z.string().min(1).max(200),
  sourceGuideId: z.string().min(1).max(200),
  currentVersionId: z.string().min(1).max(200),
  currentVersion: z.number().int().positive(),
  currentTitle: z.string().min(1).max(200),
  latestVersionId: z.string().min(1).max(200),
  latestVersion: z.number().int().positive(),
  latestTitle: z.string().min(1).max(200),
}).strict();

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
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;
export type WorkspaceItemKind = z.infer<typeof WorkspaceItemKindSchema>;
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type WorkspaceItemSummary = z.infer<typeof WorkspaceItemSummarySchema>;
export type WorkspaceFolder = z.infer<typeof WorkspaceFolderSchema>;
export type WorkspaceResourceMount = z.infer<typeof WorkspaceResourceMountSchema>;
export type GuideReferenceUpdate = z.infer<typeof GuideReferenceUpdateSchema>;
export type WorkspaceActivity = z.infer<typeof WorkspaceActivitySchema>;

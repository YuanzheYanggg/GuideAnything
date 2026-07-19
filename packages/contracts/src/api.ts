import { z } from 'zod';

import { CanvasDocumentSchema } from './canvas';

export const UserRoleSchema = z.enum(['AUTHOR', 'EDITOR', 'LEARNER']);
export const GuideStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const GuideVersionSnapshotSchema = z.object({
  id: z.string().min(1),
  guideId: z.string().min(1),
  workspaceItemId: z.string().min(1).optional(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000),
  tags: z.array(z.string().min(1).max(50)).max(20),
  document: CanvasDocumentSchema,
});

export const GuideSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceItemId: z.string().min(1),
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000),
  tags: z.array(z.string()),
  status: GuideStatusSchema,
  revision: z.number().int().min(0),
  ownerId: z.string().min(1),
  authorName: z.string().min(1),
  publishedVersionId: z.string().nullable(),
  publishedVersion: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime(),
});

export const GuideDraftHistorySnapshotSchema = z.object({
  revision: z.number().int().positive(),
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000),
  tags: z.array(z.string().min(1).max(50)).max(20),
  savedAt: z.string().datetime(),
  savedBy: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
  }).strict(),
}).strict();

export type UserRole = z.infer<typeof UserRoleSchema>;
export type GuideStatus = z.infer<typeof GuideStatusSchema>;
export type GuideVersionSnapshot = z.infer<typeof GuideVersionSnapshotSchema>;
export type GuideSummary = z.infer<typeof GuideSummarySchema>;
export type GuideDraftHistorySnapshot = z.infer<typeof GuideDraftHistorySnapshotSchema>;

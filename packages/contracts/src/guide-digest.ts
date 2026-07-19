import { z } from 'zod';

const IdV1Schema = z.string().trim().min(1).max(200);
const ShortLabelV1Schema = z.string().trim().min(1).max(50);
const ShortTextV1Schema = z.string().trim().min(1).max(200);
const DescriptionV1Schema = z.string().trim().min(1).max(2_000);
const SourceIdsV1Schema = z.array(IdV1Schema).min(1).max(200);
const OptionalSourceIdsV1Schema = z.array(IdV1Schema).max(200);
const TextListV1Schema = z.array(z.string().trim().min(1).max(200)).max(50);

export const GuideDigestTagCategoryV1Schema = z.enum([
  'DOMAIN',
  'PROCESS',
  'SYSTEM',
  'OBJECT',
  'ROLE',
  'RISK',
]);

export const GuideDigestGapCodeV1Schema = z.enum([
  'EMPTY_STAGE',
  'MISSING_ENTRY',
  'MISSING_EXIT',
  'UNCONNECTED_NODE',
  'UNREFERENCED_RESOURCE',
  'INCOMPLETE_DESCRIPTION',
  'SNAPSHOT_DIAGNOSTIC',
]);

export const GuideDigestDraftV1Schema = z.object({
  schemaVersion: z.literal(1),
  shortSummary: z.string().trim().min(1).max(200),
  scope: z.object({
    audiences: TextListV1Schema,
    businessObjects: TextListV1Schema,
    systems: TextListV1Schema,
  }).strict(),
  stageSections: z.array(z.object({
    stageId: IdV1Schema,
    title: ShortTextV1Schema,
    overview: DescriptionV1Schema,
    steps: z.array(z.object({
      targetId: IdV1Schema,
      title: ShortTextV1Schema,
      description: DescriptionV1Schema,
      inputs: TextListV1Schema,
      actions: TextListV1Schema,
      outputs: TextListV1Schema,
      resourceIds: z.array(IdV1Schema).max(200),
    }).strict()).max(2_000),
  }).strict()).max(200),
  keyRules: z.array(z.object({
    statement: DescriptionV1Schema,
    sourceIds: SourceIdsV1Schema,
  }).strict()).max(200),
  tagSuggestions: z.array(z.object({
    label: ShortLabelV1Schema,
    category: GuideDigestTagCategoryV1Schema,
    sourceIds: SourceIdsV1Schema,
  }).strict()).max(20),
  gaps: z.array(z.object({
    code: GuideDigestGapCodeV1Schema,
    message: DescriptionV1Schema,
    sourceIds: OptionalSourceIdsV1Schema,
  }).strict()).max(200),
}).strict();

export type GuideDigestTagCategoryV1 = z.infer<typeof GuideDigestTagCategoryV1Schema>;
export type GuideDigestGapCodeV1 = z.infer<typeof GuideDigestGapCodeV1Schema>;
export type GuideDigestDraftV1 = z.infer<typeof GuideDigestDraftV1Schema>;

import { z } from 'zod';

import { CanvasEdgeSchema, CanvasNodeSchema, LessonStepSchema } from './canvas';

const IdSchema = z.string().min(1).max(200);
const TimestampSchema = z.string().datetime();
const OptionalIdSchema = IdSchema.nullable();

export const WorkspaceEditorialPermissionV1Schema = z.enum(['OWNER', 'EDIT']);
export const WorkspaceQuestionClusterStatusV1Schema = z.enum(['OPEN', 'DISMISSED', 'CARD_CREATED']);
export const WorkspaceKnowledgeCardStatusV1Schema = z.enum(['DRAFT', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'ARCHIVED']);
export const WorkspaceFlowProposalStatusV1Schema = z.enum(['DRAFT', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'APPLIED', 'STALE']);
export const WorkspaceKnowledgeCardKindV1Schema = z.enum(['QUESTION_GAP', 'EVIDENCE_CONFLICT', 'IMPROVEMENT_PROPOSAL']);

export const FlowProposalOperationV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ADD_NODE'), node: CanvasNodeSchema }).strict(),
  z.object({ kind: z.literal('UPDATE_NODE'), nodeId: IdSchema, node: CanvasNodeSchema }).strict().superRefine((value, context) => {
    if (value.node.id !== value.nodeId) context.addIssue({ code: 'custom', path: ['node', 'id'], message: '替换节点必须保留目标节点 ID' });
  }),
  z.object({ kind: z.literal('REMOVE_NODE'), nodeId: IdSchema }).strict(),
  z.object({ kind: z.literal('ADD_EDGE'), edge: CanvasEdgeSchema }).strict(),
  z.object({ kind: z.literal('UPDATE_EDGE'), edgeId: IdSchema, edge: CanvasEdgeSchema }).strict().superRefine((value, context) => {
    if (value.edge.id !== value.edgeId) context.addIssue({ code: 'custom', path: ['edge', 'id'], message: '替换连线必须保留目标连线 ID' });
  }),
  z.object({ kind: z.literal('REMOVE_EDGE'), edgeId: IdSchema }).strict(),
  z.object({ kind: z.literal('REPLACE_STEPS'), steps: z.array(LessonStepSchema).max(10_000) }).strict(),
  z.object({ kind: z.literal('SET_ENTRY_EXIT'), entryNodeId: OptionalIdSchema, exitNodeIds: z.array(IdSchema).max(1_000) }).strict(),
]);

export const WorkspaceQuestionClusterV1Schema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  status: WorkspaceQuestionClusterStatusV1Schema,
  summary: z.string().min(1).max(1_000),
  occurrenceCount: z.number().int().positive(),
  ownerVisibleExampleCount: z.number().int().min(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export const WorkspaceKnowledgeCardV1Schema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  clusterId: OptionalIdSchema,
  kind: WorkspaceKnowledgeCardKindV1Schema,
  status: WorkspaceKnowledgeCardStatusV1Schema,
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(5_000),
  guideId: OptionalIdSchema,
  nodeId: OptionalIdSchema,
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export const WorkspaceFlowProposalV1Schema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  cardId: OptionalIdSchema,
  guideId: IdSchema,
  baseRevision: z.number().int().min(0),
  status: WorkspaceFlowProposalStatusV1Schema,
  summary: z.string().min(1).max(5_000),
  operations: z.array(FlowProposalOperationV1Schema).min(1).max(500),
  evidenceIds: z.array(IdSchema).min(1).max(200).superRefine((value, context) => {
    if (new Set(value).size !== value.length) context.addIssue({ code: 'custom', message: '提案证据 ID 不能重复' });
  }),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

export type FlowProposalOperationV1 = z.infer<typeof FlowProposalOperationV1Schema>;
export type WorkspaceQuestionClusterV1 = z.infer<typeof WorkspaceQuestionClusterV1Schema>;
export type WorkspaceKnowledgeCardV1 = z.infer<typeof WorkspaceKnowledgeCardV1Schema>;
export type WorkspaceFlowProposalV1 = z.infer<typeof WorkspaceFlowProposalV1Schema>;

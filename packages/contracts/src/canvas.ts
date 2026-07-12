import { z } from 'zod';

const IdSchema = z.string().min(1).max(200);
const PositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const SourceTraceSchema = z.object({
  referenceNodeId: IdSchema,
  sourceGuideId: IdSchema,
  sourceVersionId: IdSchema,
  sourceElementId: IdSchema,
});

const NodeBaseSchema = z.object({
  id: IdSchema,
  position: PositionSchema,
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  zIndex: z.number().int(),
  hidden: z.boolean().optional(),
  source: SourceTraceSchema.optional(),
  stageId: IdSchema.optional(),
  contentParentId: IdSchema.optional(),
});

const FlowDataSchema = z.object({
  label: z.string().min(1).max(200),
  description: z.string().max(5_000).optional(),
  shape: z.enum(['start', 'end', 'process', 'decision', 'data']),
  branchLabels: z.array(z.string().min(1).max(100)).max(8).optional(),
});

const KeypointSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200),
  timeSeconds: z.number().min(0).max(86_400),
  stepId: IdSchema.optional(),
  targetNodeId: IdSchema.optional(),
});

const ExpandedContinuationEdgeSchema = z.object({
  id: IdSchema,
  hidden: z.boolean(),
});

export const FlowStageSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(120),
  order: z.number().int().min(0).max(10_000),
  description: z.string().max(1_000).optional(),
});

function isSafeMediaUrl(value: string): boolean {
  if (value.startsWith('/api/media/')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const MediaUrlSchema = z.string().max(2_048).refine(isSafeMediaUrl, '媒体地址必须使用 HTTP(S) 或产品媒体路径');

const node = <TType extends string, TData extends z.ZodType>(type: TType, data: TData) =>
  NodeBaseSchema.extend({ type: z.literal(type), data });

export const CanvasNodeSchema = z.discriminatedUnion('type', [
  node('start', FlowDataSchema.extend({ shape: z.literal('start') })),
  node('end', FlowDataSchema.extend({ shape: z.literal('end') })),
  node('process', FlowDataSchema.extend({ shape: z.literal('process') })),
  node('decision', FlowDataSchema.extend({ shape: z.literal('decision') })),
  node('data', FlowDataSchema.extend({ shape: z.literal('data') })),
  node('markdown', z.object({ markdown: z.string().max(100_000) })),
  node('image', z.object({
    assetId: IdSchema.optional(),
    url: MediaUrlSchema,
    caption: z.string().max(1_000).optional(),
    alt: z.string().min(1).max(500),
  })),
  node('video', z.object({
    assetId: IdSchema.optional(),
    url: MediaUrlSchema,
    caption: z.string().max(1_000).optional(),
    keypoints: z.array(KeypointSchema).max(500),
  })),
  node('subguide', z.object({
    guideId: IdSchema,
    guideVersionId: IdSchema,
    title: z.string().min(1).max(200),
    version: z.number().int().positive(),
    expanded: z.boolean(),
    sourceEntryNodeId: IdSchema.optional(),
    sourceExitNodeIds: z.array(IdSchema).optional(),
    expandedContinuationEdges: z.array(ExpandedContinuationEdgeSchema).max(1_000).optional(),
  })),
]);

export const CanvasEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  sourceHandle: IdSchema.optional(),
  target: IdSchema,
  targetHandle: IdSchema.optional(),
  label: z.string().max(200).optional(),
  hidden: z.boolean().optional(),
  sourceTrace: SourceTraceSchema.optional(),
});

export const LessonStepSchema = z.object({
  id: IdSchema,
  order: z.number().int().min(0),
  title: z.string().min(1).max(200),
  body: z.string().max(10_000).optional(),
  nodeId: IdSchema,
  keypointId: IdSchema.optional(),
  source: SourceTraceSchema.optional(),
});

export const CanvasDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  stages: z.array(FlowStageSchema).max(200).optional(),
  nodes: z.array(CanvasNodeSchema).max(20_000),
  edges: z.array(CanvasEdgeSchema).max(40_000),
  viewport: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().min(0.05).max(8),
  }),
  steps: z.array(LessonStepSchema).max(10_000),
  entryNodeId: IdSchema.optional(),
  exitNodeIds: z.array(IdSchema).max(1_000),
}).superRefine((document, context) => {
  const nodeIds = new Set(document.nodes.map((item) => item.id));
  const edgeIds = new Set<string>();
  const seenNodeIds = new Set<string>();
  const seenStageIds = new Set<string>();
  const primaryTypes = new Set(['start', 'end', 'process', 'decision', 'data', 'subguide']);
  const contentTypes = new Set(['markdown', 'image', 'video']);
  const stageIds = new Set(document.stages?.map((stage) => stage.id) ?? []);

  document.stages?.forEach((stage, index) => {
    if (seenStageIds.has(stage.id)) {
      context.addIssue({ code: 'custom', path: ['stages', index, 'id'], message: '阶段 ID 必须唯一' });
    }
    seenStageIds.add(stage.id);
  });

  document.nodes.forEach((item, index) => {
    if (seenNodeIds.has(item.id)) {
      context.addIssue({ code: 'custom', path: ['nodes', index, 'id'], message: '节点 ID 必须唯一' });
    }
    seenNodeIds.add(item.id);
  });

  document.nodes.forEach((node, index) => {
    const primary = primaryTypes.has(node.type) && !node.source;
    if (node.stageId && (!primary || !stageIds.has(node.stageId))) {
      context.addIssue({ code: 'custom', path: ['nodes', index, 'stageId'], message: '阶段只能标记存在的一级主流程节点' });
    }
    if (!node.contentParentId) return;
    const parent = document.nodes.find((candidate) => candidate.id === node.contentParentId);
    if (!contentTypes.has(node.type) || !parent || !primaryTypes.has(parent.type) || parent.source) {
      context.addIssue({ code: 'custom', path: ['nodes', index, 'contentParentId'], message: '资料必须挂靠到一级主流程节点' });
    }
  });

  document.edges.forEach((edge, index) => {
    if (edgeIds.has(edge.id)) {
      context.addIssue({ code: 'custom', path: ['edges', index, 'id'], message: '连线 ID 必须唯一' });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      context.addIssue({ code: 'custom', path: ['edges', index], message: '连线端点必须存在' });
    }
  });

  document.steps.forEach((step, index) => {
    if (!nodeIds.has(step.nodeId)) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'nodeId'], message: '教学步骤必须关联现有节点' });
    }
  });

  if (document.entryNodeId && !nodeIds.has(document.entryNodeId)) {
    context.addIssue({ code: 'custom', path: ['entryNodeId'], message: '入口节点必须存在' });
  }
  document.exitNodeIds.forEach((id, index) => {
    if (!nodeIds.has(id)) {
      context.addIssue({ code: 'custom', path: ['exitNodeIds', index], message: '出口节点必须存在' });
    }
  });
});

export type SourceTrace = z.infer<typeof SourceTraceSchema>;
export type FlowStage = z.infer<typeof FlowStageSchema>;
export type NodeKind = z.infer<typeof CanvasNodeSchema>['type'];
type AnyCanvasNode = z.infer<typeof CanvasNodeSchema>;
export type CanvasNode<TType extends NodeKind = NodeKind> = Extract<AnyCanvasNode, { type: TType }>;
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;
export type LessonStep = z.infer<typeof LessonStepSchema>;
export type CanvasDocument = z.infer<typeof CanvasDocumentSchema>;

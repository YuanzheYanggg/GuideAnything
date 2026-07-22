import { z } from 'zod';

const IdV1Schema = z.string().min(1).max(200);
const TimestampV1Schema = z.string().datetime();

export const FlowRegressionVerificationV1Schema = z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']);
export const FlowRegressionCaseStatusV1Schema = z.enum(['ACTIVE', 'NEEDS_REVIEW', 'ARCHIVED']);
export const FlowRegressionExpectedAgentStatusV1Schema = z.enum(['SUPPORTED', 'PARTIAL']);

export const FlowRegressionReferenceEligibilityV1Schema = z.discriminatedUnion('eligible', [
  z.object({
    eligible: z.literal(true),
    guideId: IdV1Schema,
    resourceNodeId: IdV1Schema,
    annotationId: IdV1Schema,
    expectedAgentStatus: FlowRegressionExpectedAgentStatusV1Schema,
  }).strict(),
  z.object({
    eligible: z.literal(false),
    reasonCode: z.enum([
      'NOT_IMAGE_ANNOTATION_REFERENCE',
      'ANSWER_STATUS_UNSUPPORTED',
      'GUIDE_ACCESS_REQUIRED',
      'TARGET_STALE',
    ]),
  }).strict(),
]);

export const WorkspaceFlowRegressionCaseV1Schema = z.object({
  id: IdV1Schema,
  guideId: IdV1Schema,
  resourceNodeId: IdV1Schema,
  annotationId: IdV1Schema,
  question: z.string().min(1).max(20_000),
  expectedAgentStatus: FlowRegressionExpectedAgentStatusV1Schema,
  status: FlowRegressionCaseStatusV1Schema,
  createdAt: TimestampV1Schema,
  updatedAt: TimestampV1Schema,
  lastVerifiedSnapshotId: IdV1Schema.nullable(),
  lastRetrievalVerification: FlowRegressionVerificationV1Schema.nullable(),
  lastAgentVerification: FlowRegressionVerificationV1Schema.nullable(),
}).strict();

export const FlowAnnotationHealthIssueCodeV1Schema = z.enum([
  'ANNOTATION_LEAF_MISSING',
  'ANNOTATION_TARGET_MISMATCH',
  'ANNOTATION_NOT_RANKED',
  'ANNOTATION_CONTEXT_MISSING',
  'ANNOTATION_REFERENCE_INVALID',
]);

export const FlowAnnotationHealthIssueV1Schema = z.object({
  resourceNodeId: IdV1Schema,
  annotationId: IdV1Schema,
  code: FlowAnnotationHealthIssueCodeV1Schema,
}).strict();

export const FlowAnnotationHealthV1Schema = z.object({
  snapshotId: IdV1Schema.nullable(),
  issues: z.array(FlowAnnotationHealthIssueV1Schema).max(500),
}).strict();

export const FlowRegressionCaseListV1Schema = z.object({
  items: z.array(WorkspaceFlowRegressionCaseV1Schema).max(500),
}).strict();

export const UpdateFlowRegressionCaseStatusRequestV1Schema = z.object({
  status: z.literal('ARCHIVED'),
}).strict();

const AgentRetrievalDiagnosticCandidateV1Schema = z.object({
  fragmentId: IdV1Schema,
  projection: z.enum(['OVERVIEW', 'NODE', 'RESOURCE', 'IMAGE_ANNOTATION', 'OTHER']),
  rank: z.number().int().min(1).max(50),
  selected: z.boolean(),
}).strict();

const AgentRetrievalDiagnosticClosureV1Schema = z.object({
  id: IdV1Schema,
  kind: z.enum(['OVERVIEW', 'NODE', 'RESOURCE']),
}).strict();

export const AgentRetrievalDiagnosticReasonCodeV1Schema = z.enum([
  'NO_TARGET_LEAF',
  'TARGET_NOT_RANKED',
  'CONTEXT_NOT_CLOSED',
  'BUDGET_EXHAUSTED',
  'REFERENCE_NOT_RESOLVABLE',
  'MODEL_STATUS_MISMATCH',
  'TARGET_REMOVED',
]);

export const AgentRetrievalDiagnosticV1Schema = z.object({
  id: IdV1Schema,
  runId: IdV1Schema,
  guideId: IdV1Schema.nullable(),
  targetResourceNodeId: IdV1Schema.nullable().optional(),
  targetAnnotationId: IdV1Schema.nullable().optional(),
  queryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reasonCode: AgentRetrievalDiagnosticReasonCodeV1Schema,
  candidates: z.array(AgentRetrievalDiagnosticCandidateV1Schema).max(50),
  closure: z.array(AgentRetrievalDiagnosticClosureV1Schema).max(50),
  createdAt: TimestampV1Schema,
  expiresAt: TimestampV1Schema,
}).strict();

export type FlowRegressionVerificationV1 = z.infer<typeof FlowRegressionVerificationV1Schema>;
export type FlowRegressionCaseStatusV1 = z.infer<typeof FlowRegressionCaseStatusV1Schema>;
export type FlowRegressionExpectedAgentStatusV1 = z.infer<typeof FlowRegressionExpectedAgentStatusV1Schema>;
export type FlowRegressionReferenceEligibilityV1 = z.infer<typeof FlowRegressionReferenceEligibilityV1Schema>;
export type WorkspaceFlowRegressionCaseV1 = z.infer<typeof WorkspaceFlowRegressionCaseV1Schema>;
export type FlowAnnotationHealthIssueV1 = z.infer<typeof FlowAnnotationHealthIssueV1Schema>;
export type FlowAnnotationHealthV1 = z.infer<typeof FlowAnnotationHealthV1Schema>;
export type FlowRegressionCaseListV1 = z.infer<typeof FlowRegressionCaseListV1Schema>;
export type UpdateFlowRegressionCaseStatusRequestV1 = z.infer<typeof UpdateFlowRegressionCaseStatusRequestV1Schema>;
export type AgentRetrievalDiagnosticV1 = z.infer<typeof AgentRetrievalDiagnosticV1Schema>;

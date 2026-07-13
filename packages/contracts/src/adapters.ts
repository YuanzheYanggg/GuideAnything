import { z } from 'zod';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }

function isPlainJsonObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return (prototype === Object.prototype || prototype === null)
    && Object.getOwnPropertySymbols(input).length === 0;
}

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueSchema),
  z.custom<Record<string, unknown>>(isPlainJsonObject, { message: 'Expected a plain JSON object' })
    .pipe(z.record(z.string(), JsonValueSchema)),
]));

export const AgentRiskSchema = z.enum(['READ', 'WRITE', 'EXECUTE']);
export const AgentCapabilitySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  risk: AgentRiskSchema,
  requiresApproval: z.boolean(),
});

export const SyncResultSchema = z.object({
  sourceId: z.string().min(1),
  indexedDocuments: z.number().int().min(0),
  completedAt: z.string().datetime(),
});
export const KnowledgeHitSchema = z.object({
  sourceId: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string(),
  score: z.number().min(0),
});
export const AgentSessionInputSchema = z.object({
  workspaceId: z.string().min(1),
  agentItemId: z.string().min(1),
  initiatedBy: z.string().min(1),
});
export const AgentSessionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  status: z.enum([
    'READY',
    'RUNNING',
    'WAITING_APPROVAL',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),
});
export const AgentEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  type: z.enum(['MESSAGE', 'TOOL_REQUEST', 'TOOL_RESULT', 'STATUS', 'ERROR']),
  payload: z.record(z.string(), JsonValueSchema),
});
export const OntologyBuildSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  status: z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED']),
});
export const OntologyResultSchema = z.object({
  entities: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.string().min(1),
  })),
  relations: z.array(z.object({
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    kind: z.string().min(1),
  })),
});
export const OntologyExplanationSchema = z.object({
  entityId: z.string().min(1),
  summary: z.string(),
  evidenceItemIds: z.array(z.string().min(1)),
});

export type AgentRisk = z.infer<typeof AgentRiskSchema>;
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;
export type AgentSessionInput = z.infer<typeof AgentSessionInputSchema>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type OntologyBuild = z.infer<typeof OntologyBuildSchema>;
export type OntologyResult = z.infer<typeof OntologyResultSchema>;
export type OntologyExplanation = z.infer<typeof OntologyExplanationSchema>;

export interface KnowledgeSourceAdapter {
  readonly kind: string;
  validateConfiguration(input: unknown): Promise<void>;
  sync(sourceId: string, signal: AbortSignal): Promise<SyncResult>;
  search(sourceIds: string[], query: string): Promise<KnowledgeHit[]>;
}

export interface AgentRuntimeAdapter {
  readonly kind: string;
  capabilities(): Promise<AgentCapability[]>;
  createSession(input: AgentSessionInput): Promise<AgentSession>;
  send(sessionId: string, message: string): AsyncIterable<AgentEvent>;
  cancel(sessionId: string): Promise<void>;
}

export interface OntologyProvider {
  rebuild(workspaceId: string, sourceItemIds: string[]): Promise<OntologyBuild>;
  query(workspaceId: string, query: string): Promise<OntologyResult>;
  explain(workspaceId: string, entityId: string): Promise<OntologyExplanation>;
}

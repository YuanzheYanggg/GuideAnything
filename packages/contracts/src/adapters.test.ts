import { expect, it } from 'vitest';

import {
  AgentCapabilitySchema,
  AgentEventSchema,
  AgentSessionSchema,
  KnowledgeHitSchema,
  OntologyBuildSchema,
  OntologyExplanationSchema,
  OntologyResultSchema,
  SyncResultSchema,
} from './adapters';
import { JsonValueSchema, type JsonValue } from './index';

it('keeps runtime capabilities explicit and serializable', () => {
  expect(AgentCapabilitySchema.parse({
    id: 'read-workspace',
    label: '读取工作区资料',
    risk: 'READ',
    requiresApproval: false,
  })).toEqual(expect.objectContaining({ risk: 'READ' }));
  expect(AgentCapabilitySchema.parse({
    id: 'run-command',
    label: '运行本地命令',
    risk: 'EXECUTE',
    requiresApproval: true,
  })).toEqual(expect.objectContaining({ requiresApproval: true }));
});

it('validates serializable source sync and search results', () => {
  expect(SyncResultSchema.parse({
    sourceId: 'source-1',
    indexedDocuments: 2,
    completedAt: '2026-07-13T08:00:00.000Z',
  }).indexedDocuments).toBe(2);
  expect(KnowledgeHitSchema.parse({
    sourceId: 'source-1',
    documentId: 'document-1',
    title: '物料规范',
    excerpt: '高亮片段',
    score: 0.8,
  }).score).toBe(0.8);
});

it('validates agent session and event lifecycle values', () => {
  expect(AgentSessionSchema.parse({
    id: 'session-1',
    workspaceId: 'workspace-materials',
    status: 'WAITING_APPROVAL',
  }).status).toBe('WAITING_APPROVAL');
  expect(AgentEventSchema.parse({
    id: 'event-1',
    sessionId: 'session-1',
    type: 'TOOL_REQUEST',
    payload: { capabilityId: 'run-command' },
  }).payload).toEqual({ capabilityId: 'run-command' });
});

it('keeps nested agent event payloads JSON serializable through the root export', () => {
  const payload: Record<string, JsonValue> = {
    approved: true,
    attempts: 2,
    note: null,
    tool: {
      id: 'run-command',
      arguments: ['pnpm', { flags: ['test'], timeout: 30 }],
    },
  };
  const event = AgentEventSchema.parse({
    id: 'event-json',
    sessionId: 'session-1',
    type: 'TOOL_REQUEST',
    payload,
  });

  expect(JsonValueSchema.parse(payload)).toEqual(payload);
  expect(JSON.parse(JSON.stringify(event))).toEqual(event);
});

it.each([
  ['bigint', 1n],
  ['function', () => 'not-json'],
  ['symbol', Symbol('not-json')],
  ['undefined', undefined],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['Date', new Date('2026-07-13T00:00:00.000Z')],
  ['class instance', new (class RuntimeValue { value = 'not-plain'; })()],
])('rejects %s values in agent event payloads', (_label, invalidValue) => {
  expect(() => AgentEventSchema.parse({
    id: 'event-invalid',
    sessionId: 'session-1',
    type: 'TOOL_RESULT',
    payload: { invalidValue },
  })).toThrow();
});

it('validates ontology build, query, and evidence results', () => {
  expect(OntologyBuildSchema.parse({
    id: 'build-1',
    workspaceId: 'workspace-materials',
    status: 'QUEUED',
  }).status).toBe('QUEUED');
  expect(OntologyResultSchema.parse({
    entities: [{ id: 'entity-1', label: '物料', kind: 'concept' }],
    relations: [{ sourceId: 'entity-1', targetId: 'entity-2', kind: 'depends-on' }],
  }).entities).toHaveLength(1);
  expect(OntologyExplanationSchema.parse({
    entityId: 'entity-1',
    summary: '从工作区资料提取的概念',
    evidenceItemIds: ['item-1'],
  }).evidenceItemIds).toEqual(['item-1']);
});

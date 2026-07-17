# Workspace Knowledge Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an editor-only workspace knowledge-evolution workbench that turns verified internal question gaps into auditable knowledge cards and revision-safe flow proposals, then lets an editor apply approved proposals to a guide draft.

**Architecture:** Keep `CanvasDocument` / `GuideVersion` as the only authoritative process source and preserve `FlowKnowledgeSnapshotV1` as its immutable, derived semantic index. Store editorial cards, question clusters, proposal operations and audit events in separate workspace-scoped tables so they can never enter normal Agent retrieval. Extend the existing Agent output commit transaction to record only evidence-backed workspace question gaps; add a strict proposal-operation contract and a pure canvas patcher that applies a proposal only when its base draft revision matches.

**Tech Stack:** TypeScript, Zod, Fastify, SQLite `STRICT` tables, Vitest, React, React Router, React Flow, pnpm workspaces.

## Global Constraints

- `SANTEXWELL` remains a user-enabled external-industry supplement and must never create, update, or provide internal editorial records.
- `CanvasDocument` and published `GuideVersion` remain the sole authoritative process sources; `FlowKnowledgeSnapshotV1` remains a derived, non-editable index.
- Only workspace `OWNER` and `EDIT` members can list or mutate editorial resources; `VIEW` users must receive `403` from direct API requests and have no navigation entry.
- Editorial cards, question clusters, proposal operations and raw question samples must not be available to normal Agent retrieval or ordinary users.
- Only an `OWNER` may view raw question text; all editor-facing aggregate views show sanitized question summaries and counts.
- No Agent output can mutate a guide. An editor must review a typed proposal, then explicitly apply it to a matching draft revision and separately use the existing publish endpoint.
- All API input/output is validated with shared Zod contracts; authorization filters occur before SQL result limits.
- Do not add runtime dependencies.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/db/migrations/0005_workspace_editorial_knowledge.sql` | Strict, workspace-scoped persistence and integrity triggers for clusters, cards, evidence, proposals, operations and audit events. |
| `packages/contracts/src/workspace-editorial.ts` | Shared Zod contracts for editor-only API data and typed flow operations. |
| `packages/contracts/src/workspace-editorial.test.ts` | Contract boundary and operation-schema tests. |
| `packages/contracts/src/index.ts` | Public export for editorial contracts. |
| `packages/canvas-core/src/flow-proposal.ts` | Pure validate/diff/apply functions for typed operations over `CanvasDocument`. |
| `packages/canvas-core/src/flow-proposal.test.ts` | Safe operation, topology and no-mutation tests. |
| `packages/canvas-core/src/index.ts` | Export proposal helpers. |
| `apps/api/src/modules/editorial/repository.ts` | SQL reads/writes with workspace filtering and audit persistence. |
| `apps/api/src/modules/editorial/service.ts` | Role policy, state transitions, proposal construction and revision-safe application. |
| `apps/api/src/modules/editorial/routes.ts` | Fastify routes and request parsing. |
| `apps/api/src/modules/editorial/editorial.test.ts` | API/service authorization, state, audit, privacy and conflict tests. |
| `apps/api/src/modules/agents/editorial-question-recorder.ts` | Transactional conversion of qualifying completed workspace runs into question-cluster events. |
| `apps/api/src/modules/agents/output-committer.ts` | Invoke the recorder inside the existing committed-answer transaction. |
| `apps/api/src/modules/agents/bundles/workspace-query.ts` | Versioned, code-adjacent `guideanything-workspace-query` bundle metadata and source-policy instructions. |
| `apps/api/src/modules/agents/bundles/workspace-query.test.ts` | Bundle revision and source-isolation tests. |
| `apps/web/src/features/editorial/types.ts` | Frontend DTO aliases and form-state types. |
| `apps/web/src/features/editorial/WorkspaceEditorialPage.tsx` | Editor workbench: question queue, card list, proposal review and apply controls. |
| `apps/web/src/features/editorial/WorkspaceEditorialPage.test.tsx` | Visibility, loading, card lifecycle and proposal-action UI tests. |
| `apps/web/src/features/workspace/WorkspaceOverviewPage.tsx` | Display an editor-only entry into the knowledge-evolution workbench. |
| `apps/web/src/features/workspace/WorkspacePages.test.tsx` | Route and navigation access tests. |
| `apps/web/src/lib/api.ts` | Typed editorial API client methods. |
| `apps/web/src/App.tsx` | Guarded `/workspaces/:workspaceId/knowledge-evolution` route. |
| `apps/web/src/styles.css` | Existing-token styling for editorial queue, card status and proposal diff. |
| `docs/ARCHITECTURE.md` | Document the separate editorial domain and query-bundle boundary. |
| `docs/PRD.md` | Document editor workflow and ordinary-user visibility. |

## Task 1: Define editorial and typed proposal contracts

**Files:**
- Create: `packages/contracts/src/workspace-editorial.ts`
- Create: `packages/contracts/src/workspace-editorial.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/workspace-editorial.test.ts`

**Interfaces:**
- Consumes: `CanvasDocumentSchema`, `CanvasNode` and `CanvasEdge` from `packages/contracts/src/canvas.ts`; `WorkspacePermissionSchema` from `packages/contracts/src/workspace.ts`.
- Produces: `WorkspaceQuestionClusterV1Schema`, `WorkspaceKnowledgeCardV1Schema`, `FlowProposalOperationV1Schema`, `WorkspaceFlowProposalV1Schema`, and request/response schemas used by API and Web.

- [ ] **Step 1: Write failing schema tests for access-safe editorial records and typed flow operations.**

```ts
it('rejects an editor-only card without a workspace and a proposal without its base draft revision', () => {
  expect(WorkspaceKnowledgeCardV1Schema.safeParse({ id: 'card-1', status: 'DRAFT' }).success).toBe(false);
  expect(WorkspaceFlowProposalV1Schema.safeParse({
    id: 'proposal-1', workspaceId: 'workspace-1', guideId: 'guide-1', status: 'DRAFT', operations: [],
  }).success).toBe(false);
});

it('accepts an update-node operation only when the replacement keeps the targeted node identity', () => {
  expect(FlowProposalOperationV1Schema.safeParse({
    kind: 'UPDATE_NODE', nodeId: 'review', node: { id: 'review', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '复核', shape: 'process' } },
  }).success).toBe(true);
});
```

- [ ] **Step 2: Run the contract test to verify it fails because the editorial contracts do not exist.**

Run: `pnpm --filter @guideanything/contracts test -- src/workspace-editorial.test.ts`

Expected: FAIL with an import error for `./workspace-editorial`.

- [ ] **Step 3: Add strict discriminated contracts.**

```ts
export const FlowProposalOperationV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ADD_NODE'), node: CanvasNodeSchema }).strict(),
  z.object({ kind: z.literal('UPDATE_NODE'), nodeId: IdSchema, node: CanvasNodeSchema }).strict(),
  z.object({ kind: z.literal('REMOVE_NODE'), nodeId: IdSchema }).strict(),
  z.object({ kind: z.literal('ADD_EDGE'), edge: CanvasEdgeSchema }).strict(),
  z.object({ kind: z.literal('UPDATE_EDGE'), edgeId: IdSchema, edge: CanvasEdgeSchema }).strict(),
  z.object({ kind: z.literal('REMOVE_EDGE'), edgeId: IdSchema }).strict(),
  z.object({ kind: z.literal('REPLACE_STEPS'), steps: z.array(LessonStepSchema).max(10_000) }).strict(),
  z.object({ kind: z.literal('SET_ENTRY_EXIT'), entryNodeId: IdSchema.nullable(), exitNodeIds: z.array(IdSchema).max(1_000) }).strict(),
]);

export const WorkspaceFlowProposalV1Schema = z.object({
  id: IdSchema, workspaceId: IdSchema, cardId: IdSchema.nullable(), guideId: IdSchema,
  baseRevision: z.number().int().min(0), status: z.enum(['DRAFT', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'APPLIED', 'STALE']),
  summary: z.string().min(1).max(5_000), operations: z.array(FlowProposalOperationV1Schema).min(1).max(500),
  evidenceIds: z.array(IdSchema).min(1).max(200), createdBy: IdSchema, createdAt: TimestampSchema, updatedAt: TimestampSchema,
}).strict();
```

Export the new schemas and inferred types through `packages/contracts/src/index.ts`. Add super-refinements that require unique operation identities and require `UPDATE_NODE.node.id === nodeId` / `UPDATE_EDGE.edge.id === edgeId`.

- [ ] **Step 4: Run the contract test to verify the schemas pass and reject identity mismatches.**

Run: `pnpm --filter @guideanything/contracts test -- src/workspace-editorial.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract boundary.**

```bash
git add packages/contracts/src/workspace-editorial.ts packages/contracts/src/workspace-editorial.test.ts packages/contracts/src/index.ts
git commit -m "feat: define workspace editorial contracts"
```

## Task 2: Add pure, revision-independent proposal application to canvas-core

**Files:**
- Create: `packages/canvas-core/src/flow-proposal.ts`
- Create: `packages/canvas-core/src/flow-proposal.test.ts`
- Modify: `packages/canvas-core/src/index.ts`
- Test: `packages/canvas-core/src/flow-proposal.test.ts`

**Interfaces:**
- Consumes: `CanvasDocumentSchema`, `CanvasDocument`, `FlowProposalOperationV1`.
- Produces: `applyFlowProposalOperations(document, operations): CanvasDocument` and `describeFlowProposalOperations(document, operations): FlowProposalDiffV1`.

- [ ] **Step 1: Write failing tests for immutable application and invalid topology rejection.**

```ts
it('adds an approved node without mutating the base canvas document', () => {
  const result = applyFlowProposalOperations(baseDocument, [{ kind: 'ADD_NODE', node: reviewNode }]);
  expect(result.nodes.map((node) => node.id)).toContain('review');
  expect(baseDocument.nodes.map((node) => node.id)).not.toContain('review');
});

it('rejects a remove-node operation while a remaining edge references that node', () => {
  expect(() => applyFlowProposalOperations(baseDocument, [{ kind: 'REMOVE_NODE', nodeId: 'start' }]))
    .toThrow('流程提案会留下悬空连线');
});
```

- [ ] **Step 2: Run the canvas-core test to verify it fails because the patcher does not exist.**

Run: `pnpm --filter @guideanything/canvas-core test -- src/flow-proposal.test.ts`

Expected: FAIL with an import error for `./flow-proposal`.

- [ ] **Step 3: Implement a pure operation reducer and validate the final document.**

```ts
export function applyFlowProposalOperations(
  base: CanvasDocument,
  operations: readonly FlowProposalOperationV1[],
): CanvasDocument {
  const draft = structuredClone(CanvasDocumentSchema.parse(base));
  for (const operation of operations) applyOne(draft, operation);
  const parsed = CanvasDocumentSchema.safeParse(draft);
  if (!parsed.success) throw new FlowProposalApplicationError('INVALID_RESULT', '流程提案无法形成有效流程图');
  return parsed.data;
}
```

`applyOne` must reject duplicate new IDs, missing update/remove IDs, replacement identity changes, and removal of a node still used by an edge, step, entry or exit. `describeFlowProposalOperations` returns the stable IDs grouped as `addedNodeIds`, `updatedNodeIds`, `removedNodeIds`, `addedEdgeIds`, `updatedEdgeIds`, and `removedEdgeIds` for UI rendering.

- [ ] **Step 4: Run unit tests and the canvas type check.**

Run: `pnpm --filter @guideanything/canvas-core test -- src/flow-proposal.test.ts && pnpm --filter @guideanything/canvas-core build`

Expected: PASS.

- [ ] **Step 5: Commit the pure canvas patcher.**

```bash
git add packages/canvas-core/src/flow-proposal.ts packages/canvas-core/src/flow-proposal.test.ts packages/canvas-core/src/index.ts
git commit -m "feat: apply typed flow proposal operations"
```

## Task 3: Persist editorial records outside normal knowledge retrieval

**Files:**
- Create: `apps/api/src/db/migrations/0005_workspace_editorial_knowledge.sql`
- Modify: `apps/api/src/db/migrate.test.ts`
- Test: `apps/api/src/db/migrate.test.ts`

**Interfaces:**
- Consumes: existing `workspaces`, `users`, `guides`, `conversation_messages`, `agent_runs`, `answer_citations`, `flow_knowledge_snapshots` tables.
- Produces: workspace-scoped editorial tables which have no foreign key or registration path into `knowledge_sources`, `knowledge_documents`, or `knowledge_fragments`.

- [ ] **Step 1: Write migration assertions for editorial isolation and integrity.**

```ts
expect(tableNames).toContain('workspace_knowledge_cards');
expect(tableNames).toContain('workspace_flow_proposals');
expect(tableNames).not.toContain('workspace_editorial_knowledge_sources');
expect(() => database.prepare('INSERT INTO workspace_flow_proposals (...) VALUES (...)').run(...staleWorkspaceValues))
  .toThrow(/proposal guide must belong to workspace/);
```

- [ ] **Step 2: Run migration tests to verify the new tables are absent.**

Run: `pnpm --filter @guideanything/api test -- src/db/migrate.test.ts`

Expected: FAIL because migration `0005` and its tables do not exist.

- [ ] **Step 3: Create strict tables, indexes and containment triggers.**

```sql
CREATE TABLE workspace_question_clusters (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cluster_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'DISMISSED', 'CARD_CREATED')),
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count > 0),
  owner_visible_example_count INTEGER NOT NULL CHECK (owner_visible_example_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, cluster_key)
) STRICT;
```

Create matching `workspace_question_cluster_examples`, `workspace_knowledge_cards`, `workspace_knowledge_card_evidence`, `workspace_flow_proposals`, `workspace_flow_proposal_operations`, and `workspace_editorial_audit_events` tables. Use triggers to enforce workspace equality between card, cluster, guide, evidence citation, proposal, and proposal operation. Index all list routes by `(workspace_id, status, updated_at DESC)`.

- [ ] **Step 4: Run migration tests and verify a fresh database migrates through `0005`.**

Run: `pnpm --filter @guideanything/api test -- src/db/migrate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the migration.**

```bash
git add apps/api/src/db/migrations/0005_workspace_editorial_knowledge.sql apps/api/src/db/migrate.test.ts
git commit -m "feat: persist workspace editorial knowledge"
```

## Task 4: Implement editor-only repository, service and routes

**Files:**
- Create: `apps/api/src/modules/editorial/repository.ts`
- Create: `apps/api/src/modules/editorial/service.ts`
- Create: `apps/api/src/modules/editorial/routes.ts`
- Create: `apps/api/src/modules/editorial/editorial.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/guides/service.ts`
- Modify: `apps/api/src/modules/guides/permissions.test.ts`
- Test: `apps/api/src/modules/editorial/editorial.test.ts`

**Interfaces:**
- Consumes: editorial contracts, `getWorkspacePermission`, `GuideService.applyEditorialProposal`, and `applyFlowProposalOperations`.
- Produces: `/api/workspaces/:id/editorial/*` endpoints and `WorkspaceEditorialService`.

- [ ] **Step 1: Write API tests for visibility, state transitions and Owner-only raw examples.**

```ts
it('denies an EDIT member raw question examples but permits aggregated clusters', async () => {
  expect((await requestAs(editUser, 'GET', '/api/workspaces/workspace-1/editorial/question-clusters')).statusCode).toBe(200);
  expect((await requestAs(editUser, 'GET', '/api/workspaces/workspace-1/editorial/question-clusters/cluster-1/examples')).statusCode).toBe(403);
});

it('denies a VIEW member every editorial route', async () => {
  expect((await requestAs(viewUser, 'GET', '/api/workspaces/workspace-1/editorial/cards')).statusCode).toBe(403);
});

it('marks a proposal stale instead of applying it when its base revision differs', async () => {
  expect((await requestAs(editUser, 'POST', '/api/workspaces/workspace-1/editorial/proposals/proposal-1/apply')).statusCode).toBe(409);
});

it('allows a workspace EDIT member to apply an accepted editorial proposal but not to publish the guide', async () => {
  expect((await requestAs(editUser, 'POST', '/api/workspaces/workspace-1/editorial/proposals/proposal-1/apply')).statusCode).toBe(200);
  expect((await requestAs(editUser, 'POST', '/api/guides/guide-1/publish')).statusCode).toBe(403);
});
```

- [ ] **Step 2: Run the editorial API test to verify it fails because routes are not registered.**

Run: `pnpm --filter @guideanything/api test -- src/modules/editorial/editorial.test.ts`

Expected: FAIL with route/module import errors.

- [ ] **Step 3: Implement explicit role gates and lifecycle methods.**

```ts
private requireEditor(actorId: string, workspaceId: string): 'OWNER' | 'EDIT' {
  const permission = getWorkspacePermission(this.database, workspaceId, actorId);
  if (!permission) throw httpError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在');
  if (permission === 'VIEW') throw httpError(403, 'FORBIDDEN', '只有工作区所有者或编辑者可以管理知识演进');
  return permission;
}

applyProposal(actor: { id: string; role: string }, workspaceId: string, proposalId: string) {
  this.requireEditor(actor.id, workspaceId);
  const proposal = loadProposalForWorkspace(this.database, proposalId, workspaceId);
  const guide = requireGuideForWorkspace(this.database, proposal.guideId, workspaceId);
  if (guide.revision !== proposal.baseRevision) return markProposalStale(this.database, proposalId, actor.id);
  const document = applyFlowProposalOperations(guide.document, proposal.operations);
  const saved = this.guideService.applyEditorialProposal(actor, guide.id, proposal.baseRevision, document);
  return markProposalApplied(this.database, proposalId, actor.id, saved.revision);
}
```

Add this narrowly-scoped method to `GuideService`; it must require an active `OWNER` or `EDIT` workspace membership for the guide's workspace, call `updateGuide` with the supplied draft revision and document, then run the existing best-effort draft flow snapshot sync. It must not change the existing author-only publish rule or the normal guide save route.

```ts
applyEditorialProposal(user: { id: string; role: string }, guideId: string, revision: number, document: CanvasDocument) {
  const guide = getGuide(this.database, guideId);
  if (!guide) throw httpError(404, 'GUIDE_NOT_FOUND', '指南不存在');
  const permission = getWorkspacePermission(this.database, guide.workspaceId, user.id);
  if (!permission || !['OWNER', 'EDIT'].includes(permission)) {
    throw httpError(403, 'FORBIDDEN', '只有工作区所有者或编辑者可以应用流程提案');
  }
  const saved = updateGuide(this.database, guideId, user.id, revision, { document });
  this.bestEffortFlowSync({
    workspaceId: saved.workspaceId, workspaceItemId: saved.workspaceItemId, guideId: saved.id, ownerId: saved.ownerId,
    title: saved.title, summary: saved.summary, tags: saved.tags,
    origin: { kind: 'DRAFT', revision: saved.revision }, document: saved.document,
  });
  return saved;
}
```

Expose aggregate routes for clusters/cards/proposals, mutation routes for cards and proposal state, and `POST /proposals/:proposalId/apply`. Every editorial mutation inserts an audit event in the same `BEGIN IMMEDIATE` transaction. The guide save itself remains the authoritative optimistic-lock transaction.

- [ ] **Step 4: Run editorial API tests and the API build.**

Run: `pnpm --filter @guideanything/api test -- src/modules/editorial/editorial.test.ts && pnpm --filter @guideanything/api build`

Expected: PASS.

- [ ] **Step 5: Commit the editor-only API.**

```bash
git add apps/api/src/modules/editorial apps/api/src/app.ts apps/api/src/modules/guides/service.ts apps/api/src/modules/guides/permissions.test.ts
git commit -m "feat: add editor-only knowledge evolution api"
```

## Task 5: Record qualifying workspace question gaps without exposing them to retrieval

**Files:**
- Create: `apps/api/src/modules/agents/editorial-question-recorder.ts`
- Create: `apps/api/src/modules/agents/editorial-question-recorder.test.ts`
- Modify: `apps/api/src/modules/agents/output-committer.ts`
- Modify: `apps/api/src/modules/agents/output-committer.test.ts`
- Test: `apps/api/src/modules/agents/editorial-question-recorder.test.ts`

**Interfaces:**
- Consumes: committed workspace `AgentCommittedAnswerV1`, initiating conversation message, canonical evidence and editorial repositories.
- Produces: `recordWorkspaceQuestionGap(input): void`, called only within the existing answer-commit transaction.

- [ ] **Step 1: Write failing tests for qualifying answer states and source isolation.**

```ts
it('records a PARTIAL workspace answer as a sanitized aggregate and Owner-only raw sample', () => {
  recordWorkspaceQuestionGap(database, partialWorkspaceRun);
  expect(listQuestionClusters(database, 'workspace-1')).toMatchObject([{ occurrenceCount: 1, status: 'OPEN' }]);
  expect(searchKnowledgeInternal(database, '异常处理', { sourceKinds: ['WORKSPACE_FLOW'], workspaceId: 'workspace-1', userId: 'editor-1', limit: 20 }))
    .not.toContainEqual(expect.objectContaining({ title: expect.stringMatching(/问题簇/) }));
});

it('does not record a supported answer or a global Santexwell run', () => {
  recordWorkspaceQuestionGap(database, supportedWorkspaceRun);
  recordWorkspaceQuestionGap(database, globalVaultRun);
  expect(listQuestionClusters(database, 'workspace-1')).toEqual([]);
});
```

- [ ] **Step 2: Run the recorder tests to verify they fail.**

Run: `pnpm --filter @guideanything/api test -- src/modules/agents/editorial-question-recorder.test.ts`

Expected: FAIL with an import error for `editorial-question-recorder`.

- [ ] **Step 3: Implement deterministic, privacy-preserving aggregation.**

```ts
export function recordWorkspaceQuestionGap(database: DatabaseSync, input: EditorialQuestionGapInput): void {
  if (input.context.scope !== 'WORKSPACE' || !input.context.workspaceId) return;
  if (!['PARTIAL', 'INSUFFICIENT', 'CONFLICTING'].includes(input.answer.evidenceStatus)) return;
  const normalized = normalizeQuestionForCluster(input.userMessageText);
  const clusterKey = sha256([input.context.workspaceId, primaryFlowAnchor(input.answer), normalized].join('\u0000'));
  upsertQuestionCluster(database, { workspaceId: input.context.workspaceId, clusterKey, summary: redactQuestionSummary(normalized) });
  insertQuestionClusterExample(database, { clusterId, messageId: input.initiatingMessageId, ownerId: input.context.ownerId });
}
```

The recorder must receive the initiating user message text from the same database transaction, not from model output. Do not cluster or persist hidden reasoning. Do not register editorial rows in the knowledge index.

- [ ] **Step 4: Wire the recorder into `DatabaseAgentOutputCommitter.commit` and run the focused suites.**

Run: `pnpm --filter @guideanything/api test -- src/modules/agents/editorial-question-recorder.test.ts src/modules/agents/output-committer.test.ts`

Expected: PASS; output commit remains idempotent and a retried run does not double-count a question.

- [ ] **Step 5: Commit question-gap recording.**

```bash
git add apps/api/src/modules/agents/editorial-question-recorder.ts apps/api/src/modules/agents/editorial-question-recorder.test.ts apps/api/src/modules/agents/output-committer.ts apps/api/src/modules/agents/output-committer.test.ts
git commit -m "feat: record workspace question gaps for editors"
```

## Task 6: Add a versioned internal workspace-query bundle

**Files:**
- Create: `apps/api/src/modules/agents/bundles/workspace-query.ts`
- Create: `apps/api/src/modules/agents/bundles/workspace-query.test.ts`
- Modify: `apps/api/src/modules/agents/orchestrator.ts`
- Modify: `apps/api/src/modules/agents/orchestrator.test.ts`
- Test: `apps/api/src/modules/agents/bundles/workspace-query.test.ts`

**Interfaces:**
- Consumes: `AgentRunExecutionContext`, source options, route budget and `FlowKnowledgeSnapshotV1` evidence.
- Produces: `WorkspaceQueryBundleV1` and `loadWorkspaceQueryInstructions(context, decision, task): readonly string[]`.

- [ ] **Step 1: Write failing tests that prove Santexwell rules cannot be injected for a workspace-only route.**

```ts
it('loads the workspace bundle for a workspace flow task and never names Santexwell as an internal source', () => {
  const bundle = loadWorkspaceQueryInstructions(workspaceContext, focusedFlowDecision, flowTask);
  expect(bundle.join('\n')).toContain('选中上下文优先');
  expect(bundle.join('\n')).not.toContain('Santexwell');
});

it('records a stable bundle revision derived from its declarative content', () => {
  expect(WORKSPACE_QUERY_BUNDLE.revision).toMatch(/^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Run the bundle test to verify it fails.**

Run: `pnpm --filter @guideanything/api test -- src/modules/agents/bundles/workspace-query.test.ts`

Expected: FAIL with an import error for `./bundles/workspace-query`.

- [ ] **Step 3: Implement the code-adjacent bundle and inject it only into workspace workers.**

```ts
export const WORKSPACE_QUERY_BUNDLE = defineBundle({
  name: 'guideanything-workspace-query',
  version: 1,
  modules: {
    retrieval: ['选中上下文优先。', '流程命中后最多按服务端预算扩展一跳或两跳。', '不得扫描整张流程图。'],
    evidence: ['流程图和已发布工作区资料是内部事实源。', '只能引用服务端提供的 evidence ID。'],
    output: ['流程反馈必须绑定已检索的节点 locator。', '编辑模式只能提出草稿，不能修改流程。'],
  },
});
```

Extend the worker prompt with the bundle only when a task uses `WORKSPACE_FLOW`, `WORKSPACE_DOCUMENT`, or `SESSION_ATTACHMENT`. Keep `trustedSantexwellHarness` exclusive to actual Santexwell workers. Persist the selected bundle revision in the run's structured plan/audit payload without exposing internal prompt contents to ordinary users.

- [ ] **Step 4: Run focused orchestrator and bundle tests.**

Run: `pnpm --filter @guideanything/api test -- src/modules/agents/bundles/workspace-query.test.ts src/modules/agents/orchestrator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the workspace query bundle.**

```bash
git add apps/api/src/modules/agents/bundles/workspace-query.ts apps/api/src/modules/agents/bundles/workspace-query.test.ts apps/api/src/modules/agents/orchestrator.ts apps/api/src/modules/agents/orchestrator.test.ts
git commit -m "feat: add workspace query bundle"
```

## Task 7: Build the editor-only workbench and guarded navigation

**Files:**
- Create: `apps/web/src/features/editorial/types.ts`
- Create: `apps/web/src/features/editorial/WorkspaceEditorialPage.tsx`
- Create: `apps/web/src/features/editorial/WorkspaceEditorialPage.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceOverviewPage.tsx`
- Modify: `apps/web/src/features/workspace/WorkspacePages.test.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/editorial/WorkspaceEditorialPage.test.tsx`

**Interfaces:**
- Consumes: editorial API response contracts and `WorkspaceOutletContext` permission information.
- Produces: `/workspaces/:workspaceId/knowledge-evolution` page available only to `OWNER`/`EDIT` users.

- [ ] **Step 1: Write failing UI tests for editor visibility, viewer denial and proposal lifecycle controls.**

```tsx
it('renders the knowledge-evolution entry for an EDIT member and hides it for a VIEW member', async () => {
  renderOverview({ permission: 'EDIT' });
  expect(await screen.findByRole('link', { name: '知识演进' })).toBeVisible();
  renderOverview({ permission: 'VIEW' });
  expect(screen.queryByRole('link', { name: '知识演进' })).not.toBeInTheDocument();
});

it('shows a revision-conflict state instead of marking a stale proposal applied', async () => {
  renderEditorial({ applyProposal: vi.fn().mockRejectedValue(new ApiError(409, 'PROPOSAL_STALE', '流程草稿已经更新')) });
  await userEvent.click(await screen.findByRole('button', { name: '应用到草稿' }));
  expect(await screen.findByText('流程草稿已经更新')).toBeVisible();
});
```

- [ ] **Step 2: Run the page test to verify it fails because the workbench does not exist.**

Run: `pnpm --filter @guideanything/web test -- src/features/editorial/WorkspaceEditorialPage.test.tsx`

Expected: FAIL with an import error for `WorkspaceEditorialPage`.

- [ ] **Step 3: Implement a compact editorial workbench using existing page and status patterns.**

```tsx
if (permission === 'VIEW') return <Navigate to={`/workspaces/${workspaceId}`} replace />;

return <section className="editorial-workbench" aria-label="知识演进">
  <QuestionClusterQueue clusters={clusters} onCreateCard={createCard} />
  <KnowledgeCardList cards={cards} onTransition={transitionCard} />
  <ProposalReview proposals={proposals} onApply={applyProposal} />
</section>;
```

Use API calls `listEditorialClusters`, `listEditorialCards`, `listEditorialProposals`, `transitionEditorialCard`, and `applyEditorialProposal`. Do not render raw question controls for an `EDIT` member; only show Owner raw examples via a separately requested API call. Proposal review must show operation summaries and affected IDs; it must not claim a structural diff before the API returns a validated proposal.

- [ ] **Step 4: Run focused Web tests and typecheck.**

Run: `pnpm --filter @guideanything/web test -- src/features/editorial/WorkspaceEditorialPage.test.tsx src/features/workspace/WorkspacePages.test.tsx && pnpm --filter @guideanything/web build`

Expected: PASS.

- [ ] **Step 5: Commit the editor workbench.**

```bash
git add apps/web/src/features/editorial apps/web/src/lib/api.ts apps/web/src/App.tsx apps/web/src/features/workspace/WorkspaceOverviewPage.tsx apps/web/src/features/workspace/WorkspacePages.test.tsx apps/web/src/styles.css
git commit -m "feat: add workspace knowledge evolution workbench"
```

## Task 8: Verify integration, document boundaries and run complete gates

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PRD.md`
- Test: API, contracts, canvas-core and Web suites listed below.

**Interfaces:**
- Consumes: all prior deliverables.
- Produces: documented operational boundary and verified end-to-end behavior.

- [ ] **Step 1: Write a cross-layer integration test that follows the approved editorial path.**

```ts
it('keeps a question gap hidden until an editor applies and publishes a proposal', async () => {
  const gap = await createPartialWorkspaceAnswer(context);
  expect(await normalAgentQuery('workspace-1', '如何处理异常？')).not.toContain('编辑知识卡');
  const proposal = await createProposalFromCard(editorToken, gap.cardId);
  await applyProposal(editorToken, proposal.id);
  await publishGuide(editorToken, proposal.guideId);
  expect(await normalAgentQuery('workspace-1', '如何处理异常？')).toContain('已发布流程中的异常复核');
});
```

- [ ] **Step 2: Run it to verify integration initially exposes any missing wiring.**

Run: `pnpm --filter @guideanything/api test -- src/modules/editorial/editorial.test.ts src/modules/agents/agent-runtime-integration.test.ts`

Expected: PASS after Tasks 1-7; otherwise fix the smallest missing integration before proceeding.

- [ ] **Step 3: Update product and architecture documentation.**

Add the following exact boundary to both documents in their relevant sections:

```text
工作区知识演进对象仅供 Owner/Editor 审阅，绝不作为普通问答的隐式来源。
只有编辑者将受证据约束的提案应用到流程草稿并发布后，新流程快照才进入普通工作区 Agent 的证据域。
Santexwell 是显式启用的行业补充来源，不拥有或更新工作区内部流程知识。
```

- [ ] **Step 4: Run complete validation.**

Run: `pnpm typecheck && pnpm test && pnpm build && git diff --check`

Expected: all workspace packages pass. If Web build emits only the existing Vite chunk-size warning, record it as a warning rather than a failure.

- [ ] **Step 5: Inspect the final diff and commit documentation.**

```bash
git diff --check
git status --short
git add docs/ARCHITECTURE.md docs/PRD.md
git commit -m "docs: describe workspace knowledge evolution"
```

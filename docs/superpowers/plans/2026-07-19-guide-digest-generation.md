# Guide Digest Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editor-reviewed, snapshot-first workflow that generates a structured Chinese guide summary, evidence-linked tag suggestions, and deterministic Markdown from the current guide draft through the real Codex Runtime Bridge.

**Architecture:** First compile every current Canvas draft into a normalized `FlowKnowledgeSnapshotV2` whose nodes, resources, relations, learning path, and diagnostics are agent-readable. A dedicated app-owned focused-worker bundle receives only that current snapshot and returns strict `GuideDigestDraftV1` JSON. The API validates source references, renders Markdown deterministically, stores an auditable proposal, and applies only the editor-selected summary and tags under optimistic revision checks. Accepted Markdown remains proposal evidence and never becomes Canvas truth or retrieval input.

**Tech Stack:** TypeScript, Zod 4, Fastify 5, SQLite STRICT tables, React 19, Vitest, Testing Library, `@guideanything/contracts`, `@guideanything/canvas-core`, Codex Runtime Bridge.

## Global Constraints

- Implement in an isolated `codex/guide-digest-generation` worktree because the current `main` checkout has unrelated user edits in editor, media, contracts, and styles files. Do not move, reset, stage, or overwrite those edits.
- Treat [the approved design specification](../specs/2026-07-19-guide-digest-generation-design.md) as the product contract. If implementation pressure exposes a product-level contradiction, stop and update the spec for review before changing behavior.
- Keep `FlowKnowledgeSnapshotV1Schema` immutable. Add a V2 schema and a V1-to-V2 read adapter; do not rewrite existing snapshot rows.
- New draft and publish syncs write V2 snapshots. Old V1 rows remain readable and searchable.
- Never send image bytes, media URLs, local paths, private workspace mounts, credentials, or generated Markdown to the digest worker. Send only the normalized V2 JSON projection.
- Run the worker only from the explicit editor action. Do not attach generation to autosave, publish, startup reconciliation, or retrieval.
- The model may propose; only the API can validate, render, persist, and apply. Applying is a single transaction guarded by both `guide.revision` and `proposal.base_revision`.
- Preserve existing tags by default. The editor may accept individual new labels; generation never silently deletes or replaces current tags.
- All error responses use stable codes and Chinese user-facing messages. Logs and persisted errors must not contain raw model output or secrets.
- Every task ends with targeted tests and a scoped commit. Before the final handoff, run the repository-wide checks and inspect the complete diff.

---

### Task 1: Introduce the normalized V2 snapshot contract and compatibility adapter

**Files:**

- Modify: `packages/contracts/src/flow-knowledge.ts`
- Modify: `packages/contracts/src/flow-knowledge.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/canvas-core/src/flow-knowledge-compat.ts`
- Create: `packages/canvas-core/src/flow-knowledge-compat.test.ts`
- Modify: `packages/canvas-core/src/index.ts`

- [ ] **Step 1: Write failing contract tests for V2 strictness**

Add fixtures asserting that `FlowKnowledgeSnapshotV2Schema`:

- accepts semantic stage/lane data without Canvas `position`;
- keeps business nodes and resources in separate top-level arrays;
- accepts `FLOW`, `USES_RESOURCE`, and `RESOURCE_REFERENCE` relations;
- accepts an ordered learning path targeting either a node or resource;
- rejects duplicate IDs, dangling relation targets, invalid learning targets, unknown keys, and unsupported `schemaVersion` values.

Add `FlowKnowledgeSnapshotSchema = z.discriminatedUnion('schemaVersion', [...])` tests showing that both stored V1 and new V2 payloads parse.

Run:

```bash
pnpm --filter @guideanything/contracts test -- flow-knowledge.test.ts
```

Expected: FAIL because the V2 and union schemas do not exist.

- [ ] **Step 2: Define the exact V2 contract**

Keep the existing V1 declarations byte-for-byte compatible and add these public shapes:

```ts
export const FlowKnowledgeRelationKindV2Schema = z.enum([
  'FLOW',
  'USES_RESOURCE',
  'RESOURCE_REFERENCE',
]);

export const FlowKnowledgeSnapshotV2Schema = z.object({
  schemaVersion: z.literal(2),
  snapshotId: IdV1Schema,
  workspaceId: IdV1Schema,
  workspaceItemId: IdV1Schema,
  guideId: IdV1Schema,
  title: z.string().min(1),
  summary: z.string(),
  tags: z.array(z.string()),
  origin: FlowSnapshotOriginV1Schema,
  stages: z.array(FlowKnowledgeStageV1Schema),
  lanes: z.array(FlowKnowledgeLaneV1Schema),
  nodes: z.array(FlowKnowledgeNodeV2Schema),
  resources: z.array(FlowKnowledgeResourceV2Schema),
  relations: z.array(FlowKnowledgeRelationV2Schema),
  learningPath: z.array(FlowKnowledgeLearningStepV2Schema),
  diagnostics: FlowKnowledgeDiagnosticsV2Schema,
}).strict().superRefine(validateSnapshotGraph);
```

Use discriminated relation schemas so each kind exposes only valid endpoint fields. Resource payloads retain media kind, title, description, semantic locator/annotation timestamps, and ordering, but never raw URLs or file paths. Diagnostics must distinguish dangling flow edges, invalid resource directions, unreferenced resources, invalid learning targets, and excluded derived nodes.

- [ ] **Step 3: Write failing V1 compatibility tests**

Create tests for `normalizeFlowKnowledgeSnapshot(snapshot)`:

- V2 input is returned as a validated semantic copy;
- V1 embedded attachments become unique V2 resources plus `USES_RESOURCE` relations;
- V1 incoming/outgoing edges become one deduplicated `FLOW` relation per edge ID;
- V1 unattached resources remain resources and appear in `unreferencedResourceIds`;
- the adapter never mutates its input.

Run:

```bash
pnpm --filter @guideanything/canvas-core test -- flow-knowledge-compat.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 4: Implement and export the pure compatibility adapter**

Parse through `FlowKnowledgeSnapshotSchema`, convert V1 into V2 deterministically, sort synthesized relations by stable endpoint/ID order, and validate the result with `FlowKnowledgeSnapshotV2Schema`. Do not read the database or generate random IDs in the adapter.

- [ ] **Step 5: Run contract and adapter validation**

```bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/canvas-core test
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/canvas-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the compatibility foundation**

```bash
git add packages/contracts/src/flow-knowledge.ts packages/contracts/src/flow-knowledge.test.ts packages/contracts/src/index.ts packages/canvas-core/src/flow-knowledge-compat.ts packages/canvas-core/src/flow-knowledge-compat.test.ts packages/canvas-core/src/index.ts
git commit -m "feat: add normalized flow snapshot v2 contract"
```

---

### Task 2: Compile current Canvas documents into V2 without losing resources or learning order

**Files:**

- Modify: `packages/canvas-core/src/flow-knowledge.ts`
- Modify: `packages/canvas-core/src/flow-knowledge.test.ts`
- Modify: `packages/canvas-core/src/index.ts`

- [ ] **Step 1: Add failing regression fixtures matching the current proposal workflow**

Build a compact Canvas fixture with:

- a stage containing Canvas-only `position`;
- two business nodes linked by a labeled edge;
- one image and one video linked from a business node by real Canvas edges;
- legacy `contentParentId` on one resource;
- image annotations and video timestamp annotations;
- a resource referenced by two business nodes;
- `document.steps` targeting both a business node and a resource;
- one derived helper node that must be excluded.

Assert `compileFlowKnowledgeSnapshotV2` succeeds, strips stage/lane layout fields, emits each resource once, emits the correct relation types, preserves annotation/timestamp locators, and preserves learning-step order.

Run:

```bash
pnpm --filter @guideanything/canvas-core test -- flow-knowledge.test.ts
```

Expected: FAIL because only the V1 compiler exists and V1 currently rejects `position`.

- [ ] **Step 2: Implement a semantic projection before validation**

Introduce explicit projection helpers rather than spreading Canvas objects into strict schemas:

```ts
function projectStage(stage: CanvasStage): FlowKnowledgeStageV1 {
  return {
    id: stage.id,
    title: stage.title,
    order: stage.order,
    ...(stage.description ? { description: stage.description } : {}),
  };
}
```

Apply the same rule to lanes and nodes. Canvas position, size, handle, UI state, route points, URLs, and upload metadata must not enter the semantic snapshot.

- [ ] **Step 3: Normalize graph and resource relationships**

Classify endpoints before relation emission:

- business-to-business edge -> `FLOW`;
- business-to-resource edge -> `USES_RESOURCE`;
- resource annotations/timestamps with semantic targets -> `RESOURCE_REFERENCE`;
- legacy `contentParentId` -> synthesized `USES_RESOURCE` only when an equivalent real edge is absent;
- all other directions -> diagnostic, not a fabricated flow relation.

Deduplicate shared resources by resource ID and preserve multiple `USES_RESOURCE` edges.

- [ ] **Step 4: Compile learning path and diagnostics**

Project `document.steps` into ordered semantic targets. Put missing targets in diagnostics and omit them from `learningPath`; do not silently retarget. Keep stable ordering by explicit order, then source document order, then ID.

- [ ] **Step 5: Prove V1 remains stable and V2 fixes the real failure**

```bash
pnpm --filter @guideanything/canvas-core test -- flow-knowledge.test.ts flow-knowledge-compat.test.ts
pnpm --filter @guideanything/canvas-core typecheck
```

Expected: PASS, including the regression where V1 previously threw on `stages[0].position`.

- [ ] **Step 6: Commit the V2 compiler**

```bash
git add packages/canvas-core/src/flow-knowledge.ts packages/canvas-core/src/flow-knowledge.test.ts packages/canvas-core/src/index.ts
git commit -m "feat: compile canvas documents into flow snapshot v2"
```

---

### Task 3: Migrate flow indexing and readers to the versioned snapshot union

**Files:**

- Modify: `apps/api/src/modules/knowledge/flow-indexer.ts`
- Modify: `apps/api/src/modules/knowledge/knowledge.test.ts`
- Modify: `apps/api/src/modules/agents/knowledge-adapters.ts`
- Modify: `apps/api/src/modules/agents/knowledge-adapters.test.ts`
- Modify: `apps/api/src/modules/agents/execution-context.ts`
- Modify: `apps/api/src/modules/conversations/service.ts`
- Modify: `apps/api/src/modules/conversations/service.test.ts`
- Modify: `apps/api/src/modules/artifacts/service.ts`
- Modify: `apps/api/src/modules/artifacts/routes.test.ts`
- Modify: `apps/api/src/modules/agents/agent-runtime-integration.test.ts`

- [ ] **Step 1: Add failing indexing tests for V2 and stale failure metadata**

Extend `knowledge.test.ts` to prove:

- a current draft sync stores `schemaVersion: 2`;
- fragments contain title, description, stage/lane labels, edge labels, resource titles, current summary, and current tags;
- one current draft origin remains idempotent by checksum;
- `recordFlowIndexFailure` updates both `status` and `revision` on conflict;
- a later successful sync returns the source to `READY`;
- an old V1 fixture remains listable/readable through the adapter.

Run:

```bash
pnpm --filter @guideanything/api test -- knowledge.test.ts knowledge-adapters.test.ts
```

Expected: FAIL on V2 storage, missing summary search text, and stale failure revision.

- [ ] **Step 2: Switch new writes to `compileFlowKnowledgeSnapshotV2`**

Change `GuideFlowContext.document` to the V2 compiler input type. Parse existing rows through `FlowKnowledgeSnapshotSchema`, normalize them for materialization, and make `flowFragments` accept normalized V2 only.

Include guide summary and tags in the document-level searchable projection without duplicating them into every model prompt. Preserve existing knowledge visibility and source IDs.

- [ ] **Step 3: Fix failure-state upsert**

Update the conflict clause to set:

```sql
status = 'FAILED',
revision = excluded.revision,
config_json = excluded.config_json,
updated_at = excluded.updated_at
```

This makes readiness evidence describe the current guide revision rather than the last successful draft.

- [ ] **Step 4: Update all snapshot readers to parse the union**

Replace direct `FlowKnowledgeSnapshotV1Schema.parse` calls in knowledge adapters, execution context, conversation selection, and artifact rendering with:

```ts
normalizeFlowKnowledgeSnapshot(
  FlowKnowledgeSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
)
```

Do not leak V2-only assumptions into APIs that still return V1-named public summary envelopes. Add focused tests for selected-node lookup and attachment/resource lookup through both versions.

- [ ] **Step 5: Run API regression checks**

```bash
pnpm --filter @guideanything/api test -- \
  src/modules/knowledge/knowledge.test.ts \
  src/modules/agents/knowledge-adapters.test.ts \
  src/modules/conversations/service.test.ts \
  src/modules/artifacts/routes.test.ts \
  src/modules/agents/agent-runtime-integration.test.ts
pnpm --filter @guideanything/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit index migration**

Stage only the files actually changed in this task, then:

```bash
git commit -m "feat: index versioned flow snapshots"
```

---

### Task 4: Define digest output, source validation, deterministic Markdown, and the app-owned bundle

**Files:**

- Create: `packages/contracts/src/guide-digest.ts`
- Create: `packages/contracts/src/guide-digest.test.ts`
- Create: `apps/api/src/modules/guides/digest-renderer.ts`
- Create: `apps/api/src/modules/guides/digest-renderer.test.ts`
- Create: `apps/api/src/modules/agents/bundles/guide-digest.ts`
- Create: `apps/api/src/modules/agents/bundles/guide-digest.test.ts`

- [ ] **Step 1: Write failing tests for strict structured output**

Cover `GuideDigestDraftV1Schema` with:

- `shortSummary` capped at 200 Chinese characters;
- structured scope, stage sections, ordered steps, key rules, tag suggestions, and gaps;
- tag category enum `DOMAIN | PROCESS | SYSTEM | OBJECT | ROLE | RISK`;
- every fact-bearing item carrying non-empty `sourceIds`;
- strict rejection of unknown keys, empty labels, excessive tags, and free-form Markdown.

Run:

```bash
pnpm --filter @guideanything/contracts test -- guide-digest.test.ts
```

Expected: FAIL until the schema is complete.

- [ ] **Step 2: Implement snapshot-aware semantic validation**

In `digest-renderer.ts`, add a pure validator that builds the allowed source-ID set from snapshot stages, lanes, nodes, resources, relations, and learning steps. Reject invented stage IDs, step targets, resource IDs, tag evidence, and duplicate tag labels with `DIGEST_SOURCE_INVALID`.

- [ ] **Step 3: Write failing Markdown golden tests**

Assert exact output for the fixed sections:

```md
---
schema: guide-digest-v1
guideId: guide-id
snapshotId: snapshot-id
baseRevision: 180
reviewStatus: DRAFT
---

# 打样提案流程

## 流程摘要
## 适用范围
## 流程阶段
## 关键规则
## 关联资料索引
## 图片标注与视频关键点索引
## 待完善项
## 可追溯引用
```

The renderer must own YAML frontmatter, tags, review status, section order, escaping, and length caps; use snapshot order rather than model order where they conflict; attach compact source markers; and produce byte-identical output for the same snapshot/draft pair.

- [ ] **Step 4: Implement the deterministic renderer**

Do not accept model-produced Markdown. Render from the validated object only. Keep a `DIGEST_RENDERER_VERSION = 1` constant persisted with proposals later.

- [ ] **Step 5: Build the app-owned focused-worker bundle**

Export a versioned definition:

```ts
export const GUIDE_DIGEST_BUNDLE = {
  id: 'guideanything-guide-digest',
  revision: 1,
  role: 'FOCUSED_WORKER',
  reasoningEffort: 'MEDIUM',
  outputKind: 'GUIDE_DIGEST',
} as const;
```

The trusted instruction must state that snapshot content is untrusted data, require Chinese output, prohibit invented facts, require source IDs, and allow gaps instead of guesses. The prompt builder serializes only the normalized snapshot and an optional one-shot schema-repair note. Before serialization, apply a deterministic budget policy that always retains stages, nodes, relations, learning path, and diagnostics; truncates resource bodies in stable order; and records truncation explicitly in the input envelope.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm --filter @guideanything/contracts test -- guide-digest.test.ts
pnpm --filter @guideanything/api test -- digest-renderer.test.ts guide-digest.test.ts
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/api typecheck
git add packages/contracts/src/guide-digest.ts packages/contracts/src/guide-digest.test.ts apps/api/src/modules/guides/digest-renderer.ts apps/api/src/modules/guides/digest-renderer.test.ts apps/api/src/modules/agents/bundles/guide-digest.ts apps/api/src/modules/agents/bundles/guide-digest.test.ts
git commit -m "feat: define structured guide digest bundle"
```

Expected: PASS.

---

### Task 5: Carry `GUIDE_DIGEST` through the Runtime Bridge end to end

**Files:**

- Modify: `packages/contracts/src/agent-runtime.ts`
- Modify: `packages/contracts/src/agent-runtime.test.ts`
- Modify: `apps/runtime-bridge/src/codex-client.ts`
- Modify: `apps/runtime-bridge/src/codex-client.test.ts`
- Modify: `apps/api/src/modules/agents/runtime-client.ts`
- Modify: `apps/api/src/modules/agents/runtime-client.test.ts`
- Modify: `apps/api/src/modules/agents/typed-runtime.ts`
- Modify: `apps/api/src/modules/agents/typed-runtime.test.ts`
- Modify: `apps/api/src/modules/agents/fake-runtime-client.ts`
- Modify: `apps/api/src/modules/agents/fake-runtime-client.test.ts`

- [ ] **Step 1: Add failing protocol tests**

Extend the output kind enum with `GUIDE_DIGEST` and add a typed terminal event:

```ts
{
  type: 'GUIDE_DIGEST';
  payload: { digest: GuideDigestDraftV1 };
}
```

Test that only `FOCUSED_WORKER` may request it, `ROUTER` and `DEEP_WORKER` are rejected, and bridge events fail closed on extra keys.

Run:

```bash
pnpm --filter @guideanything/contracts test -- agent-runtime.test.ts
```

Expected: FAIL because the protocol does not know the new kind.

- [ ] **Step 2: Add the strict JSON schema to the Bridge**

Generate the Codex CLI output schema from `GuideDigestDraftV1Schema` using the same Zod-to-JSON-schema path as route/task/answer output. Add it to `OUTPUT_SCHEMA_BY_KIND`, parse it with Zod after CLI completion, and emit `GUIDE_DIGEST`. Invalid output must end with stable code `INVALID_GUIDE_DIGEST_OUTPUT`; never downgrade it to `ANSWER`.

- [ ] **Step 3: Update HTTP and typed runtime clients**

Map `GUIDE_DIGEST` requests to the matching terminal event in `assertExpectedOutput`. Add:

```ts
export async function invokeGuideDigestRuntime(
  runtime: AgentRuntimeClient,
  request: BridgeRunRequestV1,
): Promise<GuideDigestDraftV1>
```

The helper must reject missing, duplicate, or mismatched terminal events and surface bridge failure codes for the service-level one-shot repair policy.

- [ ] **Step 4: Add a deterministic fake result**

Return a valid minimal digest based only on source IDs present in the supplied fixture prompt. Fake mode exists for local UI/tests; label it as fake in diagnostics and do not use its prose as quality evidence.

- [ ] **Step 5: Run protocol, bridge, and client tests**

```bash
pnpm --filter @guideanything/contracts test -- agent-runtime.test.ts guide-digest.test.ts
pnpm --filter @guideanything/runtime-bridge test -- codex-client.test.ts
pnpm --filter @guideanything/api test -- runtime-client.test.ts typed-runtime.test.ts fake-runtime-client.test.ts
pnpm --filter @guideanything/runtime-bridge typecheck
pnpm --filter @guideanything/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the protocol extension**

```bash
git add packages/contracts/src/agent-runtime.ts packages/contracts/src/agent-runtime.test.ts apps/runtime-bridge/src/codex-client.ts apps/runtime-bridge/src/codex-client.test.ts apps/api/src/modules/agents/runtime-client.ts apps/api/src/modules/agents/runtime-client.test.ts apps/api/src/modules/agents/typed-runtime.ts apps/api/src/modules/agents/typed-runtime.test.ts apps/api/src/modules/agents/fake-runtime-client.ts apps/api/src/modules/agents/fake-runtime-client.test.ts
git commit -m "feat: add guide digest runtime output"
```

---

### Task 6: Persist immutable proposals and audit every state transition

**Files:**

- Create: `apps/api/src/db/migrations/0009_guide_digest_proposals.sql`
- Modify: `apps/api/src/db/migrate.test.ts`
- Create: `apps/api/src/modules/guides/digest-repository.ts`
- Create: `apps/api/src/modules/guides/digest-repository.test.ts`

- [ ] **Step 1: Write the failing migration assertions**

Expect migration version 9 plus these STRICT tables and indexes:

- `guide_digest_proposals` keyed by UUID, scoped to guide/workspace/snapshot/base revision;
- immutable `draft_json`, `markdown`, bundle revision, renderer version, and generation metadata;
- state `DRAFT | REJECTED | APPLIED | STALE | FAILED`;
- nullable applied revision, selected fields, safe failure code, creator, timestamps;
- nullable `supersedes_proposal_id` so an explicit regeneration links to the prior proposal;
- `guide_digest_audit_events` for `GENERATED | VALIDATION_FAILED | REJECTED | MARKED_STALE | APPLIED`.

Add JSON validity checks, state-dependent column checks, workspace/guide scope trigger, list/index coverage by `(guide_id, created_at DESC)` and `(guide_id, base_revision, status)`, plus a partial unique index permitting only one `DRAFT` row for `(guide_id, base_snapshot_id, bundle_revision)`. Explicit regeneration must first mark the prior DRAFT `STALE`, then create the linked successor in the same transaction.

Run:

```bash
pnpm --filter @guideanything/api test -- migrate.test.ts
```

Expected: FAIL because migration 9 is absent.

- [ ] **Step 2: Add migration 0009**

Do not mutate earlier migrations. Store accepted tags as JSON and the final accepted Markdown flag separately. The original generated draft and Markdown must never be overwritten during apply/reject.

- [ ] **Step 3: Add repository tests before implementation**

Cover create/get/list, duplicate generation lookup, rejected transition, stale transition, applied transition, immutable content, and audit rows. Reject invalid state transitions and cross-guide lookups.

- [ ] **Step 4: Implement repository primitives**

Use explicit SQLite transactions at the service layer; repository functions should accept an existing `DatabaseSync`, return parsed domain objects, and validate persisted JSON with the contract schemas.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @guideanything/api test -- migrate.test.ts digest-repository.test.ts
pnpm --filter @guideanything/api typecheck
git add apps/api/src/db/migrations/0009_guide_digest_proposals.sql apps/api/src/db/migrate.test.ts apps/api/src/modules/guides/digest-repository.ts apps/api/src/modules/guides/digest-repository.test.ts
git commit -m "feat: persist guide digest proposals"
```

Expected: PASS.

---

### Task 7: Add readiness, generation, review, and optimistic apply APIs

**Files:**

- Create: `apps/api/src/modules/guides/digest-service.ts`
- Create: `apps/api/src/modules/guides/digest-service.test.ts`
- Modify: `apps/api/src/modules/guides/routes.ts`
- Modify: `apps/api/src/modules/guides/guides.test.ts`
- Modify: `apps/api/src/modules/guides/permissions.test.ts`
- Modify: `apps/api/src/modules/agents/assembly.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write failing service tests for every gate**

Use an injected scripted `AgentRuntimeClient`; do not start HTTP or Codex in unit tests. Cover:

- owner and guide collaborator may generate/read/reject/apply;
- workspace-only editor without guide access gets 403, hidden guide gets 404;
- current V2 snapshot `READY` is required;
- missing, failed, or revision-mismatched snapshots return `FLOW_SNAPSHOT_NOT_READY` without invoking the worker;
- the same `baseSnapshotId + bundleRevision` with an existing DRAFT proposal is idempotent unless the request explicitly sets `regenerate: true`;
- invalid structured output gets exactly one repair request, then `FAILED`;
- source validation failure never persists a DRAFT proposal;
- apply can select summary, individual proposed tags, and Markdown independently;
- apply preserves all existing tags and enforces 20 tags / 50 chars;
- guide or proposal revision drift marks the proposal `STALE` and returns 409;
- a summary/tag-changing apply increments the guide revision exactly once and creates one audit event;
- a Markdown-only acceptance records `markdown_accepted` without incrementing the guide revision or creating a redundant draft-history row.

- [ ] **Step 2: Implement snapshot readiness and explicit reconcile**

Expose:

```text
GET  /api/guides/:id/flow-snapshot-status
POST /api/guides/:id/flow-snapshot/reconcile
```

Status returns only safe metadata: guide revision, source status, current snapshot ID/revision/schema version, and safe failure code. Reconcile calls the existing deterministic compiler/indexer; it never invokes the model.

- [ ] **Step 3: Implement proposal endpoints**

Expose:

```text
POST /api/guides/:id/digest-proposals
GET  /api/guides/:id/digest-proposals
GET  /api/guides/:id/digest-proposals/:proposalId
PATCH /api/guides/:id/digest-proposals/:proposalId/status
POST /api/guides/:id/digest-proposals/:proposalId/apply
```

Parse create input as `{ regenerate?: boolean }`, status input as `{ status: 'REJECTED' }`, and apply input strictly:

```ts
{
  applySummary: boolean;
  acceptedTagLabels: string[];
  acceptMarkdown: boolean;
}
```

Require at least one selected output. Only labels in the proposal are eligible.

- [ ] **Step 4: Implement one-shot runtime invocation and repair**

Generate a request ID and run ID per attempt, use `GUIDE_DIGEST_BUNDLE`, and call `invokeGuideDigestRuntime`. Retry once only for schema/output validation codes, with a compact repair instruction and the same snapshot. Do not retry auth, transport, timeout, cancellation, or readiness failures.

- [ ] **Step 5: Apply in one transaction**

Within `BEGIN IMMEDIATE`:

1. reload guide and proposal;
2. confirm `guide.revision === proposal.base_revision` and the proposal is still `DRAFT`;
3. compute summary and stable-deduplicated tags and determine whether guide fields materially change;
4. when guide fields change, call `updateGuideInTransaction` exactly once (never call the transaction-owning `updateGuide` here); when only Markdown is accepted, do not touch the guide row;
5. mark proposal `APPLIED` with selected fields and the resulting/current revision;
6. insert audit event;
7. commit, then run best-effort flow sync only when guide fields changed.

If any check fails, roll back. Return `NO_EFFECTIVE_CHANGE` when the selection changes neither guide fields nor Markdown acceptance. Never store generated Markdown in `guides.draft_document` or `knowledge_fragments`.

- [ ] **Step 6: Share the production runtime client explicitly**

Change the assembly return type to include the underlying `client: AgentRuntimeClient`. Add an optional `guideDigestRuntime` to `BuildAppOptions`; `server.ts` passes `agentRuntime.client`, while guide route tests inject a scripted client. If the runtime is absent, only generation returns 503; ordinary guide APIs remain available.

- [ ] **Step 7: Run route, permission, and service tests**

```bash
pnpm --filter @guideanything/api test -- digest-service.test.ts guides.test.ts permissions.test.ts agent-runtime-integration.test.ts
pnpm --filter @guideanything/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the API slice**

Stage only the listed API files, then:

```bash
git commit -m "feat: add reviewed guide digest proposal api"
```

---

### Task 8: Add the editor review dialog without coupling it to autosave

**Files:**

- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/features/editor/GuideDigestDialog.tsx`
- Create: `apps/web/src/features/editor/GuideDigestDialog.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Add typed API methods and failing dialog tests**

Add methods for readiness, reconcile, generate, list/read, reject, and apply. Test these states:

- no current snapshot: button disabled with current revision/status and a `重新同步快照` action;
- ready: explicit `生成结构化摘要` action;
- generating: one in-flight request, disabled controls, no autosave trigger;
- review: read-only proposed summary, per-tag checkboxes with category/source explanation, read-only Markdown preview, gaps panel;
- stale: apply disabled and clear regeneration instruction;
- failed: safe error code/message, retry only on explicit click;
- apply: independent checkboxes for summary and Markdown plus selected tag labels;
- reject: closes active review and preserves current guide fields.

Run:

```bash
pnpm --filter @guideanything/web test -- GuideDigestDialog.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the isolated dialog**

Use existing buttons, inputs, modal/dialog patterns, and tokens. Render Markdown with the existing `react-markdown + remark-gfm + rehype-sanitize` stack. Never render raw HTML from the proposal.

Show provenance in human terms: source title plus type, with raw IDs only in a collapsible diagnostic detail. Distinguish current guide tags from suggested additions.

- [ ] **Step 3: Integrate with `GuideEditor`**

Place one action near the guide summary/tags fields. Pass the latest saved guide revision into the dialog. Before generation, flush any pending editor save and use the returned revision; never generate from unsaved local state.

On apply success, update editor summary/tags/revision from the API response and reset dirty tracking. Do not mutate Canvas nodes or learning steps.

- [ ] **Step 4: Reconcile existing dirty-file changes during execution**

Because these three paths are already edited in the user's main checkout, compare the isolated worktree version with `main` immediately before integration. Resolve semantically and preserve both the existing edge/editor work and this dialog; do not copy whole files over the user's versions.

- [ ] **Step 5: Run component and web validation**

```bash
pnpm --filter @guideanything/web test -- GuideDigestDialog.test.tsx GuideEditor.test.tsx
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
```

Expected: PASS.

- [ ] **Step 6: Commit the editor workflow**

```bash
git add apps/web/src/lib/api.ts apps/web/src/features/editor/GuideDigestDialog.tsx apps/web/src/features/editor/GuideDigestDialog.test.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
git commit -m "feat: add guide digest review workflow"
```

---

### Task 9: Verify the real proposal workflow, Bridge boundary, and repository regression

**Files:**

- Modify only if evidence reveals a defect in the preceding tasks.
- Create: `docs/verification/2026-07-19-guide-digest-generation.md`

- [ ] **Step 1: Run the complete deterministic suite**

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0. If an unrelated pre-existing failure appears, record the exact command/output boundary and still run every targeted package check.

- [ ] **Step 2: Inspect the final diff and migration safety**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
```

Confirm no credentials, generated database/media files, personal skills, debug logs, or unrelated user changes are present. Run migration tests against a fresh temporary database and an upgraded pre-v9 fixture.

- [ ] **Step 3: Start and identify the real stack safely**

Before touching listeners, identify each owner:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP -iTCP:3010 -sTCP:LISTEN
```

For every PID returned above, run `ps -ww -p` with that concrete numeric PID and inspect its full command. Use `pnpm dev`, not `pnpm dev:fake`. Verify API health and Bridge `/health` reports `READY` with every required role ready. Do not print the Bridge token.

- [ ] **Step 4: Run the live `打样提案流程` acceptance journey**

In a real browser:

1. open guide `22c6fb40-62dc-43ab-b037-0742330d060f`;
2. confirm the latest draft is saved;
3. reconcile and verify a V2 snapshot at the same revision;
4. generate once through the real Bridge;
5. verify no model request fires during normal autosave;
6. inspect summary, tag categories/source explanations, Markdown sections, image annotation evidence, video timestamps, and information gaps;
7. accept one tag and the summary while leaving Markdown unselected;
8. verify existing `ERP` remains and the guide revision increments once;
9. regenerate, then edit/save the guide in another action and verify the old proposal becomes stale and cannot apply;
10. confirm the generated Markdown is absent from Canvas document and knowledge fragments.

Capture the editor review, applied fields, stale-state screen, Network request, and Bridge health evidence. Do not treat fake-runtime output as quality proof.

- [ ] **Step 5: Record bounded verification evidence**

Document:

- exact commit SHA and checkout;
- exact Web/API/Bridge URLs and listener commands;
- snapshot schema/revision/status;
- Runtime Bridge mode and readiness, without secrets;
- test/build commands and results;
- browser journey results and screenshots;
- separately labeled verified, inferred, and unverified claims;
- remaining cost/latency observations from this single on-demand run.

- [ ] **Step 6: Commit verification evidence**

```bash
git add docs/verification/2026-07-19-guide-digest-generation.md
git commit -m "docs: verify guide digest generation"
```

---

## Completion Gate

The feature is complete only when all of the following are true:

- current drafts compile to V2 without the stage `position` failure;
- the current proposal guide exposes real resource relations and ordered learning steps;
- old V1 snapshots remain readable;
- summary/tags participate in the intended search surfaces;
- the real Bridge validates and returns `GUIDE_DIGEST`, with no personal skill dependency;
- generation is explicit, snapshot-current, source-validated, and at most one repair attempt;
- every proposal transition is auditable;
- apply preserves existing tags and is revision-safe;
- generated Markdown is deterministic, sanitized in UI, immutable in the proposal, and excluded from Canvas/retrieval;
- targeted and repository-wide validation pass or any unrelated baseline failure is precisely documented;
- live browser evidence distinguishes real Bridge behavior from unit/fake-runtime evidence.

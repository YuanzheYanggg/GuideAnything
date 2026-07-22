# 轻量图片标注回归与精确引用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让图片标注成为可精确跳转、自动健康校验、可一键固定回归题且可审计的流程知识叶子。

**Architecture:** `FlowKnowledgeSnapshotV2` 和普通 `knowledge_*` 继续只存流程事实与索引。新增的回归题、自动健康异常和检索诊断都存入独立表；标注叶子通过 `resourceNodeId + annotationId` 作为稳定身份。检索适配器只在内存中收集最小候选/闭包 trace，输出提交器仅在失败、部分回答或显式回归操作时将其落库。

**Tech Stack:** TypeScript、Zod、Fastify、SQLite (`node:sqlite`)、React 19、React Router、Vitest。

## Global Constraints

- 不修改 `CanvasDocument`、`FlowKnowledgeSnapshotV2` 或普通 `knowledge_*` 的事实边界来存放 QA 数据。
- 不引入 embedding、向量数据库、全图扫描、后台模型批量评测或新增第三方依赖。
- `annotationId` 只在服务器验证其属于当前图片资源、snapshot 和读取权限后才进入 public flow locator / deep link。
- 自动检查与确定性复跑不得调用模型；真实 Agent 试跑必须由 `OWNER` / `EDIT` 显式发起。
- 回归题持久化稳定目标，不持久化 fragment ID、模型标准答案、思维链、完整证据正文或未固定的原问题副本。
- 正常成功问答不落 retrieval trace；诊断默认 30 天惰性清理。
- 当前工作树已有无关改动；只编辑本计划列出的文件，未经用户明确授权不提交或推送。

---

### Task 1: 建立契约与数据库隔离边界

**Files:**
- Modify: `packages/contracts/src/agent-runtime.ts:325-377,923-950`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/flow-regression.ts`
- Modify: `packages/contracts/src/agent-runtime.test.ts`
- Create: `packages/contracts/src/flow-regression.test.ts`
- Create: `apps/api/src/db/migrations/0011_flow_annotation_regression.sql`
- Modify: `apps/api/src/db/migrate.ts:4-47`
- Modify: `apps/api/src/db/migrate.test.ts`

**Interfaces:**
- Consumes: `FlowLocatorV1Schema`, existing strict `InternalEvidenceLocatorV1Schema`, `agent_runs`, `guides`, and `flow_knowledge_snapshots`.
- Produces: an optional `annotationId` on `WORKSPACE_FLOW` internal locators; `WorkspaceFlowRegressionCaseV1`; `FlowAnnotationHealthIssueV1`; `AgentRetrievalDiagnosticV1`; and isolated persistence tables.

- [x] **Step 1: Write the failing contract and migration tests**

```ts
it('accepts a WORKSPACE_FLOW locator only when annotationId is an opaque bounded ID', () => {
  expect(InternalEvidenceLocatorV1Schema.parse({
    kind: 'WORKSPACE_FLOW', guideId: 'guide', snapshotId: 'snapshot', nodeId: 'image', annotationId: 'field-version',
  })).toMatchObject({ annotationId: 'field-version' });
  expect(() => InternalEvidenceLocatorV1Schema.parse({
    kind: 'WORKSPACE_FLOW', guideId: 'guide', snapshotId: 'snapshot', nodeId: 'image', annotationId: '',
  })).toThrow();
});

it('migrates isolated regression, health, and diagnostic tables without adding QA rows to knowledge tables', () => {
  migrateDatabase(database);
  const names = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  expect(names).toEqual(expect.arrayContaining([
    'workspace_flow_regression_cases', 'workspace_flow_regression_runs',
    'flow_annotation_health_issues', 'agent_retrieval_diagnostics',
  ]));
});
```

- [x] **Step 2: Run the tests to verify they fail for the missing schema/table definitions**

Run: `pnpm --filter @guideanything/contracts test -- agent-runtime.test.ts flow-regression.test.ts && pnpm --filter @guideanything/api test -- migrate.test.ts`

Expected: FAIL because `annotationId`, the new contracts, migration 11, and its tables do not exist yet.

- [x] **Step 3: Add strict public contracts and migration 11**

```ts
export const WorkspaceFlowRegressionCaseV1Schema = z.object({
  id: IdV1Schema,
  guideId: IdV1Schema,
  resourceNodeId: IdV1Schema,
  annotationId: IdV1Schema,
  question: z.string().min(1).max(2_000),
  expectedAgentStatus: z.enum(['SUPPORTED', 'PARTIAL']),
  status: z.enum(['ACTIVE', 'NEEDS_REVIEW', 'ARCHIVED']),
  createdAt: TimestampV1Schema,
  updatedAt: TimestampV1Schema,
  lastVerifiedSnapshotId: IdV1Schema.nullable(),
  lastRetrievalVerification: z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']).nullable(),
  lastAgentVerification: z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']).nullable(),
}).strict();
```

Use an `0011_flow_annotation_regression.sql` migration with foreign keys to `workspaces`, `guides`, `users`, `agent_runs`, and `answer_citations`; CHECK constrained statuses; immutable target columns; a unique active source citation; and indexes by `(guide_id, status, updated_at)` and `expires_at`. Keep all diagnostic payloads as JSON objects with no raw question or evidence body columns.

- [x] **Step 4: Run the focused contract and migration tests to verify they pass**

Run: `pnpm --filter @guideanything/contracts test -- agent-runtime.test.ts flow-regression.test.ts && pnpm --filter @guideanything/api test -- migrate.test.ts`

Expected: PASS; a fresh in-memory migration has all four isolated tables and the old `knowledge_*` schema remains unchanged.

### Task 2: Resolve and validate stable image-annotation targets

**Files:**
- Create: `apps/api/src/modules/flow-regressions/targets.ts`
- Create: `apps/api/src/modules/flow-regressions/targets.test.ts`
- Modify: `apps/api/src/modules/agents/knowledge-adapters.ts:376-550`
- Modify: `apps/api/src/modules/agents/knowledge-adapters.test.ts`

**Interfaces:**
- Consumes: a normalized `FlowKnowledgeSnapshotV2`, a flow resource locator, and the `IMAGE_ANNOTATION` fragment locator.
- Produces: `resolveFlowAnnotationTarget(snapshot, resourceNodeId, annotationId)` and `assertFlowAnnotationLocator(...)`, which return the resource, annotation, and owner node IDs or fail closed.

- [x] **Step 1: Write failing target resolver tests**

```ts
it('resolves only an annotation that belongs to the referenced image resource', () => {
  expect(resolveFlowAnnotationTarget(snapshot, 'image-1', 'version-type')).toMatchObject({
    resourceNodeId: 'image-1', annotation: { id: 'version-type', title: '版类型' }, ownerNodeIds: ['confirm-material'],
  });
  expect(() => resolveFlowAnnotationTarget(snapshot, 'image-1', 'other-image-note')).toThrow(/标注/u);
});

it('keeps annotationId in canonical flow evidence only for IMAGE_ANNOTATION fragments', async () => {
  const evidence = await adapters.retriever.retrieve(annotationRequest());
  expect(evidence[0]!.locator).toMatchObject({ kind: 'WORKSPACE_FLOW', nodeId: 'image-1', annotationId: 'version-type' });
});
```

- [x] **Step 2: Run the target resolver tests to verify RED**

Run: `pnpm --filter @guideanything/api test -- targets.test.ts knowledge-adapters.test.ts`

Expected: FAIL because no target resolver exists and canonical evidence strips `annotationId`.

- [x] **Step 3: Implement the target resolver and authoritative locator rule**

```ts
const target = resolveFlowAnnotationTarget(snapshot, locator.nodeId, annotationId);
const authoritative = {
  kind: 'WORKSPACE_FLOW' as const,
  ...target.resource.locator,
  annotationId: target.annotation.id,
};
assertLocatorFields(untrustedLocator, authoritative, [
  'kind', 'guideId', 'snapshotId', 'nodeId', 'annotationId',
]);
```

Only take this branch when the persisted fragment projection is `IMAGE_ANNOTATION`; generic resources and ordinary nodes retain the current locator shape. Reject missing, cross-resource, stale, or unauthorized annotation IDs before creating evidence.

- [x] **Step 4: Run the target resolver tests to verify GREEN**

Run: `pnpm --filter @guideanything/api test -- targets.test.ts knowledge-adapters.test.ts`

Expected: PASS; regular resource and node citations remain backwards compatible.

### Task 3: Make opaque reference resolution produce a safe precise deep link

**Files:**
- Modify: `apps/api/src/modules/artifacts/service.ts:177-245,379-395`
- Modify: `apps/api/src/modules/artifacts/routes.test.ts`
- Modify: `apps/api/src/modules/agents/agent-runtime-integration.test.ts`
- Modify: `apps/web/src/App.tsx:120-150`
- Modify: `apps/web/src/features/lesson/LessonPage.tsx`
- Modify: `apps/web/src/features/lesson/ImageAnnotationPlayer.tsx`
- Modify: `apps/web/src/features/lesson/ImageAnnotationPlayer.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/ImageAnnotationEditor.tsx`
- Modify: `apps/web/src/features/editor/ImageAnnotationEditor.test.tsx`

**Interfaces:**
- Consumes: a persisted opaque citation with a verified `WORKSPACE_FLOW` locator.
- Produces: `/guides/:guideId/edit?nodeId=<resource>&annotationId=<annotation>` or `/versions/:versionId/learn?nodeId=<resource>&annotationId=<annotation>` only when `resolveFlowAnnotationTarget` succeeds.

- [x] **Step 1: Write failing reference and UI focus tests**

```ts
it('returns an annotation-specific draft deep link only for a valid current annotation target', async () => {
  seedCitation('annotation-reference', 'run-flow', 'WORKSPACE_FLOW', {
    kind: 'WORKSPACE_FLOW', ...image.locator, annotationId: 'version-type',
  }, snapshot.snapshotId);
  await expect(resolve('annotation-reference', token)).resolves.toMatchObject({
    target: { href: `/guides/guide-flow/edit?nodeId=${image.id}&annotationId=version-type` },
  });
});

it('opens a deep-linked image annotation at the requested annotation index', async () => {
  render(<ImageAnnotationPlayer data={image} initialAnnotationId="version-type" />);
  expect(await screen.findByRole('heading', { name: '版类型' })).toBeVisible();
});
```

- [x] **Step 2: Run the reference and UI tests to verify RED**

Run: `pnpm --filter @guideanything/api test -- artifacts/routes.test.ts agent-runtime-integration.test.ts && pnpm --filter @guideanything/web test -- ImageAnnotationPlayer.test.tsx ImageAnnotationEditor.test.tsx`

Expected: FAIL because the resolver ignores `annotationId` and the frontend only accepts `nodeId`.

- [x] **Step 3: Implement server revalidation and focused UI plumbing**

Server: call `resolveFlowAnnotationTarget` from `snapshotContainsFlowLocator`; append query parameters with `URLSearchParams`; return `STALE` rather than guessing a same-title substitute.

Client: read the bounded `annotationId` search parameter in `App`; pass `focusAnnotationId` into lesson/editor. `LessonPage` forwards it to image preview; `ImageAnnotationPlayer` resolves ID to sorted annotation index, starts it, and safely does nothing for unknown IDs. `GuideEditor` both focuses the image node and opens `ImageAnnotationEditor`, whose selected annotation follows a valid `focusAnnotationId`.

- [x] **Step 4: Run the reference and UI tests to verify GREEN**

Run: `pnpm --filter @guideanything/api test -- artifacts/routes.test.ts agent-runtime-integration.test.ts && pnpm --filter @guideanything/web test -- ImageAnnotationPlayer.test.tsx ImageAnnotationEditor.test.tsx`

Expected: PASS; stale or mismatched annotation IDs never navigate to a different annotation.

### Task 4: Add automatic health checks and deterministic case replay

**Files:**
- Create: `apps/api/src/modules/flow-regressions/service.ts`
- Create: `apps/api/src/modules/flow-regressions/service.test.ts`
- Modify: `apps/api/src/modules/knowledge/flow-indexer.ts:48-148,288-444`
- Modify: `apps/api/src/modules/knowledge/knowledge.test.ts`

**Interfaces:**
- Consumes: a just-materialized flow snapshot/document, owner-scoped `searchKnowledgeInternal`, and stable annotation targets.
- Produces: no success rows; a `flow_annotation_health_issues` row only for missing/mismatched/unranked leaf failures; updates affected regression cases deterministically.

- [x] **Step 1: Write failing health and replay tests**

```ts
it('keeps no health row when every annotation title query ranks its own leaf first', () => {
  syncGuideFlowSnapshot(database, contextWithImageAnnotations());
  expect(database.prepare('SELECT * FROM flow_annotation_health_issues').all()).toEqual([]);
});

it('marks a case NEEDS_REVIEW when its stable target is deleted instead of rebinding a same-title annotation', () => {
  const caseItem = createRegressionCaseFromCitation(database, actor, 'annotation-reference');
  syncGuideFlowSnapshot(database, contextWithoutTarget());
  expect(readCase(caseItem.id)).toMatchObject({ status: 'NEEDS_REVIEW', lastRetrievalVerification: 'NEEDS_REVIEW' });
});
```

- [x] **Step 2: Run health and replay tests to verify RED**

Run: `pnpm --filter @guideanything/api test -- service.test.ts knowledge.test.ts`

Expected: FAIL because no health recorder or deterministic case verifier exists.

- [x] **Step 3: Implement bounded synthetic checks and replay**

For each image annotation use `"<title> 怎么设置？"` when unique in the guide, otherwise `"<owner title> 中的 <title> 是什么？"`. Search at the current FOCUSED budget of six flow candidates. Verify the leaf exists, its projection/locator match, it ranks before generic overview/resource fragments, and its structural closure has overview plus all available owner nodes. Delete prior issues only for the exact snapshot before inserting current failures.

For active cases, use the stored question and current target. Persist only `lastVerifiedSnapshotId`, deterministic result, and `NEEDS_REVIEW` when target/leaf/context is unavailable. Never store a synthetic question or a pass row.

- [x] **Step 4: Run health and replay tests to verify GREEN**

Run: `pnpm --filter @guideanything/api test -- service.test.ts knowledge.test.ts`

Expected: PASS; ordinary successful indexing produces no QA records, while broken leaves and deleted targets are auditable.

### Task 5: Capture minimal retrieval diagnostics without retaining model reasoning

**Files:**
- Modify: `apps/api/src/modules/agents/orchestrator.ts:100-160,620-800`
- Modify: `apps/api/src/modules/agents/assembly.ts`
- Modify: `apps/api/src/modules/agents/knowledge-adapters.ts:51-114,311-375`
- Modify: `apps/api/src/modules/agents/knowledge-adapters.test.ts`
- Modify: `apps/api/src/modules/agents/output-committer.ts`
- Modify: `apps/api/src/modules/agents/output-committer.test.ts`

**Interfaces:**
- Consumes: search hit order and `expandFlowEvidence` append decisions.
- Produces: an in-memory `AgentRetrievalTrace` keyed by `runId`; `AgentOutputCommitter.commit` receives it and persists it only when an answer is not `SUPPORTED` or the run maps to a regression case.

- [x] **Step 1: Write failing trace tests**

```ts
it('does not persist a diagnostic for an ordinary supported answer', async () => {
  await committer.commit({ context, answer: supportedAnswer, references, retrievalTrace: trace });
  expect(countDiagnostics()).toBe(0);
});

it('persists only IDs, projections, ranks, closure relations, a query hash, and expiry for a partial answer', async () => {
  await committer.commit({ context, answer: partialAnswer, references, retrievalTrace: trace });
  expect(readDiagnostic()).toMatchObject({ reasonCode: 'TARGET_NOT_RANKED' });
  expect(JSON.stringify(readDiagnostic())).not.toContain('用户原问题');
  expect(JSON.stringify(readDiagnostic())).not.toContain('隐藏推理');
});
```

- [x] **Step 2: Run trace tests to verify RED**

Run: `pnpm --filter @guideanything/api test -- knowledge-adapters.test.ts output-committer.test.ts orchestrator.test.ts`

Expected: FAIL because retrieval has no trace interface and the committer cannot persist a diagnostic.

- [x] **Step 3: Implement trace handoff and 30-day cleanup**

Keep trace data in the database adapter only until `consumeTrace(runId)` is called. Candidate objects contain `fragmentId`, `projection`, `rank`, `selected`, and bounded exclusion/closure reason codes; closure records only resource/node IDs and relation kinds. Hash normalized question text with SHA-256 before persistence. On every diagnostic insert, delete only rows with `expires_at <= now`; never backfill diagnostics for ordinary successful runs.

- [x] **Step 4: Run trace tests to verify GREEN**

Run: `pnpm --filter @guideanything/api test -- knowledge-adapters.test.ts output-committer.test.ts orchestrator.test.ts`

Expected: PASS; diagnostics are bounded, sanitized, and absent for unpinned supported runs.

### Task 6: Create, list, replay, archive, and explicitly real-run regression cases

**Files:**
- Create: `apps/api/src/modules/flow-regressions/routes.ts`
- Create: `apps/api/src/modules/flow-regressions/routes.test.ts`
- Modify: `apps/api/src/modules/artifacts/routes.ts`
- Modify: `apps/api/src/modules/artifacts/service.ts`
- Modify: `apps/api/src/modules/artifacts/routes.test.ts`
- Modify: `apps/api/src/modules/guides/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/agents/output-committer.ts`
- Modify: `apps/api/src/modules/agents/output-committer.test.ts`

**Interfaces:**
- Consumes: an opaque citation or a guide/case ID and authenticated actor.
- Produces: idempotent case creation from a cited `IMAGE_ANNOTATION`, a compact guide-scoped list, deterministic replay, archival, and an explicitly scheduled real Agent run mapped to the case.

- [x] **Step 1: Write failing route authorization and real-run tests**

```ts
it('allows only guide OWNER or EDIT to pin an image-annotation citation', async () => {
  expect((await pinAs(ownerToken)).statusCode).toBe(201);
  expect((await pinAs(viewerToken)).statusCode).toBe(403);
});

it('creates a normal agent run only after the editor explicitly requests a real trial', async () => {
  const response = await app.inject({ method: 'POST', url: `/api/guides/${guideId}/flow-regression-cases/${caseId}/real-run`, headers: ownerHeaders });
  expect(response.statusCode).toBe(202);
  expect(runtime.scheduleRun).toHaveBeenCalledWith(response.json().run.id);
});
```

- [x] **Step 2: Run route tests to verify RED**

Run: `pnpm --filter @guideanything/api test -- flow-regressions/routes.test.ts artifacts/routes.test.ts output-committer.test.ts`

Expected: FAIL because the route family and regression-run mapping do not exist.

- [x] **Step 3: Implement the minimal authenticated API**

Provide these paths:

```text
GET  /api/references/:referenceId/flow-regression-eligibility
POST /api/references/:referenceId/flow-regression-cases
GET  /api/guides/:id/flow-regression-cases
POST /api/guides/:id/flow-regression-cases/:caseId/replay
PATCH /api/guides/:id/flow-regression-cases/:caseId/status
POST /api/guides/:id/flow-regression-cases/:caseId/real-run
GET  /api/guides/:id/flow-annotation-health
GET  /api/agent-runs/:runId/retrieval-diagnostic
```

Creation derives the original user question from the cited run, accepts only a current `IMAGE_ANNOTATION` target, derives expected status from the cited committed answer (`SUPPORTED` or `PARTIAL`), and is idempotent per citation. `real-run` creates a new workspace conversation/run with only `workspaceFlows` enabled, records the mapping before scheduling, and never auto-runs after save/publish. The output committer updates `lastAgentVerification` only when the mapped run finishes and both evidence status and cited stable target match.

- [x] **Step 4: Run route tests to verify GREEN**

Run: `pnpm --filter @guideanything/api test -- flow-regressions/routes.test.ts artifacts/routes.test.ts output-committer.test.ts`

Expected: PASS; reader roles cannot enumerate, pin, replay, archive, or pay for a real trial.

### Task 7: Add the compact citation and guide-editor controls

**Files:**
- Modify: `apps/web/src/features/agents/types.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/agents/AgentConversationPanel.tsx`
- Modify: `apps/web/src/features/agents/AgentConversationPanel.test.tsx`
- Create: `apps/web/src/features/editor/FlowRegressionPanel.tsx`
- Create: `apps/web/src/features/editor/FlowRegressionPanel.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`

**Interfaces:**
- Consumes: the eligibility endpoint, compact case list, and current editor access.
- Produces: a citation-local “固定为回归题” control visible only after eligibility says `canPin`, plus an editor-local “回归题 (N)” details panel with deterministic replay, archive, and explicit real trial controls.

- [x] **Step 1: Write failing UI tests**

```tsx
it('shows a pin action only for an eligible image-annotation citation and creates one case', async () => {
  render(<AgentConversationPanel api={api} scope={{ kind: 'WORKSPACE', workspaceId: 'workspace-1' }} />);
  await user.click(await screen.findByRole('button', { name: '固定为回归题' }));
  expect(api.createFlowRegressionCase).toHaveBeenCalledWith('reference-annotation');
});

it('shows compact case state in the guide editor without a standalone QA page', async () => {
  render(<FlowRegressionPanel guideId="guide-1" api={api} />);
  expect(await screen.findByText('回归题（1）')).toBeVisible();
  expect(screen.getByText('版类型')).toBeVisible();
});
```

- [x] **Step 2: Run UI tests to verify RED**

Run: `pnpm --filter @guideanything/web test -- AgentConversationPanel.test.tsx FlowRegressionPanel.test.tsx GuideEditor.test.tsx styles.test.ts`

Expected: FAIL because no client API or components exist.

- [x] **Step 3: Implement compact controls and accessible states**

Use an `EligibilityPinAction` subcomponent that fetches eligibility and renders nothing for viewers or non-annotation citations. It must show a disabled pending state, concise success/error feedback, and never copy answer text into the request.

Render `FlowRegressionPanel` inside the Guide editor header as a `<details>` section. List question, target annotation title, current status, last deterministic/real result, and only three actions: “确定性复跑”, “真实试跑”, and “归档”. Health issues appear as a compact warning inside that section; do not add a global QA navigation item or a standalone dashboard.

- [x] **Step 4: Run UI tests to verify GREEN**

Run: `pnpm --filter @guideanything/web test -- AgentConversationPanel.test.tsx FlowRegressionPanel.test.tsx GuideEditor.test.tsx styles.test.ts`

Expected: PASS; non-editors see no mutation controls, and all controls have loading/error/disabled behavior.

### Task 8: Run integration, type, rendering, and real-runtime verification

**Files:**
- Modify: `apps/api/src/modules/agents/agent-runtime-integration.test.ts`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `docs/superpowers/specs/2026-07-21-lightweight-annotation-regression-design.md` only if implementation reveals a concrete discrepancy; otherwise leave it unchanged.

**Interfaces:**
- Consumes: all production routes, contracts, indexer, and UI components from tasks 1–7.
- Produces: evidence that a “版类型” annotation query yields a precise deep link, can be pinned and deterministically replayed, while a real bridge run remains explicit.

- [x] **Step 1: Write the final failing integration assertions before altering any remaining production glue**

```ts
expect(reference.json().target.href).toContain(`nodeId=${imageId}&annotationId=version-type`);
expect((await listCases()).items[0]).toMatchObject({
  resourceNodeId: imageId,
  annotationId: 'version-type',
  lastRetrievalVerification: 'PASS',
});
expect(database.prepare('SELECT COUNT(*) AS count FROM knowledge_sources WHERE id LIKE \'%regression%\'').get())
  .toEqual({ count: 0 });
```

- [x] **Step 2: Run the final integration test to verify RED if any cross-layer behavior remains missing**

Run: `pnpm --filter @guideanything/api test -- agent-runtime-integration.test.ts flow-regressions/routes.test.ts && pnpm --filter @guideanything/web test -- App.test.tsx`

Expected: FAIL until the final routing/client wiring is complete; fix the missing layer rather than weakening the assertion.

- [x] **Step 3: Complete only the remaining glue required by the failing assertion**

Keep all serialization through Zod contracts, call `git diff --check`, and do not add test-only production switches. Add no behavior beyond the reviewed specification.

- [x] **Step 4: Run the complete verification set**

Run:

```bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/api test
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/api typecheck
pnpm --filter @guideanything/web typecheck
git diff --check
```

Expected: every command exits 0.

- [x] **Step 5: Perform a real Bridge smoke test only after automated checks pass**

Use the existing real Bridge readiness checks, then submit the existing “打样流程中，版类型应该怎么设置？” flow query. Verify the returned citation resolves to a URL containing both the image resource `nodeId` and the intended `annotationId`; pin it; run deterministic replay; do not start “真实试跑” unless explicitly clicked in the product UI.

## Plan Self-Review

- Spec coverage: Task 1 preserves fact/index boundaries; Tasks 2–3 establish stable annotation identity and safe navigation; Task 4 handles all-object checks and automatic case maintenance; Task 5 handles sanitized diagnostics; Task 6 supplies permissioned persistence, replay, archive, and explicit model trials; Task 7 supplies the minimal UI; Task 8 verifies the original “版类型” failure end to end.
- Placeholder scan: this plan contains no implementation placeholders. All new contracts, tables, route paths, behavior constraints, tests, and commands are explicit.
- Type consistency: every case target is `guideId + resourceNodeId + annotationId`; public agent state is consistently `SUPPORTED | PARTIAL`; deterministic results are `PASS | FAIL | NEEDS_REVIEW`; the real-run mapping is keyed by `agent_runs.id`.

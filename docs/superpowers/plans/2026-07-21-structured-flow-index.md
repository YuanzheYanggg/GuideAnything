# Structured Flow Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a direct image-annotation/field query retrieve the exact leaf plus its bounded flow context, so the Agent reports a knowledge gap only after the indexed flow graph has no matching leaf.

**Architecture:** Keep `FlowKnowledgeSnapshotV2` as the immutable canonical fact graph; it already retains `FLOW`, `USES_RESOURCE`, `RESOURCE_REFERENCE`, `learningPath`, and annotation IDs. Materialize that graph as an indexed wiki projection: overview outline, node fragments, resource fragments, and one searchable fragment per image annotation. The server-side retriever, not the model, closes a matched leaf over its parent resource/node, concise overview, and bounded flow neighbours.

**Tech Stack:** TypeScript 5.9, Node.js 24 `node:sqlite`, SQLite FTS5, Zod 4, Vitest, pnpm.

## Global Constraints

- Preserve `FlowKnowledgeSnapshotV2` IDs and immutable snapshot checksums; do not add a snapshot migration for an index-projection concern.
- Keep the public `WORKSPACE_FLOW` locator shape unchanged; annotation fragments cite their existing image-resource locator and retain an internal projection marker only.
- Rebuild existing materialized documents when their metadata lacks the current flow-index projection version; keep `knowledge_documents.checksum` equal to the snapshot document checksum so authorization remains valid.
- Expand only the matched structural closure, never the entire flow graph; honour `maxCandidates` and `maxFlowHops`.
- A mixed worktree is in use. Do not stage, commit, reset, or overwrite unrelated files.

---

### Task 1: Materialize an indexed flow wiki with annotation leaves

**Files:**

- Modify: `apps/api/src/modules/knowledge/flow-indexer.ts:25-470`
- Test: `apps/api/src/modules/knowledge/knowledge.test.ts:462-535`

**Interfaces:**

- Consumes: `FlowKnowledgeSnapshotV2.nodes`, `.resources`, `.relations`, and `.learningPath`.
- Produces: `knowledge_fragments` with internal `projection` values `OVERVIEW`, no projection for existing node/resource fragments, and `IMAGE_ANNOTATION` for per-annotation leaves.
- Produces: document metadata field `flowIndexProjectionVersion` used by `syncGuideFlowSnapshot` and `reconcileGuideFlowSnapshots` to rematerialize stale index projections.

- [ ] **Step 1: Write failing index and rebuild tests**

Add a test document with an image attached to `middle`, two annotations (`版类型`, `紧急度`), and assert that the saved snapshot creates independently searchable annotation fragments whose content starts with the annotation title/body and names its owner node. Also assert the overview contains a `流程结构索引` path and that an existing document whose metadata has no `flowIndexProjectionVersion` is rebuilt by `reconcileGuideFlowSnapshots` without changing the snapshot ID or document checksum.

```ts
expect(annotationFragments).toEqual(expect.arrayContaining([
  expect.objectContaining({ heading: '版类型', content: expect.stringContaining('初样') }),
  expect.objectContaining({ heading: '紧急度', content: expect.stringContaining('加急') }),
]));
expect(overview.content).toContain('流程结构索引');
expect(overview.content).toContain('确认原料');
expect(reconcileGuideFlowSnapshots(context.database)).toMatchObject({ indexed: 1, failed: 0 });
expect(rebuilt.document_checksum).toBe(snapshot.document_checksum);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @guideanything/api test -- knowledge.test.ts -t "materializes image annotations as independent flow leaves"`

Expected: FAIL because the current index emits one image-resource blob, the overview has no structure outline, and reconciliation ignores an already materialized document.

- [ ] **Step 3: Implement the minimal projection and versioned rematerialization**

In `flow-indexer.ts`:

```ts
const FLOW_INDEX_PROJECTION_VERSION = 2;

function flowDocumentMetadata(context: GuideFlowContext) {
  return {
    sourceKind: 'WORKSPACE_FLOW',
    aliases: [],
    tags: context.tags,
    rawEvidenceAvailable: false,
    guideId: context.guideId,
    guideTitle: context.title,
    origin: context.origin,
    flowIndexProjectionVersion: FLOW_INDEX_PROJECTION_VERSION,
  };
}
```

Generate a compact overview outline from ordered `learningPath` targets. Keep the current node/resource fragment IDs, then append one `IMAGE_ANNOTATION` fragment per `resource.annotations` entry. Its content order must be `annotation.title`, `annotation.body`, resource label, owner-node titles, and learning-path context, so the direct answer stays inside the public excerpt. For existing snapshots, detect an absent/outdated metadata version, delete only that document's fragments in one transaction, update metadata/checksum/revision in place, and insert the new projection with the same document ID. Update reconcile selection to include projection-version mismatches.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @guideanything/api test -- knowledge.test.ts -t "materializes image annotations as independent flow leaves"`

Expected: PASS; existing snapshot facts remain unchanged while its derived fragments are replaced atomically.

- [ ] **Step 5: Review the task diff without committing**

Run: `git diff --check -- apps/api/src/modules/knowledge/flow-indexer.ts apps/api/src/modules/knowledge/knowledge.test.ts`

Expected: no whitespace errors. Do not commit in the mixed worktree.

### Task 2: Close a matched flow leaf over its graph context

**Files:**

- Modify: `apps/api/src/modules/agents/knowledge-adapters.ts:57-109,311-340,723-747`
- Test: `apps/api/src/modules/agents/knowledge-adapters.test.ts:390-458,1180-1245`

**Interfaces:**

- Consumes: an indexed evidence record whose canonical `nodeId` may identify either a flow node or a resource.
- Produces: bounded evidence ordered as direct match, structural overview, owner/reference nodes, direct attached resources where relevant, then one/two-hop flow neighbours.
- Preserves: `authoritativeFlowLocator`, source permissions, revision checks, and the existing rule that an `OVERVIEW` seed must not expand as a node.

- [ ] **Step 1: Write a failing retrieval-closure test**

Update the annotated test fixture so its image is attached to `middle`. Request `打样流程里版类型应该怎么设置？` with four candidates and assert that the first evidence is the `IMAGE_ANNOTATION` leaf, the set contains the owner node and structure overview, and all evidence remains in the same snapshot.

```ts
expect(evidence[0]).toMatchObject({
  excerpt: expect.stringContaining('版类型'),
  locator: expect.objectContaining({ nodeId: 'annotated-image' }),
});
expect(evidence).toEqual(expect.arrayContaining([
  expect.objectContaining({ locator: expect.objectContaining({ nodeId: 'middle' }) }),
  expect.objectContaining({ excerpt: expect.stringContaining('流程结构索引') }),
]));
expect(evidence.every((item) => item.locator.kind !== 'WORKSPACE_FLOW'
  || item.locator.snapshotId === flow.snapshotId)).toBe(true);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @guideanything/api test -- knowledge-adapters.test.ts -t "returns structural context for an exact image annotation leaf"`

Expected: FAIL because `expandFlowEvidence` only searches `snapshot.nodes` and immediately returns for a resource locator.

- [ ] **Step 3: Implement relation-aware closure**

Replace the node-only branch in `expandFlowEvidence` with helpers that classify the seed as node or resource. For a resource seed, derive owner node IDs from `USES_RESOURCE` and target node/resource IDs from `RESOURCE_REFERENCE`; for a node seed, derive attached resource IDs from `USES_RESOURCE`. Add a dedicated overview loader that selects `projection = 'OVERVIEW'`. Append the overview and direct structural anchors before bounded `FLOW` neighbours, using the existing `seen` set and `request.maxCandidates` guard on every append.

```ts
const ownerNodeIds = snapshot.relations.flatMap((relation) => (
  relation.kind === 'USES_RESOURCE' && relation.resourceId === seedId
    ? [relation.sourceNodeId]
    : []
));

const referenceNodeIds = snapshot.relations.flatMap((relation) => (
  relation.kind === 'RESOURCE_REFERENCE' && relation.sourceResourceId === seedId && relation.targetNodeId
    ? [relation.targetNodeId]
    : []
));
```

Do not add an unbounded graph traversal and do not expose internal projection fields through `ValidatedEvidenceV1`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @guideanything/api test -- knowledge-adapters.test.ts -t "returns structural context for an exact image annotation leaf"`

Expected: PASS; the direct annotation remains first and its owner/overview are present without duplicated fragments.

- [ ] **Step 5: Run adjacent retrieval regressions**

Run: `pnpm --filter @guideanything/api test -- knowledge-adapters.test.ts -t "returns an image annotation|keeps an exact annotation hit|does not expand a flow overview|returns a selected flow node"`

Expected: PASS; older V1 snapshots still use safe node-neighbour expansion and overview matching never fans out incorrectly.

### Task 3: Align the workspace Agent harness with structural evidence

**Files:**

- Modify: `apps/api/src/modules/agents/bundles/workspace-query.ts:7-25`
- Modify: `apps/api/src/modules/agents/orchestrator.test.ts` (existing router/harness assertions)

**Interfaces:**

- Consumes: server-provided direct annotation evidence and its bounded structural closure.
- Produces: a worker instruction that preserves the no-full-graph rule but forbids treating absent surrounding prose as a knowledge gap when a direct indexed leaf answers the requested field.

- [ ] **Step 1: Write a failing harness assertion**

Add an assertion against the focused-worker prompt that it contains both `结构闭包` and the condition that a gap may be reported only after the direct field/annotation and its bounded related context have been checked.

```ts
expect(prompt).toContain('结构闭包');
expect(prompt).toContain('不得仅因缺少整张流程图的摘要而声明资料缺口');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @guideanything/api test -- orchestrator.test.ts -t "uses structural closure guidance for focused flow workers"`

Expected: FAIL because the current workspace bundle only says not to scan the full flow and to report a gap on a miss.

- [ ] **Step 3: Add the minimal conditional instruction**

Keep the existing safety boundary, and add wording equivalent to:

```ts
'字段或图片标注命中时，服务端提供的 direct leaf、所属节点和流程结构索引构成结构闭包；先据此回答。只有直接字段及其受限关联上下文都没有依据时，才能声明资料缺口。不得仅因缺少整张流程图的摘要而声明资料缺口。'
```

The instruction must not give the model a new retrieval capability or authorize whole-workspace scanning.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @guideanything/api test -- orchestrator.test.ts -t "uses structural closure guidance for focused flow workers"`

Expected: PASS.

### Task 4: Verify derived-index compatibility and live behavior

**Files:**

- Verify: `apps/api/src/modules/knowledge/knowledge.test.ts`
- Verify: `apps/api/src/modules/agents/knowledge-adapters.test.ts`
- Verify: `apps/api/src/modules/agents/orchestrator.test.ts`
- Verify: `apps/api/src/modules/agents/bundles/workspace-query.ts`

- [ ] **Step 1: Run the affected API test suites**

Run: `pnpm --filter @guideanything/api test -- knowledge.test.ts knowledge-adapters.test.ts orchestrator.test.ts`

Expected: PASS with no failing flow-index, authorization, or route-policy tests.

- [ ] **Step 2: Run API type checking and whitespace validation**

Run: `pnpm --filter @guideanything/api typecheck && git diff --check`

Expected: both commands exit 0.

- [ ] **Step 3: Verify the current local database rematerializes safely**

Run a read-only SQLite summary after API reconciliation that proves the current `打样提案流程` has an `IMAGE_ANNOTATION` fragment for `版类型`, whose first public excerpt contains its definition, and that the document checksum still equals the flow snapshot checksum.

Expected: one direct leaf, same snapshot ID, no snapshot rewrite.

- [ ] **Step 4: Verify a real Bridge Agent answer**

Send a new workspace question that names a late image annotation and confirm the completed answer cites the direct leaf, answers from it, and reports a gap only for genuinely absent rules. Do not expose credentials, tokens, or raw database content in the handoff.

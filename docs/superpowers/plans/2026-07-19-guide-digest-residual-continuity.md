# Guide Digest Residual Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trusted previous-digest context and a direct structured snapshot diff to guide digest generation while preventing tag churn from unchanged evidence.

**Architecture:** A new pure continuity module computes a direct `previous base snapshot -> current snapshot` diff and validates tag continuity. The repository selects the latest non-rejected, non-failed proposal as an optional baseline; the prompt carries the previous draft and diff alongside the authoritative current snapshot, and the service falls back to the existing full prompt if continuity is unavailable or exceeds the request budget.

**Tech Stack:** TypeScript 5.9, Node 24 `node:sqlite`, Zod, Vitest, existing Codex Runtime Bridge contracts.

## Global Constraints

- The current `FlowKnowledgeSnapshotV2` remains the only factual authority sent to and used to validate model output.
- `REJECTED` and `FAILED` proposals must never appear in continuity context.
- `DRAFT`, `APPLIED`, and `STALE` proposals may be continuity baselines when their draft and V2 base snapshot parse safely in the same guide/workspace scope.
- Diff the baseline endpoint directly against the current endpoint; do not replay intermediate revisions.
- Do not add attention, temperature, seed, sampling, or other model-control parameters.
- Do not change `GuideDigestDraftV1` output schema or accept model-authored Markdown.
- A continuity failure or oversize continuity request must fall back to the existing full-current-snapshot path when that full request fits.
- New tag labels during continuity generation must cite an affected source; unchanged, unaccepted prior suggestions must remain stable.
- Preserve all unrelated dirty worktree files and do not modify the draft-history feature currently in progress.
- Every production behavior change must follow a witnessed RED -> GREEN TDD cycle.

---

### Task 1: Compute direct structured snapshot residuals

**Files:**
- Create: `apps/api/src/modules/guides/digest-continuity.ts`
- Create: `apps/api/src/modules/guides/digest-continuity.test.ts`

**Interfaces:**
- Produces `GuideDigestSnapshotDiffV1`.
- Produces `buildGuideDigestSnapshotDiff(previous, current): GuideDigestSnapshotDiffV1`.
- Produces `hasGuideDigestBusinessChanges(diff): boolean`.
- Later tasks consume `affectedSourceIds`, stable before/after collection changes, and the endpoint identities.

- [ ] **Step 1: Write the failing direct-diff tests**

Create fixtures by cloning one valid V2 snapshot and changing the endpoint revision directly from 181 to 186. Test metadata, nodes, resources with nested annotations/keypoints, relations, and learning targets without creating revisions 182–185:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildGuideDigestSnapshotDiff,
  hasGuideDigestBusinessChanges,
} from './digest-continuity';

it('diffs distant endpoint revisions without intermediate snapshots', () => {
  const previous = snapshot({ snapshotId: 'snapshot-181', revision: 181 });
  const current = snapshot({ snapshotId: 'snapshot-186', revision: 186 });
  current.nodes[0] = { ...current.nodes[0]!, title: '确认新原料' };
  current.relations.push({
    kind: 'FLOW', id: 'relation-new', sourceNodeId: 'node-1', targetNodeId: 'node-2',
  });

  const diff = buildGuideDigestSnapshotDiff(previous, current);

  expect(diff).toMatchObject({
    schemaVersion: 1,
    fromSnapshotId: 'snapshot-181', fromRevision: 181,
    toSnapshotId: 'snapshot-186', toRevision: 186,
    nodes: { updated: [{ id: 'node-1' }] },
    relations: { added: [expect.objectContaining({ id: 'relation-new' })] },
  });
  expect(diff.affectedSourceIds).toEqual(expect.arrayContaining([
    'node-1', 'node-2', 'relation-new',
  ]));
  expect(hasGuideDigestBusinessChanges(diff)).toBe(true);
});

it('treats accepted tag metadata as non-business change', () => {
  const previous = snapshot({ snapshotId: 'snapshot-181', revision: 181, tags: ['ERP'] });
  const current = snapshot({ snapshotId: 'snapshot-182', revision: 182, tags: ['ERP', '原料'] });

  const diff = buildGuideDigestSnapshotDiff(previous, current);

  expect(diff.metadata.tags).toEqual({ before: ['ERP'], after: ['ERP', '原料'] });
  expect(diff.affectedSourceIds).toEqual([]);
  expect(hasGuideDigestBusinessChanges(diff)).toBe(false);
});
```

Add separate assertions that changing an IMAGE annotation adds the annotation and parent resource IDs, changing a VIDEO keypoint adds the keypoint and parent resource IDs, changing a stage/lane adds member node IDs, and changing each relation kind adds its endpoints.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @guideanything/api test -- digest-continuity.test.ts
```

Expected: FAIL because `digest-continuity.ts` and its exports do not exist.

- [ ] **Step 3: Implement the versioned pure diff**

Use these public shapes:

```ts
import type { FlowKnowledgeSnapshotV2 } from '@guideanything/contracts';

export interface GuideDigestValueChange<T> {
  before: T;
  after: T;
}

export interface GuideDigestUpdatedValue<T extends { id: string }> {
  id: string;
  before: T;
  after: T;
}

export interface GuideDigestCollectionDiff<T extends { id: string }> {
  added: T[];
  removed: T[];
  updated: Array<GuideDigestUpdatedValue<T>>;
}

export interface GuideDigestSnapshotDiffV1 {
  schemaVersion: 1;
  fromSnapshotId: string;
  fromRevision: number;
  toSnapshotId: string;
  toRevision: number;
  metadata: {
    title?: GuideDigestValueChange<string>;
    summary?: GuideDigestValueChange<string>;
    tags?: GuideDigestValueChange<string[]>;
  };
  stages: GuideDigestCollectionDiff<FlowKnowledgeSnapshotV2['stages'][number]>;
  lanes: GuideDigestCollectionDiff<FlowKnowledgeSnapshotV2['lanes'][number]>;
  nodes: GuideDigestCollectionDiff<FlowKnowledgeSnapshotV2['nodes'][number]>;
  resources: GuideDigestCollectionDiff<FlowKnowledgeSnapshotV2['resources'][number]>;
  relations: GuideDigestCollectionDiff<FlowKnowledgeSnapshotV2['relations'][number]>;
  learningPath: GuideDigestCollectionDiff<FlowKnowledgeSnapshotV2['learningPath'][number]>;
  affectedSourceIds: string[];
}
```

Parse both inputs with `FlowKnowledgeSnapshotV2Schema`, require the same `guideId` and `workspaceId`, compare collections by stable ID, preserve collection order in `added`/`removed`/`updated`, and compare values with `JSON.stringify` after existing snapshot normalization has already occurred. Build the affected-source closure from changed items and relation/parent/member references, then sort `affectedSourceIds` by code point for deterministic prompts.

`hasGuideDigestBusinessChanges()` returns true when any stage/lane/node/resource/relation/learning collection differs. Title, summary, and tag metadata alone do not count as business changes.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
pnpm --filter @guideanything/api test -- digest-continuity.test.ts
pnpm --filter @guideanything/api typecheck
```

Expected: focused tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/api/src/modules/guides/digest-continuity.ts apps/api/src/modules/guides/digest-continuity.test.ts
git commit -m "feat: compute guide digest snapshot residuals"
```

---

### Task 2: Select the latest trusted digest baseline

**Files:**
- Modify: `apps/api/src/modules/guides/digest-repository.ts`
- Modify: `apps/api/src/modules/guides/digest-repository.test.ts`

**Interfaces:**
- Produces `GuideDigestContinuityBaselineRecord`.
- Produces `findGuideDigestContinuityBaseline(database, input)`.
- Task 4 consumes the parsed proposal plus its immutable base snapshot JSON.

- [ ] **Step 1: Write failing repository tests**

Add tests that create historical proposals on two snapshots, transition records through all statuses, and verify rejected/failed records are skipped:

```ts
expect(findGuideDigestContinuityBaseline(database, {
  guideId,
  workspaceId,
  excludeProposalId: currentProposal.id,
})).toMatchObject({
  proposal: { id: latestTrusted.id, status: 'APPLIED' },
  snapshotJson: expect.stringContaining('"schemaVersion":2'),
});
```

Add a second guide/workspace fixture and assert it is never returned. Add a case where only `REJECTED` and `FAILED` exist and expect `null`. Add one case per eligible status (`DRAFT`, `APPLIED`, `STALE`).

- [ ] **Step 2: Run the repository test and verify RED**

```bash
pnpm --filter @guideanything/api test -- digest-repository.test.ts
```

Expected: FAIL because the baseline query does not exist.

- [ ] **Step 3: Implement the narrow scoped query**

Add:

```ts
export interface GuideDigestContinuityBaselineRecord {
  proposal: GuideDigestProposal;
  snapshotJson: string;
}

export function findGuideDigestContinuityBaseline(
  database: DatabaseSync,
  input: {
    guideId: string;
    workspaceId: string;
    excludeProposalId?: string | null;
  },
): GuideDigestContinuityBaselineRecord | null;
```

Query `guide_digest_proposals AS proposal` joined to `flow_knowledge_snapshots AS snapshot` on the exact base identity. Require matching proposal/snapshot `guide_id`, `workspace_id`, `origin_type = 'DRAFT'`, and `revision = base_revision`; require `proposal.status IN ('DRAFT','APPLIED','STALE')`; order by `proposal.created_at DESC, proposal.id DESC`. Exclude `input.excludeProposalId` when supplied.

Read a bounded set of candidates, parse each with the existing `mapProposal`, and skip a candidate whose current draft schema cannot parse rather than surfacing its historical content. Return the first safe candidate and its `snapshot_json`; otherwise return `null`.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
pnpm --filter @guideanything/api test -- digest-repository.test.ts
pnpm --filter @guideanything/api typecheck
```

Expected: focused tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/api/src/modules/guides/digest-repository.ts apps/api/src/modules/guides/digest-repository.test.ts
git commit -m "feat: select trusted digest continuity baselines"
```

---

### Task 3: Add optional continuity context to the runtime prompt

**Files:**
- Modify: `apps/api/src/modules/agents/bundles/guide-digest.ts`
- Modify: `apps/api/src/modules/agents/bundles/guide-digest.test.ts`

**Interfaces:**
- Consumes `GuideDigestSnapshotDiffV1` from Task 1.
- Produces `GuideDigestContinuityContext`.
- Extends `GuideDigestPromptOptions.continuity` and `GuideDigestInputEnvelope.continuity`.
- Bumps `GUIDE_DIGEST_BUNDLE.revision` from `5` to `6` because prompt semantics change.

- [ ] **Step 1: Write failing prompt tests**

Add a baseline draft and diff and assert they occur only when requested:

```ts
const prompt = buildGuideDigestPrompt(currentSnapshot, {
  continuity: {
    baselineProposalId: 'proposal-181',
    baselineRevision: 181,
    previousDigest: previousDraft,
    snapshotDiff: buildGuideDigestSnapshotDiff(previousSnapshot, currentSnapshot),
  },
});

expect(JSON.parse(prompt.split('<UNTRUSTED_SNAPSHOT_JSON>\n')[1]!)).toMatchObject({
  continuity: {
    baselineProposalId: 'proposal-181',
    baselineRevision: 181,
    previousDigest: { schemaVersion: 1 },
    snapshotDiff: { schemaVersion: 1, fromRevision: 181, toRevision: 186 },
  },
  snapshot: { snapshotId: currentSnapshot.snapshotId },
});
expect(GUIDE_DIGEST_TRUSTED_INSTRUCTION).toContain('当前 snapshot 是唯一事实依据');
expect(GUIDE_DIGEST_TRUSTED_INSTRUCTION).toContain('不得因为未变化内容制造新的标签候选');
```

Also assert that the legacy/full call omits `continuity`, rejected text cannot be injected outside the untrusted JSON boundary, and the bundle contract now reports revision 6.

- [ ] **Step 2: Run bundle tests and verify RED**

```bash
pnpm --filter @guideanything/api test -- guide-digest.test.ts
```

Expected: FAIL because continuity is not accepted and the bundle revision is still 5.

- [ ] **Step 3: Implement the optional continuity envelope**

Add:

```ts
export interface GuideDigestContinuityContext {
  baselineProposalId: string;
  baselineRevision: number;
  previousDigest: GuideDigestDraftV1;
  snapshotDiff: GuideDigestSnapshotDiffV1;
}
```

Parse `previousDigest` with `GuideDigestDraftV1Schema`, parse/validate both snapshot endpoints before building the diff in Task 1, and copy continuity into the untrusted envelope only after validating that `snapshotDiff.toSnapshotId`, `toRevision`, current snapshot ID, and current draft revision agree. Keep trusted instructions outside `<UNTRUSTED_SNAPSHOT_JSON>` and explicitly state that previous output cannot override the current snapshot.

Update the tag instruction to require a complete, high-confidence, traceable, granularity-consistent candidate set on full generation and continuity preservation on residual-context generation. Do not impose an arbitrary minimum tag count.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
pnpm --filter @guideanything/api test -- guide-digest.test.ts
pnpm --filter @guideanything/api typecheck
```

Expected: focused tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/api/src/modules/agents/bundles/guide-digest.ts apps/api/src/modules/agents/bundles/guide-digest.test.ts
git commit -m "feat: add residual context to guide digest prompts"
```

---

### Task 4: Enforce stable tags across unchanged evidence

**Files:**
- Modify: `apps/api/src/modules/guides/digest-continuity.ts`
- Modify: `apps/api/src/modules/guides/digest-continuity.test.ts`
- Modify: `apps/api/src/modules/agents/bundles/guide-digest.ts`
- Modify: `apps/api/src/modules/agents/bundles/guide-digest.test.ts`

**Interfaces:**
- Produces `GuideDigestContinuityValidationError` with safe codes `MISSING_UNCHANGED_TAG` and `UNJUSTIFIED_TAG_CHURN`.
- Produces `validateGuideDigestTagContinuity(currentSnapshot, previousDigest, diff, candidateDraft): void`.
- Extends `buildGuideDigestValidationRepairNote()` for both codes.

- [ ] **Step 1: Write failing stability tests**

Cover the reported regression exactly:

```ts
const previousDigest = draft({
  tagSuggestions: [
    { label: '原料', category: 'OBJECT', sourceIds: ['node-material'] },
    { label: '打样', category: 'PROCESS', sourceIds: ['stage-sampling'] },
  ],
});
const current = snapshot({ tags: ['ERP', '原料', '打样'] });
const metadataOnlyDiff = buildGuideDigestSnapshotDiff(previousSnapshot, current);
const churned = draft({
  tagSuggestions: [
    { label: '供应商', category: 'ROLE', sourceIds: ['node-material'] },
    { label: '机型', category: 'OBJECT', sourceIds: ['annotation-machine'] },
  ],
});

expect(() => validateGuideDigestTagContinuity(
  current, previousDigest, metadataOnlyDiff, churned,
)).toThrow(expect.objectContaining({ code: 'UNJUSTIFIED_TAG_CHURN' }));
```

Also test:

- accepted `原料`/`打样` need not remain suggestions because they are in `current.tags`;
- an unaffected and unaccepted prior suggestion must remain with the same category/source IDs;
- a new suggestion is allowed when one source is in `affectedSourceIds`;
- an affected or deleted prior suggestion may disappear;
- normalization uses NFKC, trim, and case-insensitive comparison.

- [ ] **Step 2: Run continuity tests and verify RED**

```bash
pnpm --filter @guideanything/api test -- digest-continuity.test.ts
```

Expected: FAIL because tag continuity validation does not exist.

- [ ] **Step 3: Implement continuity validation and repair notes**

Use this error contract:

```ts
export class GuideDigestContinuityValidationError extends Error {
  constructor(readonly code: 'MISSING_UNCHANGED_TAG' | 'UNJUSTIFIED_TAG_CHURN') {
    super(code);
    this.name = 'GuideDigestContinuityValidationError';
  }
}
```

Build normalized maps for `current.tags`, `previousDigest.tagSuggestions`, and `candidateDraft.tagSuggestions`. A prior suggestion is stable only when it is not already current and none of its source IDs is affected; require an exact category and source-ID set match in the candidate. A candidate label is new only when absent from both current tags and the previous suggestion map; require at least one affected source ID. Check missing stable tags first, then unjustified new tags, so repair messages remain deterministic.

Add targeted Chinese repair notes that tell the model to preserve unchanged prior candidates, omit candidates that are now current tags, and only add labels backed by `snapshotDiff.affectedSourceIds`.

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
pnpm --filter @guideanything/api test -- digest-continuity.test.ts guide-digest.test.ts
pnpm --filter @guideanything/api typecheck
```

Expected: focused tests PASS and typecheck exits 0.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/api/src/modules/guides/digest-continuity.ts apps/api/src/modules/guides/digest-continuity.test.ts apps/api/src/modules/agents/bundles/guide-digest.ts apps/api/src/modules/agents/bundles/guide-digest.test.ts
git commit -m "fix: prevent unchanged guide tag churn"
```

---

### Task 5: Integrate continuity, budget fallback, and safe metadata

**Files:**
- Modify: `apps/api/src/modules/guides/digest-service.ts`
- Modify: `apps/api/src/modules/guides/digest-service.test.ts`
- Modify: `apps/api/src/modules/guides/digest-repository.ts`
- Modify: `apps/api/src/modules/guides/digest-repository.test.ts`

**Interfaces:**
- Consumes Tasks 1–4 interfaces.
- Extends safe generation metadata with `continuityMode`, `baselineProposalId`, `baselineRevision`, `changedSourceCount`, and optional `continuityFallbackReason`.
- Keeps the public proposal API shape unchanged because generation metadata is already an extensible safe JSON object.

- [ ] **Step 1: Write failing service integration tests**

Add an integration test that generates an initial proposal, applies its two tags, syncs the new revision, and generates again. Inspect `RecordingRuntime.requests[1].prompt`:

```ts
expect(secondEnvelope).toMatchObject({
  continuity: {
    baselineProposalId: first.proposal.id,
    baselineRevision: first.proposal.baseRevision,
    previousDigest: { tagSuggestions: first.proposal.draft!.tagSuggestions },
    snapshotDiff: {
      fromRevision: first.proposal.baseRevision,
      toRevision: first.proposal.baseRevision + 1,
      affectedSourceIds: [],
    },
  },
  snapshot: { tags: ['订单', '原料', '打样'] },
});
```

Queue churned tags first and a repaired stable output second; assert the first is rejected, the repair request contains the continuity repair note, and only the stable DRAFT persists.

Add cases that:

- skip a latest `REJECTED` proposal and use an earlier trusted proposal;
- use a `STALE` proposal across multiple revision endpoints;
- omit continuity when no trusted baseline exists;
- on explicit regenerate, use the current DRAFT as the baseline before it is superseded;
- fall back to a full prompt when continuity causes `GuideDigestInputTooLargeError` but the full prompt fits;
- preserve existing `GUIDE_DIGEST_INPUT_TOO_LARGE` when the full prompt also exceeds the limit;
- do not persist snapshot/diff/digest bodies in generation metadata.

- [ ] **Step 2: Run service tests and verify RED**

```bash
pnpm --filter @guideanything/api test -- digest-service.test.ts
```

Expected: FAIL because the service sends only the current snapshot and has no continuity metadata/fallback.

- [ ] **Step 3: Resolve and pass optional continuity into generation**

Before calling `generateDigest`, use `findGuideDigestContinuityBaseline()` with the current guide/workspace and no exclusion for explicit regenerate; for an idempotently returned current DRAFT no runtime call occurs. Parse the baseline snapshot with `FlowKnowledgeSnapshotV2Schema` plus `normalizeFlowKnowledgeSnapshot`, verify exact scope and base identity, then compute the direct diff and construct `GuideDigestContinuityContext`.

Change the request builder to return both request and safe mode metadata:

```ts
interface GuideDigestPreparedRequest {
  request: BridgeRunRequestV1;
  continuityMode: 'FULL' | 'RESIDUAL_CONTEXT';
  continuityFallbackReason?: 'CONTINUITY_INPUT_TOO_LARGE' | 'BASELINE_UNAVAILABLE';
}
```

Attempt the continuity request first. Catch only `GuideDigestInputTooLargeError`, rebuild the same attempt without continuity, and re-run the request budget assertion. Let a full-request overflow keep the existing failure. Use the same selected mode for a schema-repair attempt so the repair sees the previous digest and diff.

After current source validation succeeds, call `validateGuideDigestTagContinuity()` when continuity is active. Map its codes through the existing one-repair loop. Render Markdown only from the final validated draft and current snapshot.

- [ ] **Step 4: Persist only safe continuity metadata**

Extend `GenerationMetadataSchema` with:

```ts
continuityMode: z.enum(['FULL', 'RESIDUAL_CONTEXT']).optional(),
baselineProposalId: MetadataScalarSchema.optional(),
baselineRevision: MetadataScalarSchema.optional(),
changedSourceCount: MetadataScalarSchema.optional(),
continuityFallbackReason: z.enum([
  'CONTINUITY_INPUT_TOO_LARGE',
  'BASELINE_UNAVAILABLE',
]).optional(),
```

Populate ID/revision/count/enum only. Never include previous/current snapshot JSON, diff JSON, prompts, model output bodies, runtime request IDs, or run IDs in proposal/audit metadata.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
pnpm --filter @guideanything/api test -- digest-service.test.ts digest-repository.test.ts digest-continuity.test.ts guide-digest.test.ts
pnpm --filter @guideanything/api typecheck
```

Expected: focused tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/api/src/modules/guides/digest-service.ts apps/api/src/modules/guides/digest-service.test.ts apps/api/src/modules/guides/digest-repository.ts apps/api/src/modules/guides/digest-repository.test.ts
git commit -m "feat: generate guide digests with residual context"
```

---

### Task 6: Full validation and evidence review

**Files:**
- Verify all Task 1–5 files.
- Do not modify unrelated dirty files from the original main checkout.

**Interfaces:**
- No new interfaces; this task verifies the complete feature and its boundaries.

- [ ] **Step 1: Run all API and contract tests**

```bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/api test
```

Expected: both suites report zero failures.

- [ ] **Step 2: Run typecheck, build, and lint**

```bash
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/api typecheck
pnpm --filter @guideanything/api build
pnpm lint
```

Expected: every command exits 0.

- [ ] **Step 3: Review repository evidence**

```bash
git diff --check HEAD~5..HEAD
git status --short
git log --oneline --decorate -8
```

Expected: no whitespace errors; only planned feature files and plan/spec commits are present on the feature branch; no secrets, prompt bodies in metadata, database reset, generated artifacts, or unrelated edits.

- [ ] **Step 4: Run the final independent code review**

Generate a review package from the feature branch base through HEAD and dispatch a fresh reviewer. Resolve every Critical or Important finding with focused tests and re-review before completion.

- [ ] **Step 5: Record limitations accurately**

The final handoff must distinguish:

- verified structural diff, prompt-envelope, validator, budget-fallback, and automated test behavior;
- unverified real-model output quality, latency, token use, and live UI behavior unless a real Bridge comparison was actually run;
- the feature branch/worktree state and whether it has or has not been merged to main.

# Semantic Appendix Rails and Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic organization place attached resources outside stage frames and route business edges from semantic stage, lane, and sequence relationships while preserving explicit user endpoint choices.

**Architecture:** `packages/canvas-core` remains the deterministic source of truth for both hierarchy placement and orthogonal routes. The web editor records whether an endpoint is automatic or manually pinned, while the core router resolves automatic sides from semantic relationships and creates a short, direction-safe local channel for pinned endpoints. Stage bounds will be calculated from primary flow nodes only; resource cards will be assigned to a left or right appendix rail outside those bounds.

**Tech Stack:** TypeScript, Zod contracts, React Flow, Vitest, `@guideanything/canvas-core`, React.

## Global Constraints

- Do not add dependencies or change API payload contracts beyond the optional persisted edge-presentation fields described below.
- Preserve explicit manual waypoints (`routeMode: 'manual'`) and treat their endpoint anchors as manual.
- Treat legacy anchor fields with no anchor-mode marker as automatic so existing diagrams can be repaired by the new semantic router.
- Do not stage, commit, push, or alter unrelated dirty files unless the user explicitly asks.
- Keep resource-reference edges out of the business-edge router; their visual attachment edge remains a presentation edge.

---

## File Structure

- Modify `packages/contracts/src/canvas.ts`: add endpoint anchor mode fields to `EdgePresentationSchema` and export the inferred type.
- Modify `packages/canvas-core/src/routing.ts`: derive semantic automatic port sides, honor only manual anchor constraints, and build safe local orthogonal channels.
- Modify `packages/canvas-core/src/routing.test.ts`: cover vertical same-lane flow, stage/lane relationship sides, legacy anchors, and manually pinned endpoints.
- Modify `packages/canvas-core/src/hierarchy.ts`: calculate stage/lane bounds from primary nodes, reserve appendix rail height without enclosing resources, and place attachment groups outside the nearest stage side.
- Modify `packages/canvas-core/src/hierarchy.test.ts`: assert stage bounds exclude attachments and attachments land outside the appropriate side rail.
- Modify `apps/web/src/features/editor/GuideEditor.tsx`: persist an endpoint only when an author uses a continuous anchor/reconnect action; clear endpoint pins with route reset.
- Modify `apps/web/src/features/editor/GuideEditor.test.tsx`: assert default connections remain automatic and continuous-anchor reconnects persist a manual endpoint mode.

### Task 1: Persist only explicit endpoint pins

**Files:**

- Modify: `packages/contracts/src/canvas.ts:124-156`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx:490-575, 650-690, 1810-1850`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**

- Produces `EdgeAnchorMode = 'auto' | 'manual'`.
- Adds optional `sourceAnchorMode?: EdgeAnchorMode` and `targetAnchorMode?: EdgeAnchorMode` to `EdgePresentation`.
- Produces `isManualAnchorHandle(handle)` and `edgePresentationWithAnchors(existing, options)` in the editor.
- A newly created edge from `out`, `yes`, `no`, or `in` stores no endpoint anchor. A connection through `anchor-source-*` or `anchor-target-*` stores the corresponding anchor with mode `manual`.

- [ ] **Step 1: Write failing editor tests for automatic and manual endpoint persistence**

```ts
expect(savedEdge?.presentation?.sourceAnchor).toBeUndefined();
expect(savedEdge?.presentation?.sourceAnchorMode).toBeUndefined();

expect(savedEdge?.presentation).toEqual(expect.objectContaining({
  sourceAnchor: { side: 'BOTTOM', offset: 0.5 },
  sourceAnchorMode: 'manual',
}));
```

- [ ] **Step 2: Run the focused editor test before implementation**

Run: `pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx`

Expected: the new assertions fail because every connection currently saves mouse-derived anchors without a mode.

- [ ] **Step 3: Add the typed presentation fields and editor helper**

```ts
const EdgeAnchorModeSchema = z.enum(['auto', 'manual']);

const EdgePresentationSchema = z.object({
  // existing fields
  sourceAnchor: EdgeAnchorSchema.optional(),
  targetAnchor: EdgeAnchorSchema.optional(),
  sourceAnchorMode: EdgeAnchorModeSchema.optional(),
  targetAnchorMode: EdgeAnchorModeSchema.optional(),
});

function isManualAnchorHandle(handle: string | null | undefined): boolean {
  return Boolean(handle?.startsWith('anchor-source-') || handle?.startsWith('anchor-target-'));
}
```

- [ ] **Step 4: Make connection and reconnect handling mark only explicit pinning**

```ts
const sourceManual = isManualAnchorHandle(source.sourceHandle);
const targetManual = isManualAnchorHandle(connection.targetHandle);
const presentation = edgePresentationWithAnchors(undefined, {
  ...(sourceManual && source.sourceAnchor ? { sourceAnchor: source.sourceAnchor } : {}),
  ...(targetManual && targetAnchor ? { targetAnchor } : {}),
  sourceManual,
  targetManual,
});
```

For reconnects, preserve unchanged endpoint values, replace a changed endpoint only when it uses a continuous anchor, and leave the changed endpoint automatic otherwise. `resetSelectedRoute` must remove `routeMode`, `waypoints`, both anchor values, and both anchor-mode values.

- [ ] **Step 5: Run the focused editor test after implementation**

Run: `pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx`

Expected: PASS, including the default connection and continuous-anchor reconnect cases.

### Task 2: Resolve automatic endpoints from flow semantics and eliminate local U-turns

**Files:**

- Modify: `packages/canvas-core/src/routing.ts:25-170, 245-430`
- Test: `packages/canvas-core/src/routing.test.ts`

**Interfaces:**

- Extends `RouteKind` with `DOWNSTREAM` for same-stage, same-lane, forward vertical steps.
- Produces `isManualAnchor(edge, end)`, `automaticSidesFor(edge, sourceNode, targetNode, sourceRect, targetRect)`, and `safePortClearance(sourceRect, targetRect)`.
- `routeCanvasEdges` uses an anchor only when its endpoint is marked manual or `routeMode === 'manual'`; legacy unmarked anchors are automatic.

- [ ] **Step 1: Write failing core-routing cases**

```ts
expect(route.kind).toBe('DOWNSTREAM');
expect(route.sourceSide).toBe('BOTTOM');
expect(route.targetSide).toBe('TOP');
expect(result.report.avoidedEdgeIds).toEqual([]);
expect(Math.min(...route.points.map((point) => point.y))).toBeGreaterThanOrEqual(0);

expect(manual.sourceSide).toBe('BOTTOM');
expect(manual.targetSide).toBe('TOP');
expect(manual.collision).toBe(false);
```

The manual case uses a 32px vertical gap and non-identical `BOTTOM`/`TOP` offsets, matching the browser regression.

- [ ] **Step 2: Run the focused core-routing test before implementation**

Run: `pnpm --filter @guideanything/canvas-core exec vitest run src/routing.test.ts`

Expected: the same-lane route is classified as `BRANCH` or follows legacy anchors, and the manual-bottom case reports an avoided outer route.

- [ ] **Step 3: Compute semantic automatic sides**

```ts
function automaticSidesFor(edge: CanvasEdge, sourceNode: CanvasNode | undefined, targetNode: CanvasNode | undefined, kind: RouteKind) {
  if (kind === 'DOWNSTREAM' || kind === 'CROSS_STAGE' || kind === 'WRAP') return { source: 'BOTTOM', target: 'TOP' };
  if (kind === 'BRANCH') return edge.sourceHandle === 'yes'
    ? { source: 'RIGHT', target: targetNode && targetNode.position.x > (sourceNode?.position.x ?? 0) ? 'LEFT' : 'TOP' }
    : { source: 'BOTTOM', target: targetNode && targetNode.position.x > (sourceNode?.position.x ?? 0) ? 'LEFT' : 'TOP' };
  if (kind === 'BACK') return { source: 'RIGHT', target: 'RIGHT' };
  return { source: 'RIGHT', target: 'LEFT' };
}
```

Classify a normal semantic `FLOW` edge as `DOWNSTREAM` when source and target share a stage and lane and the target is below the source. Keep `BRANCH`, `RETRY`, `EXCEPTION`, `CROSS_STAGE`, and `WRAP` precedence intact.

- [ ] **Step 4: Replace midpoint-only anchored routing with an outward-safe local channel**

```ts
const clearance = safePortClearance(sourceRect, targetRect);
const sourceExit = extendPort(sourcePort, clearance);
const targetApproach = extendPort(targetPort, clearance);
// Horizontal source port: leave horizontally, then descend/ascend to targetApproach.y.
// Vertical source port: leave vertically, then cross to targetApproach.x.
```

Clamp clearance to half of the nearest positive node-to-node gap so a `BOTTOM -> TOP` connection does not reverse through its own 32px corridor. Select the shortest collision-free local candidate before considering `anchoredOuterRoute`; only real blockers may use the global outer channel.

- [ ] **Step 5: Run the focused core-routing test after implementation**

Run: `pnpm --filter @guideanything/canvas-core exec vitest run src/routing.test.ts`

Expected: PASS with a vertical same-lane route, unchanged branch/back-edge coverage, no outer-loop regression, and manual-anchor preservation.

### Task 3: Move attachment groups to external stage rails

**Files:**

- Modify: `packages/canvas-core/src/hierarchy.ts:33-210, 597-682, 857-1045`
- Test: `packages/canvas-core/src/hierarchy.test.ts`

**Interfaces:**

- `getStageBounds(document)` includes only `isPrimaryFlowNode(node)` nodes.
- `getSwimlaneBounds(document)` sizes lanes from primary flow nodes, not attachment-card width or height.
- `placeContent(content, positioned, contentByParent, stageBounds)` assigns each owner group an external left or right rail.

- [ ] **Step 1: Write failing hierarchy tests for external appendices**

```ts
const stage = result.stageBounds.find((bound) => bound.stageId === 'proposal')!;
const leftResource = byId.get('left-note')!;
const rightResource = byId.get('right-video')!;

expect(leftResource.position.x + 300).toBeLessThan(stage.x);
expect(rightResource.position.x).toBeGreaterThan(stage.x + stage.width);
expect(stage.height).toBeLessThan(rightResource.position.y + 260 - stage.y);
```

Use two owners in one stage, one left of the stage midpoint and one right of it. Assert that resources do not expand the stage border and that later stage nodes do not overlap the rail stack.

- [ ] **Step 2: Run the focused hierarchy test before implementation**

Run: `pnpm --filter @guideanything/canvas-core exec vitest run src/hierarchy.test.ts`

Expected: the resource cards remain inside the stage bounds or all land in the single right-side appendix column.

- [ ] **Step 3: Exclude resources from stage and lane bounds while preserving vertical reservation**

```ts
document.nodes.forEach((node) => {
  if (node.hidden || !isPrimaryFlowNode(node)) return;
  // accumulate configured stage bounds from primary nodes only
});
```

Use the primary-node stage bounds to calculate side rails. Keep semantic row-height reservation based on the total attachment stack per rail, so cards cannot overlap a later row or stage even though the blue frame stays compact.

- [ ] **Step 4: Place each owner appendix outside the nearest stage edge**

```ts
const side = owner.position.x + nodeSize(owner).width / 2 < stage.x + stage.width / 2 ? 'left' : 'right';
const x = side === 'left'
  ? stage.x - CONTENT_GAP_X - groupWidth
  : stage.x + stage.width + CONTENT_GAP_X;
const y = Math.max(owner.position.y, nextYByRail.get(`${stage.stageId}:${side}`) ?? owner.position.y);
```

Sort groups by stage, owner row, owner column, and attachment order. Retain `translateStageNodes` behavior so a stage drag moves its externally attached groups with their owners, while the individual resource nodes remain normally draggable.

- [ ] **Step 5: Run the focused hierarchy test after implementation**

Run: `pnpm --filter @guideanything/canvas-core exec vitest run src/hierarchy.test.ts`

Expected: PASS, with yellow appendix groups outside the blue stage frame and no resource overlap with later stages.

### Task 4: Integrate and verify the real editor

**Files:**

- Modify only files changed in Tasks 1-3 when integration fixes are required.
- Test: `packages/canvas-core/src/routing.test.ts`, `packages/canvas-core/src/hierarchy.test.ts`, `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**

- Consumes the contracts, router, hierarchy, and editor behavior from Tasks 1-3.
- Produces a browser-verified auto-arranged canvas with semantic endpoints and external appendix rails.

- [ ] **Step 1: Run all targeted tests together**

Run: `pnpm --filter @guideanything/canvas-core exec vitest run src/routing.test.ts src/hierarchy.test.ts && pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run type checks for the affected packages**

Run: `pnpm --filter @guideanything/canvas-core typecheck && pnpm --filter @guideanything/web typecheck`

Expected: PASS, or report an unrelated pre-existing dirty-worktree failure separately.

- [ ] **Step 3: Browser smoke test the canonical guide**

Open `http://127.0.0.1:5174/guides/22c6fb40-62dc-43ab-b037-0742330d060f/edit`, click **自动整理**, and verify:

```text
- the start-to-confirm line leaves the start bottom and enters confirm from the top;
- its SVG route does not travel above the stage;
- attached Markdown/Image/Video cards are outside the stage frame;
- selecting and dragging a resource selects the resource rather than stage-dragging;
- no new console errors occur during the interaction.
```

- [ ] **Step 4: Review the final diff without staging it**

Run: `git diff --check && git diff -- packages/contracts/src/canvas.ts packages/canvas-core/src/routing.ts packages/canvas-core/src/routing.test.ts packages/canvas-core/src/hierarchy.ts packages/canvas-core/src/hierarchy.test.ts apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx`

Expected: no whitespace errors and no unrelated-file changes.

## Self-Review

- Stage bounds and lane bounds exclude attached resources: Task 3.
- Left/right external resource rails, ordered attachment groups, and stage-drag alignment: Task 3.
- Same-stage/same-lane vertical edge semantics: Task 2.
- Cross-lane, cross-stage, branch, and back-edge behavior: Task 2 regression coverage.
- Explicit manual endpoint persistence and reset behavior: Task 1.
- Current browser regression and interaction evidence: Task 4.
- No placeholders, dependency additions, staging, commits, or pushes are included.

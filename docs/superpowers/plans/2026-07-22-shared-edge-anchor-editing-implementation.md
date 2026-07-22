# Shared Edge Anchor Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple business edges to intentionally share a node connection point, snap a dragged endpoint to an existing point, and expose endpoint dragging only after the author enters route-edit mode.

**Architecture:** Keep sharing as persisted manual endpoint anchors rather than adding a new document field. The routing layer treats explicitly pinned anchors as stable and orders automatic sibling fan-out by semantic child order. The editor finds nearby displayed endpoints in flow coordinates, persists the snapped anchor for the selected edge and its shared peers, and enables React Flow reconnect controls only while route editing is active.

**Tech Stack:** TypeScript, React, React Flow, Vitest, Testing Library, `@guideanything/canvas-core`, `@guideanything/contracts`.

## Global Constraints

- Preserve `routing: 'straight'` and `routeMode: 'manual'` choices unless the author explicitly edits that edge.
- Do not add a new persisted schema field; existing `sourceAnchor`/`targetAnchor` with manual modes represent shared points.
- Do not enable endpoint dragging merely by selecting a line; only route-edit mode exposes reconnect controls.
- Keep unrelated dirty worktree changes untouched and do not commit or push.

### Task 1: Route-order and shared-anchor invariants

**Files:**
- Modify: `packages/canvas-core/src/routing.ts`
- Test: `packages/canvas-core/src/routing.test.ts`

**Interfaces:**
- `routeCanvasEdges(document: CanvasDocument): RoutingResult` remains unchanged.
- Internal route candidates gain stable semantic ordering and manual-anchor pin metadata.

- [ ] **Step 1: Write the failing tests**

Add a sibling fan-out fixture with a parent and three horizontally aligned children. Give the children outline orders `0`, `1`, and `2`, reverse the edge IDs, and assert the route source anchors and first channel coordinates increase by semantic child order rather than edge ID. Add a second fixture with two edges carrying the same manual source anchor and one automatic sibling; assert the two pinned routes retain the same source point while the automatic route is moved away from that point.

- [ ] **Step 2: Run the focused routing tests and verify failure**

Run:

```bash
pnpm --filter @guideanything/canvas-core exec vitest run src/routing.test.ts
```

Expected: the new semantic-order assertion fails because the current implementation sorts routable edges and endpoint clusters by `edge.id`; the shared-anchor assertion fails because `fanOutSharedPorts` currently redistributes every close endpoint.

- [ ] **Step 3: Implement the minimal routing changes**

Compute a deterministic route-order key from direct child `outline.order`, then semantic edge order, then target position and node index. Use it for routable-edge ordering, endpoint cluster ordering, and shared-channel offsets. Mark persisted manual source/target anchors as pinned. Keep pinned endpoints at their exact offsets; distribute only unpinned neighbors around them, and leave a fully pinned cluster untouched.

- [ ] **Step 4: Run the focused routing tests**

Run the command above and expect all routing tests to pass.

### Task 2: Endpoint snap calculation

**Files:**
- Create: `apps/web/src/features/editor/edge-anchor-snap.ts`
- Create: `apps/web/src/features/editor/edge-anchor-snap.test.ts`

**Interfaces:**
- `findNearestEndpointSnap(document, routesByEdgeId, edgeId, endpoint, nodeId, pointer, threshold?)` returns the nearest existing endpoint anchor and all peer edge IDs at the same displayed point.
- `pointForEndpointAnchor(node, anchor)` converts an anchor to a flow-space point.

- [ ] **Step 1: Write the failing tests**

Cover a pointer within the snap threshold of another source endpoint, a pointer outside the threshold, and two existing edges sharing the same source point. Assert that the result returns the anchor and both peer IDs only for the close case.

- [ ] **Step 2: Run the focused helper test and verify failure**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/editor/edge-anchor-snap.test.ts
```

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Implement the pure snap helper**

Use measured node size or `defaultCanvasNodeSize`, compare flow-space Euclidean distance, ignore the edge currently being edited, restrict candidates to the same endpoint kind and node, and return a stable nearest candidate with all exact-point peers.

- [ ] **Step 4: Run the focused helper test**

Run the command above and expect all helper tests to pass.

### Task 3: Route-edit endpoint interaction

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/OrthogonalEdge.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Test: `apps/web/src/features/editor/OrthogonalEdge.test.tsx`

**Interfaces:**
- Selecting an edge still opens its toolbar and selected styling.
- `manualRouteDraft` is the only state that enables endpoint reconnect controls.
- Reconnect end persists a raw or snapped endpoint anchor and updates the active draft endpoint to the same flow-space point.

- [ ] **Step 1: Write the failing editor and edge-render tests**

Update the existing reconnect-control contract so global reconnectability is false before route editing and true only after clicking `编辑走向`. Assert that the active route renders a visibly larger source endpoint. Add an editor integration case that reconnects an active source near an existing source endpoint and asserts the selected edge plus the peer edge receive equal manual source anchors.

- [ ] **Step 2: Run the focused editor tests and verify failure**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx src/features/editor/OrthogonalEdge.test.tsx
```

Expected: the updated route-edit assertions fail because reconnect is currently disabled globally and the active custom edge only hides passive endpoint dots.

- [ ] **Step 3: Implement the editor interaction**

Pass selected and reconnect-active state separately to `renderEdge`; keep selected styling on toolbar selection, but set `reconnectable` and `endpointMode: 'active'` only for the active manual route draft. Set `edgesReconnectable` from that draft state. On reconnect end, convert the pointer to flow coordinates, call the snap helper, persist manual anchors for the selected endpoint and exact-point peers, and update the route draft’s first or last point. Render active endpoint circles with pointer-events disabled so React Flow’s updater remains draggable.

- [ ] **Step 4: Run the focused editor tests**

Run the command above and expect all updated tests to pass.

### Task 4: Full validation

**Files:**
- Review: `packages/canvas-core/src/routing.ts`
- Review: `apps/web/src/features/editor/edge-anchor-snap.ts`
- Review: `apps/web/src/features/editor/GuideEditor.tsx`
- Review: `apps/web/src/features/editor/OrthogonalEdge.tsx`
- Review: `apps/web/src/styles.css`

- [ ] **Step 1: Run canvas-core and web focused suites**

```bash
pnpm --filter @guideanything/canvas-core exec vitest run
pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx src/features/editor/OrthogonalEdge.test.tsx src/features/editor/ManualRouteEditor.test.tsx src/features/editor/EdgeToolbar.test.tsx
```

- [ ] **Step 2: Run typecheck and build**

```bash
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
```

- [ ] **Step 3: Review the diff and check formatting**

```bash
git diff --check
git diff --stat
git status --short
```

Confirm that only the routing/editor files, focused tests, and this plan are part of this task; do not stage, commit, or push.

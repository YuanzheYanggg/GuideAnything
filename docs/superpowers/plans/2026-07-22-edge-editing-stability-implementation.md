# Edge Style Rendering and Manual Route Editing Stability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the selected edge path style visible even when edges cross, and make manual route editing deterministic and diagnosable when a route approaches or crosses a node.

**Architecture:** Keep `routeCanvasEdges` responsible for route geometry, endpoint allocation, node collision checks, and bridge metadata. Treat `pathStyle` as a renderer choice: edge crossings may affect bridge decoration for orthogonal paths, but they must not automatically disable diagonal or smooth rendering. When manual editing starts, snapshot the currently derived endpoint anchors as auto-mode anchors so the preview and the saved route use the same endpoints. Keep synthetic anchors distinguishable so restoring an automatic route restores automatic endpoint allocation. Expose the blocking node ids in the routing report and raise the edge layer only while route editing is active, so React Flow reconnect handles and manual controls remain reachable above node cards.

**Tech Stack:** TypeScript, React 19, `@xyflow/react`, Zod, Vitest, Testing Library, Vite.

## Global Constraints

- Do not run intelligent layout when creating a node or edge.
- Do not change the persisted document schema; reuse existing `sourceAnchorMode: 'auto'` and `targetAnchorMode: 'auto'` compatibility fields.
- Preserve legacy `routing`, manual waypoints, endpoint snapping, shared anchors, bridge metadata, labels, arrows, colors, patterns, history, and resource decorations.
- A route blocked by a node remains invalid and cannot be saved; the UI must identify the blocking node instead of silently hiding the reason.
- A crossing with another edge is not a node collision and must not force a visual style fallback.
- Use test-first Red-Green-Refactor. Do not claim completion without fresh test/build output and a reviewed diff.
- Do not stage, commit, push, reset, or alter the user’s guide data in SQLite.

## Task 1: Separate style safety from edge-crossing bridge metadata

**Files:**

- Modify: `packages/canvas-core/src/routing.ts`
- Modify: `packages/canvas-core/src/routing.test.ts`
- Modify: `apps/web/src/features/editor/OrthogonalEdge.test.tsx` only if a renderer regression test needs a bridge-bearing route

1. Add a failing core test with two or more orthogonal routes whose canonical paths cross, and assert that a diagonal presentation keeps `directPathSafe` true when the direct segment does not intersect a node. Add a manual diagonal case with a valid manual route and the same expectation.
2. Run the focused routing test and observe the failure caused by the current `hasBridge`/`context.manual` checks.
3. Change `directPathSafe` to represent only direct-path node safety. Do not include `hasBridge` or the automatic/manual context in that boolean. Change `smoothPathSafe` similarly: retain cubic node sampling and endpoint safety, but do not make edge crossings disable the style.
4. Keep `route.bridges` attached to the canonical route. `orthogonalPath` continues to use bridge metadata; diagonal and smooth renderers may cross another edge without being silently converted back to an elbow route.
5. Run the routing and renderer tests. Existing node-obstacle tests must continue to report unsafe direct/smooth geometry.

## Task 2: Pin derived endpoints during manual route editing

**Files:**

- Modify: `packages/canvas-core/src/routing.ts`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/edge-presentation.ts`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/features/editor/edge-presentation.test.ts`

1. Add a failing editor test for an edge without explicit endpoint anchors: entering route edit, moving an internal segment, and saving must persist the endpoint positions used by the draft as `sourceAnchor`/`targetAnchor` with `sourceAnchorMode`/`targetAnchorMode` set to `auto`; the next route calculation must keep those exact endpoint ports while `routeMode` is manual.
2. Run the focused editor test and observe the mismatch between `manualRouteDraft.points` and `manualDraftRouting`.
3. Extend the in-memory manual draft with the route’s current source and target anchors. Build the preview document with those anchors and `routeMode: 'manual'`, and carry them into the saved manual presentation. Existing explicit manual anchors remain unchanged.
4. Make manual mode treat an existing anchor as pinned even when its anchor mode is `auto`, because that `auto` value marks a snapshot created for the manual draft, not a request to re-fan-out the endpoint.
5. Update route reset to remove only synthetic auto anchors together with `routeMode` and `waypoints`; preserve user-authored manual anchors and all visual presentation properties. Add focused tests for both reset cases.

## Task 3: Explain node-blocked manual routes and keep edit controls above nodes

**Files:**

- Modify: `packages/canvas-core/src/routing.ts`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/ManualRouteEditor.tsx`
- Modify: `apps/web/src/features/editor/ManualRouteEditor.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/styles.css`

1. Add a failing routing/editor test that puts a manual waypoint through a sibling node and asserts the report includes the blocking node id; the editor status should expose the node title/identifier in Chinese. Add a test that route-editing mode marks the canvas shell with an editing class.
2. Run the focused tests and observe that the current report only contains `manualConflictEdgeIds`, and that the edge layer has no editing-state stacking rule.
3. Add `manualConflictNodeIdsByEdgeId` to the in-memory `RoutingReport`, populated from the same obstacle/end-node checks that decide whether a manual route is invalid. Keep the existing edge-id report for compatibility.
4. Pass a concise status string into `ManualRouteEditor`, for example `手动路线被节点阻挡：操作步骤（PROCESS · 2.1.2），请把当前线段移到节点外侧`; fall back to the generic message when no node title is available. Keep save disabled while the conflict remains.
5. Add an `is-route-editing` class to the canvas shell only while a manual route draft exists. In CSS, raise `.react-flow__edges` above `.react-flow__nodes` only under that class and enable the relevant reconnect handles. Do not change normal viewing or node-dragging z-order.
6. Preserve the existing screen-space interior route controls and endpoint reconnect callbacks; this change only makes the active edge layer and the diagnostic state reachable/clear.

## Task 4: Validate the integrated behavior

**Files:**

- Review all changed files and tests above; no generated screenshots or guide database files are part of the change.

1. Run the focused canvas-core routing/manual-routing tests and focused web editor tests.
2. Run the affected package type checks and web build.
3. Run `git diff --check`, inspect `git status --short`, and review the diff for accidental data, generated-file, or unrelated UI changes.
4. With the existing local dev server, smoke-test the guide editor: choose diagonal on a crossing edge and confirm the line changes; enter route editing, drag a control toward a card, confirm the blocker is named and save remains unavailable; move it outside the card and confirm save succeeds. Do not modify or publish the user’s guide data as part of validation.

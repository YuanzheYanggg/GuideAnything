# Canvas Edge Intelligent and Manual Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add intelligent default edge routing with a manual route-editing mode that moves only intermediate orthogonal segments while preserving source and target anchors.

**Architecture:** Keep existing automatic routing as the default path in `routeCanvasEdges`. Persist manual intent in optional `EdgePresentation.routeMode` and `EdgePresentation.waypoints`; when present, the routing core validates the fixed-endpoint manual path and falls back to the safe automatic route with a conflict report if it intersects a node. The editor owns an ephemeral draft while dragging, renders segment handles through `ViewportPortal`, and commits one history entry when the user saves.

**Tech Stack:** TypeScript, Zod contracts, React, React Flow, Vitest, Testing Library, existing canvas routing and autosave infrastructure.

## Global Constraints

- Existing `sourceAnchor` and `targetAnchor` remain unchanged and are never moved by manual route editing.
- Missing `routeMode` continues to mean automatic routing for backward compatibility.
- Manual routes use canvas coordinates, not screen coordinates.
- Manual paths must remain orthogonal and must not cross node interiors when committed.
- Existing straight, smart, elbow, deletion, styling, and shortest automatic route behavior must remain passing.
- Do not add a new dependency or modify unrelated editor behavior.

---

### Task 1: Extend the edge presentation contract for manual route intent

**Files:**
- Modify: `packages/contracts/src/canvas.ts:92-104`
- Test: `packages/contracts/src/canvas.test.ts` near the existing edge presentation cases

**Interfaces:**
- Produces `EdgeRouteMode = 'auto' | 'manual'` and optional `routeMode`/`waypoints` fields on `EdgePresentation`.
- Keeps all existing edge presentation fields and old documents valid.

- [x] **Step 1: Write the failing schema tests**

Add tests proving that an existing presentation without route fields still parses, a manual presentation with finite waypoints parses, and an invalid waypoint count or non-finite coordinate is rejected:

```ts
it('accepts backward-compatible automatic edges and manual waypoints', () => {
  expect(EdgePresentationSchema.parse({ routing: 'elbow' })).toEqual({ routing: 'elbow' });
  expect(EdgePresentationSchema.parse({ routeMode: 'manual', waypoints: [{ x: 120, y: 240 }] })).toEqual({
    routeMode: 'manual',
    waypoints: [{ x: 120, y: 240 }],
  });
});

it('rejects invalid manual waypoint data', () => {
  expect(() => EdgePresentationSchema.parse({ routeMode: 'manual', waypoints: [{ x: Number.NaN, y: 0 }] })).toThrow();
  expect(() => EdgePresentationSchema.parse({ routeMode: 'manual', waypoints: Array.from({ length: 33 }, (_, index) => ({ x: index, y: index })) })).toThrow();
});
```

- [x] **Step 2: Run the contract tests and verify the new tests fail**

Run:

```bash
pnpm --filter @guideanything/contracts test -- canvas.test.ts
```

Expected: FAIL because `EdgePresentationSchema` does not yet recognize `routeMode` or `waypoints`.

- [x] **Step 3: Implement the minimal schema change**

Add the following schemas before `EdgePresentationSchema` and include the optional fields. Export `EdgePresentationSchema` so the focused contract tests can exercise the presentation contract directly without duplicating a full document fixture:

```ts
const EdgeRouteModeSchema = z.enum(['auto', 'manual']);
const EdgeWaypointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

// inside EdgePresentationSchema
routeMode: EdgeRouteModeSchema.optional(),
waypoints: z.array(EdgeWaypointSchema).max(32).optional(),
```

Export the inferred types beside the existing `EdgeAnchor`, `EdgeRouting`, and `EdgePresentation` types.

- [x] **Step 4: Run the contract tests and verify they pass**

Run the same command. Expected: all contract tests pass, including the new compatibility and validation cases.

### Task 2: Add fixed-endpoint manual routing and conflict reporting

**Files:**
- Modify: `packages/canvas-core/src/routing.ts:30-160, 470-560`
- Test: `packages/canvas-core/src/routing.test.ts` after the persisted-anchor tests

**Interfaces:**
- Extends `RoutingReport` with `manualConflictEdgeIds: string[]`.
- `routeCanvasEdges` consumes `edge.presentation.routeMode` and `edge.presentation.waypoints`.
- Automatic callers continue to receive the same `OrthogonalRoute` shape and behavior.

- [x] **Step 1: Write failing manual route tests**

Add tests for a valid manual route, fixed endpoints, and a manual route that crosses an obstacle:

```ts
it('uses manual waypoints while preserving the persisted endpoint ports', () => {
  const result = routeCanvasEdges(document(
    [process('source', 0, 0), process('target', 500, 0), process('blocker', 240, -60)],
    [edge('manual', 'source', 'target', {
      presentation: {
        routeMode: 'manual',
        sourceAnchor: { side: 'RIGHT', offset: 0.25 },
        targetAnchor: { side: 'LEFT', offset: 0.75 },
        waypoints: [{ x: 224, y: 25 }, { x: 224, y: 160 }, { x: 476, y: 160 }, { x: 476, y: 75 }],
      },
    })],
  ));
  const route = result.routesByEdgeId.get('manual')!;

  expect(route.points[0]).toEqual({ x: 200, y: 25 });
  expect(route.points.at(-1)).toEqual({ x: 500, y: 75 });
  expect(route.points).toContainEqual({ x: 224, y: 160 });
  expect(result.report.manualConflictEdgeIds).toEqual([]);
  expect(route.collision).toBe(false);
});

it('falls back to a safe automatic route and reports a manual conflict', () => {
  const result = routeCanvasEdges(document(
    [process('source', 0, 0), process('target', 500, 0), { ...process('blocker', 240, 80), size: { width: 240, height: 220 } }],
    [edge('conflict', 'source', 'target', {
      presentation: { routeMode: 'manual', waypoints: [{ x: 224, y: 130 }, { x: 476, y: 130 }] },
    })],
  ));

  expect(result.report.manualConflictEdgeIds).toEqual(['conflict']);
  expect(result.report.collisionEdgeIds).toEqual([]);
  expect(result.routesByEdgeId.get('conflict')!.collision).toBe(false);
});
```

- [x] **Step 2: Run the routing tests and verify they fail**

Run:

```bash
pnpm --filter @guideanything/canvas-core test -- routing.test.ts
```

Expected: FAIL because the report has no manual conflict field and the router ignores `waypoints`.

- [x] **Step 3: Implement manual route selection**

In `routeCanvasEdges`, add `manualConflictEdgeIds` and build a manual candidate when `routeMode === 'manual'` and `waypoints` is present:

```ts
const manualPoints = edge.presentation?.routeMode === 'manual' && edge.presentation.waypoints?.length
  ? compact([sourcePort.point, ...edge.presentation.waypoints, targetPort.point])
  : undefined;
const manualBlocked = manualPoints ? routeBlocked(manualPoints) || !isOrthogonal(manualPoints) : false;
if (manualPoints && !manualBlocked) {
  points = manualPoints;
} else {
  if (manualPoints && manualBlocked) manualConflictEdgeIds.push(edge.id);
  // continue through the existing automatic candidate and fallback selection
}
```

Add a local `isOrthogonal` helper that accepts zero-length segments after compaction and rejects any segment with both non-zero `x` and `y` deltas. Keep endpoint-aware obstacle checking in the existing `routeBlocked` path.

- [x] **Step 4: Run the routing tests and verify they pass**

Run the same command. Expected: all routing tests pass, including existing automatic shortest-route and obstacle tests.

### Task 3: Add tested geometry helpers for draggable route segments

**Files:**
- Create: `packages/canvas-core/src/manual-routing.ts`
- Create: `packages/canvas-core/src/manual-routing.test.ts`
- Modify: `packages/canvas-core/src/index.ts` to export the helpers if the package uses a barrel export

**Interfaces:**
- `editableRouteSegments(points: Point[]): EditableRouteSegment[]`
- `moveRouteSegment(points: Point[], segmentIndex: number, coordinate: number): Point[]`
- `EditableRouteSegment` contains `index`, `orientation`, `start`, `end`, and `midpoint`.

- [x] **Step 1: Write failing geometry tests**

```ts
it('exposes only interior orthogonal segments as editable handles', () => {
  expect(editableRouteSegments([
    { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 120 },
  ])).toEqual([
    expect.objectContaining({ index: 1, orientation: 'vertical' }),
    expect.objectContaining({ index: 2, orientation: 'horizontal' }),
  ]);
});

it('moves a horizontal segment without changing either endpoint', () => {
  const points = [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 120 }];
  expect(moveRouteSegment(points, 2, 160)).toEqual([
    { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 160 }, { x: 200, y: 160 }, { x: 200, y: 120 },
  ]);
  expect(points[0]).toEqual({ x: 0, y: 0 });
  expect(points.at(-1)).toEqual({ x: 200, y: 120 });
});
```

- [x] **Step 2: Run the new geometry tests and verify they fail**

Run:

```bash
pnpm --filter @guideanything/canvas-core test -- manual-routing.test.ts
```

Expected: FAIL because the module and helpers do not yet exist.

- [x] **Step 3: Implement the geometry helpers**

Classify only non-zero segments whose index is greater than `0` and less than `points.length - 2`. `moveRouteSegment` must update the shared coordinate on both points of the selected segment and return a new array without mutating the input. Reject invalid indices and diagonal segments by returning the original point array copy.

- [x] **Step 4: Run the geometry tests and the canvas-core test suite**

Run:

```bash
pnpm --filter @guideanything/canvas-core test -- manual-routing.test.ts routing.test.ts
```

Expected: all new and existing canvas-core tests pass.

### Task 4: Add the manual route editor overlay and toolbar state

**Files:**
- Create: `apps/web/src/features/editor/ManualRouteEditor.tsx`
- Create: `apps/web/src/features/editor/ManualRouteEditor.test.tsx`
- Modify: `apps/web/src/features/editor/EdgeToolbar.tsx:45-135`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx:130-220, 205-220, 840-870`
- Modify: `apps/web/src/styles.css` near the existing edge toolbar and canvas overlay rules

**Interfaces:**
- `ManualRouteEditor` receives `points`, `onMoveSegment`, `conflict`, and `screenToFlowPosition`; save/cancel/reset remain in `EdgeToolbar` so route actions share the existing selected-edge toolbar state.
- `EdgeToolbar` receives optional route-edit callbacks and renders `编辑走向`, `保存走向`, `取消走向`, and `恢复智能路线` actions.

- [x] **Step 1: Write failing component tests**

Cover the interaction contract without relying on React Flow internals:

```tsx
it('renders draggable interior route segments and keeps endpoints locked', () => {
  render(<ManualRouteEditor points={points} conflict={false} onMoveSegment={vi.fn()} screenToFlowPosition={screenToFlowPosition} />);
  expect(screen.getByRole('button', { name: '拖动连线段 1' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '拖动连线端点 0' })).not.toBeInTheDocument();
});

it('blocks save while the draft conflicts with a node', async () => {
  render(<ManualRouteEditor points={points} conflict onMoveSegment={vi.fn()} screenToFlowPosition={screenToFlowPosition} />);
  expect(screen.getByRole('status')).toHaveTextContent('手动路线被节点阻挡');
  expect(screen.getByRole('button', { name: '保存走向' })).toBeDisabled();
});
```

- [x] **Step 2: Run the component tests and verify they fail**

Run:

```bash
pnpm --filter @guideanything/web test -- ManualRouteEditor.test.tsx
```

Expected: FAIL because the component and toolbar callbacks do not yet exist.

- [x] **Step 3: Implement the route editor draft flow**

In `GuideEditor`:

```ts
type ManualRouteDraft = { edgeId: string; points: Point[] };
const [manualRouteDraft, setManualRouteDraft] = useState<ManualRouteDraft | null>(null);
```

On `编辑走向`, initialize `points` from the selected route, including the current automatic route when no manual waypoints exist. While a draft exists, override only the selected edge's rendered route points and compute conflict through a temporary document with `routeMode: 'manual'` and the draft waypoints. Render `ManualRouteEditor` inside `ViewportPortal` so handles use flow coordinates. On save, commit one edge presentation update with `routeMode: 'manual'` and `waypoints: points.slice(1, -1)`. On reset, remove `routeMode` and `waypoints`; on cancel, clear the draft without committing.

The component must use pointer capture or window pointer listeners to convert screen coordinates with `screenToFlowPosition`, constrain a horizontal segment to `y` and a vertical segment to `x`, and snap the coordinate to the existing 20px grid. Stop pointer propagation so dragging a route segment does not pan the canvas or reconnect an edge.

- [x] **Step 4: Implement toolbar and overlay styles**

Add an accessible route-edit action group to `EdgeToolbar`. Render draggable intermediate segment handles and a conflict status message; endpoints remain unrendered and therefore locked. Use existing design tokens and `nodrag nopan nowheel` classes; do not add a second floating toolbar system.

- [ ] **Step 5: Run the component tests and the relevant editor suite**

Run:

```bash
pnpm --filter @guideanything/web test -- ManualRouteEditor.test.tsx GuideEditor.test.tsx EdgeToolbar.test.tsx
```

Expected: all route editor, guide editor, and edge toolbar tests pass.

### Task 5: Integrate persistence, playback, and conflict behavior

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx` save/commit and route rendering paths
- Modify: `apps/web/src/features/lesson/LessonPage.tsx` only if its route rendering does not already consume the shared `routeCanvasEdges` output
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx` and `apps/web/src/features/lesson/LessonPage.test.tsx`

**Interfaces:**
- Saved manual routes load through `CanvasDocumentSchema` and render identically in editor and lesson playback.
- A manual conflict is surfaced as a non-blocking editor warning while the visible route remains safe.

- [ ] **Step 1: Write failing persistence and conflict tests**

Add tests that save `routeMode: 'manual'` and `waypoints`, reload the document through `createApi`, and verify the editor uses the saved path. Add a node-move case where the route becomes blocked and verify the automatic safe route is rendered while the conflict status is visible.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --filter @guideanything/web test -- GuideEditor.test.tsx LessonPage.test.tsx
```

Expected: FAIL because manual route fields are not yet wired through the editor and conflict status is not yet rendered.

- [ ] **Step 3: Implement persistence and playback wiring**

Ensure `commit` and autosave validate the new fields through `CanvasDocumentSchema`, preserve them during undo/redo, and use the shared routing output in the lesson page. Clear the warning only when the manual route is removed or becomes valid again.

- [ ] **Step 4: Run the persistence and playback tests**

Run the same command. Expected: all editor and lesson tests pass.

### Task 6: Full verification and browser QA

**Files:**
- Test: existing canvas-core and web test suites; no new source file unless a focused regression is found

- [ ] **Step 1: Run the complete validation suite**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
git diff --check
```

Expected: all commands exit with code 0.

- [ ] **Step 2: Verify the real editor in the browser**

Use the existing local editor page and verify:

1. An untouched edge starts in intelligent automatic mode.
2. Selecting the edge and entering “编辑走向” displays only intermediate segment handles.
3. Dragging a horizontal handle changes the route from above to below while source and target port coordinates remain unchanged.
4. A path that crosses a node shows the conflict message and cannot be saved.
5. Saving, refreshing, undoing, and resetting to intelligent route preserve the expected state.

- [ ] **Step 3: Review the final diff**

Confirm that only the contract, routing core, editor route controls, focused tests, the approved design document, and this implementation plan changed. Do not commit or push without explicit user approval.

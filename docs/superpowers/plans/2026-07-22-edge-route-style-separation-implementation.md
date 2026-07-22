# Edge Route and Visual Style Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Separate safe route skeletons from edge visual styles so automatic business edges are always orthogonal, while preserving manual route editing, anchors, fan-out, bridges, and existing visual details.

**Architecture:** Keep routeCanvasEdges as the sole authority for semantic routing, endpoint allocation, node avoidance, and manual waypoint validation. Add a visual-only pathStyle to the persisted edge, return safety-checked style geometry with each OrthogonalRoute, and let the custom edge renderer choose folded, genuine smooth cubic, or safe diagonal SVG output without rewriting the route skeleton. The editor toolbar writes only pathStyle; route reset is a separate operation that removes manual waypoints while retaining anchors and visual style.

**Tech Stack:** TypeScript, Zod, React 19, @xyflow/react, Vitest, Testing Library, Vite.

## Global Constraints

- Do not automatically run node layout when a node or edge is created.
- All automatic route geometry must be horizontal and/or vertical; no automatic diagonal segment is allowed.
- Keep existing documents parseable and preserve explicit legacy routing: straight as a diagonal visual preference only.
- Preserve semantic ordering, fan-out, shared endpoint anchors, endpoint snapping, manual routes, obstacle avoidance, bridges, labels, arrows, colors, patterns, resource decorations, history, and persistence.
- A style safety fallback must not mutate the saved document.
- Use test-first Red-Green-Refactor; do not write production code before the corresponding failing test has been observed.
- Do not stage or commit unrelated worktree changes; stage exact files only.

---

### Task 1: Add a backward-compatible visual-style contract

**Files:**

- Modify: packages/contracts/src/canvas.ts:134-165
- Modify: packages/contracts/src/canvas.test.ts:318-378
- Modify: packages/canvas-core/src/hierarchy.ts:316-327
- Modify: packages/canvas-core/src/hierarchy.test.ts

**Interfaces:**

- Produces EdgePathStyle = orthogonal | smooth | diagonal.
- Produces resolveEdgePathStyle(presentation?: EdgePresentation): EdgePathStyle from @guideanything/contracts.
- Explicit pathStyle wins. A legacy routing: straight resolves to diagonal; every other legacy or omitted routing resolves to orthogonal.
- Derived hierarchy presentation strips pathStyle together with routing, waypoints, and anchors.

- [ ] **Step 1: Write the failing contract and hierarchy tests**

Add to packages/contracts/src/canvas.test.ts:

~~~ts
it('accepts an explicit path style and resolves legacy routing without migration', () => {
  expect(EdgePresentationSchema.parse({ pathStyle: 'smooth' })).toEqual({ pathStyle: 'smooth' });
  expect(resolveEdgePathStyle({ pathStyle: 'orthogonal', routing: 'straight' })).toBe('orthogonal');
  expect(resolveEdgePathStyle({ routing: 'straight' })).toBe('diagonal');
  expect(resolveEdgePathStyle({ routing: 'smart' })).toBe('orthogonal');
  expect(resolveEdgePathStyle(undefined)).toBe('orthogonal');
});

it('rejects an unknown path style', () => {
  expect(() => EdgePresentationSchema.parse({ pathStyle: 'rounded' })).toThrow();
});
~~~

Add a hierarchy test whose source presentation contains pathStyle: smooth, routeMode: manual, and waypoints. Assert that the derived hierarchy decoration style contains none of those route fields.

- [ ] **Step 2: Run tests and verify Red**

Run:

~~~bash
pnpm --filter @guideanything/contracts test -- src/canvas.test.ts
pnpm --filter @guideanything/canvas-core test -- src/hierarchy.test.ts
~~~

Expected: the contract test fails because pathStyle and resolveEdgePathStyle do not exist; the hierarchy assertion fails because pathStyle is retained.

- [ ] **Step 3: Implement the smallest shared contract**

In packages/contracts/src/canvas.ts, add:

~~~ts
const EdgePathStyleSchema = z.enum(['orthogonal', 'smooth', 'diagonal']);

export type EdgePathStyle = z.infer<typeof EdgePathStyleSchema>;

export function resolveEdgePathStyle(presentation: EdgePresentation | undefined): EdgePathStyle {
  if (presentation?.pathStyle) return presentation.pathStyle;
  return presentation?.routing === 'straight' ? 'diagonal' : 'orthogonal';
}
~~~

Add pathStyle: EdgePathStyleSchema.optional() to EdgePresentationSchema. In packages/canvas-core/src/hierarchy.ts, destructure pathStyle with routing, routeMode, waypoints, and anchor fields before style is copied into a hierarchy artifact.

- [ ] **Step 4: Run focused tests and type checks to verify Green**

~~~bash
pnpm --filter @guideanything/contracts test -- src/canvas.test.ts
pnpm --filter @guideanything/canvas-core test -- src/hierarchy.test.ts
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/canvas-core typecheck
~~~

Expected: all commands pass.

- [ ] **Step 5: Commit only reviewed task hunks**

The worktree is already mixed. Review and stage only the hunks created by this task before committing:

~~~bash
git diff -- packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts packages/canvas-core/src/hierarchy.ts packages/canvas-core/src/hierarchy.test.ts
git add -p -- packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts packages/canvas-core/src/hierarchy.ts packages/canvas-core/src/hierarchy.test.ts
git diff --cached --check
git diff --cached -- packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts packages/canvas-core/src/hierarchy.ts packages/canvas-core/src/hierarchy.test.ts
git commit -m "feat: add edge path style contract"
~~~

### Task 2: Make automatic route skeletons strictly orthogonal and expose safe style geometry

**Files:**

- Modify: packages/canvas-core/src/routing.ts:1-238
- Modify: packages/canvas-core/src/routing.test.ts:14-520

**Interfaces:**

- Extends OrthogonalRoute with pathStyle, directPath, directPathSafe, smoothSegments, and smoothPathSafe.
- Retains routing: EdgeRouting for compatibility and diagnostics but does not use it to select automatic geometry.
- Produces CubicBezierSegment values with start, control1, control2, and end.
- Valid manual routes remain authoritative and orthogonal.

- [ ] **Step 1: Write failing routing tests**

Add a local helper:

~~~ts
function expectOrthogonal(points: Point[]) {
  expect(points.every((point, index) =>
    index === 0 || point.x === points[index - 1]!.x || point.y === points[index - 1]!.y,
  )).toBe(true);
}
~~~

Add these test shapes:

~~~ts
it.each(['straight', 'smart'] as const)('keeps legacy %s automatic geometry orthogonal', (routing) => {
  const result = routeCanvasEdges(document(
    [process('source', 0, 0), process('target', 420, 180)],
    [edge('route', 'source', 'target', { presentation: { routing } })],
  ));
  expectOrthogonal(result.routesByEdgeId.get('route')!.points);
});

it('collapses aligned automatic endpoints to one real horizontal segment', () => {
  const result = routeCanvasEdges(document(
    [process('source', 0, 0), process('target', 420, 0)],
    [edge('route', 'source', 'target')],
  ));
  const route = result.routesByEdgeId.get('route')!;
  expect(route.points).toHaveLength(2);
  expect(route.points[0]!.y).toBe(route.points[1]!.y);
});

it('keeps manual waypoints authoritative after selecting smooth style', () => {
  const manualWaypoints = [{ x: 100, y: 160 }, { x: 500, y: 160 }, { x: 500, y: 350 }];
  const result = routeCanvasEdges(document(
    [process('source', 0, 0), process('target', 600, 300)],
    [edge('route', 'source', 'target', {
      presentation: { pathStyle: 'smooth', routeMode: 'manual', waypoints: manualWaypoints },
    })],
  ));
  const route = result.routesByEdgeId.get('route')!;
  expect(route.pathStyle).toBe('smooth');
  expect(route.points.slice(1, -1)).toEqual(manualWaypoints);
  expectOrthogonal(route.points);
});
~~~

Add one obstacle fixture that asserts a diagonal style has directPathSafe false. Add one clear non-aligned fixture that asserts smoothSegments contains cubic geometry, its first control point travels outward from sourceSide, and sampled cubic points avoid the fixture obstacle.

- [ ] **Step 2: Run routing tests and verify Red**

~~~bash
pnpm --filter @guideanything/canvas-core test -- src/routing.test.ts
~~~

Expected: tests fail because straight and smart still select direct diagonal points and the style geometry fields do not exist.

- [ ] **Step 3: Implement canonical routing and style geometry**

Keep the legacy routing field but replace its direct-line selection with orthogonal candidates:

~~~ts
const automaticPoints = chooseShortestRoute(clearElbowCandidates) ?? elbowCandidates[0]!;
const points = manualPoints && !manualBlocked ? manualPoints : automaticPoints;
~~~

After bridge annotation, attach geometry computed from the final skeleton:

~~~ts
{
  pathStyle: resolveEdgePathStyle(edge.presentation),
  directPath: [sourcePort.point, targetPort.point],
  directPathSafe: !routeBlocked(directPoints) && route.bridges.length === 0,
  smoothSegments,
  smoothPathSafe: smoothSegments.length > 0
    && !routeBlocked(sampleCubicSegments(smoothSegments))
    && route.bridges.length === 0,
}
~~~

Generate cubic segments from the skeleton guide points. The first tangent follows sourceSide; the last tangent is the inward inverse of targetSide. Intermediate guide points share a tangent so adjacent cubic segments join continuously. Sample every cubic at a fixed bounded density before applying the existing node-obstacle and endpoint-clearance checks. If sampling is unsafe, set smoothPathSafe false and preserve canonical points unchanged.

- [ ] **Step 4: Run routing regressions and type check to verify Green**

~~~bash
pnpm --filter @guideanything/canvas-core test -- src/routing.test.ts src/manual-routing.test.ts src/hierarchy.test.ts
pnpm --filter @guideanything/canvas-core typecheck
~~~

Expected: new geometry tests pass; fan-out, shared anchors, manual routes, collisions, and bridges remain green.

- [ ] **Step 5: Commit only reviewed routing hunks**

~~~bash
git diff -- packages/canvas-core/src/routing.ts packages/canvas-core/src/routing.test.ts
git add -p -- packages/canvas-core/src/routing.ts packages/canvas-core/src/routing.test.ts
git diff --cached --check
git diff --cached -- packages/canvas-core/src/routing.ts packages/canvas-core/src/routing.test.ts
git commit -m "feat: keep automatic edge routes orthogonal"
~~~

### Task 3: Render genuine smooth curves and safe diagonal fallbacks

**Files:**

- Modify: apps/web/src/features/editor/OrthogonalEdge.tsx:1-188
- Modify: apps/web/src/features/editor/OrthogonalEdge.test.tsx
- Modify: apps/web/src/features/lesson/LessonMap.tsx:61-250
- Modify: apps/web/src/features/lesson/LessonMap.test.tsx

**Interfaces:**

- OrthogonalEdge selects an SVG path from OrthogonalRoute style geometry.
- The editor and lesson map reuse the same custom edge renderer.
- Labels and endpoint updater circles continue to use canonical route.points.

- [ ] **Step 1: Write failing renderer tests**

Add pure renderer assertions:

~~~ts
expect(renderRoutePath({ ...route, pathStyle: 'smooth', smoothPathSafe: true, smoothSegments })).toContain('C');
expect(renderRoutePath({ ...route, pathStyle: 'diagonal', directPathSafe: true, directPath })).toBe('M 10 20 L 210 120');
expect(renderRoutePath({ ...route, pathStyle: 'diagonal', directPathSafe: false, directPath })).toContain('Q');
~~~

Add an aligned two-point route test: smooth and diagonal must still render one exact L segment, not a visible curve. In LessonMap.test.tsx, assert that a persisted smooth business edge reaches OrthogonalEdge with the resolved route style while a hierarchy presentation edge remains non-selectable.

- [ ] **Step 2: Run renderer tests and verify Red**

~~~bash
pnpm --filter @guideanything/web test -- src/features/editor/OrthogonalEdge.test.tsx src/features/lesson/LessonMap.test.tsx
~~~

Expected: tests fail because OrthogonalEdge always calls orthogonalPath.

- [ ] **Step 3: Implement style-aware SVG rendering**

Add an exported pure renderer helper:

~~~ts
export function renderRoutePath(route: OrthogonalRoute | undefined, fallback: Point[]): string {
  const points = route?.points ?? fallback;
  if (!route || points.length < 2) return orthogonalPath(points, 12, route?.bridges ?? []);
  if (route.pathStyle === 'diagonal' && route.directPathSafe) return linePath(route.directPath);
  if (route.pathStyle === 'smooth' && route.smoothPathSafe) return cubicPath(route.smoothSegments);
  return orthogonalPath(points, 12, route.bridges);
}
~~~

cubicPath emits SVG C commands and preserves exact endpoints. linePath emits one SVG L command. Do not change label placement, endpoint circles, updater synchronization, markers, pointer behavior, or LessonMap handle wiring.

- [ ] **Step 4: Run renderer tests and type check to verify Green**

~~~bash
pnpm --filter @guideanything/web test -- src/features/editor/OrthogonalEdge.test.tsx src/features/lesson/LessonMap.test.tsx
pnpm --filter @guideanything/web typecheck
~~~

Expected: smooth style emits real cubic curves; unsafe styles retain a visible folded fallback; lesson playback and editor agree.

- [ ] **Step 5: Commit only reviewed renderer hunks**

~~~bash
git diff -- apps/web/src/features/editor/OrthogonalEdge.tsx apps/web/src/features/editor/OrthogonalEdge.test.tsx apps/web/src/features/lesson/LessonMap.tsx apps/web/src/features/lesson/LessonMap.test.tsx
git add -p -- apps/web/src/features/editor/OrthogonalEdge.tsx apps/web/src/features/editor/OrthogonalEdge.test.tsx apps/web/src/features/lesson/LessonMap.tsx apps/web/src/features/lesson/LessonMap.test.tsx
git diff --cached --check
git diff --cached -- apps/web/src/features/editor/OrthogonalEdge.tsx apps/web/src/features/editor/OrthogonalEdge.test.tsx apps/web/src/features/lesson/LessonMap.tsx apps/web/src/features/lesson/LessonMap.test.tsx
git commit -m "feat: render edge path styles safely"
~~~

### Task 4: Separate visual-style selection from route editing

**Files:**

- Modify: apps/web/src/features/editor/EdgeToolbar.tsx:28-182
- Modify: apps/web/src/features/editor/EdgeToolbar.test.tsx:94-159
- Modify: apps/web/src/features/editor/edge-presentation.ts:33-50
- Modify: apps/web/src/features/editor/edge-presentation.test.ts
- Modify: apps/web/src/features/editor/GuideEditor.tsx:389-400,719-800,1573-1599,2031-2115
- Modify: apps/web/src/features/editor/GuideEditor.test.tsx:1850-2040
- Modify: apps/web/src/styles.css:452-459

**Interfaces:**

- EdgeToolbar emits pathStyle from a menu labelled 选择画线风格.
- edgePresentationForPathStyle writes only pathStyle.
- resetEdgeRoutePresentation removes routeMode and waypoints while preserving pathStyle and endpoint anchors.
- Manual route save keeps pathStyle and does not force routing: elbow.

- [ ] **Step 1: Write failing toolbar, presentation, and editor tests**

Replace the routing-selector expectation with:

~~~tsx
it('selects a visual path style without clearing manual geometry', async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<EdgeToolbar presentation={{ routeMode: 'manual', waypoints: [{ x: 120, y: 80 }] }} onChange={onChange} onClose={vi.fn()} />);

  await user.click(screen.getByRole('button', { name: '选择画线风格' }));
  await user.click(screen.getByRole('button', { name: '平滑曲线' }));

  expect(onChange).toHaveBeenLastCalledWith({ pathStyle: 'smooth' });
});
~~~

Add pure helper checks:

~~~ts
expect(edgePresentationForPathStyle(manualPresentation, 'smooth')).toEqual({
  ...manualPresentation,
  pathStyle: 'smooth',
});
expect(resetEdgeRoutePresentation(manualPresentation)).toEqual({
  pathStyle: 'smooth',
  sourceAnchor: manualPresentation.sourceAnchor,
  sourceAnchorMode: 'manual',
});
~~~

Update GuideEditor tests so choosing 平滑曲线 saves pathStyle: smooth with unchanged manual waypoints and anchors. Update reset assertions so routeMode and waypoints are removed while pathStyle, arrows, color, and anchors remain. Assert the action text is 恢复自动走线.

- [ ] **Step 2: Run UI tests and verify Red**

~~~bash
pnpm --filter @guideanything/web test -- src/features/editor/EdgeToolbar.test.tsx src/features/editor/edge-presentation.test.ts src/features/editor/GuideEditor.test.tsx
~~~

Expected: tests fail because the toolbar emits routing, its helper clears manual data, and reset writes routing: smart.

- [ ] **Step 3: Implement separated editor state**

Replace routing options with:

~~~ts
const pathStyleOptions = [
  ['orthogonal', '折线'],
  ['smooth', '平滑曲线'],
  ['diagonal', '斜线'],
] as const;
~~~

Rename menu identifiers and accessible labels from routing and 连线路由 to pathStyle and 画线风格. Use a continuous C-shaped preview for smooth and a direct diagonal preview for diagonal.

Replace edgePresentationForRouting with:

~~~ts
export function edgePresentationForPathStyle(presentation: EdgePresentation | undefined, pathStyle: EdgePathStyle): EdgePresentation {
  return { ...presentation, pathStyle };
}

export function resetEdgeRoutePresentation(presentation: EdgePresentation | undefined): EdgePresentation | undefined {
  const { routeMode: _routeMode, waypoints: _waypoints, ...remaining } = presentation ?? {};
  return Object.keys(remaining).length > 0 ? remaining : undefined;
}
~~~

In GuideEditor, use the style helper only for partial.pathStyle. Preserve pathStyle in manualRouteDocument, finishManualRouteSegment, and saveManualRouteEdit. Stop writing routing: elbow as part of manual editing. Use resetEdgeRoutePresentation for reset and relabel it 恢复自动走线. Rename CSS routing-preview selectors to path-style-preview without changing toolbar placement or mobile layout.

- [ ] **Step 4: Run UI tests and type check to verify Green**

~~~bash
pnpm --filter @guideanything/web test -- src/features/editor/EdgeToolbar.test.tsx src/features/editor/edge-presentation.test.ts src/features/editor/GuideEditor.test.tsx
pnpm --filter @guideanything/web typecheck
~~~

Expected: selecting a style does not clear route data; endpoint editing and shared-anchor tests remain green; reset only clears manual geometry.

- [ ] **Step 5: Commit only reviewed editor hunks**

~~~bash
git diff -- apps/web/src/features/editor/EdgeToolbar.tsx apps/web/src/features/editor/EdgeToolbar.test.tsx apps/web/src/features/editor/edge-presentation.ts apps/web/src/features/editor/edge-presentation.test.ts apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
git add -p -- apps/web/src/features/editor/EdgeToolbar.tsx apps/web/src/features/editor/EdgeToolbar.test.tsx apps/web/src/features/editor/edge-presentation.ts apps/web/src/features/editor/edge-presentation.test.ts apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
git diff --cached --check
git diff --cached -- apps/web/src/features/editor/EdgeToolbar.tsx apps/web/src/features/editor/EdgeToolbar.test.tsx apps/web/src/features/editor/edge-presentation.ts apps/web/src/features/editor/edge-presentation.test.ts apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
git commit -m "feat: separate edge styles from route editing"
~~~

### Task 5: Run complete regression and browser acceptance checks

**Files:**

- Modify only if a regression is found in the scoped files listed in Tasks 1-4.
- Verify: packages/contracts/src/canvas.test.ts
- Verify: packages/canvas-core/src/routing.test.ts
- Verify: apps/web/src/features/editor/GuideEditor.test.tsx
- Verify: apps/web/src/features/lesson/LessonMap.test.tsx

**Interfaces:**

- Confirms editor and lesson viewer render the same saved style and safety fallback.
- Confirms no unrelated worktree changes are staged or committed.

- [ ] **Step 1: Run package-level regressions**

~~~bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/canvas-core test
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/web build
git diff --check
~~~

Expected: all relevant suites and build pass; the diff check reports no whitespace errors.

- [ ] **Step 2: Run live browser acceptance**

Use the repository's real local development stack, never a fake stack. Before reusing a port, inspect its listener owner and command. Verify:

1. Same-row and same-column nodes show one real horizontal or vertical segment.
2. A non-aligned automatic edge is folded and contains no diagonal segment.
3. 平滑曲线 renders a continuous curve rather than rounded orthogonal corners.
4. A curve or diagonal blocked by a node falls back visibly to folded routing.
5. 编辑走向 still exposes active endpoints and segment controls.
6. Endpoint snapping still shares a nearby anchor.
7. A crossing orthogonal route still shows its bridge.
8. A hierarchy/resource decoration edge remains non-editable.

- [ ] **Step 3: Review evidence and final diff**

~~~bash
git status --short
git diff --check
git diff --stat
~~~

Report changed files, test/build results, browser observations, any observed fallback, and remaining limitations. Do not stage or commit unrelated files.

- [ ] **Step 4: Keep final regression fixes within their originating task commit**

If browser QA exposes a regression, add a focused test first and repair the matching Task 1-4 file set. Re-run that task's focused command and stage only the reviewed hunk with git add -p. Do not create a generic final commit in this already mixed worktree.

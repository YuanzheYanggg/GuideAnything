# Screen-Space Canvas Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep canvas action surfaces legible at every React Flow zoom level, remove the intrusive selected-node outline, and make the business-flow sidebar collapsible.

**Architecture:** Retain canvas coordinates as the source of truth, but render interaction surfaces in a sibling overlay that is outside React Flow's transformed viewport. Convert each canvas anchor to screen-relative coordinates from the live viewport so the overlay follows pan and zoom while its CSS pixel size stays constant. Keep hierarchy visibility as local editor UI state; it changes layout only and is never persisted into a guide document.

**Tech Stack:** React, TypeScript, React Flow, Vitest, Testing Library, CSS custom properties.

## Global Constraints

- Keep all guide document schema and persisted canvas data unchanged.
- Reuse the existing isolated worktree and preserve unrelated dirty files.
- Do not add UI dependencies.
- Screen controls use a 56px toolbar, 40px touch targets, 22px icons, and 10px group/menu spacing.
- Follow TDD: each behavior test must fail before its implementation change.

---

### Task 1: Create a reusable screen-space anchor conversion boundary

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**
- Consumes: React Flow viewport `{ x: number; y: number; zoom: number }`, canvas point `{ x: number; y: number }`, and the canvas-shell bounding rectangle.
- Produces: an overlay-local pixel point used by toolbar, creation, and label controls.

- [ ] **Step 1: Write failing tests**

Add a test that renders the editor with a selected business edge and asserts its toolbar is outside `.react-flow__viewport`. Add a second test that invokes the editor's viewport update path and asserts the overlay anchor position changes without applying a CSS scale to the toolbar.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/editor/GuideEditor.test.tsx`

Expected: FAIL because the toolbar is currently rendered inside `ViewportPortal`.

- [ ] **Step 3: Implement the screen overlay**

Add a canvas-shell ref and live viewport state. Convert world coordinates with:

```ts
function screenOverlayPoint(point, viewport, shellRect) {
  return {
    x: point.x * viewport.zoom + viewport.x - shellRect.left,
    y: point.y * viewport.zoom + viewport.y - shellRect.top,
  };
}
```

Move `CanvasCreationMenu`, `EdgeLabelEditor`, and `EdgeToolbarAtRoute` out of `ViewportPortal` into a non-transformed `.canvas-screen-overlay`. Keep stage and swimlane decorations in `ViewportPortal`.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run src/features/editor/GuideEditor.test.tsx`

Expected: PASS.

### Task 2: Increase control hierarchy and prevent zoom-driven sizing

**Files:**
- Modify: `apps/web/src/features/editor/EdgeToolbar.tsx`
- Modify: `apps/web/src/features/editor/CanvasCreationMenu.tsx`
- Modify: `apps/web/src/features/editor/EdgeLabelEditor.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/editor/EdgeToolbar.test.tsx`

**Interfaces:**
- Consumes: existing accessible button/menu labels and overlay-local positions.
- Produces: fixed-size, readable toolbar and menus at all canvas zoom levels.

- [ ] **Step 1: Write failing tests**

Add tests asserting the toolbar exposes the four style triggers with a `data-size="screen"` marker and that the creation menu remains an accessible menu when rendered through the screen overlay.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/editor/EdgeToolbar.test.tsx src/features/editor/GuideEditor.test.tsx`

Expected: FAIL because the marker and screen-overlay rendering do not yet exist.

- [ ] **Step 3: Implement readable control geometry**

Mark the toolbar as a screen-sized surface. Set toolbar height to 56px, controls to 40px, icons to 22px, group gaps to 10px, and dividers to 20px. Set color/style popover cells to 40px with 10px placement offset. Set the creation menu to 244px minimum width with 40px menu rows and 14px labels. Keep the label dialog in the same overlay.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run src/features/editor/EdgeToolbar.test.tsx src/features/editor/GuideEditor.test.tsx`

Expected: PASS.

### Task 3: Remove node selection outline and add sidebar visibility state

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**
- Consumes: editor-local `hierarchyOpen: boolean`.
- Produces: a default-collapsed hierarchy panel controlled by `展开业务流程` and `收起业务流程` buttons.

- [ ] **Step 1: Write failing tests**

Add a test asserting the panel starts collapsed, its expand button is available, and clicking it exposes the `流程结构` tree; assert the inverse control collapses it. Add a DOM assertion that a selected node has no outer `outline` rule from the application stylesheet contract.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/editor/GuideEditor.test.tsx`

Expected: FAIL because the sidebar is always rendered and selected nodes use a three-pixel accent outline.

- [ ] **Step 3: Implement the local layout behavior**

Initialize `hierarchyOpen` to `false`. Add an editor-workspace modifier class, a left-edge toggle within the canvas shell, and a collapsed sidebar transform that returns layout width to the canvas. Remove only `.react-flow__node.selected .canvas-node`'s outer outline; preserve input focus and hover feedback.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run src/features/editor/GuideEditor.test.tsx`

Expected: PASS.

### Task 4: Validate the integrated UI

**Files:**
- Modify: test files only if a regression is discovered.

- [ ] **Step 1: Run the web test suite**

Run: `pnpm --filter @guideanything/web test`

Expected: all tests pass.

- [ ] **Step 2: Run static and production validation**

Run: `pnpm --filter @guideanything/web typecheck && pnpm --filter @guideanything/web build && git diff --check`

Expected: all commands succeed with no diff whitespace errors.

- [ ] **Step 3: Browser acceptance**

Verify at low and high canvas zoom that the toolbar and connection-creation menu retain their 56px/40px screen geometry, the selected node has no blue outer outline, and the sidebar starts hidden then expands/collapses without console errors.

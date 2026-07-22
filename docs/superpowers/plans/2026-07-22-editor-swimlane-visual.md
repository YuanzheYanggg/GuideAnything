# Editor Vertical Swimlanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subtle, viewport-synchronized vertical swimlane layer to the GuideAnything editor so nodes sharing a responsibility lane are visually grouped without changing document behavior.

**Architecture:** Reuse `getSwimlaneBounds(renderedDocument)` from `@guideanything/canvas-core` and render the result through a focused `CanvasSwimlanes` presentational component inside the existing `ViewportPortal`. Style the layer as non-interactive dark-tech canvas decoration, leaving node, edge, selection, and persistence code untouched.

**Tech Stack:** React, TypeScript, `@xyflow/react` `ViewportPortal`, Vitest + Testing Library, existing CSS custom properties and React Bits visual language.

## Global Constraints

- Do not change `CanvasDocument`, `FlowLane`, `laneId`, or persistence schemas.
- Do not add a runtime dependency.
- `CanvasSwimlanes` must be decorative: `aria-hidden="true"` and `pointer-events: none`.
- Use the existing `getSwimlaneBounds` geometry; do not derive a second lane layout or move nodes.
- Preserve unrelated dirty worktree changes; do not commit or push.

---

### Task 1: Add the focused swimlane renderer and regression tests

**Files:**
- Create: `apps/web/src/features/editor/CanvasSwimlanes.tsx`
- Create: `apps/web/src/features/editor/CanvasSwimlanes.test.tsx`

**Interfaces:**
- Consumes: `SwimlaneBounds[]` from `@guideanything/canvas-core`.
- Produces: one decorative `.canvas-swimlane` element per bound with `data-lane-id`, title, and kind label.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CanvasSwimlanes } from './CanvasSwimlanes';

describe('CanvasSwimlanes', () => {
  it('renders configured and unassigned lane bounds as decorative columns', () => {
    render(<CanvasSwimlanes bounds={[
      { laneId: 'sales', title: '业务', kind: 'ROLE', x: 0, y: -40, width: 320, height: 720 },
      { laneId: null, title: '未分配责任', kind: null, x: 392, y: -40, width: 320, height: 720 },
    ]} />);

    expect(screen.getAllByTestId('canvas-swimlane')).toHaveLength(2);
    expect(screen.getByTestId('canvas-swimlane-sales')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('canvas-swimlane-sales')).toHaveAttribute('data-lane-kind', 'ROLE');
    expect(screen.getByTestId('canvas-swimlane-sales')).toHaveTextContent('业务');
    expect(screen.getByTestId('canvas-swimlane-unassigned')).toHaveTextContent('未分配责任');
  });

  it('renders no markup when there are no lanes', () => {
    const { container } = render(<CanvasSwimlanes bounds={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter @guideanything/web exec vitest run src/features/editor/CanvasSwimlanes.test.tsx`

Expected: FAIL because `CanvasSwimlanes` does not exist yet.

- [ ] **Step 3: Write the minimal renderer**

```tsx
import type { SwimlaneBounds } from '@guideanything/canvas-core';
import type { CSSProperties } from 'react';

function laneKindLabel(kind: SwimlaneBounds['kind']): string {
  return kind === 'ROLE' ? '责任' : kind === 'SYSTEM' ? '系统' : '未分配';
}

export function CanvasSwimlanes({ bounds }: { bounds: SwimlaneBounds[] }) {
  return <>{bounds.map((bound) => {
    const laneKey = bound.laneId ?? 'unassigned';
    const laneClass = bound.kind === 'ROLE' ? ' canvas-swimlane--role' : bound.kind === 'SYSTEM' ? ' canvas-swimlane--system' : ' canvas-swimlane--unassigned';
    return <div
      key={laneKey}
      className={`canvas-swimlane${laneClass}`}
      data-testid="canvas-swimlane"
      data-lane-id={bound.laneId ?? 'unassigned'}
      data-lane-kind={bound.kind ?? 'UNASSIGNED'}
      aria-hidden="true"
      style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height } as CSSProperties}
    >
      <div className="canvas-swimlane-heading">
        <span>{bound.title}</span>
        <em>{laneKindLabel(bound.kind)}</em>
      </div>
    </div>;
  })}</>;
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter @guideanything/web exec vitest run src/features/editor/CanvasSwimlanes.test.tsx`

Expected: 2 tests pass.

### Task 2: Mount swimlane bounds in the editor viewport

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`

**Interfaces:**
- Consumes: `renderedDocument`, `getSwimlaneBounds`, and `CanvasSwimlanes`.
- Produces: viewport-synchronized lane decoration next to existing stage and resource overlays.

- [ ] **Step 1: Add the bounds memo**

Import `getSwimlaneBounds` and `CanvasSwimlanes`, then add:

```tsx
const swimlaneBounds = useMemo(() => renderedDocument ? getSwimlaneBounds(renderedDocument) : [], [renderedDocument]);
```

- [ ] **Step 2: Render the layer inside the existing `ViewportPortal`**

Place this before the existing stage bounds mapping:

```tsx
<CanvasSwimlanes bounds={swimlaneBounds} />
```

This keeps lane geometry in the same transform as nodes and stage frames.

- [ ] **Step 3: Run editor tests and typecheck**

Run: `pnpm --filter @guideanything/web exec vitest run --no-file-parallelism src/features/editor/CanvasSwimlanes.test.tsx src/features/editor/GuideEditor.test.tsx`

Expected: all focused tests pass.

Run: `pnpm --filter @guideanything/web typecheck`

Expected: `tsc --noEmit` exits with code 0.

### Task 3: Apply low-contrast dark-tech lane styling

**Files:**
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/styles.test.ts`

**Interfaces:**
- Consumes: `.canvas-swimlane`, `.canvas-swimlane-heading`, and lane kind modifier classes.
- Produces: visible vertical grouping with no pointer or keyboard interception.

- [ ] **Step 1: Add CSS assertions**

Extend `apps/web/src/styles.test.ts` with:

```ts
it('defines the editor swimlane visual system and reduced-transparency fallback', () => {
  expect(stylesheet).toContain('.canvas-swimlane');
  expect(stylesheet).toContain('.canvas-swimlane--role');
  expect(stylesheet).toContain('.canvas-swimlane--system');
  expect(stylesheet).toContain('pointer-events: none');
  expect(stylesheet).toContain('.canvas-swimlane-heading');
  expect(stylesheet).toContain('@media (prefers-reduced-transparency: reduce)');
});
```

- [ ] **Step 2: Add the visual rules**

Use existing tokens with these rules:

```css
.canvas-swimlane { position: absolute; z-index: 0; box-sizing: border-box; overflow: hidden; border: 1px solid color-mix(in srgb, var(--ga-border-strong) 74%, transparent); border-top-color: color-mix(in srgb, var(--ga-accent) 26%, var(--ga-border)); border-radius: 18px; background: linear-gradient(180deg, color-mix(in srgb, var(--ga-accent) 7%, transparent), transparent 42%), linear-gradient(90deg, color-mix(in srgb, var(--ga-accent) 4%, transparent), transparent 18%, transparent 82%, color-mix(in srgb, var(--ga-accent) 4%, transparent)); pointer-events: none; }
.canvas-swimlane--role { --canvas-swimlane-accent: #4fb3d8; }
.canvas-swimlane--system { --canvas-swimlane-accent: #d1a158; }
.canvas-swimlane--unassigned { --canvas-swimlane-accent: #7f8da3; }
.canvas-swimlane-heading { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: .6rem; min-height: 30px; border-bottom: 1px solid color-mix(in srgb, var(--canvas-swimlane-accent, var(--ga-accent)) 26%, transparent); padding: .4rem .58rem; color: color-mix(in srgb, var(--canvas-swimlane-accent, var(--ga-accent)) 78%, var(--ga-text)); background: color-mix(in srgb, var(--canvas-swimlane-accent, var(--ga-accent)) 7%, transparent); font-size: .67rem; font-weight: 800; letter-spacing: .045em; }
.canvas-swimlane-heading span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.canvas-swimlane-heading em { flex: 0 0 auto; border: 1px solid color-mix(in srgb, var(--canvas-swimlane-accent, var(--ga-accent)) 26%, transparent); border-radius: 999px; padding: .12rem .34rem; color: color-mix(in srgb, var(--canvas-swimlane-accent, var(--ga-accent)) 74%, var(--ga-text-secondary)); background: color-mix(in srgb, var(--canvas-swimlane-accent, var(--ga-accent)) 9%, transparent); font-size: .54rem; font-style: normal; }
```

Add `@media (prefers-reduced-transparency: reduce)` solid-fill fallbacks and a small-screen heading adjustment.

- [ ] **Step 3: Run style regression and diff checks**

Run: `pnpm --filter @guideanything/web exec vitest run --no-file-parallelism src/styles.test.ts src/features/editor/CanvasSwimlanes.test.tsx`

Expected: all tests pass.

Run: `git diff --check -- apps/web/src/features/editor/CanvasSwimlanes.tsx apps/web/src/features/editor/CanvasSwimlanes.test.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/styles.css apps/web/src/styles.test.ts`

Expected: no output.

### Task 4: Browser acceptance

**Files:**
- Inspect: `apps/web/src/features/editor/GuideEditor.tsx`, `apps/web/src/features/editor/CanvasSwimlanes.tsx`, `apps/web/src/styles.css`
- Evidence: `output/playwright/editor-swimlanes.png`

- [ ] **Step 1: Open the real editor and inspect lane DOM**

Run the existing named session:

```bash
/Users/yangyuanzhe/.codex/skills/playwright/scripts/playwright_cli.sh --session=design-audit goto "http://127.0.0.1:5174/guides/22c6fb40-62dc-43ab-b037-0742330d060f/edit?returnTo=%2Flibrary"
```

Then inspect the rendered columns:

```bash
/Users/yangyuanzhe/.codex/skills/playwright/scripts/playwright_cli.sh --session=design-audit run-code "async (page) => await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid=canvas-swimlane]')).map((lane) => ({ id: lane.getAttribute('data-lane-id'), rect: lane.getBoundingClientRect().toJSON() })))"
```

Expected: one element per visible lane bound, with non-zero width and height; the configured lane IDs match the lanes in the editor document.

- [ ] **Step 2: Capture the visual state**

Run:

```bash
/Users/yangyuanzhe/.codex/skills/playwright/scripts/playwright_cli.sh --session=design-audit screenshot --filename=output/playwright/editor-swimlanes.png
```

Expected: vertical lane columns are visible behind nodes without covering node content or controls.

- [ ] **Step 3: Exercise unchanged interactions**

Use the accessibility snapshot and existing controls to verify:

```bash
/Users/yangyuanzhe/.codex/skills/playwright/scripts/playwright_cli.sh --session=design-audit snapshot
```

Select a visible node, click `Fit View`, toggle `展开业务流程`, and drag the canvas background. Expected: the node inspector, hierarchy panel, and controls remain usable; the lane element transforms with the React Flow viewport and no new persistence request is emitted.

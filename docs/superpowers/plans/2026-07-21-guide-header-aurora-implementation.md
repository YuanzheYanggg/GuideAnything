# Guide Header Aurora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the GuideEditor header into a readable Aurora-style command header with grouped right-side actions, while preserving every existing editor action and responsive behavior.

**Architecture:** Keep `GuideEditor.tsx` as the owner of guide state and callbacks. Add two small local React Bits-derived visual primitives for the metadata panel and eyebrow shine, then compose them around the existing header controls. Use existing CSS variables, Phosphor icons, and CSS motion so no new runtime dependency or business state is introduced.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS variables, `@phosphor-icons/react`.

## Global Constraints

- Preserve all existing button labels, aria labels, callbacks, permissions, save state, publish behavior, draft-history behavior, appearance behavior, and regression-panel behavior.
- Do not stage, overwrite, or reformat unrelated existing dirty or untracked files in the shared worktree.
- Do not add `three`, `motion`, or another animation dependency for this header-only change.
- Keep the existing light/dark token strategy and use the single existing blue accent family.
- All continuous motion must have a `prefers-reduced-motion: reduce` fallback.
- Keep the header on one row at desktop widths and explicitly collapse it below the existing 1024px and 760px breakpoints.

---

### Task 1: Add local React Bits visual primitives

**Files:**
- Create: `apps/web/src/components/reactbits/SpotlightCard.tsx`
- Create: `apps/web/src/components/reactbits/ShinyText.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/components/reactbits/SpotlightCard.test.tsx`

**Interfaces:**
- `SpotlightCard({ children, className?, spotlightColor? }: React.PropsWithChildren<{ className?: string; spotlightColor?: string }>)` renders a focusable-container-safe wrapper and updates `--mouse-x`, `--mouse-y`, and `--spotlight-color` from pointer movement.
- `ShinyText({ children, className?, disabled? }: React.PropsWithChildren<{ className?: string; disabled?: boolean }>)` renders a span with the `shiny-text` class and disables animation when requested.
- Later tasks consume the class names `card-spotlight`, `shiny-text`, and `shiny-text.disabled`.

- [x] **Step 1: Write the failing SpotlightCard behavior test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SpotlightCard } from './SpotlightCard';

describe('SpotlightCard', () => {
  it('tracks the pointer position without changing its children', () => {
    render(<SpotlightCard spotlightColor="rgba(10, 132, 255, 0.2)"><span>摘要内容</span></SpotlightCard>);
    const card = screen.getByText('摘要内容').parentElement;
    expect(card).not.toBeNull();
    Object.defineProperty(card, 'getBoundingClientRect', { value: () => ({ left: 10, top: 20 }) });
    fireEvent.pointerMove(card!, { clientX: 42, clientY: 68 });
    expect(card).toHaveStyle({ '--mouse-x': '32px', '--mouse-y': '48px', '--spotlight-color': 'rgba(10, 132, 255, 0.2)' });
  });
});
```

- [x] **Step 2: Run the focused test and verify it fails because the primitive does not exist**

Run: `pnpm --filter @guideanything/web test -- src/components/reactbits/SpotlightCard.test.tsx`

Expected: FAIL because `./SpotlightCard` and its rendered behavior are not implemented.

- [x] **Step 3: Implement the copy-paste-ready primitives with local token-friendly classes**

`SpotlightCard.tsx` should use a `ref`, `onPointerMove`, `getBoundingClientRect()`, and `style.setProperty()` exactly for the three CSS custom properties. `ShinyText.tsx` should only render children and the class name; it must not add a new animation library.

```tsx
// SpotlightCard.tsx
import { useRef, type CSSProperties, type PointerEvent, type PropsWithChildren } from 'react';

type SpotlightCardProps = PropsWithChildren<{
  className?: string;
  spotlightColor?: string;
}>;

export function SpotlightCard({ children, className = '', spotlightColor = 'rgba(10, 132, 255, 0.2)' }: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const style = card.style as CSSProperties & { setProperty: (property: string, value: string) => void };
    style.setProperty('--mouse-x', `${event.clientX - rect.left}px`);
    style.setProperty('--mouse-y', `${event.clientY - rect.top}px`);
    style.setProperty('--spotlight-color', spotlightColor);
  };

  return <div ref={cardRef} className={`card-spotlight ${className}`.trim()} onPointerMove={handlePointerMove}>{children}</div>;
}
```

```tsx
// ShinyText.tsx
import type { PropsWithChildren } from 'react';

export function ShinyText({ children, className = '', disabled = false }: PropsWithChildren<{ className?: string; disabled?: boolean }>) {
  return <span className={`shiny-text${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`}>{children}</span>;
}
```

Add the React Bits-inspired spotlight radial background and shine gradient in `styles.css`, but map its colors to `--ga-*` tokens and keep the effect behind the content with `pointer-events: none`.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `pnpm --filter @guideanything/web test -- src/components/reactbits/SpotlightCard.test.tsx`

Expected: PASS.

---

### Task 2: Recompose the GuideEditor header and group the command area

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx:20-50,1335-1355`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx` near the existing `指南信息` header test

**Interfaces:**
- The existing `FlowRegressionPanel`, `AppearanceToggle`, digest opener, draft-history opener, save callback, publish callback, title input, summary textarea, and tag input keep their current props and handlers.
- The header gains the semantic groups `.editor-action-group--diagnostics`, `.editor-action-group--appearance`, `.editor-action-group--versions`, and `.editor-action-group--primary`.
- Existing accessible names remain unchanged; group labels are additional `aria-label` values only.

- [x] **Step 1: Extend the header test with group and action assertions**

Add assertions to the existing GuideEditor header test after `guideDetails` is found:

```tsx
expect(screen.getByRole('group', { name: '状态与诊断' })).toBeVisible();
expect(within(screen.getByRole('group', { name: '外观' })).getByRole('button', { name: /当前为|切换到/ })).toBeVisible();
expect(screen.getByRole('group', { name: '版本操作' })).toContainElement(screen.getByRole('button', { name: '草稿历史' }));
expect(screen.getByRole('group', { name: '版本操作' })).toContainElement(screen.getByRole('button', { name: '保存草稿' }));
expect(screen.getByRole('group', { name: '主操作' })).toContainElement(screen.getByRole('button', { name: '发布指南' }));
```

- [x] **Step 2: Run the targeted GuideEditor test and verify the new assertions fail**

Run: `pnpm --filter @guideanything/web test -- src/features/editor/GuideEditor.test.tsx -t "places guide-wide details"`

Expected: FAIL because the current header has no grouped command containers.

- [x] **Step 3: Implement the grouped header markup without changing business handlers**

Import only icons already available from `@phosphor-icons/react`, including `ArrowLeft`, `ChartLineUp`, `ClockCounterClockwise`, `FloppyDisk`, and `UploadSimple`. Keep the existing button text and aria labels. Replace the single flat `.editor-actions` row with this structure:

```tsx
<div className="editor-actions" aria-label="指南操作">
  <div className="editor-action-group editor-action-group--diagnostics" role="group" aria-label="状态与诊断">
    <span className="editor-action-group-label"><ChartLineUp size={14} weight="bold" aria-hidden="true" />状态</span>
    <FlowRegressionPanel guideId={guide.id} api={api} annotationTitle={(target) => annotationTitleForTarget(document, target)} />
  </div>
  <div className="editor-action-group editor-action-group--appearance" role="group" aria-label="外观设置">
    <span className="editor-action-group-label">外观</span>
    <AppearanceToggle />
  </div>
  <div className="editor-action-group editor-action-group--versions" role="group" aria-label="版本操作">
    <span className="editor-action-group-label"><ClockCounterClockwise size={14} weight="bold" aria-hidden="true" />版本</span>
    <div className="editor-action-segment">
      <button className="editor-action-button" type="button" onClick={() => void openDraftHistory()} disabled={Boolean(layoutPreview)} aria-label="草稿历史"><ClockCounterClockwise size={17} aria-hidden="true" />草稿历史</button>
      <button className="editor-action-button" type="button" onClick={() => void save()} disabled={Boolean(layoutPreview)} aria-label="保存草稿"><FloppyDisk size={17} aria-hidden="true" />保存草稿</button>
    </div>
  </div>
  <div className="editor-action-group editor-action-group--primary" role="group" aria-label="主操作">
    <button className="primary-button editor-publish-button" type="button" onClick={() => void publish()} disabled={Boolean(layoutPreview)} aria-label="发布指南"><UploadSimple size={18} weight="bold" aria-hidden="true" />发布指南</button>
  </div>
</div>
```

Wrap `guide-details-header` contents with `<SpotlightCard className="guide-details-card" spotlightColor="rgba(10, 132, 255, 0.22)">`, keep the existing labels and controls inside it, and render the `GUIDE DETAILS` eyebrow through `<ShinyText>`. The CSS `prefers-reduced-motion` rule disables the shine without requiring React to observe a media query. Keep the original `.guide-details-header` as the semantic region with `aria-label="指南信息"`.

- [x] **Step 4: Run the targeted test and verify it passes**

Run: `pnpm --filter @guideanything/web test -- src/features/editor/GuideEditor.test.tsx -t "places guide-wide details"`

Expected: PASS, with the guide details region still in `.editor-header`, all existing action names still queryable, and the new groups present.

---

### Task 3: Add the Aurora layout, grouped command styling, and responsive fallbacks

**Files:**
- Modify: `apps/web/src/styles.css:172-205,430-460,480-510`
- Modify: `apps/web/src/styles.test.ts`

**Interfaces:**
- `.editor-header` remains the top row of `.editor-page-content` and continues to use `--editor-header-height`.
- `.editor-header::before` and `.editor-header::after` provide the animated background only; they must not intercept pointer input.
- `.editor-action-segment` owns version buttons so they read as one control family instead of two cards.

- [x] **Step 1: Add focused stylesheet assertions for the new layout contract**

Extend `apps/web/src/styles.test.ts` with assertions for `.editor-header` isolation, grouped actions, the segmented version control, and reduced motion:

```ts
it('provides an animated but reduced-motion-safe command header', () => {
  expect(stylesheet).toMatch(/\.editor-header::before,\s*\.editor-header::after\s*\{[^}]*pointer-events:\s*none/s);
  expect(stylesheet).toMatch(/\.editor-action-segment\s*\{[^}]*display:\s*inline-flex/s);
  expect(stylesheet).toMatch(/\.editor-action-button\s*\{[^}]*border:\s*0/s);
  expect(stylesheet).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.editor-header::before/s);
});
```

- [x] **Step 2: Run the style test and verify it fails before CSS is added**

Run: `pnpm --filter @guideanything/web test -- src/styles.test.ts`

Expected: FAIL because the new selector contracts do not exist yet.

- [x] **Step 3: Implement the layout and effect styles**

Use the existing dark/light variables. The desktop header should have a layered background with two slowly moving radial gradients, a stronger inner border around the details card, and a single accent blue. The group styles should use a shared low-contrast container, 8px internal gaps, 12px group radius, and no individual outer borders on version buttons. Use the existing `var(--ga-fast)` and `var(--ga-standard)` timing tokens.

Required CSS behavior:

```css
.editor-header { position: relative; isolation: isolate; overflow: hidden; }
.editor-header::before, .editor-header::after { position: absolute; inset: -35%; z-index: -1; pointer-events: none; content: ""; }
.editor-header::before { background: radial-gradient(circle at 12% 30%, color-mix(in srgb, var(--ga-accent) 25%, transparent), transparent 28%), radial-gradient(circle at 68% 0%, rgb(119 92 255 / .16), transparent 30%); filter: blur(28px); opacity: .9; }
.editor-header::after { background: linear-gradient(112deg, transparent 20%, rgb(255 255 255 / .06) 45%, transparent 65%); transform: translateX(-18%); animation: editor-header-sheen 12s ease-in-out infinite; }
.editor-action-group { display: grid; gap: 5px; min-width: 0; padding: 5px; border: 1px solid color-mix(in srgb, var(--ga-border) 88%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--ga-surface) 72%, transparent); backdrop-filter: blur(16px) saturate(145%); }
.editor-action-group-label { display: inline-flex; align-items: center; gap: 4px; padding-inline: 5px; color: var(--ga-text-tertiary); font-size: .62rem; font-weight: 750; letter-spacing: .06em; }
.editor-action-segment { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: color-mix(in srgb, var(--ga-bg-raised) 78%, transparent); }
.editor-action-button { display: inline-flex; align-items: center; gap: 6px; min-height: 31px; border: 0; border-radius: 7px; padding: 0 8px; color: var(--ga-text-secondary); background: transparent; font-size: .72rem; font-weight: 680; }
.editor-action-button:hover:not(:disabled) { color: var(--ga-text); background: var(--ga-accent-soft); }
@keyframes editor-header-sheen { 0%, 100% { transform: translateX(-18%); opacity: .2; } 50% { transform: translateX(18%); opacity: .65; } }
@media (prefers-reduced-motion: reduce) { .editor-header::before, .editor-header::after, .shiny-text { animation: none; } .card-spotlight::before { transition: none; } }
```

Add explicit 1024px and 760px layout rules so the details card and command groups occupy their own rows without horizontal overflow. The current responsive header heights are 240px at 1024px and 400px at 760px. Provide a solid `background: var(--ga-surface-solid)` fallback under `@media (prefers-reduced-transparency: reduce)`.

- [x] **Step 4: Run style and targeted editor tests**

Run: `pnpm --filter @guideanything/web test -- src/styles.test.ts src/features/editor/GuideEditor.test.tsx -t "places guide-wide details"`

Expected: PASS.

---

### Task 4: Verify the real page and finish the diff review

**Files:**
- Inspect only: `apps/web/src/features/editor/GuideEditor.tsx`, `apps/web/src/components/reactbits/SpotlightCard.tsx`, `apps/web/src/components/reactbits/ShinyText.tsx`, `apps/web/src/styles.css`, `apps/web/src/styles.test.ts`

- [x] **Step 1: Run the Web package typecheck and build**

Run: `pnpm --filter @guideanything/web typecheck && pnpm --filter @guideanything/web build`

Expected: TypeScript exits 0 and Vite produces a successful production build.

- [x] **Step 2: Run the complete Web test suite**

Run: `pnpm --filter @guideanything/web test`

Expected: All Web tests pass, including existing save, publish, digest, draft-history, appearance, and regression-panel tests.

- [x] **Step 3: Inspect the live browser at desktop and mobile widths**

Use the existing GuideAnything dev stack if it is already running. If a server must be started, verify port ownership first with `lsof -nP -iTCP:5173 -sTCP:LISTEN` and `lsof -nP -iTCP:3001 -sTCP:LISTEN`, then open the guide editor. At desktop width, verify the details card is visually dominant, the right actions are grouped, the publish CTA is the only saturated button, and there is no horizontal overflow. At 760px and below, verify controls stack and remain keyboard accessible. Toggle light and dark themes, hover the details card and command groups, and verify the focus ring remains visible.

- [x] **Step 4: Verify reduced motion and inspect the final diff**

Enable `prefers-reduced-motion: reduce` in the browser and confirm the aurora sheen, text shine, and spotlight transition stop without hiding content. Run `git diff --check` and `git diff --name-only -- apps/web/src/features/editor/GuideEditor.tsx apps/web/src/components/reactbits/SpotlightCard.tsx apps/web/src/components/reactbits/ShinyText.tsx apps/web/src/styles.css apps/web/src/styles.test.ts`.

Expected: no whitespace errors, only the scoped Header files are listed, and unrelated user changes remain untouched.

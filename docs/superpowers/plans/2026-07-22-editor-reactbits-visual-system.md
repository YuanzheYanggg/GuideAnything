# Guide Editor React Bits Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the GuideAnything editor nodes, menus, toolbars, structure panels, property surfaces, and dialogs one coherent dark Aurora / React Bits visual language without changing existing editor behavior or persisted data.

**Architecture:** Keep all existing state transitions, callbacks, aria labels, React Flow handles, and CanvasDocument operations unchanged. Add small local React Bits-style primitives under `apps/web/src/components/reactbits`, then compose them around the existing node and menu content. Use CSS tokens and state classes for visual treatment; use React only where a primitive needs pointer tracking, animated list entrance, or an active border state.

**Tech Stack:** React 19, TypeScript, React Flow, Phosphor Icons, Vitest, Testing Library, CSS custom properties, local React Bits primitives (`SpotlightCard`, `ShinyText`, `BorderGlow`, `AnimatedList`).

## Global Constraints

- Preserve all existing callback signatures, aria labels, keyboard behavior, pointer propagation guards, and save/publish flows.
- Do not change `CanvasDocument`, contracts, API routes, database files, or node/edge data semantics.
- Limit implementation changes to `apps/web/src/components/reactbits`, `apps/web/src/features/nodes`, the editor feature components, `apps/web/src/styles.css`, and their tests.
- Reuse the existing single electric-blue accent and dark theme tokens; do not introduce a second unrelated palette.
- Keep `prefers-reduced-motion: reduce` and `prefers-reduced-transparency: reduce` safe.
- Do not touch unrelated dirty files in the shared checkout, remove generated artifacts, or reset the worktree.
- Validate DOM structure and interaction in a real browser at desktop and mobile widths before claiming completion.

---

### Task 1: Add tested React Bits visual primitives

**Files:**
- Create: `apps/web/src/components/reactbits/BorderGlow.tsx`
- Create: `apps/web/src/components/reactbits/BorderGlow.test.tsx`
- Create: `apps/web/src/components/reactbits/AnimatedList.tsx`
- Create: `apps/web/src/components/reactbits/AnimatedList.test.tsx`
- Modify: `apps/web/src/components/reactbits/SpotlightCard.tsx`
- Modify: `apps/web/src/components/reactbits/SpotlightCard.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `BorderGlow({ children, className?, active?, tone? })` renders one wrapper with `border-glow`, `is-active`, and optional tone classes; it must not alter child order or event propagation.
- `AnimatedList({ children, className?, role?, ariaLabel? })` renders a semantic `div` whose direct children receive a stable `--animated-list-index` style variable and `animated-list-item` class; it must preserve the original child count and accessible roles.
- `SpotlightCard` accepts standard `HTMLAttributes<HTMLDivElement>` pass-through props while continuing to update pointer coordinates and preserve caller `onPointerMove` behavior.

- [ ] **Step 1: Write failing primitive tests**

Add tests that assert:

```tsx
render(<BorderGlow active tone="accent"><button>保存</button></BorderGlow>);
expect(screen.getByRole('button', { name: '保存' }).parentElement).toHaveClass('border-glow', 'is-active', 'border-glow-accent');

render(<AnimatedList role="menu" ariaLabel="动作"><button role="menuitem">第一项</button><button role="menuitem">第二项</button></AnimatedList>);
expect(screen.getByRole('menu', { name: '动作' })).toBeInTheDocument();
expect(screen.getAllByRole('menuitem')[1]).toHaveStyle({ '--animated-list-index': '1' });
```

Extend the existing SpotlightCard test with `aria-label`, `data-testid`, and a caller pointer handler to prove pass-through props and pointer tracking both remain active.

- [ ] **Step 2: Run the focused tests and verify they fail for missing primitives/props**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/components/reactbits/BorderGlow.test.tsx src/components/reactbits/AnimatedList.test.tsx src/components/reactbits/SpotlightCard.test.tsx
```

Expected: FAIL because `BorderGlow` and `AnimatedList` do not exist yet and SpotlightCard does not expose the new pass-through behavior.

- [ ] **Step 3: Implement the minimal primitives**

Use these behavior boundaries:

```tsx
export function BorderGlow({ children, className = '', active = false, tone = 'accent' }: BorderGlowProps) {
  return <div className={`border-glow border-glow-${tone}${active ? ' is-active' : ''} ${className}`.trim()}>{children}</div>;
}

export function AnimatedList({ children, className = '', role, ariaLabel }: AnimatedListProps) {
  return <div className={`animated-list ${className}`.trim()} {...(role ? { role } : {})} {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}>
    {Children.map(children, (child, index) => child == null ? child : <div className="animated-list-item" style={{ '--animated-list-index': index } as CSSProperties}>{child}</div>)}
  </div>;
}
```

Add `HTMLAttributes<HTMLDivElement>` to SpotlightCard props and call both the internal pointer handler and any supplied caller handler.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the same Vitest command. Expected: all primitive tests pass.

- [ ] **Step 5: Add reduced-motion-safe primitive CSS**

Add `.border-glow`, `.border-glow::before`, `.border-glow.is-active`, `.animated-list-item`, and reduced-motion overrides. The animated border must be opacity-gated and the list entrance must not affect layout or pointer hit testing.

---

### Task 2: Rebuild node surfaces without changing node content or actions

**Files:**
- Modify: `apps/web/src/features/nodes/NodeChrome.tsx`
- Modify: `apps/web/src/features/nodes/NodeChrome.test.tsx`
- Modify: `apps/web/src/features/nodes/FlowNode.tsx`
- Modify: `apps/web/src/features/nodes/ImageNode.tsx`
- Modify: `apps/web/src/features/nodes/MarkdownNode.tsx`
- Modify: `apps/web/src/features/nodes/VideoNode.tsx`
- Modify: `apps/web/src/features/nodes/SubguideNode.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `NodeChrome` remains the owner of handles, `NodeResizer`, delete, visibility, selected state, and resource hidden state.
- Existing child content remains in the same React child order inside `NodeChrome`; only the visual shell around it changes.

- [ ] **Step 1: Write failing NodeChrome visual composition tests**

Extend `NodeChrome.test.tsx` with tests asserting selected and resource nodes expose the React Bits shell while existing controls remain available:

```tsx
render(<NodeChrome nodeId="process-1" selected tone="process"><strong>节点</strong></NodeChrome>);
expect(document.querySelector('.canvas-node .border-glow.is-active .card-spotlight')).toBeInTheDocument();
expect(screen.getByRole('button', { name: '删除节点' })).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused NodeChrome tests and verify the new composition fails**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/nodes/NodeChrome.test.tsx
```

Expected: the existing action tests pass but the new shell assertion fails.

- [ ] **Step 3: Compose BorderGlow and SpotlightCard around the existing NodeChrome children**

Keep all handles and action buttons as siblings owned by the outer `.canvas-node`. Render the existing content inside:

```tsx
<BorderGlow className="canvas-node-glow" active={Boolean(selected)} tone={tone === 'decision' ? 'warning' : 'accent'}>
  <SpotlightCard className="canvas-node-surface" spotlightColor={spotlightColorByTone(tone)}>
    {children}
  </SpotlightCard>
</BorderGlow>
```

Do not move the delete/visibility buttons or connection handles into the SpotlightCard; their `nodrag nopan nowheel` behavior and pointer stopping must remain unchanged.

- [ ] **Step 4: Add type-specific node tokens and states**

Use one base geometry with semantic variations:

- `start` / `end`: compact pill surface and stronger flow endpoint indicator.
- `process`: electric-blue active rail and calm neutral surface.
- `decision`: restrained amber edge signal, not a new global accent.
- `data`: violet-free neutral slate with a data glyph treatment.
- `markdown`: indigo-blue document surface with readable content contrast.
- `image` / `video`: media-first surface with a thumbnail frame, bottom metadata rail, and hidden/visible status chip.
- `subguide`: dashed reference rail and pinned-guide badge.

Add `aria-hidden` decorative layers only; leave text and buttons unchanged.

- [ ] **Step 5: Run NodeChrome, node component, and canvas editor tests**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/nodes/NodeChrome.test.tsx src/features/nodes/InlineNodeIntegration.test.tsx src/features/nodes/ImageNode.test.tsx src/features/nodes/MarkdownNode.test.tsx src/features/nodes/VideoNode.test.tsx src/features/editor/GuideEditor.test.tsx --no-file-parallelism
```

Expected: existing node editing, delete, visibility, handle, and editor behavior remains green.

---

### Task 3: Convert editor menus and toolbars to the shared React Bits language

**Files:**
- Modify: `apps/web/src/features/editor/CanvasCreationMenu.tsx`
- Modify: `apps/web/src/features/editor/EdgeToolbar.tsx`
- Modify: `apps/web/src/features/editor/HierarchyPanel.tsx`
- Modify: `apps/web/src/features/editor/GuideDetailsHeader.tsx`
- Modify: `apps/web/src/features/editor/GuideSummaryDialog.tsx`
- Modify: `apps/web/src/features/editor/GuideDigestDialog.tsx`
- Modify: `apps/web/src/features/editor/DraftHistoryDialog.tsx`
- Modify: `apps/web/src/features/editor/NodeDetailDialog.tsx`
- Modify: `apps/web/src/features/editor/ImageAnnotationEditor.tsx`
- Modify: `apps/web/src/features/editor/ImageReplacementDialog.tsx`
- Modify: `apps/web/src/features/editor/HierarchyDeletionDialog.tsx`
- Modify: `apps/web/src/features/editor/AnnotatedImageDeletionDialog.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Menu and dialog props, callback names, role/name labels, open/close state, and focus restoration stay unchanged.
- Existing menu item arrays remain the source of truth; only their wrapper and presentation change.

- [ ] **Step 1: Add focused menu composition assertions before changing markup**

Extend existing tests so every menu surface keeps its current semantic contract while gaining the shared class names:

```tsx
expect(screen.getByRole('menu', { name: '创建下一项' })).toHaveClass('card-spotlight');
expect(screen.getByRole('toolbar', { name: '连线样式' })).toContainElement(screen.getByRole('menu', { name: '线型' }));
expect(screen.getByRole('region', { name: '流程结构' })).toHaveClass('hierarchy-panel');
```

Add dialog assertions for `aria-modal`, close buttons, and the new `dialog-surface` class without changing names or focus behavior.

- [ ] **Step 2: Run affected menu/dialog tests and verify the new class assertions fail**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/editor/CanvasCreationMenu.test.tsx src/features/editor/EdgeToolbar.test.tsx src/features/editor/HierarchyPanel.test.tsx src/features/editor/GuideDetailsHeader.test.tsx src/features/editor/GuideSummaryDialog.test.tsx src/features/editor/GuideDigestDialog.test.tsx src/features/editor/DraftHistoryDialog.test.tsx src/features/editor/NodeDetailDialog.test.tsx
```

- [ ] **Step 3: Compose menu surfaces from SpotlightCard, BorderGlow, AnimatedList, and ShinyText**

Apply the same structure consistently:

```tsx
<SpotlightCard className="reactbits-menu-surface canvas-creation-menu" role="menu" aria-label="创建下一项">
  <ShinyText className="menu-kicker">CREATE NEXT</ShinyText>
  <AnimatedList className="reactbits-menu-list">
    {items}
  </AnimatedList>
</SpotlightCard>
```

For drawers and dialogs, keep their existing semantic outer element and place `SpotlightCard` / `BorderGlow` around only the visual surface if an element type change would risk selectors or focus behavior.

- [ ] **Step 4: Align menu interaction states**

Use one interaction language:

- closed trigger: quiet neutral surface;
- hover: spotlight follows pointer and adds a blue edge tint;
- active/open: `BorderGlow.is-active` plus stronger text contrast;
- selected option: compact accent chip or rail, not a separate unrelated button style;
- disabled: opacity and cursor only, no animation;
- Escape/outside close/focus restore: preserve existing logic exactly.

- [ ] **Step 5: Run the affected menu/dialog tests and verify they pass**

Run the same focused command from Step 2, then run the full Web test suite serially.

---

### Task 4: Apply the visual system to the inspector, structure panel, and editor chrome

**Files:**
- Modify: `apps/web/src/features/editor/HierarchyPanel.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx` only if a class hook is required
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`

- [ ] **Step 1: Add CSS contract tests for the editor visual system**

Assert that the stylesheet contains the shared surfaces, semantic node tones, menu list animation, focus-visible states, and reduced-motion overrides without asserting generated colors pixel-for-pixel.

- [ ] **Step 2: Implement the compact visual hierarchy**

Use the following hierarchy:

- editor chrome: low-contrast glass and one blue action;
- canvas: dark dotted field with soft local glows, not a full-screen gradient wash;
- structure panel: dark slate glass, selected tree rail, compact stage/lane manager cards;
- inspector: neutral surface with grouped labels and stronger field focus rings;
- menus/dialogs: one 12–16px surface radius scale, one floating shadow family, one accent glow family.

- [ ] **Step 3: Preserve responsive and accessibility states**

Ensure desktop, 1024px compact desktop, 760px mobile, selected, disabled, empty, loading, error, and reduced-motion states remain represented by selectors/tests.

- [ ] **Step 4: Run style tests and typecheck**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/styles.test.ts
pnpm --filter @guideanything/web typecheck
```

---

### Task 5: Browser verification and final regression pass

**Files:**
- No new production files.
- Artifacts: `output/playwright/editor-reactbits-visual-system.png`, `output/playwright/editor-reactbits-menu-states.png`.

- [ ] **Step 1: Verify desktop visual states in a real browser**

At 1280px or wider, inspect:

1. unselected flow/resource nodes;
2. selected node with delete/visibility actions;
3. node detail expansion and inline editing;
4. canvas creation menu;
5. edge toolbar with each menu open;
6. hierarchy panel and stage/lane manager drawer;
7. node inspector fields;
8. summary, digest, history, annotation, and deletion dialogs.

- [ ] **Step 2: Verify responsive and reduced-motion behavior**

At 390px × 844px, verify no horizontal overflow and no toolbar/menu clipping. Emulate reduced motion and verify animated border/list effects are disabled while controls remain visible and usable.

- [ ] **Step 3: Run the complete validation bundle**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run --no-file-parallelism
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
git diff --check -- apps/web/src/components/reactbits apps/web/src/features/nodes apps/web/src/features/editor apps/web/src/styles.css apps/web/src/styles.test.ts
```

Expected: all Web tests pass serially, typecheck and build pass, and the diff has no whitespace errors. Report any pre-existing parallel fake-timer interference separately rather than weakening product assertions.

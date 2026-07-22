# Flow Node Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicated swimlane labels from flow nodes and refine the node information hierarchy and neutral action controls without changing editor behavior or persisted data.

**Architecture:** Keep `FlowNode` responsible for flow-node content and `NodeChrome` responsible for the shared shell, handles, visibility, and delete action. Reuse the existing local React Bits-style `SpotlightCard` and `BorderGlow` primitives, add only semantic wrappers and CSS states, and keep the Phosphor icon family for controls.

**Tech Stack:** React 19, TypeScript, React Flow, Phosphor Icons, local React Bits-style primitives, CSS custom properties, Vitest, Testing Library, Playwright.

## Global Constraints

- Preserve existing node callbacks, `aria-label` values, keyboard focus behavior, `nodrag nopan nowheel` classes, connection handles, and React Flow geometry updates.
- Remove only the repeated node-level responsibility display. Keep `laneId` in the inspector and keep canvas swimlanes as the source of visual lane context.
- Replace only the delete icon and visual treatment. The action remains a delete action and keeps `删除节点` as its accessible name.
- Do not add a runtime dependency or change `CanvasDocument`, API routes, persistence, or save/publish behavior.
- Use the existing electric-blue accent and current theme tokens. Delete hover state must be neutral or accent-colored, not danger red.
- Preserve dark and light theme rules, `prefers-reduced-motion`, `prefers-reduced-transparency`, and existing dirty worktree changes.

---

### Task 1: Remove the duplicated swimlane marker and establish the flow-node content hierarchy

**Files:**
- Modify: `apps/web/src/features/nodes/FlowNode.tsx`
- Modify: `apps/web/src/features/nodes/InlineNodeIntegration.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `FlowNode` continues to receive the same `NodeProps` and uses `NodeDetailPresentationProvider` exactly as before.
- The node still exposes inline title editing, detail editing, detail expansion, and the same accessible labels.
- The rendered flow content becomes `flow-node-header` plus `flow-node-content`; no persistence shape changes.

- [ ] **Step 1: Change the regression test first**

Replace the old responsibility-marker test with an explicit absence assertion and content-shell assertions:

```tsx
it('does not repeat the swimlane inside a flow node', () => {
  render(
    <NodeDetailPresentationProvider value={{ expandedNodeIds: new Set(), onOpenEditor: vi.fn(), onToggleExpanded: vi.fn() }}>
      <FlowNode {...props('process-1', 'process', {
        label: '确认原料',
        description: '核对供应商与交期',
        responsibility: { title: '供应商、原辅料采购与质量确认协调职责', kind: 'ROLE' },
      })} />
    </NodeDetailPresentationProvider>,
  );

  expect(screen.queryByText('泳道', { selector: '.node-responsibility-label' })).not.toBeInTheDocument();
  expect(screen.queryByText('供应商、原辅料采购与质量确认协调职责')).not.toBeInTheDocument();
  expect(screen.getByText('确认原料').closest('.flow-node-header')).toBeInTheDocument();
  expect(screen.getByTestId('flow-description-process-1').closest('.flow-node-content')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run --no-file-parallelism src/features/nodes/InlineNodeIntegration.test.tsx
```

Expected: the new absence assertion fails because `FlowNode` still renders `.node-responsibility`.

- [ ] **Step 3: Update `FlowNode` markup without changing behavior**

Keep the existing callbacks and accessible labels, but group the visible content and remove the responsibility block:

```tsx
return <NodeChrome nodeId={id} selected={selected} tone={type ?? 'process'} width={width} expanded={expanded}>
  <div className="flow-node-header">
    <span className="node-kicker">{value.semanticCode ? `${flowLabel(type)} · ${value.semanticCode}` : flowLabel(type)}</span>
    <InlineNodeTextEditor nodeId={id} field="label" value={value.label ?? ''} label={`${label} · 节点标题`} required>
      <strong>{label}</strong>
    </InlineNodeTextEditor>
  </div>
  <div className="flow-node-content">
    <button ... className="flow-detail-trigger nodrag nopan nowheel">...</button>
    {description ? <button ... className="flow-detail-toggle flow-detail-toggle-compact nodrag nopan nowheel">...</button> : null}
  </div>
</NodeChrome>;
```

The detail button body and event handlers remain the current implementation. Do not remove `event.stopPropagation()`, `onDoubleClick`, or the local expanded-state callback.

- [ ] **Step 4: Add the node layout rules**

Add scoped rules that create a clear header, title, body preview, and bottom detail action without changing node dimensions for other node types:

```css
.flow-node-header { display: grid; gap: 5px; min-width: 0; }
.flow-node-header .node-kicker { display: block; }
.flow-node-header strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flow-node-content { position: relative; display: grid; gap: 6px; min-width: 0; }
.flow-node-content .flow-detail-trigger { min-width: 0; }
.flow-node-content .flow-description { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.flow-node-content .flow-detail-toggle { justify-self: end; }
```

Keep the existing selected-only placeholder and expanded Markdown behavior intact.

- [ ] **Step 5: Run the focused test and verify it passes**

Run the same Vitest command from Step 2. Expected: all inline node integration tests pass and no node responsibility text appears in the rendered flow node.

---

### Task 2: Replace the red trash icon with a neutral X action

**Files:**
- Modify: `apps/web/src/features/nodes/NodeChrome.tsx`
- Modify: `apps/web/src/features/nodes/NodeChrome.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `NodeChrome` remains the owner of deletion and resource visibility actions.
- Delete action retains `aria-label="删除节点"`, selection-only tab behavior, pointer guards, and `onDeleteNode(nodeId)`.
- The visual icon becomes Phosphor `X`, matching the existing `Eye` control family.

- [ ] **Step 1: Add the icon contract test**

Extend the existing delete-action test with a stable class on the glyph:

```tsx
const button = screen.getByRole('button', { name: '删除节点' });
expect(button.querySelector('.canvas-node-delete-icon')).toBeInTheDocument();
expect(button).toHaveAttribute('tabindex', '0');
```

Add a stylesheet contract test in `apps/web/src/styles.test.ts`:

```ts
it('uses a neutral X action instead of a danger trash action on nodes', () => {
  expect(stylesheet).toMatch(/\.canvas-node-delete\s*\{[^}]*color:\s*var\(--ga-text-secondary\)/s);
  expect(stylesheet).toMatch(/\.canvas-node-delete:hover\s*\{[^}]*color:\s*var\(--ga-accent\)/s);
});
```

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run --no-file-parallelism src/features/nodes/NodeChrome.test.tsx src/styles.test.ts
```

Expected: the glyph class and neutral CSS assertions fail before the implementation change.

- [ ] **Step 3: Swap the icon while preserving the action**

Change the Phosphor import and glyph only:

```tsx
import { Eye, EyeSlash, X } from '@phosphor-icons/react';

<X className="canvas-node-delete-icon" size={14} weight="bold" aria-hidden="true" />
```

Do not change the button label, pointer handlers, tab index, or callback.

- [ ] **Step 4: Restyle the action cluster**

Use a neutral shared icon treatment and reserve the danger color for confirmation surfaces elsewhere in the product:

```css
.canvas-node-delete { color: var(--ga-text-secondary); background: color-mix(in srgb, var(--ga-surface-solid) 92%, transparent); }
.canvas-node-delete:hover { border-color: color-mix(in srgb, var(--ga-accent) 58%, var(--ga-border)); color: var(--ga-accent); background: var(--ga-accent-soft); }
.canvas-node-delete:focus-visible { outline: 2px solid color-mix(in srgb, var(--ga-accent) 70%, transparent); outline-offset: 2px; }
.canvas-node-delete-icon { flex: 0 0 auto; }
```

Keep the eye button geometry aligned with the X button and keep resource visibility states unchanged.

- [ ] **Step 5: Run the focused interaction tests**

Run the same command from Step 2. Expected: NodeChrome delete, visibility, handle, and focus tests pass.

---

### Task 3: Apply the React Bits-inspired surface treatment and verify the complete node flow

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/features/nodes/NodeChrome.test.tsx` only if an additional shell assertion is needed
- Test: `apps/web/src/features/nodes/InlineNodeIntegration.test.tsx`
- Inspect: `apps/web/src/components/reactbits/SpotlightCard.tsx`, `apps/web/src/components/reactbits/BorderGlow.tsx`

**Interfaces:**
- Reuse existing local React Bits-style primitives. Do not install `reactbits` or another visual dependency.
- `SpotlightCard` remains pointer-coordinate driven and `BorderGlow` remains selection-driven.
- Reduced motion and reduced transparency fallbacks remain active.

- [ ] **Step 1: Add the shell regression assertion if needed**

Confirm the shared node surface still composes the existing primitives:

```tsx
render(<NodeChrome nodeId="process-1" selected tone="process"><strong>节点</strong></NodeChrome>);
expect(document.querySelector('.canvas-node-glow')).toHaveClass('border-glow', 'is-active');
expect(document.querySelector('.canvas-node-surface')).toHaveClass('card-spotlight');
```

- [ ] **Step 2: Add restrained hover and selected states**

Use the current blue accent and the existing SpotlightCard variables. The effect communicates hover focus and selection only; it must not move the node or animate layout properties:

```css
.canvas-node-surface { position: relative; isolation: isolate; }
.canvas-node-surface::after { position: absolute; inset: 1px; border: 1px solid color-mix(in srgb, var(--ga-accent) 12%, transparent); border-radius: inherit; opacity: 0; pointer-events: none; content: ""; transition: opacity var(--ga-fast); }
.canvas-node:hover .canvas-node-surface::after, .react-flow__node.selected .canvas-node-surface::after { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .canvas-node-surface::after { transition: none; }
}
```

Do not add 3D transforms or continuous animation to draggable nodes.

- [ ] **Step 3: Run all changed node tests**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run --no-file-parallelism src/features/nodes/NodeChrome.test.tsx src/features/nodes/InlineNodeIntegration.test.tsx src/features/editor/GuideEditor.test.tsx src/styles.test.ts
```

Expected: all changed node and editor behavior tests pass.

- [ ] **Step 4: Run typecheck and build**

Run:

```bash
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
```

Expected: both commands exit with code 0. A pre-existing chunk-size warning may remain and must be reported, not treated as a node regression.

- [ ] **Step 5: Verify the real browser behavior**

In the existing `design-audit` Playwright session, verify:

1. Flow nodes no longer contain `.node-responsibility` or the text `泳道`.
2. A selected process node shows the neutral X control and the existing eye control remains available on resource nodes.
3. Double-clicking the title still opens inline editing.
4. Clicking `详情` still expands and collapses details.
5. Clicking the X still invokes the existing delete confirmation path.
6. Dragging a node still moves only the node and keeps the lane/stage geometry synchronized.

Capture a final screenshot under `output/playwright/editor-flow-node-visual.png` and run `git diff --check`. Do not commit or push unless separately requested.

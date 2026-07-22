# Flow Structure Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded hierarchy sidebar with a scrollable flow tree, on-demand draggable stage/lane management drawers, and one derived learning-order presentation.

**Architecture:** The persisted `CanvasDocument` remains unchanged. A pure ordering helper normalizes stage/lane `order` values; `GuideEditor` commits those results; `HierarchyPanel` manages only transient UI state for drawers, disclosure, and drag targets. The inspector loses its duplicated lesson list and the tree displays the existing semantic positions.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS, existing `@phosphor-icons/react` icons.

## Global Constraints

- Preserve the existing `CanvasDocument.stages`, `CanvasDocument.lanes`, semantic outline, and attachment schema.
- Do not add a dependency for drag-and-drop.
- Keep resources visually nested but globally numbered through `deriveSemanticFlow(document)`.
- Respect `editingLocked` for every mutating control.
- The worktree is shared and dirty: modify only the listed files, do not stage, commit, publish, or reset unrelated work.

---

### Task 1: Ordered hierarchy reordering helper

**Files:**

- Create: `apps/web/src/features/editor/hierarchy-order.ts`
- Create: `apps/web/src/features/editor/hierarchy-order.test.ts`

**Interfaces:**

- Produces: `type HierarchyDropPlacement = 'before' | 'after'`.
- Produces: `reorderHierarchyItems<T extends { id: string; order: number }>(items: T[], sourceId: string, targetId: string, placement: HierarchyDropPlacement): T[] | null`.
- Consumed by: stage and lane reorder handlers in `GuideEditor.tsx`.

- [ ] **Step 1: Write the failing order-normalization tests.**

```ts
it('moves a source item before the target and normalizes all order fields', () => {
  expect(reorderHierarchyItems([
    { id: 'proposal', order: 0 },
    { id: 'sourcing', order: 1 },
    { id: 'sampling', order: 2 },
  ], 'sampling', 'sourcing', 'before')).toEqual([
    { id: 'proposal', order: 0 },
    { id: 'sampling', order: 1 },
    { id: 'sourcing', order: 2 },
  ]);
});

it('returns null for a same-item or missing-item drop', () => {
  const items = [{ id: 'proposal', order: 0 }];
  expect(reorderHierarchyItems(items, 'proposal', 'proposal', 'before')).toBeNull();
  expect(reorderHierarchyItems(items, 'missing', 'proposal', 'before')).toBeNull();
});
```

- [ ] **Step 2: Run the helper test and confirm it fails because the module does not exist.**

Run: `pnpm --dir apps/web test -- hierarchy-order.test.ts`

Expected: Vitest reports that `./hierarchy-order` cannot be resolved.

- [ ] **Step 3: Implement the smallest pure reorder helper.**

```ts
export type HierarchyDropPlacement = 'before' | 'after';

export function reorderHierarchyItems<T extends { id: string; order: number }>(items: T[], sourceId: string, targetId: string, placement: HierarchyDropPlacement): T[] | null {
  if (sourceId === targetId) return null;
  const ordered = [...items].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
  const targetIndex = ordered.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return null;
  const [source] = ordered.splice(sourceIndex, 1);
  const nextTargetIndex = ordered.findIndex((item) => item.id === targetId);
  ordered.splice(nextTargetIndex + (placement === 'after' ? 1 : 0), 0, source!);
  return ordered.map((item, order) => ({ ...item, order }));
}
```

- [ ] **Step 4: Re-run the helper test.**

Run: `pnpm --dir apps/web test -- hierarchy-order.test.ts`

Expected: both tests pass.

### Task 2: Compact management triggers and draggable drawer

**Files:**

- Modify: `apps/web/src/features/editor/HierarchyPanel.tsx`
- Modify: `apps/web/src/features/editor/HierarchyPanel.test.tsx`

**Interfaces:**

- Consumes: `HierarchyDropPlacement` and reorder callbacks `onReorderStage` / `onReorderLane`.
- Produces: compact trigger buttons, a single visible management drawer, native drag events, and keyboard move fallback.

- [ ] **Step 1: Write failing component tests for the replacement interaction.**

```tsx
it('keeps stage and lane editors out of the main tree until its trigger is opened', async () => {
  const user = userEvent.setup();
  render(<HierarchyPanel {...props} />);
  expect(screen.queryByRole('textbox', { name: '业务阶段 订单录入' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '管理业务阶段' }));
  expect(screen.getByRole('region', { name: '业务阶段管理' })).toBeVisible();
});

it('sends a before-target reorder when a stage is dropped on a stage row', () => {
  render(<HierarchyPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '管理业务阶段' }));
  fireEvent.dragStart(screen.getByRole('button', { name: '拖动阶段 打样 排序' }));
  fireEvent.drop(screen.getByRole('listitem', { name: '阶段 订单录入' }));
  expect(props.onReorderStage).toHaveBeenCalledWith('sampling', 'entry', 'before');
});
```

- [ ] **Step 2: Run the panel test and confirm it fails on the absent compact trigger and reorder callback.**

Run: `pnpm --dir apps/web test -- HierarchyPanel.test.tsx`

Expected: the test cannot find `管理业务阶段` and the prop does not exist.

- [ ] **Step 3: Replace always-open manager sections with management controls and a secondary drawer.**

Implement a local `activeManager` state, a `HierarchyManagerDrawer` component, `draggable` grip buttons, target placement state, `onDragStart`, `onDragOver`, `onDrop`, and `onKeyDown` for `Alt+ArrowUp` / `Alt+ArrowDown`. Preserve title draft behavior so empty text can be edited locally before a non-empty value is committed.

- [ ] **Step 4: Re-run the panel tests.**

Run: `pnpm --dir apps/web test -- HierarchyPanel.test.tsx`

Expected: existing tree tests and the new drawer/drag tests pass.

### Task 3: Hierarchy tree and scroll containment

**Files:**

- Modify: `apps/web/src/features/editor/HierarchyPanel.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`

**Interfaces:**

- Produces: `hierarchy-panel-scroll`, collapsible stage roots, appendix groups, global sequence badges, and an independently scrollable drawer.

- [ ] **Step 1: Add failing CSS and tree-disclosure tests.**

```ts
it('keeps the hierarchy scroll viewport inside the workspace', () => {
  expect(stylesheet).toMatch(/\.hierarchy-panel-shell\s*\{[^}]*min-height:\s*0[^}]*height:\s*100%[^}]*overflow:\s*visible[^}]*\}/s);
  expect(stylesheet).toMatch(/\.hierarchy-panel-scroll\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable[^}]*\}/s);
});
```

```tsx
it('groups an owner resources into a collapsible appendix while keeping global positions', async () => {
  const user = userEvent.setup();
  render(<HierarchyPanel {...props} />);
  await user.click(screen.getByRole('button', { name: '展开 录入订单 的资料附录' }));
  expect(screen.getByRole('button', { name: '选择资料 核对订单字段' })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused tests and confirm both fail.**

Run: `pnpm --dir apps/web test -- HierarchyPanel.test.tsx styles.test.ts`

Expected: absence of `hierarchy-panel-scroll` and the appendix disclosure control causes failures.

- [ ] **Step 3: Implement hierarchy structure and stylesheet rules.**

Move the scroll boundary from `.hierarchy-panel` to `.hierarchy-panel-scroll`, constrain `.hierarchy-panel-shell` with `height: 100%` and `min-height: 0`, and use `overflow: visible` only so the drawer can overlay the canvas. Add stage and appendix disclosure controls, continuous semantic order chips, an owner-to-resource connector rail, and narrow-screen drawer positioning.

- [ ] **Step 4: Re-run the focused tests.**

Run: `pnpm --dir apps/web test -- HierarchyPanel.test.tsx styles.test.ts`

Expected: all hierarchy and stylesheet assertions pass.

### Task 4: Persist reordering and merge the editor's learning-path presentation

**Files:**

- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**

- Consumes: `reorderHierarchyItems` and the `HierarchyPanel` reorder callbacks.
- Produces: persisted stage/lane order changes and removal of the inspector's duplicate lesson list.

- [ ] **Step 1: Write a failing editor integration test.**

```tsx
it('persists a stage order changed from the hierarchy drag drawer', async () => {
  render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
  await screen.findByDisplayValue('订单教学');
  await user.click(screen.getByRole('button', { name: '展开业务流程' }));
  await user.click(screen.getByRole('button', { name: '管理业务阶段' }));
  fireEvent.keyDown(screen.getByRole('button', { name: '拖动阶段 打样 排序' }), { key: 'ArrowUp', altKey: true });
  await user.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(lastSavedDocument(api).stages).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'sampling', order: 1 }),
  ]));
});
```

- [ ] **Step 2: Run the focused editor test and confirm it fails because the new interaction is not wired to document commits.**

Run: `pnpm --dir apps/web test -- GuideEditor.test.tsx`

Expected: missing drag-handle control or unchanged saved stage order.

- [ ] **Step 3: Wire drawer reorders to document commits and remove the duplicate inspector list.**

Import `reorderHierarchyItems`, add `reorderStage` and `reorderLane` callbacks next to the existing move callbacks, pass them to `HierarchyPanel`, and replace the inspector's `step-summary` block with no duplicate list. Keep the lesson count in `HierarchyPanel` through its existing `deriveSemanticFlow(document)` calculation.

- [ ] **Step 4: Re-run the focused editor test.**

Run: `pnpm --dir apps/web test -- GuideEditor.test.tsx`

Expected: the saved document has normalized reordered stage order and no other editor test regresses.

### Task 5: Full validation and visual smoke test

**Files:**

- Review: `apps/web/src/features/editor/HierarchyPanel.tsx`
- Review: `apps/web/src/features/editor/GuideEditor.tsx`
- Review: `apps/web/src/styles.css`

- [ ] **Step 1: Run targeted suites and type checking.**

Run: `pnpm --dir apps/web test -- hierarchy-order.test.ts HierarchyPanel.test.tsx GuideEditor.test.tsx styles.test.ts && pnpm --dir apps/web typecheck`

Expected: all targeted tests and TypeScript check pass.

- [ ] **Step 2: Run the full web test suite and diff checks.**

Run: `pnpm --dir apps/web test && git diff --check -- apps/web/src/features/editor/HierarchyPanel.tsx apps/web/src/features/editor/hierarchy-order.ts apps/web/src/features/editor/GuideEditor.tsx apps/web/src/styles.css`

Expected: all web tests pass and diff check has no output.

- [ ] **Step 3: Verify the live editor at `http://127.0.0.1:5174/guides/22c6fb40-62dc-43ab-b037-0742330d060f/edit`.**

Verify that a 900px-high viewport keeps the panel scroll area at workspace height, stage management opens as an overlay drawer, a drag reorder updates visible order, the primary/resource tree remains readable, and the inspector no longer duplicates the full lesson path.

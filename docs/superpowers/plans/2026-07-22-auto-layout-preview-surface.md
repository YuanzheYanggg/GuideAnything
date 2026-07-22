# 自动整理预览与编辑器工具栏 Implementation Plan

> **状态：已实施。** 本文记录最终实现约束。自动整理预览位于右侧 Inspector，不再位于主画布中央，也不再以工具栏 inline 内容渲染。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将子指南并入节点创建工具栏，把编辑动作固定到最右侧，移除层级组，把自动整理预览放入右侧 Inspector，并用共享 React Bits 外壳统一次级编辑弹窗和画布编辑浮层。

**Architecture:** 保留 `GuideEditor` 当前的 `layoutPreview` 状态和 `commit(layoutPreview.document)` 数据流，只改变预览 UI 的承载位置。`CanvasLayoutPreviewDialog` 由 `GuideEditor` 在 `.inspector` 内挂载；工具栏只负责节点入口和编辑动作分组。次级确认弹窗和编辑浮层复用 `EditorDialogSurface`，由它提供 `BorderGlow`、统一关闭 X 和可访问对话框语义。

**Tech Stack:** React, TypeScript, React Flow, Vitest, Testing Library, native CSS variables, `@phosphor-icons/react`, existing local React Bits primitives.

## Global Constraints

- 不改变自动整理算法、`CanvasDocument`、阶段、泳道、子指南节点或保存/撤销语义。
- 预览期间不保存；只有点击“应用自动整理”才调用现有 `commit`。
- 不新增第三方依赖，不手写 SVG 图标，复用 Phosphor 和本地 React Bits 组件。
- 保留现有无障碍标签、Escape 行为、焦点可见性和 reduced-motion 支持。
- 不提交、不推送、不清理其他用户改动。

---

### Task 1: 建立自动整理预览面板的失败测试

**Files:**
- Create: `apps/web/src/features/editor/CanvasLayoutPreviewDialog.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**
- Consumes: `HierarchyLayoutResult` from `@guideanything/canvas-core` and `onApply`, `onClose` callbacks.
- Produces: test contract for `CanvasLayoutPreviewDialog` and the editor-level preview state.

- [x] **Step 1: Write the focused dialog tests**

Add tests that render a representative `HierarchyLayoutResult` and assert:

```tsx
expect(screen.getByRole('dialog', { name: '自动整理预览' })).toBeVisible();
expect(screen.getByText('主流程 8')).toBeVisible();
expect(screen.getByText('阶段 3')).toBeVisible();
expect(screen.getByText('泳道 3')).toBeVisible();
expect(screen.getByRole('button', { name: '应用自动整理' })).toBeVisible();
```

Also cover `Escape` calling `onClose`, the close button calling `onClose`, and the apply button calling `onApply` exactly once.

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run --no-file-parallelism src/features/editor/CanvasLayoutPreviewDialog.test.tsx
```

Expected: FAIL because `CanvasLayoutPreviewDialog` does not exist yet.

- [x] **Step 3: Update editor preview assertions**

In the existing auto-layout tests, replace inline-text assertions with the new dialog contract:

```tsx
expect(screen.getByRole('dialog', { name: '自动整理预览' })).toBeVisible();
expect(screen.getByText('阶段从上到下')).toBeVisible();
expect(screen.queryByText('阶段从上到下 · 子节点向右展开')).not.toBeInTheDocument();
```

Keep all existing save-count, cancellation, disabled-state and undo assertions.

---

### Task 2: Implement the accessible Inspector preview panel

**Files:**
- Create: `apps/web/src/features/editor/CanvasLayoutPreviewDialog.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `{ layout: HierarchyLayoutResult; avoidedEdgeCount: number; onApply: () => void; onClose: () => void }`.
- Produces: a `role="dialog"` Inspector panel with close-button focus entry, Escape close, and stable callbacks. It is not a page-blocking modal.

- [x] **Step 1: Implement the dialog shell and focus behavior**

Use `BorderGlow`, `SpotlightCard`, `Sparkle`, `ArrowRight`, `GitBranch`, `Stack`, `WarningCircle`, and `X` from the existing libraries. The component must:

```tsx
return <BorderGlow ref={panelRef} className="canvas-layout-preview-panel" active tone="accent" role="dialog" aria-labelledby="canvas-layout-preview-title">
    ...
</BorderGlow>;
```

Render four core stat cards, a secondary diagnostic row, the two layout rules, and the apply/cancel actions. Focus the close action when the panel opens and clean up the global Escape listener in `useEffect`.

- [x] **Step 2: Add Inspector-scoped visual treatment**

Add styles for `.canvas-layout-preview-panel` that:

- position the preview as a full-height panel inside `.inspector`, with no header or canvas scrim;
- keep the panel within the Inspector width and allow its content to scroll independently;
- use the existing surface tokens, a single blue accent, `BorderGlow`, and `SpotlightCard`;
- make core stats a 4-column grid on desktop and a 2-column grid under 760px;
- emphasize non-zero diagnostics without decorative dots;
- disable transitions and backdrop blur under reduced-motion/transparency preferences.

- [x] **Step 3: Run focused component tests**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run --no-file-parallelism src/features/editor/CanvasLayoutPreviewDialog.test.tsx
```

Expected: PASS for rendering, apply, close, Escape, and focus behavior.

---

### Task 3: Recompose the editor toolbar and mount the panel in the Inspector

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: existing `previewLayout`, `applyLayoutPreview`, `insertReference`, `removeSelected`, and `layoutPreview` disabled guards.
- Produces: node creation group with subguide, right-aligned edit group, no layer group, Inspector-mounted preview panel.

- [x] **Step 1: Move the subguide action into the node group**

Place the existing search-opening action beside the resource node buttons, keep `aria-label="插入子指南"`, and display the compact label `子指南`. Remove the separate `editor-toolbar-group--reference` markup.

- [x] **Step 2: Move edit actions to the right and relocate deletion**

Render the edit group after the node group and set its style class to `editor-toolbar-group--edit editor-toolbar-group--edit-end`. Keep undo, redo, copy, paste, left-align, and auto-layout. Move the existing `删除选中项` button into this group. Remove the `editor-toolbar-group--layer` markup and remove the now-unused `moveLayer` callback.

- [x] **Step 3: Render preview inside `.inspector`**

Import `CanvasLayoutPreviewDialog` and render it as the first branch inside the right Inspector:

```tsx
{layoutPreview ? <CanvasLayoutPreviewDialog
  layout={layoutPreview}
  avoidedEdgeCount={routing?.report.avoidedEdgeIds.length ?? 0}
  onApply={applyLayoutPreview}
  onClose={() => setLayoutPreview(null)}
/> : null}
```

Remove the old inline `.layout-preview` JSX from the toolbar. Keep the existing preview effect and commit behavior unchanged.

- [x] **Step 4: Add editor-level regression assertions**

Extend the existing editor tests to assert:

```tsx
expect(screen.getByRole('group', { name: '添加节点' })).toContainElement(screen.getByRole('button', { name: '插入子指南' }));
expect(screen.queryByRole('group', { name: '引用与整理' })).not.toBeInTheDocument();
expect(screen.queryByRole('group', { name: '层级与删除' })).not.toBeInTheDocument();
expect(screen.getByRole('group', { name: '编辑画布' })).toContainElement(screen.getByRole('button', { name: '删除选中项' }));
```

Retain the existing search, insertion, save, undo, and preview tests.

- [x] **Step 5: Run editor tests and verify they pass**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run --no-file-parallelism src/features/editor/CanvasLayoutPreviewDialog.test.tsx src/features/editor/GuideEditor.test.tsx
```

Expected: PASS with no change to persisted document expectations.

---

### Task 4: Validate the complete visual closure

**Files:**
- Modify: `apps/web/src/styles.test.ts`
- Inspect: `apps/web/src/features/editor/GuideEditor.tsx`, `apps/web/src/features/editor/CanvasLayoutPreviewDialog.tsx`, `apps/web/src/styles.css`

- [x] **Step 1: Add stylesheet contracts**

Assert that the toolbar edit group is right-aligned, the preview panel is Inspector-scoped, and no legacy inline preview rule or canvas backdrop is required.

- [x] **Step 2: Run full Web validation**

Run:

```bash
git diff --check
pnpm --filter @guideanything/web exec vitest run --no-file-parallelism
pnpm --filter @guideanything/web build
```

Expected: all tests pass, TypeScript emits no errors, and Vite produces a production build.

- [x] **Step 3: Perform real-browser smoke validation**

Using the existing `design-audit` session:

1. Confirm the toolbar has node creation and edit groups only, with edit aligned to the right.
2. Open the subguide action from the node group and confirm the existing search modal opens.
3. Close it, click `自动整理`, and confirm the preview appears inside `.inspector`, not inside `.editor-toolbar`, `.editor-header`, or the center of `.canvas-shell`.
4. Confirm 1280px layout has no horizontal overflow, apply and cancel work, and Escape closes the dialog.
5. Capture `output/playwright/auto-layout-preview-dialog.png` and inspect it visually.

- [x] **Step 4: Review final diff**

Confirm only the requested toolbar/dialog files and the required spec/plan/test files changed; preserve all unrelated dirty worktree changes and do not commit or push.

### Task 5: Complete the shared React Bits surface

The following secondary surfaces now use `EditorDialogSurface` or a local React Bits primitive without changing their data flow:

- Guide reference search, annotated-image deletion, hierarchy deletion, and image replacement confirmation.
- Image annotation editor, edge-label editor, manual-route conflict status, and regression menu.
- Guide summary, digest review, draft history, and node-detail dialogs.

The shared surface keeps existing callbacks and keyboard behavior local to each feature. The close action is an X icon from Phosphor, and disabled async states prevent accidental dismissal.

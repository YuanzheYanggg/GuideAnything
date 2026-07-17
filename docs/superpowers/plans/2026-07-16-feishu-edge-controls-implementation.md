# Feishu-Style Edge Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized edge settings panel with a compact canvas toolbar and make the only visible endpoint control the one that can actually reconnect an edge.

**Architecture:** `EdgeToolbar` will expose one row of four icon-led triggers. Each trigger opens only its own small menu, so changing a line does not cover nearby nodes. `NodeChrome` keeps per-edge physical handles solely for route geometry, but hides them from sight and accessibility; React Flow's native `.react-flow__edgeupdater` remains the single visible and draggable endpoint. `GuideEditor` continues to persist the exact side and offset through its existing reconnect-end path.

**Tech Stack:** TypeScript 5.9, React 19, @xyflow/react 12.11.2, @phosphor-icons/react 2.1.10, Vitest 4, Testing Library, existing CSS theme tokens.

## Global Constraints

- Preserve the existing `EdgePresentation` contract and all stored color, width, pattern, arrow, side, and offset values.
- Do not introduce a UI dependency. Reuse the installed Phosphor icon family and existing CSS variables.
- Keep all toolbar choices keyboard reachable and give icon-only triggers meaningful accessible names.
- The physical `edge:<id>:source|target` handles must remain in the DOM for React Flow geometry but must no longer be visible or announced as draggable controls.
- The actual React Flow endpoint dot is the only visual reconnect affordance. It must look draggable, remain pointer-enabled, and avoid obscuring the node body.
- Preserve normal source and target connection surfaces on all four node sides.
- Run web tests from `apps/web` or with `pnpm --filter @guideanything/web`; do not use repo-root Vitest discovery.

---

## File Structure

- Modify: `apps/web/src/features/editor/EdgeToolbar.tsx` - compact trigger row, menu state, preview controls, and accessible labels.
- Modify: `apps/web/src/features/editor/EdgeToolbar.test.tsx` - prove menus are collapsed by default, apply one constrained update, and close when chosen.
- Modify: `apps/web/src/features/nodes/NodeChrome.tsx` - mark stored physical edge handles as presentation-only and inaccessible.
- Modify: `apps/web/src/features/nodes/NodeChrome.test.tsx` - prove a stored edge handle is hidden from assistive labels while continuous connection surfaces remain exposed.
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx` - capture reconnect completion callbacks and lock the persisted exact edge side/offset regression.
- Modify: `apps/web/src/styles.css` - replace the two-row fieldset panel with compact toolbar/menu styling and make only native update dots visible.

### Task 1: Compact toolbar menus

**Files:**
- Modify: `apps/web/src/features/editor/EdgeToolbar.test.tsx`
- Modify: `apps/web/src/features/editor/EdgeToolbar.tsx`

**Interfaces:**
- Consumes: `presentation?: EdgePresentation`, `onChange(partial)`, and `onClose()`.
- Produces: Four trigger buttons named `选择连线颜色`, `选择连线粗细`, `选择线型`, and `选择箭头`.
- Preserves: The same constrained partial updates (`color`, `width`, `pattern`, `arrows`) and the existing close action.

- [ ] **Step 1: Write the failing toolbar behavior tests**

Replace the first test with a collapsed-first interaction test:

```tsx
it('keeps choices compact until a trigger opens its own menu', async () => {
  const user = userEvent.setup();
  render(<EdgeToolbar presentation={{}} onChange={vi.fn()} onClose={vi.fn()} />);

  expect(screen.getByRole('button', { name: '选择连线颜色' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: '红色连线' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '选择连线颜色' }));

  expect(screen.getByRole('button', { name: '选择连线颜色' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu', { name: '连线颜色' })).toBeInTheDocument();
});

it('emits one constrained update and closes the chosen menu', async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<EdgeToolbar presentation={{}} onChange={onChange} onClose={vi.fn()} />);

  await user.click(screen.getByRole('button', { name: '选择线型' }));
  await user.click(screen.getByRole('button', { name: '点线' }));

  expect(onChange).toHaveBeenCalledWith({ pattern: 'dotted' });
  expect(screen.queryByRole('menu', { name: '线型' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the toolbar test and verify RED**

Run: `pnpm --filter @guideanything/web test -- EdgeToolbar.test.tsx`

Expected: FAIL because the current fieldset toolbar exposes every option immediately and has no trigger/menu roles.

- [ ] **Step 3: Implement the compact trigger row**

In `EdgeToolbar.tsx`:

```tsx
type EdgeToolbarMenu = 'color' | 'width' | 'pattern' | 'arrows' | null;

const menuMeta = {
  color: { trigger: '选择连线颜色', label: '连线颜色' },
  width: { trigger: '选择连线粗细', label: '连线粗细' },
  pattern: { trigger: '选择线型', label: '线型' },
  arrows: { trigger: '选择箭头', label: '箭头' },
} as const;
```

Use local `useState<EdgeToolbarMenu>(null)`. Render four icon-only trigger buttons inside a `role="toolbar"` section. Each trigger sets its own key or closes itself, exposes `aria-expanded`, and controls a `role="menu"` popover. Render the six color swatches, four width previews, three line previews, and four arrow previews only inside their corresponding menu. Route each option through one helper that calls `onChange(partial)` then `setOpenMenu(null)`. Use `Palette`, `Minus`, `LineSegments`, `ArrowRight`, and `X` from `@phosphor-icons/react`; previews remain CSS lines, not hand-drawn SVG paths.

- [ ] **Step 4: Run the toolbar test and verify GREEN**

Run: `pnpm --filter @guideanything/web test -- EdgeToolbar.test.tsx`

Expected: PASS with the two new tests plus the existing close and event-propagation checks.

### Task 2: Remove the misleading endpoint visual

**Files:**
- Modify: `apps/web/src/features/nodes/NodeChrome.test.tsx`
- Modify: `apps/web/src/features/nodes/NodeChrome.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `NodeAnchorPresentationProvider.handlesByNodeId` entries with ids such as `edge:business:target`.
- Produces: hidden geometry handles and visible native React Flow `.react-flow__edgeupdater` dots.
- Preserves: continuous source/target edge strips, route endpoints, and per-edge physical handle ids.

- [ ] **Step 1: Write the failing physical-handle accessibility test**

Extend the test mock so `Handle` forwards `id`, `className`, `aria-label`, and `aria-hidden` to a `<span>`. Add:

```tsx
it('keeps stored route handles hidden while leaving continuous surfaces exposed', () => {
  const handles = new Map([['process-1', [{
    id: 'edge:business:target', type: 'target' as const, side: 'LEFT' as const, offset: 0.4,
  }]]]);
  const { container } = render(
    <NodeAnchorPresentationProvider handlesByNodeId={handles}>
      <NodeChrome nodeId="process-1" tone="process"><strong>节点</strong></NodeChrome>
    </NodeAnchorPresentationProvider>,
  );

  const stored = container.querySelector('[data-handle-id="edge:business:target"]');
  expect(stored).toHaveAttribute('aria-hidden', 'true');
  expect(stored).not.toHaveAttribute('aria-label');
  expect(screen.getByLabelText('终点连接面 LEFT')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the node chrome test and verify RED**

Run: `pnpm --filter @guideanything/web test -- NodeChrome.test.tsx`

Expected: FAIL because stored route handles currently receive an accessible `终点连接面 LEFT` label just like active connection surfaces.

- [ ] **Step 3: Implement a single visible endpoint affordance**

In `NodeChrome.tsx`, conditionally pass the current `aria-label` only to `continuous` handles. Give non-continuous stored route handles `aria-hidden="true"` while retaining their id, type, side, offset, CSS class, and `pointer-events: none` behavior.

In `styles.css`, make `.edge-anchor-handle` completely transparent with no border or shadow. Keep it non-interactive. Make `.react-flow__edgeupdater` the distinct endpoint control: use `r: 8px`, a 3px accent stroke, solid surface fill, a restrained accent drop shadow, and `cursor: grab`; on hover or active fill it with the accent and switch to `grabbing`. Keep continuous side strips transparent until node hover or selection, and do not make any static node-edge dot visible.

- [ ] **Step 4: Run the node chrome test and verify GREEN**

Run: `pnpm --filter @guideanything/web test -- NodeChrome.test.tsx`

Expected: PASS and the only announced node-side connection targets are the continuous four-side surfaces.

### Task 3: Lock exact reconnect persistence and verify in the real canvas

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `onReconnectStart(event, edge, handleType)` and `onReconnectEnd(event, edge, handleType, connectionState)` from React Flow.
- Produces: the target `presentation.targetAnchor` with exact `{ side: 'RIGHT', offset: 0.5 }` after a reconnect ends on the target node's right side.

- [ ] **Step 1: Write the failing exact-side persistence test**

Capture `onReconnectStart` and `onReconnectEnd` in the React Flow mock and add:

```tsx
it('persists the target on the exact right-side drop point after reconnecting', async () => {
  const edgeDocument: CanvasDocument = {
    schemaVersion: 1,
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '开始', shape: 'start' } },
      { id: 'process-c', type: 'process', position: { x: 720, y: 0 }, zIndex: 1, data: { label: '后续处理', shape: 'process' } },
    ],
    edges: [{ id: 'business', source: 'start', target: 'process-c' }],
    viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['process-c'],
  };
  const api = createApi({ document: edgeDocument });
  render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
  await screen.findByDisplayValue('订单教学');
  const target = globalThis.document.querySelector<HTMLElement>('.react-flow__node[data-id="process-c"]')!;
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 720, top: 0, width: 240, height: 104 } as DOMRect);

  act(() => reactFlowCallbacks.onReconnectStart?.({} as MouseEvent, reactFlowCallbacks.edges[0]!, 'target'));
  act(() => reactFlowCallbacks.onReconnectEnd?.({ clientX: 960, clientY: 52 } as MouseEvent, reactFlowCallbacks.edges[0]!, 'target', { toNode: { id: 'process-c' } }));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

  await waitFor(() => expect(api.saveGuide).toHaveBeenCalled());
  expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
    document: expect.objectContaining({ edges: [expect.objectContaining({
      id: 'business', presentation: expect.objectContaining({ targetAnchor: { side: 'RIGHT', offset: 0.5 } }),
    })] }),
  }));
});
```

- [ ] **Step 2: Run the focused editor test and verify RED**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: FAIL until the test harness forwards React Flow reconnect completion callbacks to the editor.

- [ ] **Step 3: Forward callbacks and preserve current reconciliation behavior**

Extend the local React Flow mock parameter list and `reactFlowCallbacks` storage for `onReconnectStart` and `onReconnectEnd`:

```tsx
onReconnectStart: undefined as undefined | ((event: unknown, edge: Edge, handleType: 'source' | 'target') => void),
onReconnectEnd: undefined as undefined | ((event: unknown, edge: Edge, handleType: 'source' | 'target', connectionState: { toNode?: { id: string } | null }) => void),
```

Destructure both callback props in the mocked `ReactFlow`, assign them to `reactFlowCallbacks`, and leave the production persistence algorithm unchanged unless the focused test exposes a real data failure. If it does, retain `onReconnect` for node/handle reassignment and let `onReconnectEnd` overwrite only the dragged end using `anchorForNodeClientPoint`.

- [ ] **Step 4: Run focused tests and browser acceptance**

Run:

```bash
pnpm --filter @guideanything/web test -- EdgeToolbar.test.tsx NodeChrome.test.tsx GuideEditor.test.tsx
pnpm --filter @guideanything/web typecheck
```

Then use `http://127.0.0.1:5175` to:

1. Select an edge and confirm the toolbar is a short single row.
2. Open each small menu, choose a style, and confirm the line updates without covering the node.
3. Drag the single visible endpoint from a node's left edge to the right edge, release, and confirm the path enters the right side.
4. Refresh the editor and confirm that right-side endpoint remains there.
5. Check browser console warnings/errors are zero.

- [ ] **Step 5: Run full web checks and inspect the diff**

Run:

```bash
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/web build
git diff --check
git diff -- apps/web/src/features/editor/EdgeToolbar.tsx apps/web/src/features/editor/EdgeToolbar.test.tsx apps/web/src/features/nodes/NodeChrome.tsx apps/web/src/features/nodes/NodeChrome.test.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
```

Expected: all tests, typecheck, build, and whitespace check pass. Inspect only task-owned hunks before staging because this worktree contains pre-existing changes in overlapping files.

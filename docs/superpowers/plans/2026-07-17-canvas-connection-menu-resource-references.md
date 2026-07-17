# Canvas Connection Menu and Resource References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a node-to-canvas drag reliably offer creation when it does not end on a connectable node, and persist resource references as regular canvas edges so multiple nodes can share Markdown, image, and video material.

**Architecture:** React Flow's final connection state is the authority for deciding whether a drag ended on a node. A connection to any local canvas node creates a regular `CanvasEdge`; a release without a target opens the creation menu anywhere inside the canvas interaction surface, including an existing edge's hit area. Existing `contentParentId` remains readable for old documents, while all newly created references use regular edges.

**Tech Stack:** React 19, `@xyflow/react` 12, TypeScript, Vitest, Testing Library, Zod contracts.

## Global Constraints

- Keep derived subguide artifacts (`source`) non-connectable and non-editable.
- Preserve legacy `contentParentId` rendering and layout behavior; do not silently rewrite saved documents.
- Do not regress manual route editing, edge reconnecting, hierarchy pseudo-edges, or edge deletion.
- No new dependencies.

---

### Task 1: Lock down connection-end semantics with failing UI tests

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**
- Consumes: React Flow callbacks captured by the existing test mock.
- Produces: tests that require targetless canvas releases to open `创建下一项`, and resource targets to persist a real `CanvasEdge`.

- [ ] **Step 1: Write the failing targetless-release test**

```tsx
act(() => reactFlowCallbacks.onConnectStart?.({} as MouseEvent, {
  nodeId: 'start', handleId: 'out', handleType: 'source',
}));
act(() => reactFlowCallbacks.onConnectEnd?.({
  target: globalThis.document.createElementNS('http://www.w3.org/2000/svg', 'path'),
  clientX: 480, clientY: 240,
} as unknown as MouseEvent, { toNode: null, isValid: false }));

expect(await screen.findByRole('menu', { name: '创建下一项' })).toBeVisible();
```

- [ ] **Step 2: Run the targetless-release test and verify RED**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: the new test fails because the implementation requires `event.target` to have the `react-flow__pane` class.

- [ ] **Step 3: Write the failing resource-reference test**

```tsx
act(() => reactFlowCallbacks.onConnectStart?.({} as MouseEvent, {
  nodeId: 'process-a', handleId: 'out', handleType: 'source',
}));
act(() => reactFlowCallbacks.onConnect?.({
  source: 'process-a', sourceHandle: 'out', target: 'note', targetHandle: 'in',
}));
act(() => reactFlowCallbacks.onConnectEnd?.({} as MouseEvent, {
  toNode: { id: 'note' }, isValid: true,
}));

expect(saved.edges).toContainEqual(expect.objectContaining({
  source: 'process-a', target: 'note', sourceHandle: 'out', targetHandle: 'in',
}));
```

- [ ] **Step 4: Run the resource-reference test and verify RED**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: the new test fails because `onConnectEnd` currently rejects a Markdown target.

### Task 2: Implement final-state based creation and universal local-node edges

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/edge-presentation.ts`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**
- Consumes: `OnConnectEnd` final state (`toNode`, `isValid`), a captured `Connection`, and local canvas nodes.
- Produces: `CanvasEdge` for every valid local node-to-node connection; a menu when `toNode` is null inside the canvas surface; no menu for an actual edge reconnect.

- [ ] **Step 1: Replace exact-pane checking with interaction-surface checking**

```ts
function isCanvasInteractionSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('.react-flow__renderer'))
    && !target.closest('.react-flow__controls, .react-flow__minimap, .canvas-screen-overlay');
}
```

Use `connectionState.toNode` and `connectionState.isValid` to choose the node-connection branch. Only call `setCreationMenu` when there is no final target and this helper returns true.

- [ ] **Step 2: Allow all local nodes through connect, reconnect, and edge selection**

```ts
function isEditableBusinessEdge(document: CanvasDocument, edge: CanvasEdge): boolean {
  if (edge.hidden || edge.sourceTrace) return false;
  const source = document.nodes.find((node) => node.id === edge.source);
  const target = document.nodes.find((node) => node.id === edge.target);
  return Boolean(source && target && !source.source && !target.source);
}
```

In `GuideEditor.tsx`, replace the primary-node guard in create/connect/reconnect paths with the same `!node.source` local-node rule.

- [ ] **Step 3: Run the focused UI tests and verify GREEN**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: both new tests pass, as do pre-existing `GuideEditor` tests.

### Task 3: Persist newly created resources as reusable references

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**
- Consumes: the existing `CanvasCreationMenu` and local selected node ID.
- Produces: a real edge from the source/selected local node to the newly created Markdown/image/video node; no new `contentParentId` writes.

- [ ] **Step 1: Change the resource-creation expectation to the new contract**

```tsx
expect(markdown).not.toHaveProperty('contentParentId');
expect(saved.edges).toContainEqual(expect.objectContaining({
  source: 'process-a', target: markdown?.id,
}));
```

- [ ] **Step 2: Run the resource-creation test and verify RED**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: the test fails because the old implementation writes `contentParentId` and omits an edge.

- [ ] **Step 3: Implement real-edge creation for menu and toolbar resources**

```ts
const edge: CanvasEdge = {
  id: uniqueId('edge'), source: source.id, target: id,
  ...(sourceHandle ? { sourceHandle } : {}),
};
commit({ ...document, nodes: [...document.nodes, created], edges: [...document.edges, edge] });
```

Apply this to both `createFromConnection` and `addNode` when a selected local node is present. Leave pre-existing `contentParentId` values untouched for backward compatibility.

- [ ] **Step 4: Run the focused UI tests and verify GREEN**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: resource creation creates a reusable edge and the old-document compatibility tests remain green.

### Task 4: Validate across contracts, routing, and live editor interaction

**Files:**
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Test: `apps/web/src/features/editor/EdgeToolbar.test.tsx`

**Interfaces:**
- Consumes: the modified edge editability semantics and existing manual route controls.
- Produces: evidence that a resource edge is selectable/editable and old hierarchy presentation edges remain excluded.

- [ ] **Step 1: Add a resource-edge selection assertion**

```tsx
act(() => reactFlowCallbacks.onEdgeClick?.({} as MouseEvent, reactFlowCallbacks.edges[0]!));
expect(screen.getByRole('toolbar', { name: '连线样式' })).toBeVisible();
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: the old primary-only edge predicate hides the toolbar.

- [ ] **Step 3: Run verification after implementation**

Run: `pnpm --filter @guideanything/web test && pnpm --filter @guideanything/web typecheck && pnpm --filter @guideanything/web build && pnpm --filter @guideanything/canvas-core test && pnpm --filter @guideanything/contracts test && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 4: Browser smoke test**

In the current editor, drag a node border to an existing edge hit area without a node target and verify `创建下一项` appears. Create Markdown, then connect a second process node to it; verify both persisted edges render, the line can be selected, and browser console errors/warnings remain empty.

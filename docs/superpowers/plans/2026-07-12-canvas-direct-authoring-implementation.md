# Canvas Direct Authoring and Mixed Swimlanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors create connected nodes on canvas, label real edges, write flow-node details, and arrange work by editable stage rows and role/system swimlane columns.

**Architecture:** Keep `schemaVersion: 1`; add optional lane metadata so legacy documents parse unchanged. `canvas-core` keeps rank layout without lanes and selects a stage-row/lane-column grid with lanes. The editor owns menus, edge-label editing, and viewport overlays; derived artifacts and attached resources inherit context only for display.

**Tech Stack:** TypeScript, Zod 4, React 19, React Flow 12, Vitest, Testing Library, Vite.

## Global Constraints

- `schemaVersion` remains `1`; `lanes` and `laneId` are optional.
- Only source-free primary nodes own `stageId` or `laneId`; resources use only `contentParentId`.
- Source-derived nodes never enter host lane ownership, automatic layout, stage bounds, or lane bounds.
- Do not add dependencies or persist React Flow-only presentation metadata in `CanvasNode.data`.
- A document without lanes keeps the current rank layout exactly.
- Do not commit SQLite data, uploads, screenshots, or `.superpowers/sdd` reports.

---

### Task 1: Add responsibility-lane contracts

**Files:**
- Modify: `packages/contracts/src/canvas.ts`
- Modify: `packages/contracts/src/canvas.test.ts`

**Interfaces:**
- Produces: `FlowLaneSchema`, `FlowLane`, optional `CanvasDocument.lanes`, and optional `CanvasNode.laneId`.
- Guarantees: lane IDs are unique and only source-free primary nodes may point to existing lanes.

- [ ] **Step 1: Write failing tests for valid and invalid lane ownership**

Add to `canvas.test.ts`:

```ts
it('accepts mixed role and system lanes on a source-free primary', () => {
  const result = CanvasDocumentSchema.safeParse(hierarchyDocument({
    lanes: [
      { id: 'sales', title: '销售人员', kind: 'ROLE', order: 0 },
      { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
    ],
    nodes: [{ ...hierarchyDocument().nodes[0], laneId: 'sales' }, hierarchyDocument().nodes[1]],
  }));
  expect(result.success).toBe(true);
});

it('rejects duplicate, missing, resource, and derived lane assignments', () => {
  const lane = { id: 'sales', title: '销售人员', kind: 'ROLE', order: 0 };
  expect(CanvasDocumentSchema.safeParse(hierarchyDocument({ lanes: [lane, { ...lane, title: '重复', order: 1 }] })).success).toBe(false);
  expect(CanvasDocumentSchema.safeParse(hierarchyDocument({ lanes: [lane], nodes: [{ ...hierarchyDocument().nodes[0], laneId: 'missing' }] })).success).toBe(false);
  expect(CanvasDocumentSchema.safeParse(hierarchyDocument({ lanes: [lane], nodes: [{ ...hierarchyDocument().nodes[0], laneId: 'sales' }, { ...hierarchyDocument().nodes[1], laneId: 'sales' }] })).success).toBe(false);
  expect(CanvasDocumentSchema.safeParse(hierarchyDocument({
    lanes: [lane],
    nodes: [{ ...hierarchyDocument().nodes[0], laneId: 'sales' }, { ...hierarchyDocument().nodes[0], id: 'derived', laneId: 'sales', source: sourceTrace('reference-1', 'derived-flow') }],
  })).success).toBe(false);
});
```

- [ ] **Step 2: Verify the tests are red**

Run: `pnpm --filter @guideanything/contracts test -- canvas.test.ts`

Expected: FAIL because `lanes` and `laneId` have no schema or ownership validation.

- [ ] **Step 3: Implement optional lane metadata and validation**

Add before `CanvasDocumentSchema`:

```ts
export const FlowLaneSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(120),
  kind: z.enum(['ROLE', 'SYSTEM']),
  order: z.number().int().min(0).max(10_000),
});
```

Add `laneId: IdSchema.optional()` to `NodeBaseSchema`, `lanes: z.array(FlowLaneSchema).max(200).optional()` to `CanvasDocumentSchema`, and export `FlowLane`. In `superRefine`, create `seenLaneIds` and `laneIds`; reject duplicate lanes and reject `node.laneId` when `!primary || !laneIds.has(node.laneId)` with message `责任泳道只能标记存在的一级主流程节点`.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @guideanything/contracts test -- canvas.test.ts && pnpm --filter @guideanything/contracts typecheck`

Expected: valid mixed lanes parse; all invalid lane references fail; old tests remain green.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts
git commit -m "feat: add responsibility lane contracts"
```

---

### Task 2: Implement stage-row and lane-column automatic layout

**Files:**
- Modify: `packages/canvas-core/src/hierarchy.ts`
- Modify: `packages/canvas-core/src/hierarchy.test.ts`
- Modify: `packages/canvas-core/src/index.ts`

**Interfaces:**
- Consumes: `FlowLane`, `CanvasNode.laneId`, rank/cycle/attachment helpers.
- Produces: `SwimlaneBounds`, `getSwimlaneBounds(document)`, and `HierarchyLayoutReport.laneCount`.
- Guarantees: lanes opt into a deterministic grid; no-lane documents keep the current rank algorithm; derived nodes are untouched.

- [ ] **Step 1: Write a failing grid-layout test**

In `hierarchy.test.ts`, add `prepare`/`entry` stages, `sales` ROLE / `erp` SYSTEM lanes, source-free `collect`, `enter`, `save`, and `attached-note` owned by `enter`. Add a remote derived node. Assert:

```ts
expect(byId.get('collect')!.position.y).toBeLessThan(byId.get('enter')!.position.y);
expect(byId.get('collect')!.position.x).toBeLessThan(byId.get('enter')!.position.x);
expect(byId.get('save')!.position.x).toBe(byId.get('enter')!.position.x);
expect(byId.get('attached-note')!.position.x).toBe(byId.get('enter')!.position.x);
expect(byId.get('attached-note')!.position.y).toBeGreaterThan(byId.get('enter')!.position.y);
expect(result.report.laneCount).toBe(2);
expect(getSwimlaneBounds(result.document).map((lane) => lane.title)).toEqual(['销售人员', 'ERP']);
expect(byId.get('derived')!.position).toEqual({ x: 9_000, y: 8_000 });
```

Keep all existing no-lanes tests unchanged as the legacy-layout regression.

- [ ] **Step 2: Verify the layout test is red**

Run: `pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts`

Expected: FAIL because lane metadata, lane bounds, and grid placement are absent.

- [ ] **Step 3: Implement the lane grid without changing the legacy path**

Add this exported interface and helper names in `hierarchy.ts`:

```ts
export interface SwimlaneBounds {
  laneId: string;
  title: string;
  kind: FlowLane['kind'];
  x: number;
  y: number;
  width: number;
  height: number;
}
```

Implement exported `getSwimlaneBounds(document: CanvasDocument): SwimlaneBounds[]`. Create `orderedLanes` and `placePrimaryInGrid`. `layoutFlowHierarchy` selects it only when `orderedLanes(document.lanes ?? []).length > 0`:

```ts
const positioned = lanes.length > 0
  ? placePrimaryInGrid(primary, ranked.rankById, document.stages ?? [], lanes, contentByParent, document.edges)
  : placePrimary(primary, ranked.rankById, rankX, document.stages ?? [], contentByParent, document.edges);
```

`placePrimaryInGrid` groups source-free primary nodes by valid `stageId` and `laneId`, orders each cell using current rank plus `orderRankNodes`, stacks each primary node and attached content vertically, then calculates row heights and column widths from the largest cell. Stages order top-to-bottom by `order,id`; lanes order left-to-right by `order,id`. Add unassigned row/column only when needed. `getStageBounds` must span all configured lane columns in grid mode, including empty configured stages; `getSwimlaneBounds` must include empty configured lanes. Preserve the source-derived early return in all bounds/layout paths. Add `laneCount: lanes.length` to `HierarchyLayoutReport` and `reportFor`; export the new helper in `index.ts`.

- [ ] **Step 4: Verify layout and performance green**

Run: `pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts performance.test.ts && pnpm --filter @guideanything/canvas-core typecheck`

Expected: grid positions are deterministic, attached content stays in its lane, source-derived nodes remain fixed, and all legacy tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/canvas-core/src/hierarchy.ts packages/canvas-core/src/hierarchy.test.ts packages/canvas-core/src/index.ts
git commit -m "feat: arrange workflows by stage and responsibility"
```

---

### Task 3: Add editable stage/lane management and responsibility presentation

**Files:**
- Modify: `apps/web/src/features/editor/HierarchyPanel.tsx`
- Modify: `apps/web/src/features/editor/HierarchyPanel.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/features/nodes/FlowNode.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `FlowLane`, `getStageBounds`, `getSwimlaneBounds`.
- Produces: controlled stage/lane callbacks, a `责任泳道` select, node badges, and viewport stage/lane overlays.
- Guarantees: all author changes use `commit`; responsibility presentation metadata never reaches saved node data.

- [ ] **Step 1: Write failing author UI tests**

Use a fixture with stage `订单录入` and SYSTEM lane `ERP`. In `HierarchyPanel.test.tsx`, assert:

```ts
expect(screen.getByRole('textbox', { name: '业务阶段 订单录入' })).toHaveValue('订单录入');
expect(screen.getByRole('button', { name: '添加角色泳道' })).toBeVisible();
expect(screen.getByRole('button', { name: '添加系统泳道' })).toBeVisible();
expect(screen.getByRole('textbox', { name: '责任泳道 ERP' })).toHaveValue('ERP');
expect(screen.getByText('系统')).toBeVisible();
```

In `GuideEditor.test.tsx`, rename a stage, add an ERP system lane, assign it through `责任泳道`, save, and assert `stages`, `lanes`, and primary `laneId` in `saveGuide`. Also assert a ViewportPortal header contains `ERP` and `系统`, while persisted node `data` has no presentation-only responsibility field.
Assert the layout preview includes `泳道 1` when `HierarchyLayoutReport.laneCount` is non-zero.

- [ ] **Step 2: Verify author UI tests are red**

Run: `pnpm --filter @guideanything/web test -- HierarchyPanel.test.tsx GuideEditor.test.tsx`

Expected: FAIL because stage rename, lane manager, lane select, and lane overlays are absent.

- [ ] **Step 3: Implement management and overlays**

Extend `HierarchyPanelProps` with these controlled callbacks:

```ts
onUpdateStage: (stageId: string, title: string) => void;
onMoveStage: (stageId: string, direction: -1 | 1) => void;
onAddLane: (kind: FlowLane['kind']) => void;
onUpdateLane: (laneId: string, title: string) => void;
onMoveLane: (laneId: string, direction: -1 | 1) => void;
```

Render a labelled `业务阶段` manager before the existing tree: text inputs, 上移/下移, and `添加阶段`. Render a `责任泳道` manager: text inputs, `角色`/`系统` badges, 上移/下移, `添加角色泳道`, and `添加系统泳道`. All mutations disable under `editingLocked`.

In `GuideEditor`, each callback calls `commit` once; rename only changes `title`, moving reindexes all `order`, and adding creates `{ id: uniqueId('lane'), title: kind === 'ROLE' ? '新角色' : '新系统', kind, order: lanes.length }`. Extend `NodeInspector` with `责任泳道` for primary nodes.

Change `toFlowNodes(nodes, selectedIds, lanes)` to add non-persisted `responsibility: { title, kind }` to primary React Flow data. Update `fromFlowNodes` to remove `responsibility` before it returns `CanvasNode.data`. Render a compact responsibility badge in `FlowNode`. In `ViewportPortal`, render `getSwimlaneBounds(renderedDocument)` as pointer-inert `.swimlane-column` elements and retain stage rows above them. Add responsive CSS for the two managers, overlays, badges, and description clamp.

Add `泳道 {layoutPreview.report.laneCount}` to the existing layout preview summary. Use `NodeProps.id` directly for FlowNode’s description test id; do not put a node id into presentation data.

- [ ] **Step 4: Verify author UI green**

Run: `pnpm --filter @guideanything/web test -- HierarchyPanel.test.tsx GuideEditor.test.tsx && pnpm --filter @guideanything/web typecheck`

Expected: stage/lane naming, ordering, assignment, headers, badges, and clean persistence all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/editor/HierarchyPanel.tsx apps/web/src/features/editor/HierarchyPanel.test.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/features/nodes/FlowNode.tsx apps/web/src/styles.css
git commit -m "feat: manage workflow stages and swimlanes"
```

---

### Task 4: Add direct node creation, edge labels, and flow details

**Files:**
- Create: `apps/web/src/features/editor/CanvasCreationMenu.tsx`
- Create: `apps/web/src/features/editor/CanvasCreationMenu.test.tsx`
- Create: `apps/web/src/features/editor/EdgeLabelEditor.tsx`
- Create: `apps/web/src/features/editor/EdgeLabelEditor.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: creation-menu and edge-label overlays; `onConnectStart`, `onConnectEnd`, and `onEdgeDoubleClick` handlers.
- Guarantees: primary choices create one node plus one real edge; resource choices create one `contentParentId` resource and no real edge; only real host edges may have labels.

- [ ] **Step 1: Write failing direct-authoring tests**

Extend the React Flow mock in `GuideEditor.test.tsx` to capture `onConnectStart`, `onConnectEnd`, and `onEdgeDoubleClick`. Give its `onInit` instance `screenToFlowPosition: vi.fn(({ x, y }) => ({ x, y }))`. Add tests that invoke a source start (`start`/`out`) and an empty `.react-flow__pane` end at `(480, 240)`:

```ts
expect(await screen.findByRole('menu', { name: '创建下一项' })).toBeVisible();
await user.click(screen.getByRole('menuitem', { name: '创建流程节点' }));
await user.click(screen.getByRole('button', { name: '保存草稿' }));
expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
  document: expect.objectContaining({
    nodes: expect.arrayContaining([expect.objectContaining({ type: 'process', position: { x: 480, y: 240 } })]),
    edges: expect.arrayContaining([expect.objectContaining({ source: 'start', sourceHandle: 'out', target: expect.stringMatching(/^process-/) })]),
  }),
}));
```

Add a second test using `process-a` source and `创建说明资料`; assert a Markdown has `contentParentId: 'process-a'` and no edge targets its ID. Add edge-label test: double-click persisted `flow-edge`, type `提交审核`, press Enter, save, and assert `label`; double-click `hierarchy:note` and assert no `编辑连线标注` dialog. Add node-detail test that fills `节点明细`, saves `data.description`, and observes `data-testid="flow-description-process-a"` with `flow-description` CSS class. In the new overlay unit tests, assert Escape cancels and a non-primary source receives no resource menu items.

- [ ] **Step 2: Verify direct-authoring tests are red**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx CanvasCreationMenu.test.tsx EdgeLabelEditor.test.tsx`

Expected: FAIL because callbacks, overlays, detail input, and transactional mutations do not exist.

- [ ] **Step 3: Create controlled overlay components**

Create `CanvasCreationMenu` with `role="menu"`, `aria-label="创建下一项"`, and exact item names `创建流程节点`, `创建判断节点`, `创建数据节点`, `创建结束节点`, `创建说明资料`, `创建图片资料`, and `创建视频资料`. Render resource choices only under `allowResources`; include `取消`.

Create `EdgeLabelEditor` with `role="dialog"`, `aria-label="编辑连线标注"`, an auto-focused `连线标注` input, Save/Cancel buttons, Enter-to-save and Escape-to-cancel. It passes a trimmed empty value to `onSave`.

- [ ] **Step 4: Wire atomic document changes into GuideEditor**

Store `{ sourceId, sourceHandle }` in a ref on `onConnectStart`. On `onConnectEnd`, only when preview is off, source is source-free primary, `flowInstance` exists, and the event target has `.react-flow__pane`, open the menu using `flowInstance.screenToFlowPosition(clientPoint(event))`. Clear the menu on Escape, pane click, and preview entry.

For a menu choice, create the new node exactly at that flow position. `process`, `decision`, `data`, and `end` inherit the source `stageId`/`laneId` and append `{ id, source, sourceHandle, target }`. `markdown`, `image`, and `video` append no edge and set `contentParentId: source.id`. Make one `commit`, select the new node, close the menu.

On `onEdgeDoubleClick`, reject IDs beginning `hierarchy:` and persisted edges with `sourceTrace`. For other persisted edges, open `EdgeLabelEditor` near the client point. Its save maps only that edge and deletes `label` for an empty value, then makes one `commit`.

Add `节点明细` textarea immediately after `节点标题` for all FlowData nodes. It writes `description: event.target.value || undefined`. Use `FlowNode`’s existing `NodeProps.id` to expose `flow-description-{id}` and add a two-line `.flow-description` clamp plus menu/dialog focus styles.

- [ ] **Step 5: Verify direct authoring green**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx CanvasCreationMenu.test.tsx EdgeLabelEditor.test.tsx && pnpm --filter @guideanything/web typecheck`

Expected: creation, cancellation, label persistence, description persistence, and preview immutability pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/editor/CanvasCreationMenu.tsx apps/web/src/features/editor/CanvasCreationMenu.test.tsx apps/web/src/features/editor/EdgeLabelEditor.tsx apps/web/src/features/editor/EdgeLabelEditor.test.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
git commit -m "feat: author workflow directly on canvas"
```

---

### Task 5: Show responsibility to learners and verify the full workflow

**Files:**
- Modify: `apps/web/src/features/lesson/LessonPage.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `README.md`
- Modify: `docs/PRD.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/PROGRESS.md`

**Interfaces:**
- Produces: `resolveStepLane(document, nodeId)` and a learner responsibility badge.
- Guarantees: legacy lessons show no badge; source-derived steps resolve their reference node’s lane for display only.

- [ ] **Step 1: Write failing learner-responsibility tests**

Add `lanes: [{ id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 0 }]` and `laneId: 'erp'` to the hierarchy lesson fixture. Add:

```ts
expect(resolveStepLane(hierarchyVersion.document, 'intro')).toEqual(expect.objectContaining({ title: 'ERP', kind: 'SYSTEM' }));
expect(resolveStepLane(hierarchyVersion.document, 'expanded-copy')).toEqual(expect.objectContaining({ title: 'ERP' }));
render(<LessonPage versionId="hierarchy" api={api} onBack={vi.fn()} />);
expect(await screen.findByText('系统 · ERP')).toBeVisible();
expect(resolveStepLane(version.document, 'intro')).toBeNull();
```

- [ ] **Step 2: Verify learner tests are red**

Run: `pnpm --filter @guideanything/web test -- LessonPage.test.tsx`

Expected: FAIL because lane lookup and responsibility UI do not exist.

- [ ] **Step 3: Implement learner context and accurate docs**

Implement and export:

```ts
export function resolveStepLane(document: CanvasDocument, nodeId: string): FlowLane | null {
  const node = document.nodes.find((item) => item.id === nodeId);
  const ownerId = node?.source?.referenceNodeId ?? node?.contentParentId ?? nodeId;
  const owner = document.nodes.find((item) => item.id === ownerId);
  return owner && !owner.source && owner.laneId
    ? document.lanes?.find((lane) => lane.id === owner.laneId) ?? null
    : null;
}
```

Map lesson steps to `{ step, stage, lane }`; in `.lesson-step-meta`, render `责任 · {title}` for ROLE or `系统 · {title}` for SYSTEM only when a lane exists. Update README, PRD, ACCEPTANCE, and PROGRESS with named stages, mixed lanes, direct creation, edge labels, details, compatibility, and actual verification evidence.

- [ ] **Step 4: Verify learner behavior green**

Run: `pnpm --filter @guideanything/web test -- LessonPage.test.tsx && pnpm --filter @guideanything/web typecheck`

Expected: responsibility appears for host and reference-derived steps; legacy lessons remain unchanged.

- [ ] **Step 5: Run full verification and browser acceptance**

Run:

```bash
pnpm --filter @guideanything/contracts test -- canvas.test.ts
pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts performance.test.ts
pnpm --filter @guideanything/web test -- GuideEditor.test.tsx HierarchyPanel.test.tsx LessonPage.test.tsx CanvasCreationMenu.test.tsx EdgeLabelEditor.test.tsx
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git diff --check
```

Expected: all commands exit 0.

In the running app use a disposable draft: rename two stages, add one role and one system lane, assign primary nodes, preview the grid, drag-create a process and attached Markdown, label then clear a real edge, enter a long node detail, publish, and observe the learner responsibility badge. Record only observed browser results and do not commit database artifacts.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/lesson/LessonPage.tsx apps/web/src/features/lesson/LessonPage.test.tsx apps/web/src/styles.css README.md docs/PRD.md docs/ACCEPTANCE.md docs/PROGRESS.md
git commit -m "feat: explain workflow responsibility to learners"
git status --short
```

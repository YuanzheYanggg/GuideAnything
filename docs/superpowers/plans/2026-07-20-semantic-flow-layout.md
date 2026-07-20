# Semantic Flow Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让流程的编号、分支、阶段、泳道和资料归属成为可验证的语义数据，并从这些数据生成教程、矩阵布局、资料附录和走线。

**Architecture:** 在 `CanvasDocument` 上增加可选语义顺序、主资料归属和边关系字段，保持旧 JSON 可读取。`packages/canvas-core` 提供纯语义树与矩阵布局；编辑器通过明确的创建和排序动作写入语义，学习模式读取派生教程。

**Tech Stack:** TypeScript、Zod、React Flow、React、Vitest、Testing Library。

## Global Constraints

- 保持 `schemaVersion: 1`；新增字段全部可选，旧文档可读。
- 显示编号不是持久关联键；关联继续使用稳定 ID。
- 不用历史画布坐标推断新的流程顺序。
- 顶部节点类型菜单不增加常驻顺序按钮。
- `RESOURCE_REFERENCE` 不渲染为画布边。
- 测试必须先失败，再写生产代码。
- 不改数据库迁移、发布版本接口或运行时 Bridge。

---

### Task 1: Add the semantic document contract and pure outline derivation

**Files:**
- Modify: `packages/contracts/src/canvas.ts`
- Modify: `packages/contracts/src/canvas.test.ts`
- Create: `packages/canvas-core/src/semantic-flow.ts`
- Create: `packages/canvas-core/src/semantic-flow.test.ts`
- Modify: `packages/canvas-core/src/index.ts`

**Interfaces:**
- `CanvasNode.outline?: { parentId?: string; order: number; kind: 'STEP' | 'BRANCH' }`
- `CanvasNode.attachment?: { ownerNodeId: string; order: number }`
- `CanvasEdge.semantic?: { kind: 'FLOW' | 'BRANCH' | 'EXCEPTION' | 'RETRY' | 'RESOURCE_REFERENCE'; order?: number }`
- `deriveSemanticFlow(document): SemanticFlow`
- `renumberSemanticFlow(document): CanvasDocument`

- [ ] **Step 1: Write failing tests**

Add contract fixtures that reject a branch whose parent is not a decision and a resource whose owner is not a primary node. Add a semantic-flow fixture that asserts `1`, `2`, `2.1`, `3`, `3.B1`, `3.B2`, and `3.R1`, plus a shared-reference fixture that emits its resource only once in lesson order.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @guideanything/contracts test -- canvas.test.ts` and `pnpm --filter @guideanything/canvas-core test -- semantic-flow.test.ts`.

Expected: the new semantic-flow test fails because the module is absent; contract expectations fail because the properties are absent.

- [ ] **Step 3: Implement the contract and derivation**

Define optional schemas and cross-field validation. Collect editable primary nodes/resources, sort siblings by semantic order then document index then ID, derive dense codes, lesson pre-order, legacy topology fallback without positions, and a reindex function.

- [ ] **Step 4: Verify GREEN**

Run the two focused tests again, then run `pnpm --filter @guideanything/contracts typecheck` and `pnpm --filter @guideanything/canvas-core typecheck`.

Expected: all four commands exit 0.

### Task 2: Implement stage/lane matrix layout and semantic routes

**Files:**
- Modify: `packages/canvas-core/src/hierarchy.ts`
- Modify: `packages/canvas-core/src/hierarchy.test.ts`
- Modify: `packages/canvas-core/src/routing.ts`
- Modify: `packages/canvas-core/src/routing.test.ts`

**Interfaces:**
- `layoutFlowHierarchy(document)` reads `deriveSemanticFlow(document)`.
- `routeCanvasEdges(document)` classifies `edge.semantic.kind` before positional fallback.
- `getAppendixGroups(document): AppendixGroupBounds[]` returns the owner, resource IDs, yellow-frame bounds, and one owner-to-group connector.

- [ ] **Step 1: Write failing tests**

Use one stage with lanes `sales`, `erp`, and `tech`; assert semantic order `sales → erp → tech → sales` leaves the first three on a row and wraps the fourth. Assert owner resources are outside the primary placement set, exception routes use outer channels, and resource references produce no route.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts routing.test.ts`.

Expected: current hierarchy is topological rather than lane-matrix based and current routing includes every edge.

- [ ] **Step 3: Implement matrix and route semantics**

Replace `placePrimary()` with semantic matrix placement. Allocate fixed lane columns, wrap on a leftward lane transition, and place owner resources in a sorted appendix track. Return one `AppendixGroupBounds` per owner so the UI can draw a single yellow frame and connector. Keep unresolved resources in a diagnostic area. Filter resource references, map semantic edge kinds to route channels, and retain manual-waypoint plus legacy fallback behavior.

- [ ] **Step 4: Verify GREEN**

Run the focused tests again and `pnpm --filter @guideanything/canvas-core typecheck`.

Expected: all commands exit 0.

### Task 3: Make editor creation and ordering semantic

**Files:**
- Modify: `apps/web/src/features/editor/CanvasCreationMenu.tsx`
- Modify: `apps/web/src/features/editor/CanvasCreationMenu.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Create: `apps/web/src/features/editor/ResourceAppendixLayer.tsx`
- Create: `apps/web/src/features/editor/ResourceAppendixLayer.test.tsx`
- Modify: `apps/web/src/features/editor/HierarchyPanel.tsx`
- Modify: `apps/web/src/features/editor/HierarchyPanel.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `createSemanticNode(document, sourceId, kind, relation): CanvasDocument`
- `insertSemanticNode(document, anchorId, placement, type): CanvasDocument`
- `addResourceReference(document, sourceNodeId, resourceId): CanvasDocument`
- `ResourceAppendixLayer({ document, viewport }): JSX.Element` renders one non-interactive yellow frame and connector per `AppendixGroupBounds`.

- [ ] **Step 1: Write failing tests**

Assert selected `8` plus toolbar “流程” creates `9` with inherited stage/lane; normal connection creates `FLOW`; decision connection creates `BRANCH/B1`; selected Markdown creates `8.R1`; explicit action creates `8.1`; a resource reference creates no flow edge but focuses its owner. Add a `ResourceAppendixLayer` fixture that asserts one `data-testid="resource-appendix-group"` and one `data-testid="resource-appendix-connector"` for two resources on the same owner.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx CanvasCreationMenu.test.tsx HierarchyPanel.test.tsx`.

Expected: current actions only create positions and ordinary edges; manual teaching authoring remains.

- [ ] **Step 3: Implement semantic editor actions**

Centralize mutations around `renumberSemanticFlow()`. Keep top toolbar type buttons. With a selected primary node, toolbar primary creation inherits stage/lane and inserts after it; connection creation chooses flow, branch or attachment by source kind. Add selected-node actions for before, after, child and reference. Render codes, resources and reference chips in the hierarchy; remove manual teaching authoring and put code changes in layout preview/history as one transaction. Render `ResourceAppendixLayer` from `GuideEditor` using the current preview-or-document geometry; style its frame yellow, make it non-interactive, and never create one connector per resource.

- [ ] **Step 4: Verify GREEN**

Run the focused Web tests again and `pnpm --filter @guideanything/web typecheck`.

Expected: all commands exit 0.

### Task 4: Derive lessons and knowledge snapshots from semantic flow

**Files:**
- Modify: `packages/canvas-core/src/flow-knowledge.ts`
- Modify: `packages/canvas-core/src/flow-knowledge.test.ts`
- Modify: `apps/web/src/features/lesson/LessonPage.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.test.tsx`
- Modify: `apps/web/src/features/lesson/LessonMap.tsx`
- Modify: `apps/web/src/features/lesson/LessonMap.test.tsx`

**Interfaces:**
- `deriveSemanticFlow(document).lessonSteps` replaces direct `document.steps` reads when semantic metadata exists.
- `RESOURCE_REFERENCE` remains in V2 relations but not lesson/map edges.

- [ ] **Step 1: Write failing tests**

Use a parent with `R1`, a child and a resource reference. Assert lesson labels `1`, `1.R1`, `1.1`; the resource occurs once; a reference focuses its owner; and the V2 snapshot emits one attachment relation plus one reference relation.

- [ ] **Step 2: Verify RED**

Run `pnpm --filter @guideanything/canvas-core test -- flow-knowledge.test.ts` and `pnpm --filter @guideanything/web test -- LessonPage.test.tsx LessonMap.test.tsx`.

Expected: current code reads only manual steps and renders all persisted edges.

- [ ] **Step 3: Implement semantic lesson fallback**

Use semantic lesson steps in the snapshot and lesson page only when semantic metadata exists; preserve old `steps[]` behavior otherwise. Compile owner attachments and references separately and filter reference edges from the read-only map.

- [ ] **Step 4: Verify GREEN**

Run the focused tests again plus canvas-core and Web typechecks.

Expected: all commands exit 0.

### Task 5: Validate the integrated feature

**Files:**
- Verify: `packages/contracts/src/canvas.ts`
- Verify: `packages/canvas-core/src/semantic-flow.ts`
- Verify: `packages/canvas-core/src/hierarchy.ts`
- Verify: `apps/web/src/features/editor/GuideEditor.tsx`
- Verify: `apps/web/src/features/lesson/LessonPage.tsx`

- [ ] **Step 1: Run focused suites**

Run contracts canvas tests, semantic-flow/hierarchy/routing/flow-knowledge canvas-core tests, and GuideEditor/CanvasCreationMenu/HierarchyPanel/LessonPage/LessonMap Web tests.

- [ ] **Step 2: Run repository validation**

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`; then inspect whitespace and the final diff.

- [ ] **Step 3: Browser smoke test and scope review**

Use an isolated development database and unused ports to verify organization, code-preview, yellow appendix, hidden reference edge, reference jump, undo and generated tutorial order. Confirm the worktree contains only this feature’s source, test and documentation changes; do not stage, commit, merge or push without a separate user request.

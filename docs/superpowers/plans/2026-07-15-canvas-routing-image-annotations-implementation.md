# Canvas Routing and Image Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic two-dimensional business-flow layout with orthogonal obstacle-aware routing, plus authorable image annotations that play as camera-guided slides and link back to guide resources.

**Architecture:** Keep the persisted `CanvasDocument` as the source of business truth. Extend image data with optional normalized annotations, keep edge routes derived in `canvas-core`, and integrate focused editor/player components through `GuideEditor` and `LessonPage` without creating a second lesson-order model.

**Tech Stack:** TypeScript 5.9, React 19, React Flow 12, Zod, Zustand, Vitest, Testing Library, Vite; no new runtime dependency.

## Global Constraints

- Work only in `.worktrees/canvas-routing-image-annotations` on branch `feature/canvas-routing-image-annotations`.
- Do not commit, push, publish, or create a pull request without separate user authorization.
- Preserve `schemaVersion: 1`; image annotations are optional and old snapshots must parse unchanged.
- Do not introduce a graph-layout library or other new runtime dependency.
- Business topology outranks stage, responsibility lane, and previous position constraints.
- Edge routes are derived presentation data and must not be persisted in `CanvasDocument`.
- Image annotation order belongs to the image node and must not create separate `LessonStep` rows.
- Preserve current stage, lane, subguide, autosave, history, media security, and lesson behavior.
- Every production behavior starts with a failing test and a verified red-green cycle.

---

### Task 1: Image Annotation Contract

**Files:**
- Modify: `packages/contracts/src/canvas.ts`
- Modify: `packages/contracts/src/canvas.test.ts`

**Interfaces:**
- Produces: exported `ImageAnnotation` inferred type.
- Produces: optional `CanvasNode<'image'>['data']['annotations']`.
- Constraints: normalized `region` coordinates, `POINT | RECT`, camera zoom `1..8`, at most 500 annotations, no duplicate IDs, no self-target.

- [ ] **Step 1: Add failing contract tests**

Add tests that parse an old image unchanged, accept point/rectangle annotations, and reject out-of-range coordinates, invalid rectangle size, duplicate annotation IDs, duplicate orders, zoom outside `1..8`, and `targetNodeId` equal to the image node ID.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @guideanything/contracts test -- canvas.test.ts`

Expected: annotation fixtures fail because `annotations` is stripped or the new invariants are not enforced.

- [ ] **Step 3: Add schemas and document-level invariants**

Define `ImageAnnotationRegionSchema`, `ImageAnnotationCameraSchema`, and `ImageAnnotationSchema`, add `annotations: z.array(...).max(500).optional()` to image data, and extend `CanvasDocumentSchema.superRefine` to reject per-image duplicate annotation IDs/orders and self-targets while deliberately allowing missing external targets.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @guideanything/contracts test -- canvas.test.ts`

Expected: all contract tests pass.

### Task 2: Annotation Domain Utilities

**Files:**
- Create: `packages/canvas-core/src/image-annotations.ts`
- Create: `packages/canvas-core/src/image-annotations.test.ts`
- Modify: `packages/canvas-core/src/index.ts`

**Interfaces:**
- Produces: `normalizeAnnotationOrder(annotations: ImageAnnotation[]): ImageAnnotation[]`.
- Produces: `resolveAnnotationTarget(document: CanvasDocument, imageNodeId: string, targetNodeId?: string): CanvasNode | null`.
- Produces: `cameraForAnnotation(annotation: ImageAnnotation): { centerX: number; centerY: number; zoom: number }`.

- [ ] **Step 1: Add failing pure-function tests**

Cover stable order normalization without input mutation, valid/missing/self target resolution, saved camera preservation, point fallback camera, and rectangle-fit fallback camera clamped to `1..8`.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @guideanything/canvas-core test -- image-annotations.test.ts`

Expected: module import fails because utilities do not exist.

- [ ] **Step 3: Implement minimal pure utilities and exports**

Use immutable arrays, deterministic `order` reindexing, document node lookup, and normalized camera calculations. Do not reference DOM dimensions.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @guideanything/canvas-core test -- image-annotations.test.ts`

Expected: all new utility tests pass.

### Task 3: Deterministic Business-Flow Placement

**Files:**
- Modify: `packages/canvas-core/src/hierarchy.ts`
- Modify: `packages/canvas-core/src/hierarchy.test.ts`
- Modify: `packages/canvas-core/src/performance.test.ts`

**Interfaces:**
- Keeps: `layoutFlowHierarchy(document: CanvasDocument): HierarchyLayoutResult`.
- Extends: `HierarchyLayoutReport` with `backEdgeIds` and `denseStageIds`.
- Produces: stages top-to-bottom, ranks left-to-right within each stage, decision branches in stable child rows, merges after all predecessors, and disconnected flow in a separate area.

- [ ] **Step 1: Add failing placement tests**

Add focused cases for two sequential stages resetting to the left baseline, a decision whose yes path remains nearest the main row and no path moves below, a diamond merge placed after both branches, a back edge reported without reversing forward ranks, and repeated layout equality.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts`

Expected: at least the stage reset and back-edge report assertions fail against the current fixed stage-by-lane grid.

- [ ] **Step 3: Refactor placement within existing pure layout boundary**

Retain current graph/ranking helpers where valid. Build ordered stage rows, assign each visible primary node to a stage row and local rank column, reserve branch child rows, calculate row height from nodes plus attached content, and place unconnected nodes below connected stage rows. Treat lanes as stable ordering hints and responsibility metadata rather than fixed columns when fixed columns conflict with flow rank.

- [ ] **Step 4: Verify GREEN and performance**

Run: `pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts performance.test.ts`

Expected: placement and existing 1,000-node tests pass within the existing test timeout.

### Task 4: Orthogonal Route Derivation

**Files:**
- Create: `packages/canvas-core/src/routing.ts`
- Create: `packages/canvas-core/src/routing.test.ts`
- Modify: `packages/canvas-core/src/index.ts`

**Interfaces:**
- Produces: `Point`, `NodeRect`, `OrthogonalRoute`, and `RoutingReport` types.
- Produces: `routeCanvasEdges(document: CanvasDocument): { routesByEdgeId: Map<string, OrthogonalRoute>; report: RoutingReport }`.
- Route includes ordered points, `kind: 'FORWARD' | 'BRANCH' | 'CROSS_STAGE' | 'BACK'`, source/target sides, and collision flag.

- [ ] **Step 1: Add failing routing tests**

Cover straight forward edges, downward decision branches, cross-stage vertical channels, back edges outside all relevant node rectangles, parallel offsets for shared channels, hidden/source-trace edge exclusion, and deterministic output. Assert each segment is horizontal or vertical and no segment intersects a non-endpoint node rectangle.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @guideanything/canvas-core test -- routing.test.ts`

Expected: module import fails because router does not exist.

- [ ] **Step 3: Implement deterministic channel router**

Build node rectangles from persisted size/default node sizes, classify edge direction from positions/stages/handles, allocate fixed-gap channels in stable edge-ID order, test candidate segments against expanded node rectangles, and shift to the next available channel when blocked. Route back edges through the outer right gutter. Return diagnostics rather than throwing; omit hierarchy presentation edges because they are not persisted.

- [ ] **Step 4: Verify GREEN and add route performance case**

Run: `pnpm --filter @guideanything/canvas-core test -- routing.test.ts performance.test.ts`

Expected: route invariants pass and the performance suite remains within timeout.

### Task 5: Custom Business Edge Rendering and Layout Diagnostics

**Files:**
- Create: `apps/web/src/features/editor/OrthogonalEdge.tsx`
- Create: `apps/web/src/features/editor/OrthogonalEdge.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `OrthogonalEdge` consumes route points through React Flow edge `data` and renders an accessible SVG path plus existing label behavior.
- `GuideEditor` derives routes for `layoutPreview?.document ?? document`, registers `edgeTypes`, and attaches route data only to real business edges.
- `LessonPage` uses the same derived routes for published flow maps.

- [ ] **Step 1: Add failing component and integration tests**

Verify orthogonal path generation, marker and label preservation, hierarchy edge style unchanged, route data attached to business edges, preview copy says “阶段从上到下 · 阶段内从左到右”, and diagnostics expose back edges/collisions when present.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @guideanything/web test -- OrthogonalEdge.test.tsx GuideEditor.test.tsx LessonPage.test.tsx`

Expected: missing component/edge type and old preview copy cause failures.

- [ ] **Step 3: Implement edge renderer and integration**

Create a small pure path builder inside `OrthogonalEdge.tsx`, use React Flow `BaseEdge`/`EdgeLabelRenderer`, register `orthogonal` in both editor and lesson maps, memoize route derivation, preserve persisted edge labels/handles/source trace, and retain `smoothstep` only as a route failure fallback.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @guideanything/web test -- OrthogonalEdge.test.tsx GuideEditor.test.tsx LessonPage.test.tsx`

Expected: all targeted edge and preview tests pass.

### Task 6: Image Annotation Editor

**Files:**
- Create: `apps/web/src/features/editor/ImageAnnotationEditor.tsx`
- Create: `apps/web/src/features/editor/ImageAnnotationEditor.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/features/nodes/ImageNode.tsx`
- Create: `apps/web/src/features/nodes/ImageNode.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `ImageAnnotationEditor` receives `node`, document nodes, resolved image source, `onChange(data)`, and `onClose()`.
- Point creation uses image-local normalized coordinates.
- Rectangle creation uses pointer-down/move/up and normalized bounds.
- Editor owns transient selected annotation, tool, pan/zoom, and draft rectangle only; persisted edits flow through `GuideEditor.commit`.

- [ ] **Step 1: Add failing editor tests**

Cover opening from the image inspector, single-click point creation, rectangle drag creation, normalized coordinates, title/body editing, target selection, saved camera, order up/down, deletion, Escape/close focus return, and undo/redo through `GuideEditor`.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @guideanything/web test -- ImageAnnotationEditor.test.tsx ImageNode.test.tsx GuideEditor.test.tsx`

Expected: missing editor entry and component cause failures.

- [ ] **Step 3: Implement focused modal editor and node summary**

Keep pointer geometry in the editor component, clamp all normalized values, use explicit point/rectangle tools, provide accessible controls, reuse `useMediaSource`, and render `N 个标注 · M 个关联资料` on `ImageNode`. Update image node creation to initialize `annotations: []` while preserving absence on old data.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @guideanything/web test -- ImageAnnotationEditor.test.tsx ImageNode.test.tsx GuideEditor.test.tsx`

Expected: editor, history, and summary tests pass.

### Task 7: Camera-Guided Image Player

**Files:**
- Create: `apps/web/src/features/lesson/ImageAnnotationPlayer.tsx`
- Create: `apps/web/src/features/lesson/ImageAnnotationPlayer.test.tsx`
- Modify: `apps/web/src/features/lesson/MediaLightbox.tsx`
- Modify: `apps/web/src/features/lesson/MediaLightbox.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `MediaPreview` image variant carries full image data and node ID.
- `ImageAnnotationPlayer` consumes image source/data, active index, target status, and navigation callback.
- Exposes previous/next, numbered jump, optional autoplay, reduced-motion behavior, and disabled broken target state.

- [ ] **Step 1: Add failing player tests**

Cover old unannotated image fallback, first annotation start, next/previous/numbered jump, saved camera transform, computed camera fallback, autoplay default off and pause after manual action, last-slide stop, reduced-motion class/transition, and broken target button.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @guideanything/web test -- ImageAnnotationPlayer.test.tsx MediaLightbox.test.tsx`

Expected: missing player and unchanged image preview model cause failures.

- [ ] **Step 3: Implement player and lightbox integration**

Use CSS transform origin/translation/scale from normalized camera data, render numbered overlays and a side explanation card, preserve existing dialog focus/Escape/body-scroll behavior, use a timer only while autoplay is enabled, cancel it on cleanup/manual navigation, and switch transitions off under `prefers-reduced-motion`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @guideanything/web test -- ImageAnnotationPlayer.test.tsx MediaLightbox.test.tsx`

Expected: player and existing media lightbox tests pass.

### Task 8: Lesson Target Navigation and Return Context

**Files:**
- Modify: `apps/web/src/features/lesson/LessonPage.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Image preview stores image node ID and current annotation index.
- Target resolver maps a target to same-step media, an explicit lesson step, a flow-map focus fallback, or existing subguide navigation.
- Closing target content returns to the source image and restores annotation index/camera.

- [ ] **Step 1: Add failing navigation tests**

Cover opening a same-step Markdown/image/video target, switching to a target's explicit lesson step, focusing a target without a step, opening a subguide target, returning to the source annotation, and disabling a deleted target.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @guideanything/web test -- LessonPage.test.tsx`

Expected: target actions are absent.

- [ ] **Step 3: Implement navigation state machine**

Keep source preview context separate from temporary target preview, reuse `handleKeypoint`, `openSubguide`, `fitView`, and current lesson index state, and avoid generating synthetic lesson steps. Restore the source preview on target close/back.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @guideanything/web test -- LessonPage.test.tsx MediaLightbox.test.tsx ImageAnnotationPlayer.test.tsx`

Expected: target navigation and media regressions pass.

### Task 9: Documentation, Full Regression, and Runtime QA

**Files:**
- Modify: `README.md`
- Modify: `docs/PRD.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/PROGRESS.md`

**Interfaces:**
- Documents the final contract, layout rules, author journey, learner journey, diagnostics, limits, and validation evidence.

- [ ] **Step 1: Update product and architecture documents**

Describe stage-down/stage-internal-right layout, orthogonal/back-edge semantics, optional image annotations, normalized coordinates, target behavior, author controls, learner playback, and backward compatibility. Update acceptance checkboxes only for behavior verified in this worktree.

- [ ] **Step 2: Run focused package validation**

Run:

```bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/canvas-core test
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/canvas-core typecheck
pnpm --filter @guideanything/web typecheck
```

Expected: all commands exit 0.

- [ ] **Step 3: Run repository-wide validation**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0; only the documented Node SQLite experimental warning may appear.

- [ ] **Step 4: Perform runtime and visual QA**

Start API on `3001` and Web on a free port such as `5174`, then verify with a guide containing a main line, decision, merge, cross-stage edge, back edge, annotated point, annotated rectangle, saved camera, valid target, and broken target. Inspect editor and learner UI at desktop and narrow widths for crossings, node intersection, clipping, overflow, focus, animation, and reduced-motion behavior. Record concrete issues and fix them through new red-green cycles.

- [ ] **Step 5: Completion audit**

Re-read every requirement in `docs/superpowers/specs/2026-07-15-canvas-routing-image-annotations-design.md`, map it to code/test/runtime evidence, inspect the final diff for unrelated changes or missing tests, and keep iterating until no required item lacks authoritative evidence.

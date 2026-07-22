# Resource Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent eye-toggle for Markdown, image, and video resources so authors can restore hidden resources while published learning views and workspace AI knowledge projections exclude them.

**Architecture:** Add an optional resource-only `visibility` field to `CanvasNode`; absence means visible. Keep hidden resources in the author document, React Flow canvas, hierarchy panel, and history, but pass their visibility as presentation data to resource node components. Filter hidden resources at the lesson projection and V1/V2 flow knowledge compiler boundaries, including resource relations, lesson targets, deep links, and materialized search fragments.

**Tech Stack:** TypeScript 5.9, Zod 4, Vitest 4, React 19, Testing Library, Phosphor Icons, React Flow 12, pnpm workspace packages.

## Global Constraints

- Preserve all existing user changes in the dirty `main` checkout; stage only the explicit feature and documentation paths.
- Use `visibility: 'VISIBLE' | 'HIDDEN'`; do not repurpose the existing structural `hidden` field.
- Missing `visibility` is backward-compatible visible state; toggle back to visible by removing the optional field.
- Only source-free Markdown, image, and video resources receive the authoring toggle; flow nodes and subguides keep their existing behavior.
- Hidden resources remain in author documents, draft history, published JSON, the author canvas, hierarchy panel, media storage, annotations, and attachment order.
- Published lesson content, lesson map nodes/edges, resource previews, annotation/keypoint targets, V1/V2 flow snapshots, and workspace flow fragments must not expose hidden resources.
- Do not start or stop an existing listener without checking its PID, command, worktree, and health first.

---

### Task 1: Add the resource visibility contract

**Files:**
- Modify: `packages/contracts/src/canvas.ts:29-41,150-165,260-390`
- Test: `packages/contracts/src/canvas.test.ts:5-40,255-286`

**Interfaces:**
- Produces `CanvasResourceVisibilitySchema` and `CanvasResourceVisibility` from `packages/contracts/src/canvas.ts`.
- Extends every inferred `CanvasNode` with an optional `visibility` field, while `CanvasDocumentSchema` rejects that field on non-resource nodes.

- [ ] **Step 1: Write the failing contract tests.**

Add this test beside the existing hierarchy schema tests in `packages/contracts/src/canvas.test.ts`:

```ts
  it('accepts hidden visibility on resources and rejects it on flow nodes', () => {
    const hiddenResource = CanvasDocumentSchema.safeParse(hierarchyDocument({
      nodes: [
        hierarchyDocument().nodes[0],
        { ...hierarchyDocument().nodes[1], visibility: 'HIDDEN' },
      ],
    }));
    const hiddenFlowNode = CanvasDocumentSchema.safeParse(hierarchyDocument({
      nodes: [
        { ...hierarchyDocument().nodes[0], visibility: 'HIDDEN' },
        hierarchyDocument().nodes[1],
      ],
    }));

    expect(hiddenResource.success).toBe(true);
    expect(hiddenResource.success && hiddenResource.data.nodes[1]).toMatchObject({ visibility: 'HIDDEN' });
    expect(hiddenFlowNode.success).toBe(false);
  });
```

- [ ] **Step 2: Run the focused contract test and verify the expected RED failure.**

Run:

```bash
pnpm --filter @guideanything/contracts test -- src/canvas.test.ts
```

Expected: the new test fails because `visibility` is currently stripped from resource nodes and is not rejected on flow nodes.

- [ ] **Step 3: Implement the minimal contract change.**

In `packages/contracts/src/canvas.ts`, add the enum before `NodeBaseSchema`, add the optional field to `NodeBaseSchema`, and reject it for non-resource node types in the existing `document.nodes.forEach` validation:

```ts
export const CanvasResourceVisibilitySchema = z.enum(['VISIBLE', 'HIDDEN']);
export type CanvasResourceVisibility = z.infer<typeof CanvasResourceVisibilitySchema>;

const NodeBaseSchema = z.object({
  id: IdSchema,
  position: PositionSchema,
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  zIndex: z.number().int(),
  hidden: z.boolean().optional(),
  visibility: CanvasResourceVisibilitySchema.optional(),
  source: SourceTraceSchema.optional(),
  stageId: IdSchema.optional(),
  laneId: IdSchema.optional(),
  contentParentId: IdSchema.optional(),
  outline: OutlineSchema.optional(),
  attachment: ResourceAttachmentSchema.optional(),
});
```

Inside the existing node validation loop, after `const content = contentTypes.has(node.type) && !node.source;`, add:

```ts
    if (node.visibility !== undefined && !contentTypes.has(node.type)) {
      context.addIssue({ code: 'custom', path: ['nodes', index, 'visibility'], message: '资料可见性只能标记 Markdown、图片或视频资料' });
    }
```

- [ ] **Step 4: Run the focused contract test and typecheck.**

Run:

```bash
pnpm --filter @guideanything/contracts test -- src/canvas.test.ts
pnpm --filter @guideanything/contracts typecheck
```

Expected: both commands exit 0 and the new contract test passes.

---

### Task 2: Exclude hidden resources from V1/V2 flow knowledge projections

**Files:**
- Modify: `packages/canvas-core/src/flow-knowledge.ts:45-105,142-144,248-368,430-441`
- Test: `packages/canvas-core/src/flow-knowledge.test.ts:86-115,193-314`

**Interfaces:**
- `compileFlowKnowledgeSnapshotV1` and `compileFlowKnowledgeSnapshotV2` continue accepting the same `CanvasDocument` input.
- Hidden resource IDs are treated as intentionally non-addressable, so links and authored edges touching them are ignored without adding a structural-error diagnostic.

- [ ] **Step 1: Write the failing V2 projection test.**

Add this case inside `describe('compileFlowKnowledgeSnapshotV2', ...)`:

```ts
  it('omits hidden resources from the snapshot, relations, learning path, and diagnostics', () => {
    const document = currentCanvasDocument();
    const hidden = {
      ...document,
      nodes: document.nodes.map((node) => node.id === 'image-proof' ? { ...node, visibility: 'HIDDEN' as const } : node),
    };

    const snapshot = compileFlowKnowledgeSnapshotV2(input(hidden));

    expect(snapshot.resources.map((resource) => resource.id)).not.toContain('image-proof');
    expect(snapshot.relations.some((relation) => (
      ('resourceId' in relation && relation.resourceId === 'image-proof')
      || ('sourceResourceId' in relation && relation.sourceResourceId === 'image-proof')
      || ('targetResourceId' in relation && relation.targetResourceId === 'image-proof')
    ))).toBe(false);
    expect(snapshot.learningPath).not.toContainEqual(expect.objectContaining({ targetResourceId: 'image-proof' }));
    expect(snapshot.diagnostics.danglingFlowEdgeIds).not.toContain('use-image-collect');
    expect(snapshot.diagnostics.invalidResourceRelationIds).not.toContain('annotation-video-image');
  });
```

Use the actual existing resource-reference ID from `currentCanvasDocument()` if the fixture names differ; the assertion must cover one hidden-resource edge and one visible-resource-to-hidden-resource reference without requiring a diagnostic.

- [ ] **Step 2: Write the failing V1 attachment test.**

Add this case inside `describe('compileFlowKnowledgeSnapshotV1', ...)`:

```ts
  it('omits hidden resources from legacy attachments while keeping visible resources', () => {
    const document = flowDocument();
    const snapshot = compileFlowKnowledgeSnapshotV1(input({
      ...document,
      nodes: document.nodes.map((node) => node.id === 'image' ? { ...node, visibility: 'HIDDEN' as const } : node),
    }));

    expect(snapshot.nodes.flatMap((node) => node.attachments).map((attachment) => attachment.nodeId)).not.toContain('image');
    expect(snapshot.nodes.flatMap((node) => node.attachments).map((attachment) => attachment.nodeId)).toContain('note');
  });
```

- [ ] **Step 3: Run the two focused compiler tests and verify RED.**

Run:

```bash
pnpm --filter @guideanything/canvas-core test -- src/flow-knowledge.test.ts
```

Expected: both new tests fail because the compiler currently includes all source-free content nodes.

- [ ] **Step 4: Implement visibility-aware compiler filtering.**

Add these helpers near the existing `isResourceNode`/`isContentNode` helpers:

```ts
function isAuthorResourceNode(node: CanvasNode): node is CanvasNode<'markdown' | 'image' | 'video'> {
  return isContentNode(node) && node.source === undefined;
}

function isVisibleResourceNode(node: CanvasNode): node is CanvasNode<'markdown' | 'image' | 'video'> {
  return isAuthorResourceNode(node) && node.visibility !== 'HIDDEN';
}
```

Use `isVisibleResourceNode` for V2 `resourcesWithOrder` and V1 `content`. In V2, compute the hidden resource ID set before compiling relations:

```ts
  const allResourceIds = new Set(document.nodes.filter(isAuthorResourceNode).map((node) => node.id));
  const hiddenResourceIds = new Set([...allResourceIds].filter((id) => !resourceIds.has(id)));
```

Pass `hiddenResourceIds` to `compileV2Relations` and `compileLearningPath`. At the start of the edge loop, ignore edges touching hidden resources; in `resourceReferencesForNode`, return no relation when `targetId` is hidden; and in `compileLearningPath`, skip hidden resource targets without adding `invalidLearningTargetIds`. Keep missing-target diagnostics unchanged.

- [ ] **Step 5: Run the compiler tests, typecheck, and inspect the diff.**

Run:

```bash
pnpm --filter @guideanything/canvas-core test -- src/flow-knowledge.test.ts
pnpm --filter @guideanything/canvas-core typecheck
git diff --check -- packages/canvas-core/src/flow-knowledge.ts packages/canvas-core/src/flow-knowledge.test.ts
```

Expected: the focused compiler suite passes and the diff check has no output.

---

### Task 3: Add the authoring eye button and reversible document update

**Files:**
- Modify: `apps/web/src/features/nodes/NodeChrome.tsx:1-115`
- Modify: `apps/web/src/features/nodes/MarkdownNode.tsx:1-25`
- Modify: `apps/web/src/features/nodes/ImageNode.tsx:1-35`
- Modify: `apps/web/src/features/nodes/VideoNode.tsx:1-45`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx:28,1152-1175,1811-1844,1422-1426`
- Modify: `apps/web/src/styles.css:370-377,421-422`
- Test: `apps/web/src/features/nodes/NodeChrome.test.tsx:90-126`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx:580-680`

**Interfaces:**
- `NodeActionProvider` gains `onToggleResourceVisibility?: (nodeId: string) => void`.
- `NodeChrome` accepts `resourceVisibility?: CanvasResourceVisibility` and renders the eye button only when that prop and the provider callback are present.
- `toggleResourceVisibilityInDocument(document, nodeId)` returns a new document and toggles only a source-free content node between absent/visible and `HIDDEN`.

- [ ] **Step 1: Write the failing NodeChrome tests.**

Add these tests to `apps/web/src/features/nodes/NodeChrome.test.tsx`:

```tsx
  it('shows an eye button for a selected visible resource and forwards its id', () => {
    const onToggleResourceVisibility = vi.fn();
    render(
      <NodeActionProvider onToggleResourceVisibility={onToggleResourceVisibility}>
        <NodeChrome nodeId="resource-1" selected tone="markdown" resourceVisibility="VISIBLE"><strong>资料</strong></NodeChrome>
      </NodeActionProvider>,
    );

    const button = screen.getByRole('button', { name: '隐藏资料' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.pointerDown(button);
    fireEvent.click(button);

    expect(onToggleResourceVisibility).toHaveBeenCalledWith('resource-1');
  });

  it('uses the restore label for a hidden resource and does not show the control on flow nodes', () => {
    const onToggleResourceVisibility = vi.fn();
    const { rerender } = render(
      <NodeActionProvider onToggleResourceVisibility={onToggleResourceVisibility}>
        <NodeChrome nodeId="resource-1" selected tone="image" resourceVisibility="HIDDEN"><strong>资料</strong></NodeChrome>
      </NodeActionProvider>,
    );

    expect(screen.getByRole('button', { name: '显示资料' })).toHaveAttribute('aria-pressed', 'true');
    rerender(
      <NodeActionProvider onToggleResourceVisibility={onToggleResourceVisibility}>
        <NodeChrome nodeId="process-1" selected tone="process"><strong>流程</strong></NodeChrome>
      </NodeActionProvider>,
    );
    expect(screen.queryByRole('button', { name: '隐藏资料' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '显示资料' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the focused NodeChrome tests and verify RED.**

Run:

```bash
pnpm --filter @guideanything/web test -- src/features/nodes/NodeChrome.test.tsx
```

Expected: the new tests fail because `NodeActionProvider` and `NodeChrome` do not yet expose visibility actions.

- [ ] **Step 3: Implement the minimal eye control.**

In `NodeChrome.tsx`, import `Eye` and `EyeSlash`, extend the context and provider props, and render the button immediately before the delete button. Use the selected state for `tabIndex`, stop pointer propagation, and call the provider callback with the node ID. Add `is-resource-hidden` to the root class when the state is `HIDDEN`, plus a visible status label `已隐藏` for resource nodes in that state.

Use this button contract:

```tsx
<button
  className="canvas-node-visibility nodrag nopan nowheel"
  type="button"
  tabIndex={selected ? 0 : -1}
  aria-label={resourceVisibility === 'HIDDEN' ? '显示资料' : '隐藏资料'}
  aria-pressed={resourceVisibility === 'HIDDEN'}
  title={resourceVisibility === 'HIDDEN' ? '显示资料' : '隐藏资料'}
  onPointerDown={(event) => event.stopPropagation()}
  onClick={(event) => {
    event.preventDefault();
    event.stopPropagation();
    if (nodeId) actions?.onToggleResourceVisibility?.(nodeId);
  }}
>
  {resourceVisibility === 'HIDDEN' ? <EyeSlash size={14} weight="bold" aria-hidden="true" /> : <Eye size={14} weight="bold" aria-hidden="true" />}
</button>
```

Pass `resourceVisibility` from MarkdownNode, ImageNode, and VideoNode using the `resourceVisibility` data added by `toFlowNodes`. Do not pass it from FlowNode or SubguideNode.

- [ ] **Step 4: Write the failing document-toggle tests.**

Import the new helper in `GuideEditor.test.tsx` and add:

```tsx
  it('toggles only a source-free resource visibility and preserves the resource on restore', () => {
    const document = {
      schemaVersion: 1 as const,
      nodes: [
        { id: 'process', type: 'process' as const, position: { x: 0, y: 0 }, zIndex: 0, data: { label: '流程', shape: 'process' as const } },
        { id: 'note', type: 'markdown' as const, position: { x: 200, y: 0 }, zIndex: 1, data: { markdown: '说明' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };
    const hidden = toggleResourceVisibilityInDocument(document, 'note');
    const restored = toggleResourceVisibilityInDocument(hidden, 'note');

    expect(hidden.nodes.find((node) => node.id === 'note')).toMatchObject({ visibility: 'HIDDEN' });
    expect(restored.nodes.find((node) => node.id === 'note')).not.toHaveProperty('visibility');
    expect(restored.nodes.find((node) => node.id === 'note')?.data).toEqual({ markdown: '说明' });
  });
```

Also extend the existing `toFlowNodes` assertions to prove a resource carries `data.resourceVisibility` as `VISIBLE` by default and `HIDDEN` when configured, while the React Flow node itself does not receive structural `hidden` from that field.

- [ ] **Step 5: Run the editor tests and verify RED.**

Run:

```bash
pnpm --filter @guideanything/web test -- src/features/editor/GuideEditor.test.tsx
```

Expected: the helper import/test fails because the helper and resource presentation data do not exist.

- [ ] **Step 6: Implement the reversible editor update and styles.**

Add `toggleResourceVisibilityInDocument` near `removeNodesFromDocument`:

```ts
export function toggleResourceVisibilityInDocument(document: CanvasDocument, nodeId: string): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== nodeId || !isContentNode(node)) return node;
      if (node.visibility === 'HIDDEN') {
        const { visibility: _visibility, ...visibleNode } = node;
        return visibleNode as CanvasNode;
      }
      return { ...node, visibility: 'HIDDEN' as const };
    }),
  };
}
```

Add a `toggleResourceVisibility` callback beside `removeNodesImmediately` that guards `document`, `layoutPreview`, and `isContentNode`, then calls `commit(toggleResourceVisibilityInDocument(document, nodeId))`. Pass it through `NodeActionProvider`.

In `toFlowNodes`, add `resourceVisibility: node.visibility ?? 'VISIBLE'` to `data` only for content nodes. Keep the existing `hidden` spread unchanged. Add CSS so the eye button shares the delete hover/focus behavior, sits at `right: 36px`, uses accent color, and the hidden resource root gets a muted border/background plus `.canvas-node-visibility-status` styling.

- [ ] **Step 7: Run the focused web tests and typecheck.**

Run:

```bash
pnpm --filter @guideanything/web test -- src/features/nodes/NodeChrome.test.tsx src/features/editor/GuideEditor.test.tsx
pnpm --filter @guideanything/web typecheck
git diff --check -- apps/web/src/features/nodes/NodeChrome.tsx apps/web/src/features/nodes/MarkdownNode.tsx apps/web/src/features/nodes/ImageNode.tsx apps/web/src/features/nodes/VideoNode.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/styles.css
```

Expected: all focused tests pass, the web typecheck exits 0, and the diff check has no output.

---

### Task 4: Enforce hidden-resource behavior in the published lesson

**Files:**
- Modify: `apps/web/src/features/lesson/LessonPage.tsx:25-55,84-126,185-193,236-243`
- Modify: `apps/web/src/features/lesson/LessonMap.tsx:50-80,167-212`
- Test: `apps/web/src/features/lesson/LessonPage.test.tsx:49-73,282-320`
- Test: `apps/web/src/features/lesson/LessonMap.test.tsx:1-110`

**Interfaces:**
- `lessonStepsForDocument`, `resourcesForStep`, and `toLessonFlowEdges` continue returning the existing shapes, but hidden resource nodes are filtered from their results.
- `LessonMap` normalizes hidden resource visibility to display-only React Flow `hidden` nodes and removes edges that touch them; the persisted `CanvasDocument` is not mutated.

- [ ] **Step 1: Write failing lesson filtering tests.**

Extend the existing `LessonPage` fixture with a resource using `visibility: 'HIDDEN'`, then add assertions:

```tsx
  it('omits hidden resources from lesson steps and attached resource content', () => {
    const document = {
      ...hierarchyVersion.document,
      steps: [
        ...hierarchyVersion.document.steps,
        { id: 'step-hidden-note', order: 3, title: '隐藏资料', nodeId: 'hidden-resource' },
      ],
      nodes: [
        ...hierarchyVersion.document.nodes,
        { id: 'hidden-resource', type: 'markdown' as const, contentParentId: 'intro', visibility: 'HIDDEN' as const, position: { x: 360, y: 360 }, zIndex: 5, data: { markdown: '# 不应出现' } },
      ],
    };

    expect(lessonStepsForDocument(document).map((step) => step.nodeId)).not.toContain('hidden-resource');
    expect(resourcesForStep(document, 'intro').map((node) => node.id)).not.toContain('hidden-resource');
  });
```

Add an edge assertion to the existing `toLessonFlowEdges` tests:

```tsx
    expect(toLessonFlowEdges({
      ...document,
      edges: [...document.edges, { id: 'hidden-resource-edge', source: 'intro', target: 'hidden-resource' }],
    })).not.toContainEqual(expect.objectContaining({ id: 'hidden-resource-edge' }));
```

Use a local document containing the hidden resource and its edge so the test does not depend on the global fixture.

- [ ] **Step 2: Run the focused lesson tests and verify RED.**

Run:

```bash
pnpm --filter @guideanything/web test -- src/features/lesson/LessonPage.test.tsx src/features/lesson/LessonMap.test.tsx
```

Expected: the new tests fail because the lesson currently checks only structural `hidden` and maps every document edge.

- [ ] **Step 3: Implement a single lesson visibility predicate and filter.**

In `LessonPage.tsx`, add a local predicate that returns true only for source-free Markdown, image, or video nodes with `visibility === 'HIDDEN'`. Use it to filter derived/author lesson steps and `resourcesForStep`. Guard all target-opening paths (`openAnnotationTarget`, `isTargetValid`, and the deep-linked annotation effect) against hidden resource nodes, returning no-op/invalid target instead of opening them.

In `LessonMap.tsx`, add `lessonDocumentForDisplay(document)` that:

```ts
export function lessonDocumentForDisplay(document: CanvasDocument): CanvasDocument {
  const hiddenResourceIds = new Set(document.nodes.filter(isHiddenResourceNode).map((node) => node.id));
  return {
    ...document,
    nodes: document.nodes.map((node) => hiddenResourceIds.has(node.id) ? { ...node, hidden: true } : node),
    edges: document.edges.filter((edge) => !hiddenResourceIds.has(edge.source) && !hiddenResourceIds.has(edge.target)),
  };
}
```

Use the normalized document for routing, flow nodes, flow edges, and stage/swimlane bounds. This keeps hidden resource cards out of the published map while preserving the original version document in state.

- [ ] **Step 4: Run the lesson tests and typecheck.**

Run:

```bash
pnpm --filter @guideanything/web test -- src/features/lesson/LessonPage.test.tsx src/features/lesson/LessonMap.test.tsx
pnpm --filter @guideanything/web typecheck
```

Expected: all focused lesson tests pass and the web typecheck remains green.

---

### Task 5: Prove the materialized AI flow index excludes hidden resources

**Files:**
- Test: `apps/api/src/modules/knowledge/knowledge.test.ts:462-529`

**Interfaces:**
- No API route or database schema change is expected; `syncGuideFlowSnapshot` already recompiles the document through `compileFlowKnowledgeSnapshotV2` and rematerializes fragments when the document checksum changes.

- [ ] **Step 1: Write the failing knowledge-index regression test.**

Add a test near the existing V2 flow snapshot materialization test:

```ts
  it('does not materialize or search a hidden flow resource', () => {
    const document = sampleDocument('# 可见流程\n保留流程内容。');
    document.nodes.push({
      id: 'hidden-resource',
      type: 'markdown',
      position: { x: 420, y: 0 },
      zIndex: 2,
      attachment: { ownerNodeId: document.nodes[0]!.id, order: 1 },
      visibility: 'HIDDEN',
      data: { markdown: '# SECRET_HIDDEN_RESOURCE\n不应进入 AI 检索。' },
    });
    const flowContext = {
      workspaceId,
      workspaceItemId: 'item-hidden-resource',
      guideId: 'guide-hidden-resource',
      ownerId: context.userIds.author,
      title: '隐藏资料流程',
      summary: '流程摘要',
      tags: ['隐藏'],
      origin: { kind: 'DRAFT' as const, revision: 0 },
      document,
    };

    seedFlowGuide(context, flowContext.guideId, flowContext.workspaceItemId, document);
    const snapshot = syncGuideFlowSnapshot(context.database, flowContext);

    expect(snapshot.resources.map((resource) => resource.id)).not.toContain('hidden-resource');
    expect(searchKnowledge(context.database, 'SECRET_HIDDEN_RESOURCE', {
      sourceKinds: ['WORKSPACE_FLOW'], workspaceId, userId: context.userIds.author, userRole: 'AUTHOR',
    })).toEqual([]);
  });
```

- [ ] **Step 2: Run the API knowledge test and verify RED.**

Run:

```bash
pnpm --filter @guideanything/api test -- src/modules/knowledge/knowledge.test.ts
```

Expected: the new test fails because the current compiler materializes all source-free resources.

- [ ] **Step 3: Run the API test after compiler implementation.**

No additional production code is expected for this task. Run:

```bash
pnpm --filter @guideanything/api test -- src/modules/knowledge/knowledge.test.ts
pnpm --filter @guideanything/api typecheck
```

Expected: the hidden token is absent from the materialized flow fragments and search results.

---

### Task 6: Full verification and browser-backed interaction check

**Files:**
- Verify: all feature files from Tasks 1-5
- Verify: `docs/superpowers/specs/2026-07-22-resource-visibility-design.md`
- Verify: `docs/superpowers/plans/2026-07-22-resource-visibility-implementation.md`

- [ ] **Step 1: Run all targeted regression suites together.**

Run:

```bash
pnpm --filter @guideanything/contracts test -- src/canvas.test.ts
pnpm --filter @guideanything/canvas-core test -- src/flow-knowledge.test.ts
pnpm --filter @guideanything/web test -- src/features/nodes/NodeChrome.test.tsx src/features/editor/GuideEditor.test.tsx src/features/lesson/LessonPage.test.tsx src/features/lesson/LessonMap.test.tsx
pnpm --filter @guideanything/api test -- src/modules/knowledge/knowledge.test.ts
```

Expected: all commands exit 0 with zero failed tests.

- [ ] **Step 2: Run repository-wide static and build validation.**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: each command exits 0. If an unrelated pre-existing failure appears, record the exact package, command, and failure boundary rather than changing unrelated files.

- [ ] **Step 3: Verify the rendered interaction in a real browser.**

Use the existing GuideAnything development service only after checking listener ownership and health. Open the editor for a guide with at least one Markdown, image, or video resource, select a resource, and verify:

1. The selected resource shows an eye button beside the delete button; a primary flow node does not.
2. Clicking “隐藏资料” changes the icon/label to “显示资料”, adds the muted “已隐藏” state, leaves the card selectable, and marks the draft unsaved.
3. Clicking “显示资料” restores the original appearance and removes the persisted `visibility` field from the pending document.
4. Save/publish, open the learner view, and confirm the hidden resource is absent from the step content, map, and media/annotation target path.

- [ ] **Step 4: Review the final scoped diff.**

Run:

```bash
git diff --check -- packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts packages/canvas-core/src/flow-knowledge.ts packages/canvas-core/src/flow-knowledge.test.ts apps/web/src/features/nodes/NodeChrome.tsx apps/web/src/features/nodes/NodeChrome.test.tsx apps/web/src/features/nodes/MarkdownNode.tsx apps/web/src/features/nodes/ImageNode.tsx apps/web/src/features/nodes/VideoNode.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/features/lesson/LessonPage.tsx apps/web/src/features/lesson/LessonPage.test.tsx apps/web/src/features/lesson/LessonMap.tsx apps/web/src/features/lesson/LessonMap.test.tsx apps/web/src/styles.css apps/api/src/modules/knowledge/knowledge.test.ts
git status --short
git diff --stat -- packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts packages/canvas-core/src/flow-knowledge.ts packages/canvas-core/src/flow-knowledge.test.ts apps/web/src/features/nodes/NodeChrome.tsx apps/web/src/features/nodes/NodeChrome.test.tsx apps/web/src/features/nodes/MarkdownNode.tsx apps/web/src/features/nodes/ImageNode.tsx apps/web/src/features/nodes/VideoNode.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/features/lesson/LessonPage.tsx apps/web/src/features/lesson/LessonPage.test.tsx apps/web/src/features/lesson/LessonMap.tsx apps/web/src/features/lesson/LessonMap.test.tsx apps/web/src/styles.css apps/api/src/modules/knowledge/knowledge.test.ts
```

Expected: no whitespace errors; only the listed implementation/test files plus the committed spec and this plan are part of the feature scope, while unrelated existing changes remain untouched.

---

### Task 7: Collapse a fully hidden resource appendix to an owner subtitle

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Behavior:**
- When every source-free resource attached to one flow node is `visibility: 'HIDDEN'`, hide those resource cards in the authoring presentation and keep the yellow appendix as a compact clickable subtitle such as `处理 · 节点资料 ×2`.
- Clicking the subtitle/eye-slash restores all resources and expands the appendix; partial visibility keeps the existing full appendix frame.
- Derive the collapsed presentation from persisted resource visibility, without writing React Flow's transient CSS presentation or a structural `hidden` field back into the `CanvasDocument`.

- [ ] **Step 1: Add RED coverage for owner titles, compact geometry, and restore interaction.**
- [ ] **Step 2: Implement shared all-hidden grouping, compact appendix rendering, and presentation-only card hiding.**
- [ ] **Step 3: Add compact-title styles and run targeted tests, typecheck, build, and browser interaction validation.**

---

### Task 8: Route the hierarchy line to the collapsed appendix edge

**Files:**
- Create: `apps/web/src/features/editor/ResourceAppendixAnchorNode.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx:90-120,405-412,450-490,2175-2201`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx:9,265-280`
- Update: `docs/superpowers/specs/2026-07-22-resource-visibility-design.md`

**Interfaces:**
- `resourceAppendixAnchorNodes(document: CanvasDocument): Node[]` returns transient, non-persisted React Flow nodes for all-hidden `ResourceAppendixGroup`s.
- `hierarchyPresentationEdges(document: CanvasDocument): Edge[]` keeps visible groups targeting their first resource, but targets `resource-appendix-anchor:{ownerId}` with a direction-specific `appendix-in-{side}` handle when the group is fully hidden.
- `ResourceAppendixAnchorNode` renders four transparent target handles (`appendix-in-top`, `appendix-in-right`, `appendix-in-bottom`, `appendix-in-left`) over the compact title geometry; the transient node also supplies numeric dimensions and static handle bounds so React Flow can route the edge on its first render.

- [x] **Step 1: Write the failing edge-anchor test.**

Add this test beside the existing hierarchy presentation edge tests in `apps/web/src/features/editor/GuideEditor.test.tsx`:

```tsx
  it('routes a fully hidden appendix edge to the collapsed title boundary', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'step', type: 'process', position: { x: 900, y: 0 }, zIndex: 0, data: { label: '确认原料', shape: 'process' } },
        { id: 'one', type: 'markdown', visibility: 'HIDDEN', position: { x: 320, y: 0 }, zIndex: 1, attachment: { ownerNodeId: 'step', order: 1 }, data: { markdown: '资料一' } },
        { id: 'two', type: 'image', visibility: 'HIDDEN', position: { x: 320, y: 210 }, zIndex: 2, attachment: { ownerNodeId: 'step', order: 0 }, data: { url: 'https://example.com/a.png', alt: '资料二' } },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [],
    };

    const [edge] = hierarchyPresentationEdges(document);
    const [anchor] = resourceAppendixAnchorNodes(document);

    expect(edge).toMatchObject({
      source: 'step',
      target: 'resource-appendix-anchor:step',
      targetHandle: 'appendix-in-right',
    });
    expect(anchor).toMatchObject({
      id: 'resource-appendix-anchor:step',
      type: 'resource-appendix-anchor',
      position: { x: 302, y: -30 },
      style: expect.objectContaining({ width: 220, height: 58 }),
      data: { targetSide: 'RIGHT' },
    });

    const restored = setResourceVisibilityInDocument(document, ['one', 'two'], false);
    expect(hierarchyPresentationEdges(restored)[0]).toMatchObject({ target: 'two', targetHandle: 'in' });
    expect(resourceAppendixAnchorNodes(restored)).toEqual([]);
  });
```

- [x] **Step 2: Run the focused test and verify the expected RED failure.**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx
```

Expected: the existing code still targets `two` and returns no transient anchor node, so the new test fails on the target ID/handle or missing anchor.

- [x] **Step 3: Implement the transient anchor node and direction calculation.**

Create `apps/web/src/features/editor/ResourceAppendixAnchorNode.tsx`:

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

export type ResourceAppendixAnchorSide = 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT';

export type ResourceAppendixAnchorData = {
  targetSide: ResourceAppendixAnchorSide;
};

const handleBySide = {
  TOP: { id: 'appendix-in-top', position: Position.Top },
  RIGHT: { id: 'appendix-in-right', position: Position.Right },
  BOTTOM: { id: 'appendix-in-bottom', position: Position.Bottom },
  LEFT: { id: 'appendix-in-left', position: Position.Left },
} as const;

export function ResourceAppendixAnchorNode({ data }: NodeProps) {
  return <div className="resource-appendix-anchor-node" aria-hidden="true">
    {(Object.keys(handleBySide) as ResourceAppendixAnchorSide[]).map((side) => {
      const handle = handleBySide[side];
      return <Handle key={handle.id} type="target" id={handle.id} position={handle.position} />;
    })}
  </div>;
}
```

In `GuideEditor.tsx`, import the anchor component and side/data types, register `resourceAppendixAnchor` in `nodeTypes`, and add `resourceAppendixAnchorId(ownerId)`, `resourceAppendixTargetHandleId(side)`, and `resourceAppendixTargetSide(group, owner)` helpers. Choose the horizontal side when the owner/group center delta is wider than the vertical delta; otherwise choose `TOP` or `BOTTOM` by the sign of the vertical delta.

- [x] **Step 4: Route hierarchy edges and add anchors only to the presentation node list.**

Update `hierarchyPresentationEdges` to use the matching all-hidden appendix group:

```tsx
const appendixGroupByOwner = new Map(resourceAppendixGroups(document).map((group) => [group.ownerId, group]));
const group = appendixGroupByOwner.get(ownerId);
const collapsed = group?.allHidden === true && group.resourceIds.length === attachments.length;
const targetSide = collapsed ? resourceAppendixTargetSide(group, owner) : undefined;
return [{
  id: `hierarchy:${ownerId}`,
  source: ownerId,
  target: collapsed ? resourceAppendixAnchorId(ownerId) : target.id,
  sourceHandle: owner.type === 'decision' ? 'yes' : 'out',
  targetHandle: collapsed ? resourceAppendixTargetHandleId(targetSide!) : 'in',
  type: 'smoothstep',
  selectable: false,
  className: 'hierarchy-presentation-edge',
  style: { stroke: '#9a6a42', strokeDasharray: '5 5', strokeWidth: 1.5 },
  label: attachments.length > 1 ? `资料 ×${attachments.length}` : undefined,
}];
```

Append `resourceAppendixAnchorNodes(renderedDocument)` to `renderedFlowNodes`, not to `flowNodes` or the `CanvasDocument`. Filter transient anchor IDs out of `onNodesChange` before `persistableNodeChanges` so React Flow measurement/position events cannot mark the document dirty or enter draft history. Keep the normal expanded path unchanged: it has no anchor node and the hierarchy edge targets the first resource with `targetHandle: 'in'`.

- [x] **Step 5: Make the anchor invisible and non-interactive while preserving its measured rectangle.**

Add these styles to `apps/web/src/styles.css`:

```css
.resource-appendix-anchor,
.resource-appendix-anchor-node { opacity: 0; pointer-events: none; }
.resource-appendix-anchor-node { width: 100%; height: 100%; }
```

The compact title remains the visible click target in the existing `ViewportPortal`; the transparent anchor supplies only the React Flow target-handle geometry.

- [x] **Step 6: Run focused tests, static checks, and browser validation.**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx
pnpm lint
git diff --check -- apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/features/editor/ResourceAppendixAnchorNode.tsx apps/web/src/styles.css docs/superpowers/specs/2026-07-22-resource-visibility-design.md docs/superpowers/plans/2026-07-22-resource-visibility-implementation.md
```

Then use the existing local editor in a browser: hide all three attached resources, verify the dashed `资料 ×3` line ends on the compact title frame edge, click the title, and verify the line returns to the first visible resource card. Restore the visible state before ending the check.

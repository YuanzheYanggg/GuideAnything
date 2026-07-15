# Inline Node Text Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors edit flow titles/details, Markdown, image captions, and video captions directly inside canvas nodes without bypassing document history or persistence.

**Architecture:** Add a web-only React context and reusable inline editor that remain inert outside `GuideEditor`. Node components keep transient drafts locally and submit typed field updates to `GuideEditor`, where a pure updater produces a validated `CanvasDocument` change through the existing `commit` path.

**Tech Stack:** React 19, TypeScript, React Flow 12, Vitest, Testing Library, existing `CanvasDocumentSchema` and editor history.

## Global Constraints

- Do not change `CanvasDocument` or published snapshot schemas.
- Do not store callbacks or temporary drafts in `node.data`.
- Subguide titles stay read-only.
- Inline editing is disabled during automatic-layout preview and outside the editor.
- One confirmed edit creates one history entry; typing and cancellation create none.
- Keep right-side inspector fields as compatibility and advanced-property controls.
- Do not add dependencies.
- Do not commit, stage, push, or publish without explicit user authorization.

---

## File Structure

- Create `apps/web/src/features/nodes/InlineNodeTextEditor.tsx`: editor context, field type, reusable single-line/multiline inline editing component, keyboard and validation behavior.
- Create `apps/web/src/features/nodes/InlineNodeTextEditor.test.tsx`: isolated interaction tests for save, cancel, multiline keyboard behavior, empty-title validation, and read-only fallback.
- Modify `apps/web/src/features/nodes/FlowNode.tsx`: inline title and optional detail.
- Modify `apps/web/src/features/nodes/MarkdownNode.tsx`: rendered preview ↔ raw Markdown textarea.
- Modify `apps/web/src/features/nodes/ImageNode.tsx`: inline caption and selected empty-caption placeholder.
- Modify `apps/web/src/features/nodes/VideoNode.tsx`: injectable inline caption while preserving reusable read-only `VideoNodeView`.
- Modify `apps/web/src/features/editor/GuideEditor.tsx`: provider integration and type-safe document updater through `commit`.
- Modify `apps/web/src/features/editor/GuideEditor.test.tsx`: save payload, undo, layout-preview lock, and no-function persistence coverage.
- Modify `apps/web/src/styles.css`: unobtrusive editable affordance, in-node fields, validation and focus states.

---

### Task 1: Reusable Inline Text Editor

**Files:**
- Create: `apps/web/src/features/nodes/InlineNodeTextEditor.tsx`
- Create: `apps/web/src/features/nodes/InlineNodeTextEditor.test.tsx`

**Interfaces:**
- Produces: `InlineTextField`, `InlineNodeEditingProvider`, and `InlineNodeTextEditor`.
- `InlineNodeTextEditor` accepts `nodeId`, `field`, `value`, `label`, `multiline`, `required`, `placeholder`, `showPlaceholder`, and `children`.
- Context callback signature: `(nodeId: string, field: InlineTextField, value: string) => void`.

- [ ] **Step 1: Write failing interaction tests**

Cover these concrete cases with Testing Library:

```tsx
const updateText = vi.fn();
render(
  <InlineNodeEditingProvider value={{ enabled: true, updateText }}>
    <InlineNodeTextEditor nodeId="process-1" field="label" value="旧标题" label="节点标题" required>
      <strong>旧标题</strong>
    </InlineNodeTextEditor>
  </InlineNodeEditingProvider>,
);
await user.dblClick(screen.getByText('旧标题'));
await user.clear(screen.getByRole('textbox', { name: '节点标题' }));
await user.type(screen.getByRole('textbox', { name: '节点标题' }), '新标题{Enter}');
expect(updateText).toHaveBeenCalledOnce();
expect(updateText).toHaveBeenCalledWith('process-1', 'label', '新标题');
```

Add separate tests proving `Escape` does not call `updateText`, an empty required value stays open with an alert, ordinary `Enter` adds a newline in multiline mode while `Meta+Enter` commits, and missing/disabled provider renders children without an editor.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/nodes/InlineNodeTextEditor.test.tsx
```

Expected: FAIL because `InlineNodeTextEditor.tsx` does not exist.

- [ ] **Step 3: Implement the minimal editor and context**

Implement a default disabled context and local `editing`, `draft`, and `error` state. The display wrapper must enter editing on double click or `Enter`/`F2`; the field must use `nodrag nopan nowheel`, stop pointer/double-click propagation, save on blur, save single-line values on `Enter`, save multiline values only on `Meta/Ctrl+Enter`, cancel on `Escape`, and reject a trimmed empty required value.

Use this public type:

```ts
export type InlineTextField = 'label' | 'description' | 'markdown' | 'imageCaption' | 'videoCaption';
```

Call `updateText` only when the committed value differs from the original. Trim required single-line labels; preserve multiline whitespace. Render an `aria-live` alert for invalid required text.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all tests in the new file PASS with no warnings.

- [ ] **Step 5: Review the task diff**

Run:

```bash
git diff --check -- apps/web/src/features/nodes/InlineNodeTextEditor.tsx apps/web/src/features/nodes/InlineNodeTextEditor.test.tsx
```

Expected: exit 0. Do not stage or commit.

---

### Task 2: Node Component Integration

**Files:**
- Modify: `apps/web/src/features/nodes/FlowNode.tsx`
- Modify: `apps/web/src/features/nodes/MarkdownNode.tsx`
- Modify: `apps/web/src/features/nodes/ImageNode.tsx`
- Modify: `apps/web/src/features/nodes/VideoNode.tsx`
- Modify: existing tests under `apps/web/src/features/nodes/`

**Interfaces:**
- Consumes: `InlineNodeTextEditor` and `InlineTextField` from Task 1.
- Produces: editable node presentations that remain read-only without an enabled provider.

- [ ] **Step 1: Write failing node tests**

Add component tests proving:

```tsx
render(
  <InlineNodeEditingProvider value={{ enabled: true, updateText }}>
    <FlowNode {...flowProps} />
  </InlineNodeEditingProvider>,
);
await user.dblClick(screen.getByText('收到订单'));
expect(screen.getByRole('textbox', { name: '收到订单 · 节点标题' })).toBeVisible();
```

Add equivalent assertions for Markdown content, image caption, and video caption. Assert `SubguideNode` still has no textbox after double click. Assert a selected image/video with no caption exposes a direct-edit placeholder while an unselected one does not.

- [ ] **Step 2: Run node tests and verify RED**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/nodes
```

Expected: FAIL because node components do not render inline editors.

- [ ] **Step 3: Integrate the editor into node components**

- `FlowNode`: wrap `<strong>` with required single-line `label`; render `description` as multiline and show “双击添加节点明细” only when selected and editing is enabled.
- `MarkdownNode`: wrap `MarkdownNodeView` with multiline `markdown` editor.
- `ImageNode`: wrap caption or selected placeholder with multiline `imageCaption` editor.
- `VideoNode`: extend `VideoNodeView` with an optional `captionContent: ReactNode`; use it from the canvas node while keeping current read-only fallback for lesson consumers.
- `SubguideNode`: make no change.

Pass labels that identify both the current node and field, for example `收到订单 · 节点标题` and `示意图 · 图片说明`.

- [ ] **Step 4: Run node tests and verify GREEN**

Run the Step 2 command. Expected: all node test files PASS.

- [ ] **Step 5: Review the task diff**

Run `git diff --check` on the four node components and their tests. Expected: exit 0. Do not stage or commit.

---

### Task 3: GuideEditor Persistence and History Integration

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**
- Consumes: `InlineNodeEditingProvider`, `InlineTextField`.
- Produces: `updateInlineNodeText(document, nodeId, field, value): CanvasDocument` as a pure exported updater and editor context wiring through `commit`.

- [ ] **Step 1: Write failing document and editor tests**

Add pure updater cases for all legal mappings:

```ts
expect(updateInlineNodeText(document, 'process-1', 'label', '新标题').nodes[0]).toMatchObject({
  data: { label: '新标题' },
});
expect(updateInlineNodeText(document, 'image-1', 'imageCaption', '').nodes[1]!.data).not.toHaveProperty('caption');
```

Add an editor behavior test that double-clicks the rendered flow title through the React Flow mock, enters a new title, saves the draft, and asserts the API payload contains the new title and contains no function values. Then click Undo and save again to prove the old title returns. Add a layout-preview test proving double click does not produce a textbox while preview is active.

- [ ] **Step 2: Run GuideEditor tests and verify RED**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx
```

Expected: FAIL because `updateInlineNodeText` and provider wiring do not exist.

- [ ] **Step 3: Implement the pure updater**

Find the node by ID and apply only type-compatible fields:

- primary flow + `label`: set trimmed `data.label`.
- primary flow + `description`: set non-empty value or remove `description`.
- markdown + `markdown`: set the string.
- image + `imageCaption`: set non-empty `caption` or remove it.
- video + `videoCaption`: set non-empty `caption` or remove it.
- mismatched node/field or missing node: return the original document unchanged.

Do not mutate the input document or node.

- [ ] **Step 4: Wire the provider through `commit`**

Create a callback that exits when `document` is missing or `layoutPreview` is active, calls the pure updater, and calls `commit` only when a new document is returned. Wrap `ReactFlow` with:

```tsx
<InlineNodeEditingProvider value={{ enabled: !layoutPreview, updateText: updateInlineText }}>
  <ReactFlow ... />
</InlineNodeEditingProvider>
```

Keep provider functions outside `toFlowNodes`; no callbacks enter `node.data`.

- [ ] **Step 5: Run GuideEditor tests and verify GREEN**

Run the Step 2 command. Expected: all GuideEditor tests PASS.

- [ ] **Step 6: Review the task diff**

Run `git diff --check` on the two editor files. Expected: exit 0. Do not stage or commit.

---

### Task 4: Visual States and Keyboard Isolation

**Files:**
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/nodes/InlineNodeTextEditor.test.tsx`

**Interfaces:**
- Consumes: class names emitted by `InlineNodeTextEditor`.
- Produces: readable inline editing at all node sizes without altering node geometry.

- [ ] **Step 1: Add a failing class/state test**

Assert the display wrapper, active input, placeholder, and invalid state receive stable semantic classes such as `inline-node-text`, `inline-node-text-input`, `inline-node-text-placeholder`, and `is-invalid`.

- [ ] **Step 2: Run the focused test and verify RED**

Run the Task 1 focused command. Expected: FAIL on missing state class assertions.

- [ ] **Step 3: Add minimal styles**

Add styles that preserve inherited typography, use transparent backgrounds until focused, provide a visible focus ring, allow textarea resize only vertically, constrain multiline overflow inside the node, show placeholders with reduced contrast, and keep invalid feedback legible. Do not set fixed node width or height.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 focused command. Expected: PASS.

- [ ] **Step 5: Review the task diff**

Run `git diff --check -- apps/web/src/styles.css apps/web/src/features/nodes/InlineNodeTextEditor.test.tsx`. Expected: exit 0.

---

### Task 5: Browser Acceptance and Full Regression

**Files:**
- Verify all files above.
- Update `docs/ACCEPTANCE.md` only if the repository records new permanent acceptance scenarios there.

**Interfaces:**
- Consumes: completed inline editing feature.
- Produces: runtime evidence and final regression evidence.

- [ ] **Step 1: Run targeted tests together**

```bash
pnpm --filter @guideanything/web exec vitest run src/features/nodes src/features/editor/GuideEditor.test.tsx
```

Expected: all targeted tests PASS.

- [ ] **Step 2: Start isolated QA services**

Use the existing ignored QA database and separate ports:

```bash
API_PORT=3002 WEB_ORIGIN=http://127.0.0.1:5175 DATABASE_PATH=data/qa-canvas-annotations.sqlite pnpm --filter @guideanything/api dev
API_PORT=3002 pnpm --filter @guideanything/web dev --port 5175
```

Verify listener ownership with `lsof` before browser interaction; do not touch the main `5174/3001` services.

- [ ] **Step 3: Execute browser acceptance**

Log in as the author, open a draft, then:

1. Record the selected node position and title.
2. Double-click the flow title, edit it, and press `Enter`.
3. Confirm the node position is unchanged.
4. Double-click Markdown, enter multiline content, and press `Meta+Enter`.
5. Save, reload, and confirm both values persist.
6. Undo the last committed edit and confirm only that edit reverts.
7. Open automatic-layout preview and confirm inline fields cannot open.
8. Confirm browser console warning/error counts are zero.

- [ ] **Step 4: Stop QA services and verify ports are free**

Send `SIGINT` only to the sessions started in Step 2, then run `lsof` for ports 5175 and 3002. Expected: no listeners on those QA ports; original 5174/3001 listeners remain untouched.

- [ ] **Step 5: Run the complete verification bundle**

```bash
pnpm lint && pnpm test && pnpm typecheck && pnpm build && git diff --check
```

Expected: exit 0 for the entire chain with no test failures.

- [ ] **Step 6: Review final scope**

Run `git status --short` and inspect the final diff for callbacks in persisted data, unrelated edits, debug output, generated browser artifacts, and accidental database changes. Report the exact validation evidence and leave all changes uncommitted unless the user separately authorizes a commit.

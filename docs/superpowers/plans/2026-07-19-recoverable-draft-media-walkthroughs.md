# Recoverable Draft Media Walkthroughs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image-annotation guides recoverable after accidental deletion, present unobstructed image walkthroughs, and make the learning map faithfully display the authored stage, lane, node, and edge geometry.

**Architecture:** Store immutable draft snapshots independently of published guide versions and create them within the same transaction as every successful draft save. Keep browser UI thin: it asks the API for history, centralizes protected image-node deletion, and persists supplemental-image references in the existing canvas document. Reuse the canvas-core routing and hierarchy geometry in the read-only learning map, while giving it the same per-edge physical handles used by the editor.

**Tech Stack:** TypeScript, Fastify, SQLite migrations, Zod contracts, React, React Flow, Vitest, pnpm workspaces.

## Global Constraints

- Keep the most recent **200** immutable draft snapshots per guide; never prune or reinterpret `guide_versions`.
- Draft-history list responses return metadata only; only the restore endpoint reads a historical document.
- History list and restore use existing `OWNER` / `EDIT` draft permissions and existing optimistic `revision` conflict semantics.
- A successful save or restore must create the post-save snapshot in the same SQLite transaction; a failure rolls back both current draft and snapshot.
- Only deletion of an image node with `annotations.length > 0` requires confirmation. The confirmation applies to node chrome, toolbar, and Delete/Backspace; it never deletes the media asset itself.
- Image-editor markers remain authoring aids only. Learning playback renders no numbered marker, region overlay, or image click target.
- Render learning-map lanes only when `document.lanes.length > 0`; do not synthesize an unassigned lane.
- Preserve authored route, color, arrow, line style, node size, stage/lane geometry, and physical edge anchor coordinates in learning mode.
- A single annotation has at most **8** supplemental images. Each stores `id`, `assetId`, private media `url`, `alt`, optional `caption`, and `order`; removing it only removes that reference.
- Flow-knowledge snapshots may include supplemental asset ID, alternative text, and caption, but must never include a supplemental media URL.
- Do not reset, discard, or stage unrelated working-tree edits. In particular, reconcile the existing uncommitted stage-drag and Markdown edits in `GuideEditor.tsx`, `LessonPage.tsx`, `styles.css`, `hierarchy.ts`, and their tests.
- Do not push, publish, or alter Runtime Bridge configuration as part of this work.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/contracts/src/canvas.ts` | Validate annotation supplemental-image data and export its shared type. |
| `packages/contracts/src/flow-knowledge.ts` | Define the URL-free supplemental metadata allowed in a flow snapshot. |
| `packages/canvas-core/src/flow-knowledge.ts` | Project annotation supplements into knowledge snapshots without URLs. |
| `apps/api/src/db/migrations/0007_guide_draft_history.sql` | Add immutable snapshot storage and guide/revision lookup indexes. |
| `apps/api/src/modules/guides/repository.ts` | Atomically create, list, prune, and restore draft snapshots. |
| `apps/api/src/modules/guides/service.ts` and `routes.ts` | Apply access control, revision checks, flow sync, and HTTP contracts. |
| `apps/web/src/lib/api.ts` | Expose typed draft-history calls to the editor. |
| `apps/web/src/features/editor/DraftHistoryDialog.tsx` | List revisions and explicitly confirm restore. |
| `apps/web/src/features/editor/AnnotatedImageDeletionDialog.tsx` | Explain and confirm destructive annotated-image deletion. |
| `apps/web/src/features/editor/GuideEditor.tsx` | Centralize deletion protection, invoke history UI, and upload annotation supplements. |
| `apps/web/src/features/editor/ImageAnnotationEditor.tsx` | Edit ordered supplemental-image references for the selected annotation. |
| `apps/web/src/features/lesson/LessonMap.tsx` | Render read-only nodes, physical edge handles, stages, lanes, and routed edges from a common geometry model. |
| `apps/web/src/features/lesson/ImageAnnotationPlayer.tsx` | Play camera-only annotation walkthroughs and expose supplemental-image thumbnails. |
| `apps/web/src/features/lesson/MediaLightbox.tsx` and `LessonPage.tsx` | Push supplemental images on the existing preview stack and restore the same walkthrough step on return. |

## Task 1: Add Supplemental-Image Contract and Knowledge Projection

**Files:**
- Modify: `packages/contracts/src/canvas.ts`
- Modify: `packages/contracts/src/canvas.test.ts`
- Modify: `packages/contracts/src/flow-knowledge.ts`
- Modify: `packages/contracts/src/flow-knowledge.test.ts`
- Modify: `packages/canvas-core/src/flow-knowledge.ts`
- Modify: `packages/canvas-core/src/flow-knowledge.test.ts`

**Interfaces:**
- Produces `ImageAnnotationSupplement` and an optional `supplementalImages` field on `ImageAnnotation`.
- Produces `FlowKnowledgeImageAnnotationSupplementV1`, whose shape is `{ assetId: string; alt: string; caption?: string }` and intentionally has no `url` field.
- Consumes existing `ImageAnnotation`, `FlowKnowledgeImageAnnotationV1`, and `buildFlowKnowledgeSnapshot`.

- [x] **Step 1: Write failing contract and projection tests**

```ts
it('accepts legacy image annotations and up to eight supplemental images', () => {
  expect(CanvasDocumentSchema.parse(legacyImageDocument)).toBeDefined();
  expect(() => CanvasDocumentSchema.parse(withEightAnnotationSupplements)).not.toThrow();
  expect(() => CanvasDocumentSchema.parse(withNineAnnotationSupplements)).toThrow();
});

it('rejects duplicate supplemental ids or duplicate order within one annotation', () => {
  expect(() => CanvasDocumentSchema.parse(withDuplicateSupplementIds)).toThrow();
  expect(() => CanvasDocumentSchema.parse(withDuplicateSupplementOrders)).toThrow();
});

it('projects supplemental asset metadata without its media URL', () => {
  const snapshot = buildFlowKnowledgeSnapshot(documentWithSupplement);
  expect(snapshot.steps[0]?.media?.annotations[0]?.supplementalImages).toEqual([
    { assetId: 'asset-menu', alt: '成衣类型菜单', caption: '点击后的下拉选项' },
  ]);
  expect(JSON.stringify(snapshot)).not.toContain('/api/media/asset-menu');
});
```

- [x] **Step 2: Run the focused tests and verify they fail for the missing schema fields**

Run: `pnpm --filter @guideanything/contracts test -- canvas.test.ts flow-knowledge.test.ts && pnpm --filter @guideanything/canvas-core test -- flow-knowledge.test.ts`

Expected: FAIL because `supplementalImages` is not part of the annotation or flow-knowledge schemas.

- [x] **Step 3: Add the minimal schema and projection**

```ts
export const ImageAnnotationSupplementSchema = z.object({
  id: IdSchema,
  order: z.number().int().min(0),
  assetId: IdSchema,
  url: MediaUrlSchema,
  alt: z.string().trim().min(1).max(500),
  caption: z.string().trim().max(1_000).optional(),
});

export const ImageAnnotationSchema = z.object({
  // existing fields
  supplementalImages: z.array(ImageAnnotationSupplementSchema).max(8).optional(),
});

// CanvasDocumentSchema superRefine, for every annotation:
// report duplicate supplement ids and duplicate supplement order values.

const supplementalImages = annotation.supplementalImages?.map(({ assetId, alt, caption }) => ({
  assetId,
  alt,
  ...(caption ? { caption } : {}),
}));
```

Add `supplementalImages` as an optional field in the flow-knowledge annotation schema and map it from the canvas annotation. Keep omitted fields omitted for legacy documents.

- [x] **Step 4: Run contract, canvas-core, and type checks**

Run: `pnpm --filter @guideanything/contracts test -- canvas.test.ts flow-knowledge.test.ts && pnpm --filter @guideanything/canvas-core test -- flow-knowledge.test.ts && pnpm --filter @guideanything/contracts typecheck && pnpm --filter @guideanything/canvas-core typecheck`

Expected: PASS.

- [x] **Step 5: Review the diff without staging existing user changes**

Run: `git diff --check -- packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts packages/contracts/src/flow-knowledge.ts packages/contracts/src/flow-knowledge.test.ts packages/canvas-core/src/flow-knowledge.ts packages/canvas-core/src/flow-knowledge.test.ts`

Expected: no whitespace errors. Do not create a commit while `packages/contracts/src/canvas.ts` contains unrelated pre-existing edits.

## Task 2: Persist and Restore Server-Side Draft History

**Files:**
- Create: `apps/api/src/db/migrations/0007_guide_draft_history.sql`
- Modify: `apps/api/src/db/migrate.test.ts`
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/api/src/modules/guides/repository.ts`
- Modify: `apps/api/src/modules/guides/service.ts`
- Modify: `apps/api/src/modules/guides/routes.ts`
- Modify: `apps/api/src/modules/guides/guides.test.ts`

**Interfaces:**
- Produces `GuideDraftHistorySnapshotSchema` with `revision`, `title`, `summary`, `tags`, `savedAt`, and `savedBy`; it excludes `document`.
- Produces `GuideRepository.listDraftHistory(guideId): GuideDraftHistorySnapshot[]` and `GuideRepository.restoreDraft(guideId, sourceRevision, currentRevision): GuideDraft`.
- Consumes the existing `updateGuideInTransaction`, revision conflict error, access checks, and `bestEffortFlowSync`.

- [x] **Step 1: Write failing API tests for save, listing, restore, pruning, and rejection**

```ts
it('creates one draft snapshot with every successful save and lists metadata only', async () => {
  const saved = await saveGuideAsEditor(context, guide.id, guide.revision, changedDocument);
  const response = await context.app.inject({ method: 'GET', url: `/api/guides/${guide.id}/draft-history`, headers: editorHeaders });
  expect(response.statusCode).toBe(200);
  expect(response.json().items[0]).toMatchObject({ revision: saved.revision, savedBy: editor.id });
  expect(response.body).not.toContain('"nodes"');
});

it('restores a source snapshot as a new revision without changing the source snapshot', async () => {
  const sourceRevision = await saveGuideAsEditor(context, guide.id, guide.revision, sourceDocument);
  const laterRevision = await saveGuideAsEditor(context, guide.id, sourceRevision.revision, laterDocument);
  const response = await context.app.inject({
    method: 'POST',
    url: `/api/guides/${guide.id}/draft-history/${sourceRevision.revision}/restore`,
    headers: editorHeaders,
    payload: { revision: laterRevision.revision },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().revision).toBe(laterRevision.revision + 1);
  expect(response.json().document).toEqual(sourceDocument);
});

it('keeps only the newest 200 snapshots for the saved guide', () => {
  // seed 201 revisions for guide A and one old revision for guide B
  expect(listSnapshotRevisions(context.db, guideA.id)).toHaveLength(200);
  expect(listSnapshotRevisions(context.db, guideB.id)).toContain(oldGuideBRevision);
});

it.each(['viewer access', 'missing source revision', 'stale current revision'])('rejects draft-history restore for %s', async () => {
  // assert 403, 404, and existing revision-conflict status respectively
});
```

- [x] **Step 2: Run the focused API test and verify it fails**

Run: `pnpm --filter @guideanything/api test -- guides.test.ts`

Expected: FAIL because the table and draft-history routes do not exist.

- [x] **Step 3: Add migration, repository transaction helpers, service methods, and routes**

```sql
CREATE TABLE guide_draft_revisions (
  id TEXT PRIMARY KEY,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  draft_document_json TEXT NOT NULL,
  saved_by TEXT NOT NULL REFERENCES users(id),
  saved_at TEXT NOT NULL,
  UNIQUE (guide_id, revision)
);
CREATE INDEX idx_guide_draft_revisions_latest ON guide_draft_revisions (guide_id, saved_at DESC, revision DESC);
```

```ts
private insertDraftSnapshotInTransaction(guide: GuideDraft, savedBy: string): void {
  this.db.prepare(`INSERT INTO guide_draft_revisions (...) VALUES (...)`).run(/* guide revision and current document */);
  this.db.prepare(`DELETE FROM guide_draft_revisions
    WHERE guide_id = ? AND id IN (
      SELECT id FROM guide_draft_revisions
      WHERE guide_id = ?
      ORDER BY saved_at DESC, revision DESC
      LIMIT -1 OFFSET 200
    )`).run(guide.id, guide.id);
}

restoreDraft(guideId: string, sourceRevision: number, currentRevision: number, actorId: string): GuideDraft {
  this.db.exec('BEGIN IMMEDIATE');
  try {
    const source = this.getDraftSnapshotDocumentInTransaction(guideId, sourceRevision);
    const restored = this.updateGuideInTransaction(guideId, currentRevision, source, actorId);
    this.insertDraftSnapshotInTransaction(restored, actorId);
    this.db.exec('COMMIT');
    return restored;
  } catch (error) { this.db.exec('ROLLBACK'); throw error; }
}
```

Call `insertDraftSnapshotInTransaction` after every normal `updateGuideInTransaction` result before committing. In the service, require the existing edit access before `listDraftHistory` and `restoreDraft`, and call `bestEffortFlowSync` for a successful restore. Add Fastify schemas/routes:

```ts
fastify.get('/api/guides/:id/draft-history', async (request) => service.listDraftHistory(request.user, request.params.id));
fastify.post('/api/guides/:id/draft-history/:revision/restore', async (request) =>
  service.restoreDraft(request.user, request.params.id, Number(request.params.revision), request.body.revision));
```

- [x] **Step 4: Run migration and API tests**

Run: `pnpm --filter @guideanything/api test -- migrate.test.ts guides.test.ts && pnpm --filter @guideanything/api typecheck`

Expected: PASS, including the 200-item prune and source-preserving restore assertions.

- [x] **Step 5: Inspect the migration path and final route payloads**

Run: `pnpm --filter @guideanything/api db:migrate && git diff --check -- apps/api/src/db/migrations/0007_guide_draft_history.sql apps/api/src/db/migrate.test.ts apps/api/src/modules/guides/repository.ts apps/api/src/modules/guides/service.ts apps/api/src/modules/guides/routes.ts apps/api/src/modules/guides/guides.test.ts packages/contracts/src/api.ts`

Expected: migration reports success; no whitespace errors. Do not run `db:reset` because it removes the live local guide database.

## Task 3: Expose Draft History and Protect Annotated-Image Deletion

**Files:**
- Create: `apps/web/src/features/editor/DraftHistoryDialog.tsx`
- Create: `apps/web/src/features/editor/DraftHistoryDialog.test.tsx`
- Create: `apps/web/src/features/editor/AnnotatedImageDeletionDialog.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes `GuideDraftHistorySnapshot` from `@guideanything/contracts` and `EditorApi.listDraftHistory(guideId)` / `EditorApi.restoreDraft(guideId, sourceRevision, revision)`.
- Produces `requestNodeDeletion(nodeIds: string[])`, the only GuideEditor node-deletion entry point; it either opens a dialog or commits `removeNodesFromDocument`.
- Produces `DraftHistoryDialog` callbacks `onRestore(revision: number)` and `onClose()`.

- [x] **Step 1: Write failing editor tests for all deletion paths and history restore affordance**

```tsx
it.each([
  ['node chrome', () => user.click(screen.getByRole('button', { name: '删除图片节点' }))],
  ['toolbar', () => user.click(screen.getByRole('button', { name: '删除所选节点' }))],
  ['keyboard', () => fireEvent.keyDown(window, { key: 'Delete' })],
])('asks before %s deletes an annotated image', async (_name, remove) => {
  renderEditor(withAnnotatedImage());
  await remove();
  expect(screen.getByRole('dialog', { name: '确认删除带标注的图片' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '取消' }));
  expect(saveGuide).not.toHaveBeenCalled();
  expect(screen.getByText('图片节点')).toBeInTheDocument();
});

it('deletes an annotated image only after confirmation and leaves the media asset untouched', async () => {
  renderEditor(withAnnotatedImage());
  await user.click(screen.getByRole('button', { name: '删除所选节点' }));
  await user.click(screen.getByRole('button', { name: '确认删除' }));
  expect(latestSavedDocument().nodes).not.toContainEqual(expect.objectContaining({ id: 'image-1' }));
  expect(uploadMedia).not.toHaveBeenCalled();
});

it('lists history and restores a selected revision only after a second confirmation', async () => {
  renderEditor(withHistory([{ revision: 21, savedAt: '2026-07-19T00:00:00.000Z', savedBy: 'editor' }]));
  await user.click(screen.getByRole('button', { name: '草稿历史' }));
  await user.click(screen.getByRole('button', { name: '恢复 revision 21' }));
  expect(restoreDraft).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '确认恢复' }));
  expect(restoreDraft).toHaveBeenCalledWith('guide-1', 21, 24);
});
```

- [x] **Step 2: Run the focused editor test and verify it fails**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx DraftHistoryDialog.test.tsx`

Expected: FAIL because history methods, dialogs, and centralized annotated-image deletion do not exist.

- [x] **Step 3: Add API client methods and focused dialogs**

```ts
listDraftHistory: (guideId) => request<{ items: GuideDraftHistorySnapshot[] }>(`/api/guides/${guideId}/draft-history`),
restoreDraft: (guideId, sourceRevision, revision) => request<GuideDraft>(
  `/api/guides/${guideId}/draft-history/${sourceRevision}/restore`,
  { method: 'POST', body: JSON.stringify({ revision }) },
),
```

```tsx
export function AnnotatedImageDeletionDialog({ imageCount, annotationCount, onConfirm, onCancel }: Props) {
  return <Dialog aria-label="确认删除带标注的图片">{/* state-free copy, Cancel and 确认删除 */}</Dialog>;
}

export function DraftHistoryDialog({ items, currentRevision, onRestore, onClose }: Props) {
  // newest first; mark current revision; select non-current source then show its confirmation state
}
```

Use existing dialog primitives and existing style tokens. Keep metadata only in browser history state, then update the editor document/revision from the restore response.

- [x] **Step 4: Centralize deletion and connect header history action**

```ts
const requestNodeDeletion = useCallback((nodeIds: string[]) => {
  const annotated = nodeIds
    .map((id) => document?.nodes.find((node) => node.id === id))
    .filter((node): node is CanvasNode => node?.type === 'image' && (node.data.annotations?.length ?? 0) > 0);
  if (annotated.length > 0) {
    setPendingNodeDeletion({ ids: nodeIds, imageCount: annotated.length, annotationCount: annotated.reduce((n, node) => n + (node.data.annotations?.length ?? 0), 0) });
    return;
  }
  removeNodesImmediately(nodeIds);
}, [document, removeNodesImmediately]);
```

Route node chrome, toolbar, and Delete/Backspace through `requestNodeDeletion`; keep direct edge deletion unchanged. Reconcile this deliberately with the existing uncommitted `GuideEditor.tsx` stage-drag changes instead of replacing them.

- [ ] **Step 5: Run focused web tests, type check, and a manual browser smoke**

Run: `pnpm --filter @guideanything/web test -- GuideEditor.test.tsx DraftHistoryDialog.test.tsx && pnpm --filter @guideanything/web typecheck`

Expected: PASS. In the running real app on `http://127.0.0.1:5174`, verify cancellation keeps an annotated image visible and confirming opens no media deletion request.

## Task 4: Add Supplemental Images to the Annotation Editor and Media Preview Stack

**Files:**
- Modify: `apps/web/src/features/editor/ImageAnnotationEditor.tsx`
- Modify: `apps/web/src/features/editor/ImageAnnotationEditor.test.tsx`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Modify: `apps/web/src/features/lesson/ImageAnnotationPlayer.tsx`
- Modify: `apps/web/src/features/lesson/ImageAnnotationPlayer.test.tsx`
- Modify: `apps/web/src/features/lesson/MediaLightbox.tsx`
- Modify: `apps/web/src/features/lesson/MediaLightbox.test.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes `onUploadSupplement(file: File): Promise<{ id: string; url: string; alt: string }>` from `GuideEditor`.
- Produces `ImageAnnotationPlayer` callback `onOpenSupplement(supplement: ImageAnnotationSupplement, annotationIndex: number): void`.
- Extends the `MediaPreview` discriminated union with `{ kind: 'annotation-supplement'; supplement: ImageAnnotationSupplement }`.

- [x] **Step 1: Write failing upload, ordering, playback, and return-path tests**

```tsx
it('adds, captions, reorders, and removes an image-only annotation supplement without deleting the asset', async () => {
  render(<ImageAnnotationEditor {...props} onUploadSupplement={uploadSupplement} />);
  await user.upload(screen.getByLabelText('上传步骤补充图'), new File(['png'], 'menu.png', { type: 'image/png' }));
  await user.type(screen.getByLabelText('补充图说明'), '点击后出现的菜单');
  await user.click(screen.getByRole('button', { name: '上移补充图' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ supplementalImages: expect.arrayContaining([expect.objectContaining({ caption: '点击后出现的菜单' })]) }));
  await user.click(screen.getByRole('button', { name: '移除补充图' }));
  expect(uploadSupplement).toHaveBeenCalledTimes(1);
});

it('rejects a non-image upload and preserves the selected annotation', async () => {
  await user.upload(screen.getByLabelText('上传步骤补充图'), new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
  expect(uploadSupplement).not.toHaveBeenCalled();
  expect(screen.getByText('仅支持图片')).toBeInTheDocument();
});

it('has no image markers in playback and opens a supplement without losing its walkthrough index', async () => {
  render(<MediaLightbox initialPreview={annotatedImagePreview} />);
  expect(screen.queryByRole('button', { name: /播放标注/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '打开补充图 成衣类型菜单' }));
  expect(screen.getByRole('img', { name: '成衣类型菜单' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '返回图片讲解' }));
  expect(screen.getByText('讲解 2 / 8')).toBeInTheDocument();
});
```

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @guideanything/web test -- ImageAnnotationEditor.test.tsx ImageAnnotationPlayer.test.tsx MediaLightbox.test.tsx LessonPage.test.tsx`

Expected: FAIL because supplements, image-only validation, and the new preview discriminant do not exist; an existing player assertion still finds markers.

- [x] **Step 3: Implement editor upload and ordered reference editing**

```ts
const uploadSupplement = async (file: File) => {
  if (!file.type.startsWith('image/')) throw new Error('仅支持图片');
  const media = await api.uploadMedia(file);
  if (media.kind !== 'IMAGE') throw new Error('仅支持图片');
  return { id: crypto.randomUUID(), assetId: media.id, url: media.url, alt: file.name, order: nextOrder };
};
```

Make upload append only after success; disable the picker at eight references; update the selected annotation immutably for caption and ordering; remove only the array entry. Reuse the existing media upload endpoint and do not add an asset-delete call.

- [x] **Step 4: Implement unobstructed player and stack-safe supplemental preview**

```tsx
// ImageAnnotationPlayer: keep <img> and camera transform; do not render annotation marker buttons or regions.
<p>{`讲解 ${activeIndex + 1} / ${annotations.length}`}</p>
{activeAnnotation.supplementalImages?.map((supplement) => (
  <button aria-label={`打开补充图 ${supplement.alt}`} onClick={() => onOpenSupplement?.(supplement, activeIndex)}>
    <MediaThumbnail src={supplement.url} alt={supplement.alt} />
  </button>
))}

// LessonPage: replace the current image preview stack entry before pushing the supplement.
setPreviewStack((stack) => [
  ...stack.slice(0, -1),
  { ...stack.at(-1)!, initialAnnotationIndex: annotationIndex },
  { kind: 'annotation-supplement', supplement },
]);
```

Render the supplement with the existing authenticated media-source path and a back button that pops only the supplemental stack item. Keep `cameraForAnnotation` as the legacy fallback for point and rectangle annotations.

- [ ] **Step 5: Run focused tests and browser playback smoke**

Run: `pnpm --filter @guideanything/web test -- ImageAnnotationEditor.test.tsx ImageAnnotationPlayer.test.tsx MediaLightbox.test.tsx LessonPage.test.tsx && pnpm --filter @guideanything/web typecheck`

Expected: PASS. In the real app, upload one image supplement, save, open the lesson image, verify no overlay obscures it, open the thumbnail, return, and confirm the same `讲解 N / 总数` and camera remain.

## Task 5: Render Learning Stages, Conditional Lanes, and Exact Edge Anchors

**Files:**
- Create: `apps/web/src/features/lesson/LessonMap.tsx`
- Create: `apps/web/src/features/lesson/LessonMap.test.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.test.tsx`
- Modify: `apps/web/src/styles.css`
- Read and preserve: `packages/canvas-core/src/hierarchy.ts`
- Read and preserve: `apps/web/src/features/editor/GuideEditor.tsx`

**Interfaces:**
- Consumes `routeCanvasEdges(document)`, `defaultFlowNodeSize(node)`, `getStageBounds(document)`, and `getSwimlaneBounds(document)`.
- Produces `LessonMap` with props `{ document: CanvasDocument; onSelectNode(nodeId: string): void }` and uses a `LessonMapNode` renderer that accepts a per-node `anchorHandles` list.
- Produces edge ids `edge:${edge.id}:source` and `edge:${edge.id}:target`, matching the physical React Flow source/target handle IDs used by each route endpoint.

- [x] **Step 1: Write failing geometry and visibility tests**

```tsx
it('renders all configured stages behind the read-only map', () => {
  render(<LessonMap document={documentWithStagesAndNoLanes} onSelectNode={vi.fn()} />);
  expect(screen.getByText('客人提案阶段')).toBeInTheDocument();
  expect(screen.queryByText('未分配责任')).not.toBeInTheDocument();
});

it('renders lane bands only when the document has configured lanes', () => {
  const { rerender } = render(<LessonMap document={documentWithStagesAndNoLanes} onSelectNode={vi.fn()} />);
  expect(screen.queryByTestId('lesson-swimlane')).not.toBeInTheDocument();
  rerender(<LessonMap document={documentWithConfiguredLanes} onSelectNode={vi.fn()} />);
  expect(screen.getAllByTestId('lesson-swimlane')).toHaveLength(2);
});

it('uses the routed physical handles and identical node dimensions for edge endpoints', () => {
  render(<LessonMap document={documentWithManualAnchors} onSelectNode={vi.fn()} />);
  expect(screen.getByTestId('lesson-node-process-1')).toHaveStyle({ width: '240px', height: '104px' });
  expect(screen.getByTestId('lesson-anchor-edge-e1-source')).toBeInTheDocument();
  expect(screen.getByTestId('lesson-anchor-edge-e1-target')).toBeInTheDocument();
  expect(routeCanvasEdges).toHaveBeenCalledWith(documentWithManualAnchors);
});
```

- [x] **Step 2: Run the new focused test and verify it fails**

Run: `pnpm --filter @guideanything/web test -- LessonMap.test.tsx LessonPage.test.tsx`

Expected: FAIL because no `LessonMap` component or read-only physical anchors exists.

- [x] **Step 3: Implement a shared read-only map geometry adapter**

```tsx
const routedEdges = routeCanvasEdges(document);
const nodeStyles = Object.fromEntries(document.nodes.map((node) => [node.id, {
  width: node.size?.width ?? defaultFlowNodeSize(node).width,
  height: node.size?.height ?? defaultFlowNodeSize(node).height,
}]));

const flowEdges: Edge[] = routedEdges.map(({ edge, route }) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  sourceHandle: `edge:${edge.id}:source`,
  targetHandle: `edge:${edge.id}:target`,
  type: 'canvas',
  data: { edge, route },
}));

<ViewportPortal>
  {getStageBounds(document).map((stage) => <ReadOnlyStageBand key={stage.id} {...stage} />)}
  {document.lanes.length > 0 && getSwimlaneBounds(document).map((lane) => <ReadOnlySwimlane key={lane.id} {...lane} />)}
</ViewportPortal>
```

For each route endpoint, place an invisible `Handle` at the route’s exact source/target side and normalized offset, using the edge-specific id above. The visible node uses `node.size` or `defaultFlowNodeSize`, never the current compact `180×72` lesson CSS. Stage/lane layers use `pointer-events: none` and a lower z-index than nodes and edges.

- [x] **Step 4: Replace the inline LessonPage map without losing current Markdown changes**

```tsx
// LessonPage
<LessonMap
  document={publishedDocument}
  onSelectNode={(nodeId) => setSelectedStepId(stepIdForNodeId(nodeId))}
/>
```

Keep the existing lesson navigation, resource preview, selected-step sidebar, and current uncommitted `SanitizedMarkdown` rendering intact. Delete only the obsolete local `LessonMapNode`, `toLessonFlowEdges`, and compact node style code after the extracted component covers them.

- [x] **Step 5: Run targeted tests, type check, and visual routing verification**

Run: `pnpm --filter @guideanything/web test -- LessonMap.test.tsx LessonPage.test.tsx && pnpm --filter @guideanything/web typecheck`

Expected: PASS. Open the restored `打样提案流程` lesson in the real app and verify: (1) its three stage titles are visible, (2) no lane is shown because the current document has no lanes, (3) the image edge terminates on its physical top anchor without a floating route, and (4) a guide with configured lanes shows only those lane labels.

## Task 6: End-to-End Regression Check and Handoff

**Files:**
- Modify only if test fixes require it: files listed in Tasks 1–5
- Read: `docs/superpowers/specs/2026-07-19-recoverable-draft-media-walkthrough-design.md`

**Interfaces:**
- Consumes all completed task interfaces.
- Produces evidence that saving, history recovery, annotation playback, conditional lanes, and known existing guide behavior work together.

- [x] **Step 1: Run the full affected workspace test suites**

Run: `pnpm --filter @guideanything/contracts test && pnpm --filter @guideanything/canvas-core test && pnpm --filter @guideanything/api test && pnpm --filter @guideanything/web test`

Expected: PASS. If an existing unmodified user change causes a failure, report the failing file/test separately instead of silently reverting it.

- [x] **Step 2: Run all affected type checks and production build**

Run: `pnpm --filter @guideanything/contracts typecheck && pnpm --filter @guideanything/canvas-core typecheck && pnpm --filter @guideanything/api typecheck && pnpm --filter @guideanything/web build`

Expected: PASS.

- [ ] **Step 3: Review only the intended diff and repository state**

Run: `git diff --check && git diff --stat && git status --short`

Expected: no whitespace errors; all changed paths map to this plan or pre-existing user work. Keep unrelated dirty files un-staged.

- [ ] **Step 4: Manually exercise the real runtime path**

Run: use the existing real web/API/Runtime Bridge listeners; do not run `pnpm dev:fake`.

Expected: a history restore yields a new revision; deletion cancellation retains annotations; learning mode has no image overlays and returns from a supplement to the same walkthrough step; stage/lane and edge geometry match the authored document.

## Plan Self-Review

- Spec coverage: Tasks 1 and 4 cover the optional eight-image annotation model and URL-free knowledge snapshot; Task 2 covers the 200-snapshot transactional server history, authorization, conflicts, restoration, and pruning; Task 3 covers history and deletion UX; Task 4 covers author upload and player behavior; Task 5 covers stage/lane/route geometry; Task 6 covers regression and real-runtime verification.
- Placeholder scan: this plan contains no deferred implementation marker. Each implementation task names interfaces, paths, tests, commands, and expected outcomes.
- Type consistency: `ImageAnnotationSupplement` is defined in Task 1, used by Tasks 4 and 5 only through imported contracts; `GuideDraftHistorySnapshot` is defined in Task 2 before Task 3 uses it; edge handle IDs use the same `edge:${edge.id}:source|target` strings in Task 5's edge mapping and node renderer.

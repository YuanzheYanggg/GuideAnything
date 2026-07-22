# Replace Annotated Image Safely Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require explicit confirmation before replacing an annotated image, clear its old annotations only after a successful new-image upload, and preserve the old image-plus-annotations through the existing draft history.

**Architecture:** Keep the change inside the existing web editor. A pending replacement stores the selected `File` and image node ID without uploading; confirmation first saves any dirty current snapshot, then starts the upload, and a successful response creates one `commit` containing the new media reference and `annotations: []`. The existing autosave creates the next server draft revision, while the existing draft-history restore path remains the recovery mechanism for the prior snapshot.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing `GuideEditor` commit/autosave flow, existing draft-history API.

## Global Constraints

- Do not reset, overwrite, stage, or commit unrelated pre-existing worktree changes.
- Do not delete media assets as part of image replacement; the previous saved draft remains the recovery boundary.
- Do not upload the replacement file before the user confirms the destructive annotation-clearing action.
- If the current annotated-image draft is dirty, save that old snapshot successfully before uploading the replacement; a failed pre-save must block the upload.
- If the user cancels or the upload fails, preserve the current image node and all annotations.
- Preserve existing replacement behavior for image nodes with zero annotations unless the file upload itself fails.
- Preserve existing `alt` and `caption` fields; this change only clears `annotations`.

---

### Task 1: Add failing editor tests for safe image replacement

**Files:**
- Modify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/GuideEditor.test.tsx`
- Read: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/GuideEditor.tsx`

**Interfaces:**
- Consumes the existing `EditorApi.uploadMedia`, `GuideEditor` rendering harness, and image-node selection controls.
- Produces executable acceptance tests for cancel, confirm, and upload failure behavior.

- [x] **Step 1: Write the failing tests**

Add tests next to the existing annotated-image deletion test. Use an image document with one annotation and make `api.uploadMedia` resolve to an image asset only in the confirmation test. Assert that selecting a file opens a dialog and does not call `uploadMedia`; assert cancel leaves the current image and annotation unchanged. In the confirmation test, assert the API is called only after confirmation and the saved document contains the new URL and `annotations: []`. Add an upload-rejection test that keeps the confirmation dialog closed after confirmation, shows the upload error, and does not call `saveGuide` with a cleared document.

```tsx
it('asks before replacing an annotated image and does not upload when canceled', async () => {
  const user = userEvent.setup();
  const document = imageDocumentWithAnnotation();
  const api = createApi({ document });
  render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
  await screen.findByDisplayValue('订单教学');
  openHierarchyPanel();
  await user.click(screen.getByRole('button', { name: '选择资料 ERP 页面' }));

  await user.upload(screen.getByLabelText('上传图片'), new File(['new'], 'new.png', { type: 'image/png' }));
  expect(screen.getByRole('dialog', { name: '确认替换带标注的图片' })).toBeInTheDocument();
  expect(api.uploadMedia).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: '取消替换' }));
  expect(api.uploadMedia).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
    document: expect.objectContaining({ nodes: [expect.objectContaining({ data: expect.objectContaining({ url: 'https://example.com/erp.png', annotations: expect.any(Array) }) })] }),
  }));
});

it('uploads only after confirmation and clears annotations in the saved replacement revision', async () => {
  const user = userEvent.setup();
  const api = createApi({ document: imageDocumentWithAnnotation() });
  (api.uploadMedia as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'asset-new', url: '/api/media/asset-new', kind: 'IMAGE' });
  render(<GuideEditor guideId="guide-host" api={api} onBack={vi.fn()} />);
  await screen.findByDisplayValue('订单教学');
  openHierarchyPanel();
  await user.click(screen.getByRole('button', { name: '选择资料 ERP 页面' }));
  await user.upload(screen.getByLabelText('上传图片'), new File(['new'], 'new.png', { type: 'image/png' }));
  await user.click(screen.getByRole('button', { name: '确认并上传' }));

  await waitFor(() => expect(api.uploadMedia).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
    document: expect.objectContaining({ nodes: [expect.objectContaining({ data: expect.objectContaining({ assetId: 'asset-new', url: '/api/media/asset-new', annotations: [] }) })] }),
  }));
});
```

Use the existing test helper rather than adding a second API mock. Keep the test document's annotation stable so a future implementation cannot pass by deleting the whole node.

- [x] **Step 2: Run the focused tests and verify the expected failure**

Run:

```bash
pnpm --filter @guideanything/web test -- GuideEditor.test.tsx
```

Expected result: FAIL because the current file input immediately calls `uploadMedia`, no replacement confirmation dialog exists, and the current update preserves annotations.

### Task 2: Implement the confirmation and replacement state flow

**Files:**
- Create: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/ImageReplacementDialog.tsx`
- Modify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/GuideEditor.tsx`

**Interfaces:**
- `ImageReplacementDialog` consumes `annotationCount`, `uploading`, `onConfirm`, and `onCancel` and exposes accessible actions named `确认并上传` and `取消替换`.
- `GuideEditor` consumes the dialog and owns pending file/node state, upload failure state, and the single `commit` that replaces the media and clears annotations.

- [x] **Step 1: Add the state-free confirmation dialog**

Create a dialog matching the existing `AnnotatedImageDeletionDialog` modal structure. Use role name `确认替换带标注的图片`, explain that the new image will not inherit the existing annotation count, and state that the old saved draft can be restored. Close on Escape by invoking `onCancel`; disable both actions while `uploading` and render `正在上传…` on the confirm action while active.

- [x] **Step 2: Add pending replacement state and the upload helper**

In `GuideEditor`, add state shaped as:

```ts
type PendingImageReplacement = { nodeId: string; file: File; annotationCount: number };
const [imageReplacement, setImageReplacement] = useState<PendingImageReplacement | null>(null);
const [imageReplacementUploading, setImageReplacementUploading] = useState(false);
```

Implement a `replaceImage(nodeId, file)` callback that:

1. calls `api.uploadMedia(file)`;
2. rejects non-`IMAGE` responses with the existing image-only error wording;
3. finds the same image node still present in the latest `document`;
4. calls `commit` once with `{ ...node.data, assetId, url, annotations: [] }`;
5. leaves the old document untouched if upload or validation fails;
6. reports failure through the existing editor error surface and clears the uploading state.

Implement `requestImageUpload(nodeId, file)` so it opens `ImageReplacementDialog` when the current node has one or more annotations; otherwise it calls `replaceImage` directly. In `confirmImageReplacement`, save the current dirty editor snapshot through `saveRef.current()` before calling `replaceImage`; if that save rejects or returns no guide, surface the error and do not upload. Do not call `uploadMedia` while the dialog is only open. After a successful replacement, clear the pending state and let the existing `save`/autosave flow create the new draft revision.

- [x] **Step 3: Wire the image file input to the request path**

Change the image branch of `NodeInspector` to receive an `onUploadImage` callback from `GuideEditor`. The file input should pass the selected file and node ID to that callback rather than uploading directly. Render `ImageReplacementDialog` with the pending annotation count and replacement callback beside the existing deletion and draft-history dialogs. Reuse existing modal and button classes; do not introduce a new dependency or a second persistence path.

- [x] **Step 4: Run the focused tests and verify the expected green result**

Run:

```bash
pnpm --filter @guideanything/web test -- GuideEditor.test.tsx
```

Expected result: the new cancel, confirm, and existing editor tests pass with zero failures.

### Task 3: Verify draft-history recovery and regression boundaries

**Files:**
- Modify only if a missing assertion is found: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/GuideEditor.test.tsx`
- Existing recovery implementation to verify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/DraftHistoryDialog.tsx`, `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/api/src/modules/guides/repository.ts`

**Interfaces:**
- Uses the existing `saveGuide` revision and `restoreDraft` APIs; no contract or migration changes are expected.
- Produces evidence that the replacement is one current draft revision and that an older saved revision remains restorable.

- [x] **Step 1: Run the existing draft-history and API regression tests**

Run:

```bash
pnpm --filter @guideanything/web test -- GuideEditor.test.tsx DraftHistoryDialog.test.tsx
pnpm --filter @guideanything/api test -- guides.test.ts
```

Expected result: the editor saves a dirty old image/annotation snapshot before uploading, saves the replacement document as a later revision, the history UI continues to call `restoreDraft` with the current revision, and the API keeps the source snapshot while creating a new current revision.

- [x] **Step 2: Run type checking and the affected package build**

Run:

```bash
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
```

Expected result: both commands exit with code 0 and report no TypeScript or production-build errors.

- [x] **Step 3: Review the final diff and worktree boundary**

Run:

```bash
git diff --check
git diff -- apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/features/editor/ImageReplacementDialog.tsx
git status --short
```

Confirm that the diff contains only the replacement dialog, the editor wiring, the focused tests, and this plan file; preserve all pre-existing modified paths and do not stage or commit without separate authorization.

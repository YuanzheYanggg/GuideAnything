# Lesson Media Lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible, theme-aware large-screen preview for image and video resources in learning mode without changing guide data or editor behavior.

**Architecture:** Keep preview state inside `LessonPage`. Add a focused `MediaLightbox` component that renders either an image or the existing `VideoNodeView`, and pass optional preview callbacks into lesson media renderers. The editor keeps using `VideoNodeView` without the callback, so its current behavior remains unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing `useMediaSource` media resolution, existing CSS theme variables.

## Global Constraints

- Scope is limited to learning-mode image and video preview; Markdown remains inline.
- Preview state is transient React state and must not modify `CanvasDocument` or call save APIs.
- Image and video media must continue using `useMediaSource` for authenticated `/api/media/...` URLs.
- Existing editor consumers of `VideoNodeView` must remain compatible with optional preview props.
- Preserve the unrelated uncommitted stage-title fix in `HierarchyPanel.tsx` and `GuideEditor.test.tsx`.

---

### Task 1: Build the media lightbox component

**Files:**
- Create: `apps/web/src/features/lesson/MediaLightbox.tsx`
- Create: `apps/web/src/features/lesson/MediaLightbox.test.tsx`

**Interfaces:**
- Produces `MediaPreview`, `MediaLightboxProps`, and the `MediaLightbox` component for `LessonPage`.
- Consumes `VideoNodeView` and the existing `CanvasNode<'video'>['data']` type.

- [ ] **Step 1: Write the failing component tests**

Test the following public behavior:

```tsx
it('renders an image preview dialog with alt text and caption', () => {
  render(<MediaLightbox preview={{ kind: 'image', source: '/image.png', alt: 'ERP 页面', caption: '字段位置' }} onClose={onClose} />);
  expect(screen.getByRole('dialog', { name: '图片预览' })).toBeVisible();
  expect(screen.getByRole('img', { name: 'ERP 页面' })).toHaveAttribute('src', '/image.png');
  expect(screen.getByText('字段位置')).toBeVisible();
});

it('closes from the close button, backdrop, and Escape', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<MediaLightbox preview={{ kind: 'image', source: '/image.png', alt: 'ERP 页面' }} onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: '关闭媒体预览' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  onClose.mockClear();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  onClose.mockClear();
  rerender(<MediaLightbox preview={{ kind: 'image', source: '/image.png', alt: 'ERP 页面' }} onClose={onClose} />);
  await user.click(screen.getByRole('dialog', { name: '图片预览' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
```

Also render a video preview and assert its `video` element and keypoint button are visible. The test must fail before the component exists.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @guideanything/web test -- MediaLightbox.test.tsx
```

Expected: the new test file fails because `MediaLightbox` is not implemented.

- [ ] **Step 3: Implement the minimal lightbox**

Define the preview union and component props:

```tsx
export type MediaPreview =
  | { kind: 'image'; source: string; alt: string; caption?: string }
  | { kind: 'video'; source: string; data: CanvasNode<'video'>['data'] }
  | null;

export function MediaLightbox({ preview, onClose, onKeypoint }: {
  preview: MediaPreview;
  onClose: () => void;
  onKeypoint?: (id: string) => void;
}) { /* render null or the dialog */ }
```

The implementation must:

- Return `null` for a null preview.
- Render a fixed backdrop and a `role="dialog" aria-modal="true"` panel.
- Render an image with `object-fit: contain`, or render `VideoNodeView` with `mediaSource={preview.source}` and no preview callback.
- Close from the close button, `Escape`, and only when the backdrop itself is clicked.
- Focus the close button when mounted, restore the previously focused element on unmount, and temporarily set `document.body.style.overflow = 'hidden'`.
- Keep the existing body overflow value during cleanup.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @guideanything/web test -- MediaLightbox.test.tsx
```

Expected: all lightbox tests pass.

---

### Task 2: Connect learning-page images and videos

**Files:**
- Modify: `apps/web/src/features/lesson/LessonPage.tsx:80-242`
- Modify: `apps/web/src/features/nodes/VideoNode.tsx:8-24`
- Modify: `apps/web/src/features/lesson/LessonPage.test.tsx`
- Modify: `apps/web/src/features/nodes/VideoNode.test.tsx`

**Interfaces:**
- `VideoNodeView` adds optional `onOpenPreview?: (source: string) => void` and `mediaSource?: string` props.
- `LessonPage` owns `MediaPreview` state and passes callbacks into `CurrentNodeContent`.

- [ ] **Step 1: Add failing learning-page interaction tests**

Extend `LessonPage.test.tsx` with an image resource and assert:

```tsx
fireEvent.click(screen.getByRole('img', { name: 'ERP 页面' }));
expect(screen.getByRole('dialog', { name: '图片预览' })).toBeVisible();
await user.click(screen.getByRole('button', { name: '关闭媒体预览' }));
expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument();
```

On the existing video step, click the video element and assert the video preview dialog appears. Click its existing keypoint button and assert the video `currentTime` changes. Add a component-level test that an omitted `onOpenPreview` leaves the editor `VideoNodeView` behavior unchanged.

Run:

```bash
pnpm --filter @guideanything/web test -- LessonPage.test.tsx VideoNode.test.tsx
```

Expected: the new assertions fail because learning media does not open a dialog and `VideoNodeView` has no preview callback yet.

- [ ] **Step 2: Add optional preview support to `VideoNodeView`**

Resolve the media source once and use the optional override for the lightbox:

```tsx
export function VideoNodeView({ data, onKeypoint, onOpenPreview, mediaSource }: {
  data: CanvasNode<'video'>['data'];
  onKeypoint?: (id: string) => void;
  onOpenPreview?: (source: string) => void;
  mediaSource?: string;
}) {
  const resolvedSource = useMediaSource(data.url);
  const source = mediaSource ?? resolvedSource;
  // Existing keypoint logic remains unchanged.
  return <div className="video-content">
    <video src={source} controls preload="metadata" onClick={() => { if (source) onOpenPreview?.(source); }} aria-label={data.caption || '教学视频'} />
    {/* existing caption and keypoint list */}
  </div>;
}
```

The exported editor `VideoNode` passes no new callback. The lightbox passes the already resolved `mediaSource` and no `onOpenPreview`, so clicking inside the lightbox cannot recursively open another lightbox.

- [ ] **Step 3: Add transient preview state to `LessonPage`**

Add:

```tsx
const [mediaPreview, setMediaPreview] = useState<MediaPreview>(null);
const closeMediaPreview = useCallback(() => setMediaPreview(null), []);
const handleKeypoint = useCallback((keypointId: string) => {
  const targetIndex = lessonSteps.findIndex(({ step }) => step.keypointId === keypointId);
  if (targetIndex >= 0) setCurrentIndex(targetIndex);
}, [lessonSteps]);
```

Pass `onOpenPreview` from `CurrentNodeContent` to `LessonImage` and `VideoNodeView`. Use the resolved source to construct the union payload. Render `MediaLightbox` once at the end of the page. Clear `mediaPreview` when the current step or version changes, and do not call `saveGuide`.

- [ ] **Step 4: Make image resources clickable**

Change `LessonImage` to accept `onOpenPreview?: (source: string) => void`. Render the existing image inside a button-like clickable wrapper only when `source` is available; preserve the current failed-load message and caption. The click handler must pass the resolved source and leave the image `alt` text unchanged.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --filter @guideanything/web test -- LessonPage.test.tsx VideoNode.test.tsx MediaLightbox.test.tsx
```

Expected: all focused media and learning-page tests pass.

---

### Task 3: Add responsive theme-aware presentation and final verification

**Files:**
- Modify: `apps/web/src/styles.css:279-294,305-332`
- Modify: `apps/web/src/features/lesson/LessonPage.test.tsx` if a dialog focus assertion needs a stable page-level test

**Interfaces:**
- Consumes the `media-lightbox-backdrop`, `media-lightbox`, `media-lightbox-close`, `media-lightbox-media`, and `media-lightbox-caption` class names produced by `MediaLightbox`.

- [ ] **Step 1: Add the lightbox styles**

Use existing theme variables and add:

```css
.media-lightbox-backdrop { position: fixed; z-index: 120; inset: 0; display: grid; place-items: center; padding: clamp(16px, 4vw, 48px); background: var(--ga-overlay); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.media-lightbox { position: relative; display: grid; gap: 12px; width: min(1120px, 100%); max-height: 100%; padding: clamp(16px, 3vw, 28px); border: 1px solid var(--ga-border); border-radius: 20px; color: var(--ga-text); background: var(--ga-surface-strong); box-shadow: var(--ga-shadow-floating); }
.media-lightbox-media { display: grid; place-items: center; min-width: 0; min-height: 0; max-height: min(78vh, 820px); }
.media-lightbox-media img, .media-lightbox-media video { display: block; width: 100%; max-width: 100%; max-height: min(78vh, 820px); border-radius: 12px; background: var(--ga-bg); object-fit: contain; }
.media-lightbox-close { position: absolute; z-index: 1; top: 10px; right: 10px; width: 36px; height: 36px; border: 1px solid var(--ga-border); border-radius: 10px; color: var(--ga-text); background: var(--ga-surface-solid); }
.media-lightbox-caption { margin: 0; color: var(--ga-text-secondary); line-height: 1.5; }
```

Add a small-screen rule reducing panel padding and media height without introducing horizontal overflow. Add a visible focus outline for the close button and clickable media trigger.

- [ ] **Step 2: Verify accessibility and responsive behavior in tests**

Assert the dialog has `aria-modal="true"`, the close button receives focus when opened, and the triggering image regains focus after closing. Keep the test independent of exact pixel values.

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all workspace tests pass, TypeScript reports no errors, Vite produces a production build, and `git diff --check` produces no output.

- [ ] **Step 4: Verify the live learning page**

With the existing dev server at `http://127.0.0.1:5174`, reload the learning page, open an image, verify the dialog is larger and readable, open a video, verify native controls and keypoints, then close with the button, backdrop, and `Escape`. Leave the user page in its original learning-step state.

## Handoff

Do not create a commit automatically. Report the changed files, verification results, and current Git status so the user can decide whether to commit and push.

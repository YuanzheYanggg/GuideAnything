# Guide Details Summary, Tags, and Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GuideEditor header's always-open summary and tag inputs with compact, expandable React presentation components while making the digest trigger more expressive.

**Architecture:** Add a focused `GuideDetailsHeader` component that owns only summary/tag presentation state and receives controlled guide values plus existing callbacks from `GuideEditor`. Keep the parent as the source of truth for persistence, digest generation, disabled layout-preview state, and focus restoration. Reuse the existing local SpotlightCard and ShinyText primitives and map all styling to existing CSS variables.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS variables, `@phosphor-icons/react`.

## Global Constraints

- Preserve the existing `摘要` and `标签` values, save callback, digest callback, digest focus ref, and layout-preview disabled behavior.
- Do not change API contracts, routes, persistence semantics, or digest dialog behavior.
- Do not add `three`, `motion`, or another runtime dependency.
- Keep all new interactive controls keyboard accessible and use the existing light/dark token strategy.
- Keep continuous motion reduced-motion safe and preserve explicit mobile collapse rules.
- Do not stage, overwrite, or reformat unrelated existing dirty or untracked files in the shared worktree.

---

### Task 1: Add the controlled GuideDetailsHeader component

**Files:**
- Create: `apps/web/src/features/editor/GuideDetailsHeader.tsx`
- Test: `apps/web/src/features/editor/GuideDetailsHeader.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `GuideDetailsHeader({ summary, tags, disabled, digestTriggerRef, onSummaryChange, onTagsChange, onOpenDigest }: Props)` renders the summary preview, tag chips, and digest command card.
- `onSummaryChange(value: string)` and `onTagsChange(tags: string[])` remain controlled callbacks owned by `GuideEditor`.
- `digestTriggerRef` remains attached to the digest button so the existing dialog close effect can restore focus.

- [x] **Step 1: Write failing component tests**

Test the resting state, tag disclosure, summary edit, tag edit, disabled state, and digest trigger:

```tsx
it('shows a compact summary, only the first three tags, and a digest command card', () => {
  render(<GuideDetailsHeader {...props({ summary: '这是一个很长的摘要', tags: ['ERP', '原料', '打样', '供应商'] })} />);
  expect(screen.getByRole('button', { name: '编辑摘要' })).toBeVisible();
  expect(screen.getByText('ERP')).toBeVisible();
  expect(screen.getByRole('button', { name: '更多标签，共 1 个' })).toBeVisible();
  expect(screen.queryByText('供应商')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '生成指南总览' })).toBeVisible();
});

it('expands tags and enters controlled edit states', async () => {
  const user = userEvent.setup();
  const onSummaryChange = vi.fn();
  const onTagsChange = vi.fn();
  render(<GuideDetailsHeader {...props({ tags: ['ERP', '原料', '打样', '供应商'], onSummaryChange, onTagsChange })} />);
  await user.click(screen.getByRole('button', { name: '更多标签，共 1 个' }));
  expect(screen.getByText('供应商')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '编辑摘要' }));
  await user.clear(screen.getByLabelText('摘要'));
  await user.type(screen.getByLabelText('摘要'), '新的摘要');
  expect(onSummaryChange).toHaveBeenLastCalledWith('新的摘要');
  await user.click(screen.getByRole('button', { name: '编辑标签' }));
  await user.clear(screen.getByLabelText('标签'));
  await user.type(screen.getByLabelText('标签'), 'ERP，新增');
  expect(onTagsChange).toHaveBeenLastCalledWith(['ERP', '新增']);
});
```

- [x] **Step 2: Run the focused component test and verify it fails**

Run: `pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideDetailsHeader.test.tsx`

Expected: FAIL because `GuideDetailsHeader` does not exist.

- [x] **Step 3: Implement the component with local presentation state**

Use `useState` for `summaryEditing`, `tagsEditing`, and `showAllTags`. Keep the controlled callbacks simple:

```tsx
const parseTags = (value: string) => value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean);
const visibleTags = showAllTags ? tags : tags.slice(0, 3);
const extraTagCount = Math.max(0, tags.length - 3);
```

Render the summary preview as a non-editable panel with an `编辑摘要` button. Render the textarea only while editing. Render tags as chips in the resting state and the existing comma-separated input only while editing. Keep the digest trigger as a real button with `ref={digestTriggerRef}` and `onClick={onOpenDigest}`.

- [x] **Step 4: Add focused CSS for preview panels and digest command card**

Add scoped selectors for `.guide-details-content`, `.guide-summary-preview`, `.guide-tags-preview`, `.guide-detail-heading`, `.guide-detail-edit`, `.guide-tag-list`, `.guide-tag-chip`, `.guide-tags-more`, `.guide-details-editor`, `.guide-digest-command`, and their focus, disabled, hover, mobile, and reduced-motion states. Animate only opacity/transform or the existing pseudo-element sheen. Use `var(--ga-*)` tokens and provide a solid fallback under `prefers-reduced-transparency`.

- [x] **Step 5: Run the component tests and verify they pass**

Run: `pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideDetailsHeader.test.tsx`

Expected: all focused component tests pass.

### Task 2: Replace the inline GuideEditor details markup and preserve existing tests

**Files:**
- Modify: `apps/web/src/features/editor/GuideEditor.tsx:29-38,1343-1350`
- Modify: `apps/web/src/features/editor/GuideEditor.test.tsx` summary/tag mutation helpers and header assertions

**Interfaces:**
- Import `GuideDetailsHeader` and replace only the contents of the existing `指南信息` region.
- Keep `setSummary` and `setTags` callbacks in the parent so every existing save and digest merge path remains unchanged.

- [x] **Step 1: Update the header test for display state and add edit/disclosure assertions**

Change the initial header assertions to check the compact display, then enter edit state for value assertions:

```tsx
expect(within(guideDetails).getByRole('button', { name: '编辑摘要' })).toBeVisible();
expect(within(guideDetails).getByText('ERP')).toBeVisible();
await user.click(within(guideDetails).getByRole('button', { name: '编辑摘要' }));
expect(within(guideDetails).getByLabelText('摘要')).toHaveValue('');
```

Add a small test helper for existing mutation tests:

```tsx
async function openSummaryEditor() {
  const editor = screen.queryByLabelText('摘要');
  if (editor) return editor;
  fireEvent.click(screen.getByRole('button', { name: '编辑摘要' }));
  return screen.findByLabelText('摘要');
}
```

Use the same pattern for tags through `编辑标签`, and keep all existing digest save/apply assertions unchanged after entering edit mode.

- [x] **Step 2: Run the focused GuideEditor tests and verify the display assertions fail**

Run: `pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx -t "guide-wide details|summary|digest"`

Expected: FAIL because the current markup still renders the textarea/input directly and has no preview controls.

- [x] **Step 3: Replace only the inline details markup**

Use:

```tsx
<section className="guide-details-header" aria-label="指南信息">
  <GuideDetailsHeader
    summary={summary}
    tags={tags}
    disabled={Boolean(layoutPreview)}
    digestTriggerRef={digestTriggerRef}
    onSummaryChange={(value) => { if (layoutPreview) return; setSummary(value); setSaveState('未保存'); }}
    onTagsChange={(value) => { if (layoutPreview) return; setTags(value); setSaveState('未保存'); }}
    onOpenDigest={() => void openDigest()}
  />
</section>
```

- [x] **Step 4: Run the focused GuideEditor tests and verify they pass**

Run: `pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideEditor.test.tsx -t "guide-wide details|summary|digest"`

Expected: existing digest generation, save-before-digest, merge conflict, focus restoration, and header tests pass.

### Task 3: Validate the full Web package and real responsive UI

**Files:**
- Inspect: `apps/web/src/features/editor/GuideDetailsHeader.tsx`
- Inspect: `apps/web/src/features/editor/GuideEditor.tsx`
- Inspect: `apps/web/src/styles.css`

- [x] **Step 1: Run component, GuideEditor, style, and full Web tests**

Run:

```bash
pnpm --filter @guideanything/web exec vitest run src/features/editor/GuideDetailsHeader.test.tsx src/features/editor/GuideEditor.test.tsx src/styles.test.ts
pnpm --filter @guideanything/web test
```

Expected: focused and full suites pass.

- [x] **Step 2: Run typecheck and production build**

Run: `pnpm --filter @guideanything/web typecheck && pnpm --filter @guideanything/web build`

Expected: both commands exit 0. A pre-existing Vite chunk-size warning may remain, but no TypeScript or build error is allowed.

- [x] **Step 3: Browser-verify desktop, mobile, tag disclosure, edit state, and reduced motion**

Using the existing real GuideAnything stack, verify at 1440px and 390px:

- Summary shows as a compact preview and no full textarea is visible until `编辑摘要` is clicked.
- First three tags render as chips; `+N 更多` expands and `收起` collapses.
- Digest command card remains the only saturated action in the details card and opens the existing dialog.
- `document.documentElement.scrollWidth === innerWidth` at both widths.
- `prefers-reduced-motion: reduce` disables preview sheen without hiding content.

- [x] **Step 4: Run scoped whitespace and status review**

Run:

```bash
git diff --check -- apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
git status --short -- apps/web/src/features/editor/GuideDetailsHeader.tsx apps/web/src/features/editor/GuideDetailsHeader.test.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
```

Expected: no whitespace errors. Existing unrelated dirty files remain untouched and unstaged.

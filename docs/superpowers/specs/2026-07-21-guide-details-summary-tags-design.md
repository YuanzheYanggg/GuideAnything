# Guide Details Summary, Tags, and Digest Design

## Design read

Reading this as: a dense B2B editor header for guide authors, with a compact dark-tech and Aurora visual language, leaning toward native React components plus the existing local SpotlightCard interaction.

Dial values for this refinement: `DESIGN_VARIANCE 6`, `MOTION_INTENSITY 5`, `VISUAL_DENSITY 3`. The goal is to make the header easier to scan by reducing visible text, not to add another dense data panel.

## User-visible outcome

The guide details area keeps the existing header region and all existing save, digest, and field-update behavior, but defaults to a display state:

- Summary is a compact preview panel with an icon, a two-line clamp, and an explicit edit control. Long text is not rendered as a full-width textarea in the resting state.
- Tags render as chips. The first three chips are visible by default. If more tags exist, a `+N 更多` disclosure expands the remaining chips and changes to `收起`.
- Summary and tags retain editing through local edit states. Editing opens the existing labelled textarea/input and uses the same controlled values and `setSaveState('未保存')` callbacks.
- The digest action becomes a richer command card with a sparkle icon, title, short supporting copy, accent border treatment, and the existing dialog trigger ref and `openDigest` callback.

## Component boundary

Create `GuideDetailsHeader` under `apps/web/src/features/editor/GuideDetailsHeader.tsx`. It owns only presentation state:

- `summaryEditing`
- `tagsEditing`
- `showAllTags`

The parent `GuideEditor` remains the owner of `summary`, `tags`, `layoutPreview`, `openDigest`, and the digest focus ref. The child receives controlled values and callbacks, so draft persistence and three-way digest merge behavior stay unchanged.

Reuse the existing `SpotlightCard` and `ShinyText` primitives. Use Phosphor icons only. No new animation or runtime dependency is required.

## Interaction states

1. Resting state: summary preview, first three tag chips, and the digest command card are visible.
2. Summary edit state: the summary preview becomes a labelled textarea with a compact completion action.
3. Tags edit state: chips become the existing comma-separated labelled input with a compact completion action.
4. Tags expanded state: all tags are visible and the disclosure button is labelled `收起` with `aria-expanded="true"`.
5. Disabled state: layout preview disables the edit/disclosure controls and prevents entering edit mode.
6. Reduced motion: spotlight and CTA sheen stop through the existing global media rule; content and controls remain visible.

## Layout and accessibility

The outer `指南信息` region remains in `.editor-header`. The child uses a stable desktop three-column grid: summary preview, tags preview, and digest command card. Existing field labels remain `摘要` and `标签` in edit state. Disclosure and edit controls are real buttons with explicit names, focus styles, and `aria-expanded` where applicable. Mobile stacks the preview panels without introducing horizontal scrolling.

## Validation

- Component tests verify summary and tag display states, `+N 更多` expansion, edit entry, and controlled callbacks.
- Existing GuideEditor tests are updated to enter edit state before mutating summary or tags; digest save/apply/focus behavior remains covered.
- Run Web tests, typecheck, build, and a real browser check at desktop and mobile widths. Verify no header overflow, digest trigger focus restoration, and reduced-motion animation disablement.

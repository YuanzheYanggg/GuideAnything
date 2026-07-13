# Task 7 Report — Generic Resource Table and Personal Pages

## Status

Implemented the desktop personal resource experience for favorites, recent views, explicitly shared resources, and trash. The temporary route headings now use a shared API-backed resource table with honest GUIDE navigation and non-interactive future resource kinds.

## Implementation

- Added `ResourceTable` with semantic article rows, Phosphor kind icons, compact 1280px+ columns, direct open/favorite/restore controls, and one accessible action menu per row.
- GUIDE rows edit only when OWNER/EDIT and unpublished; published guides open learning mode. SOURCE, AGENT, ONTOLOGY, CONVERSATION, and ARTIFACT rows show truthful labels/icons without fake open behavior.
- Added confirmation dialogs for trash and permanent removal. Permanent-removal copy states that published snapshots remain available to pinned references.
- Added keyboard menu focus entry and Escape focus restoration, dialog Escape/backdrop cancellation, mutation pending controls, and local success updates without page reloads.
- Added page-specific loaders, headings, descriptions, empty states, server error messages, and failure-safe item retention.
- Wired the four authenticated routes to `WorkspaceShell` outlet context and durable editor/learning URLs.
- Followed the desktop-only override: no mobile-specific resource CSS or tests were added.

## TDD Evidence

Initial RED:

```bash
pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx
```

Observed exit 1 because `PersonalResourcePage` did not exist. Subsequent focused RED runs proved the load-error/empty-state collision, missing menu focus management, and missing direct-mutation pending state before their targeted fixes.

Final GREEN:

```bash
pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx
```

Observed exit 0: 12 test files passed, 41 tests passed, 0 failed. Coverage includes favorite removal, trash restore, mutation failure retention, permanent-removal warning/confirmation, GUIDE/future-kind open policy, load errors, keyboard menu focus, and pending mutation controls.

## Final Verification

- `pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx`: passed, 41/41 tests.
- `pnpm --filter @guideanything/web typecheck`: passed.
- `pnpm --filter @guideanything/web build`: passed; Vite transformed 5079 modules and emitted the production bundle.
- `git diff --check`: passed.
- Post-commit worktree status: clean.

## Commit

`21df145c0cdbfc8d5e91b39e799eab2c36434e67 feat: add personal resource pages`

## Self-Review

- Confirmed every brief-provided page title, description, loader mapping, and empty-state phrase is present.
- Confirmed successful mutations update local state and failed mutations preserve the row while displaying the server message.
- Confirmed both destructive actions require accessible confirmation and permanent removal contains the pinned-reference snapshot warning.
- Confirmed only GUIDE can open and the published/unpublished permission policy matches the brief exactly.
- Confirmed no mobile-specific rules, fake module routes, unrelated API changes, or generated build assets entered the commit.

## Concerns

No functional concerns found. Git printed the repository's existing auto-derived committer identity notice; the commit succeeded and the worktree is clean.

## Review Fix — Route Scope, Focus, Menus, and Table Semantics

### Findings addressed

- Personal route transitions now remount route-owned UI state and explicitly clear rows before loading, so a failed destination loader cannot reveal rows from the previous route.
- Loader and mutation completions are guarded by a request-generation ref. Late resolve/reject results after route navigation or unmount cannot update the new page or surface stale errors.
- Destructive dialogs capture the originating action-menu trigger, focus Cancel on entry, trap forward/backward Tab, restore connected origins on Cancel/Escape/backdrop/completion, and move focus to the modal container while both controls are disabled during a pending request.
- Pending destructive dialogs ignore Cancel, Escape, and backdrop dismissal until the request settles; processing copy and disabled controls remain visible throughout.
- Action menus now dismiss on outside pointer interaction and focus departure while preserving Escape-to-trigger behavior.
- The resource list now exposes a coherent ARIA table with row groups, column headers, rows, and five associated cells per resource.

### RED evidence

Command:

```bash
pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx WorkspacePages.test.tsx
```

Observed before review fixes: exit 1, with 7 expected failures covering stale rows after a failed favorites-to-shared transition, late mutation success/rejection, missing dialog focus containment/restoration, dismissible pending dialogs, stale action menus, and missing table semantics. A follow-up RED isolated pending-modal focus containment and synchronous backdrop focus restoration.

### GREEN and final verification

Commands:

```bash
pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx WorkspacePages.test.tsx
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
git diff --check
```

Observed immediately before commit:

- Covering web tests: exit 0; 12 files passed, 48 tests passed, 0 failed.
- Web typecheck: exit 0; `tsc --noEmit` completed without errors.
- Production build: exit 0; Vite transformed 5079 modules and emitted the bundle.
- `git diff --check`: exit 0; no whitespace errors.

### Changed files

- `apps/web/src/features/personal/PersonalResourcePage.tsx`
- `apps/web/src/features/personal/PersonalResourcePage.test.tsx`
- `apps/web/src/features/resources/ResourceTable.tsx`

Review-fix commit: `0b1b0e107de0066026c12ef6adf1c99845ee8d37 fix: scope personal resource interactions`

### Review-fix concerns

No functional concerns found. Desktop-only scope remains intact: the review fix adds no mobile CSS or mobile tests. Git printed the existing auto-derived committer identity notice; the commit succeeded and the worktree is clean.

## Review Fix — Focus After Successful Resource Removal

### RED

Command:

```bash
pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx
```

Observed before the focus fix: exit 1; 12 test files ran, 1 regression failed and 48 existing tests passed. After permanent removal, React removed the originating menu trigger with its row before synchronous focus restoration could retain it, so `document.body` remained focused instead of the surviving row action.

A follow-up RED run added failure-path coverage and exited 1 with 1 failed and 50 passed tests: the retained origin was still disabled while pending cleanup committed, so immediate `.focus()` also left focus on `document.body` after a rejected removal.

### Implementation

- Captured the originating trigger, next and previous row actions, resource table, and page heading before opening a destructive confirmation.
- Deferred successful focus restoration until after React committed the row removal. The connected origin remains first choice; otherwise focus falls through to the next row, previous row, table, then page heading.
- Made the resource table and page heading programmatically focusable for empty-list and disconnected-table fallbacks.
- Kept cancellation on immediate origin restoration; failed requests defer origin restoration until pending cleanup has re-enabled the trigger. The existing pending-dialog dismissal lock remains unchanged.
- Added regressions for both a surviving next row and removal of the final row; neither success path may leave focus on `document.body`.

### GREEN and final verification

Commands:

```bash
pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
git diff --check
```

Observed immediately before commit:

- Web tests: exit 0; 12 test files passed, 51 tests passed, 0 failed.
- Web typecheck: exit 0; `tsc --noEmit` completed without errors.
- Production build: exit 0; Vite transformed 5079 modules and emitted the production bundle.
- `git diff --check`: exit 0; no whitespace errors.

### Concerns

No functional concerns found. The fallback changes are desktop-only and add no mobile-specific behavior or styling.

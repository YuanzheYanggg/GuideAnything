# Task 8 Report: Library, Editor, and Lesson Integration

## Status

Complete. The global and workspace-scoped guide library now uses workspace-aware creation, shared resource rows, permission-aware actions, and recent-view recording across editor and lesson routes.

## TDD evidence

### RED

The focused command was run before production changes:

```bash
pnpm --filter @guideanything/web test -- LibraryPage.test.tsx GuideEditor.test.tsx LessonPage.test.tsx
```

It failed for the intended missing behavior:

- `createGuide` received no workspace ID.
- No workspace picker existed for global creation.
- Workspace create intent was not consumed.
- Library rows had no favorite/trash actions.
- Editor and lesson loads made no `recordRecent` call.

Two additional RED checks caught permission and subguide boundaries:

- EDITOR users could not create despite EDIT workspace permission.
- A child version with a different `workspaceItemId` was not recorded separately.

### GREEN

- `LibraryApi` now accepts workspace scope for drafts/search/creation and lists editable workspaces.
- Global creation creates directly for one editable workspace, opens a picker for multiple, and reports the no-workspace state.
- Workspace creation uses the route workspace directly.
- `?create=1` is consumed with history replacement before the create request, guarded to run once per mount.
- Published and draft GUIDE rows are rendered through `ResourceTable` with workspace, favorite, open, and authorized trash behavior.
- VIEW rows no longer expose destructive menus.
- Editor recent recording occurs only after successful draft validation/load.
- Lesson recent recording occurs only after successful root load; subguide navigation records only a newly returned workspace item.

## Backend and contract integration

- Guide version snapshots expose `workspaceItemId` while a live workspace item exists.
- Historical published snapshots remain readable after permanent resource removal; their now-missing workspace item ID is optional.
- Search accepts `workspaceId` and filters both empty-query and keyword-query results.
- Guide creation sends the backend-required `workspaceId`.

## Verification

Fresh final run:

```text
pnpm --filter @guideanything/web test       12 files, 60 tests passed
pnpm --filter @guideanything/api test        9 files, 33 tests passed
pnpm --filter @guideanything/web typecheck   passed
pnpm --filter @guideanything/api typecheck   passed
pnpm --filter @guideanything/web build       passed
git diff --check                            passed
```

## Self-review

- Creation intent is removed before awaiting the network request, preventing reload duplication even while creation is pending.
- Direct workspace creation remains server-authorized; the UI does not infer authority beyond workspace permissions.
- Trash updates both published/search and draft local collections without route navigation.
- Existing subguide open/back behavior and auth/theme route structure remain intact.
- Desktop-only scope was preserved; no mobile-specific changes were introduced.
- API regression exposed and corrected a published-snapshot compatibility issue caused by permanently removed workspace items.

## Concerns

No blocking concerns. Recent recording is intentionally fire-and-forget so analytics failure does not block a successfully loaded guide.

---

## Review follow-up: permission, async, and navigation hardening

### RED evidence

The review regression tests were added before the follow-up implementation. The focused frontend run reported 6 intended failures covering draft favorite state, overlapping search, picker behavior, workspace-load retry, safe return navigation, and duplicate subguide activation. The first complete backend run then exposed the requester-aware SQL regression exactly:

```text
pnpm --filter @guideanything/api test
Test Files  5 failed | 4 passed (9)
Tests       19 failed | 15 passed (34)
root error: no such column: favorite.item_id
```

After correcting the query scope, one deliberately incorrect permission expectation remained and demonstrated that a VIEW learner receives `canManageLifecycle: false`:

```text
Test Files  1 failed | 8 passed (9)
Tests       1 failed | 33 passed (34)
expected canManageLifecycle true, received false
```

### GREEN evidence

Fresh follow-up verification:

```text
pnpm --filter @guideanything/api test
Test Files  9 passed (9)
Tests       34 passed (34)

pnpm --filter @guideanything/web test
Test Files  12 passed (12)
Tests       67 passed (67)

pnpm --filter @guideanything/api typecheck   passed
pnpm --filter @guideanything/web typecheck   passed
pnpm lint                                    passed
pnpm build                                   passed
git diff --check                             passed
```

### Permission note

Lifecycle authority is explicit and requester-specific. A guide owner and the owning workspace's `OWNER` receive `canManageLifecycle: true`; an EDIT collaborator receives `false` unless they own the guide. The API remains authoritative for trash, restore, and permanent removal. Creation now allows application roles `AUTHOR` and `EDITOR`, but still requires workspace permission `OWNER` or `EDIT`; VIEW members, learners, and non-members are rejected.

### Follow-up behavior

- Draft and published rows use server-provided favorite and lifecycle capability state.
- Overlapping published/search requests use a generation guard, including clearing an in-flight search.
- The workspace picker manages initial focus, Tab wrapping, Escape/backdrop close, trigger focus restoration, and a locked pending state.
- Workspace loading distinguishes a real failure from a successfully loaded empty set and exposes retry.
- Editor and lesson routes preserve a validated internal `returnTo`; external or scheme-based values fall back to `/library`.
- Subguide activation uses a synchronous in-flight ref, preventing duplicate requests before React state commits.
- Workspace `?create=1` is consumed with replacement before the request and remains exactly-once under StrictMode effect replay.

### Changed files

```text
apps/api/src/modules/guides/permissions.test.ts
apps/api/src/modules/guides/repository.ts
apps/api/src/modules/guides/service.ts
apps/api/src/modules/personal/repository.ts
apps/api/src/modules/search/repository.ts
apps/api/src/modules/search/search.test.ts
apps/api/src/modules/workspaces/repository.ts
apps/web/src/App.test.tsx
apps/web/src/App.tsx
apps/web/src/features/editor/GuideEditor.test.tsx
apps/web/src/features/lesson/LessonPage.test.tsx
apps/web/src/features/lesson/LessonPage.tsx
apps/web/src/features/library/LibraryPage.test.tsx
apps/web/src/features/library/LibraryPage.tsx
apps/web/src/features/personal/PersonalResourcePage.test.tsx
apps/web/src/features/resources/ResourceTable.tsx
packages/contracts/src/workspace.ts
```

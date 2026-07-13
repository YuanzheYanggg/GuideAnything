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

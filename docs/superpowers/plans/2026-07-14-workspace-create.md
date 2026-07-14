# 新建工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an author-only workspace creation flow to the existing workspace directory.

**Architecture:** Extend the existing web `WorkspaceApi` with a typed create method, render a focused modal form from `WorkspaceDirectoryPage`, and expose a workspace refresh callback from `WorkspaceShell`. Reuse the existing authenticated `ApiClient` and server-side `POST /api/workspaces` validation and authorization.

**Tech Stack:** React, React Router, TypeScript, Vitest, Testing Library, Fastify, pnpm.

## Global Constraints

- Only `AUTHOR` users can create workspaces.
- Required backend fields remain `name`, `slug`, `description`, `iconKey`, and `colorKey`.
- Existing guide creation and workspace read/member permissions remain unchanged.

### Task 1: Add the typed frontend creation contract

**Files:**
- Modify: `apps/web/src/features/workspace/types.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/features/workspace/WorkspacePages.test.tsx`

- [ ] Write a failing UI test that submits the creation form and expects `workspaceApi.create` to receive the form payload.
- [ ] Run `pnpm --filter @guideanything/web test -- WorkspacePages.test.tsx` and confirm the new test fails because the button/API method is missing.
- [ ] Add `CreateWorkspaceInput`, `WorkspaceApi.create`, and the authenticated `POST /api/workspaces` client call.
- [ ] Run the focused test and confirm the contract portion passes.

### Task 2: Implement the author-only creation modal

**Files:**
- Create: `apps/web/src/features/workspace/WorkspaceCreateDialog.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceDirectoryPage.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceShell.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/workspace/WorkspacePages.test.tsx`

- [ ] Add failing tests for author visibility, non-author hiding, successful navigation, and server-error display.
- [ ] Run the focused tests and confirm they fail for the missing UI behavior.
- [ ] Implement the modal form, submit state, error state, refresh callback, and navigation with the smallest existing-style changes.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Verify the full change

- [ ] Run `pnpm --filter @guideanything/web test`.
- [ ] Run `pnpm --filter @guideanything/api test -- src/modules/workspaces/workspaces.test.ts`.
- [ ] Run `pnpm typecheck` and `pnpm build`.
- [ ] Inspect `git diff --check` and the final diff, preserving unrelated `.pnpm-store/` changes.

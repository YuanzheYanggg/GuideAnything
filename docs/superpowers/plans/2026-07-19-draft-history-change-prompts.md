# 草稿历史变更提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在草稿历史和恢复确认框中展示相邻版本之间的自动变更摘要，帮助用户选择正确的 revision。

**Architecture:** 服务端读取已有 `guide_draft_revisions` 快照，按 revision 倒序将每条快照与更旧快照比较，生成短的 `changeSummary` 字符串。API 契约将该字段传给 Web，`DraftHistoryDialog` 在历史卡片和确认框中展示它；完整文档仍只留在服务端。

**Tech Stack:** TypeScript, Fastify, SQLite, Zod, React, Testing Library, Vitest。

## Global Constraints

- 不新增数据库字段或迁移；复用 `draft_document_json`。
- 不把历史 `nodes`、`edges` 或完整文档放进列表响应。
- 历史文档解析失败时不能阻断历史列表，使用明确的降级提示。
- 保留现有恢复逻辑和 revision 冲突保护。
- 测试必须先失败，再写生产代码。

---

### Task 1: Extend the draft-history contract

**Files:**
- Modify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/packages/contracts/src/api.ts:35-50`
- Test: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/api/src/modules/guides/guides.test.ts:220-275`

**Interfaces:**
- Produces `GuideDraftHistorySnapshot.changeSummary: string` for the API and Web layers.

- [ ] **Step 1: Write the failing assertion**

Extend the existing draft-history response assertion to require a non-empty summary for the latest revision, for example:

```ts
expect(history.json().items[0]).toEqual(expect.objectContaining({
  revision: 2,
  changeSummary: expect.stringContaining('更新了指南摘要'),
}));
```

- [ ] **Step 2: Run the focused API test to verify it fails**

Run:

```bash
pnpm --filter @guideanything/api test -- guides.test.ts
```

Expected: FAIL because the history response has no `changeSummary` yet.

- [ ] **Step 3: Add the contract field**

Add `changeSummary: z.string().min(1).max(500)` to `GuideDraftHistorySnapshotSchema` and keep the schema strict.

- [ ] **Step 4: Run the focused contract/API tests**

Run the same command and expect the test to continue failing only until Task 2 supplies the field; do not claim this task green independently until the repository mapper is updated.

### Task 2: Generate change summaries from adjacent snapshots

**Files:**
- Create: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/api/src/modules/guides/draft-history.ts`
- Modify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/api/src/modules/guides/repository.ts:283-315,496-505`
- Test: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/api/src/modules/guides/guides.test.ts:220-275`

**Interfaces:**
- `describeDraftChange(current: DraftRevisionState, previous?: DraftRevisionState): string`
- `listDraftHistory()` returns every item with `changeSummary` and continues returning metadata only.

- [ ] **Step 1: Add focused failing API expectations**

Use the existing two saved documents to assert that the latest history item includes metadata and document-level change text, while the oldest item is marked as an initial draft:

```ts
expect(history.json().items).toEqual([
  expect.objectContaining({
    revision: 2,
    changeSummary: expect.stringContaining('更新了指南摘要'),
  }),
  expect.objectContaining({ revision: 1, changeSummary: '初始草稿' }),
]);
```

Also retain:

```ts
expect(history.body).not.toContain('"nodes"');
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```bash
pnpm --filter @guideanything/api test -- guides.test.ts
```

Expected: FAIL with missing or undefined `changeSummary`.

- [ ] **Step 3: Implement the pure comparison helper**

Define a `DraftRevisionState` containing title, summary, tags, and parsed `CanvasDocument`. Compare metadata directly and compare nodes, edges, and steps by id. Generate short Chinese fragments such as `更新了指南摘要`, `新增节点：确认原料`, `删除 1 条连线`, and join them with ` · `. Return `初始草稿` when there is no previous snapshot and `暂无可比较的变更说明` when the document cannot be parsed.

- [ ] **Step 4: Map adjacent rows without exposing documents**

Parse each `draft_document_json` defensively inside `listDraftHistory()`, compare row `index` to row `index + 1`, and pass the result into `mapDraftHistory()`. The response object must contain only the existing metadata plus `changeSummary`.

- [ ] **Step 5: Run the focused API tests**

Run:

```bash
pnpm --filter @guideanything/api test -- guides.test.ts
```

Expected: PASS, including the metadata-only response check and the new change-summary assertions.

### Task 3: Display summaries in the history dialog

**Files:**
- Modify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/DraftHistoryDialog.tsx:48-80`
- Modify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/styles.css:317`
- Test: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/DraftHistoryDialog.test.tsx:8-42`

**Interfaces:**
- Consumes `GuideDraftHistorySnapshot.changeSummary`.
- Renders the same summary in each revision card and in the restore confirmation dialog.

- [ ] **Step 1: Write the failing Web assertions**

Add `changeSummary` to the fixture and assert both locations:

```ts
expect(screen.getByText('更新了 1 个节点 · 新增 1 条连线')).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: '恢复 revision 6' }));
expect(screen.getByRole('dialog', { name: '确认恢复草稿' })).toHaveTextContent('更新了 1 个节点 · 新增 1 条连线');
```

- [ ] **Step 2: Run the focused Web test to verify it fails**

Run:

```bash
pnpm --filter @guideanything/web test -- DraftHistoryDialog.test.tsx
```

Expected: FAIL because the dialog does not render `changeSummary` yet.

- [ ] **Step 3: Render the summary and add restrained styling**

Replace the card’s `summary || '无摘要'` line with the explicit `changeSummary` display, add a small label such as `本版变更`, and include the same text in the confirmation dialog. Add wrapping/secondary text styles so long summaries remain readable within the modal.

- [ ] **Step 4: Run the focused Web test**

Run the same command and expect PASS.

### Task 4: Full validation and handoff

**Files:**
- Verify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/api/src/modules/guides/draft-history.ts`
- Verify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/apps/web/src/features/editor/DraftHistoryDialog.tsx`
- Verify: `/Users/yangyuanzhe/private/CodeHub/Projects/GuideAnything/packages/contracts/src/api.ts`

- [ ] **Step 1: Run the API test suite**

```bash
pnpm --filter @guideanything/api test
```

Expected: all API tests pass.

- [ ] **Step 2: Run the Web test suite and typecheck**

```bash
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/web typecheck
```

Expected: all Web tests pass and TypeScript exits with code 0.

- [ ] **Step 3: Run lint, build, and diff checks**

```bash
pnpm lint
pnpm --filter @guideanything/web build
git diff --check
```

Expected: lint, production build, and whitespace checks all exit with code 0.

- [ ] **Step 4: Inspect the final diff**

Confirm no database migration, full-document history payload, unrelated worktree edit, debug output, or change to restore semantics was introduced.

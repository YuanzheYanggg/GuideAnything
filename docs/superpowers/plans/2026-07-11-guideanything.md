# GuideAnything Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable, test-backed GuideAnything vertical product slice covering authoring, multimodal canvas persistence, publishing, search, subguide expansion/collapse, and learner playback.

**Architecture:** A pnpm TypeScript monorepo separates a React/Vite web client from a Fastify API. Shared Zod contracts guard persisted JSON and HTTP DTOs; canvas-core contains dependency-free transformations; SQLite stores mutable guide drafts and immutable published snapshots.

**Tech Stack:** Node.js 24+, pnpm 10+, TypeScript, React, Vite, @xyflow/react, Zustand, Fastify, node:sqlite, Zod, Vitest, Testing Library, Playwright.

## Global Constraints

- All product copy and primary documentation are Chinese; code identifiers and API paths remain English.
- Internal publishing only; no external deployment, paid resources, or outbound messages.
- Subguide references pin an immutable `guideVersionId`; upstream publishing never mutates downstream references.
- API authorization is mandatory for all draft reads and writes; learner reads only published versions.
- Markdown is sanitized; image uploads are JPEG/PNG/WebP/GIF up to 10 MiB; video uploads are MP4/WebM up to 200 MiB.
- Every persistence write validates `CanvasDocument` and uses guide `revision` optimistic locking.

---

### Task 1: Workspace, contracts, and canvas transformations

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `packages/contracts/src/canvas.ts`, `packages/contracts/src/api.ts`, `packages/contracts/src/index.ts`
- Create: `packages/canvas-core/src/history.ts`, `packages/canvas-core/src/clipboard.ts`, `packages/canvas-core/src/subguide.ts`
- Test: `packages/contracts/src/canvas.test.ts`, `packages/canvas-core/src/subguide.test.ts`, `packages/canvas-core/src/history.test.ts`

**Interfaces:**
- Produces: `CanvasDocumentSchema`, `GuideSummarySchema`, `expandSubguide(document, referenceNode, snapshot)`, `setSubguideExpanded(document, referenceNodeId, expanded)`, `HistoryStack<T>`.

- [x] **Step 1: Write contract and expansion tests**

```ts
expect(CanvasDocumentSchema.safeParse(validDocument).success).toBe(true);
expect(expandSubguide(host, reference, snapshot).nodes.map(n => n.id))
  .toContain('ref:ref-1:source-start');
expect(expandSubguide(expanded, reference, snapshot)).toEqual(expanded);
expect(setSubguideExpanded(expanded, 'ref-1', false).nodes.find(isDerived)?.hidden).toBe(true);
```

- [x] **Step 2: Run the tests and verify module-not-found failures**

Run: `pnpm --filter @guideanything/canvas-core test`
Expected: FAIL because the source modules do not exist.

- [x] **Step 3: Implement discriminated node schemas and pure transformations**

Use deterministic derived IDs `ref:${referenceNode.id}:${sourceId}` and rewrite edge endpoints, lesson node IDs, keypoint targets, and `SourceTrace`. Expansion must return the original document when derived elements already exist.

- [x] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all Task 1 tests PASS and TypeScript exits 0.

### Task 2: SQLite schema, authentication, and authorization

**Files:**
- Create: `apps/api/src/db/migrations/0001_init.sql`, `apps/api/src/db/client.ts`, `apps/api/src/db/migrate.ts`, `apps/api/src/db/repositories.ts`
- Create: `apps/api/src/modules/auth/service.ts`, `apps/api/src/modules/auth/routes.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Test: `apps/api/src/modules/auth/auth.test.ts`, `apps/api/src/db/migrate.test.ts`

**Interfaces:**
- Produces: `buildApp(options)`, `authenticate(email,password)`, `requireRole(...roles)`, `canEditGuide(userId, guideId)`.
- Consumes: shared login/request/response schemas.

- [x] **Step 1: Write injection tests for migration, login, and protected routes**

```ts
const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'author@guide.local', password: 'Guide123!' } });
expect(response.statusCode).toBe(200);
expect(response.json().user.role).toBe('AUTHOR');
expect((await app.inject({ method: 'GET', url: '/api/guides' })).statusCode).toBe(401);
```

- [x] **Step 2: Verify the tests fail before implementation**

Run: `pnpm --filter @guideanything/api test -- auth.test.ts migrate.test.ts`
Expected: FAIL due to missing `buildApp` and migration.

- [x] **Step 3: Implement migrations, password hashing, JWT, and auth hooks**

Use `crypto.scrypt` with a per-user random salt and `timingSafeEqual`; seed hashes during `db:seed`. JWT payload contains `sub`, `email`, and `role`; repository lookups, not payload role alone, authorize writes.

- [x] **Step 4: Run auth tests**

Run: `pnpm --filter @guideanything/api test -- auth.test.ts migrate.test.ts`
Expected: PASS.

### Task 3: Guide drafts, publication, search, and pinned references

**Files:**
- Create: `apps/api/src/modules/guides/repository.ts`, `apps/api/src/modules/guides/service.ts`, `apps/api/src/modules/guides/routes.ts`
- Create: `apps/api/src/modules/search/routes.ts`, `apps/api/src/modules/search/repository.ts`
- Create: `apps/api/src/db/seed.ts`
- Test: `apps/api/src/modules/guides/guides.test.ts`, `apps/api/src/modules/guides/permissions.test.ts`, `apps/api/src/modules/search/search.test.ts`

**Interfaces:**
- Produces: `POST/GET/PATCH /api/guides`, `POST /api/guides/:id/publish`, `GET /api/versions/:id`, `GET /api/search?q=`, `POST /api/guides/:id/collaborators`.

- [x] **Step 1: Write the full API slice as failing Fastify injection tests**

```ts
const draft = await createGuide(authorToken, { title: 'ERP 销售订单创建' });
await saveGuide(authorToken, draft.id, { revision: 0, document });
const published = await publishGuide(authorToken, draft.id);
expect(published.version).toBe(1);
expect((await search(learnerToken, '销售订单')).items[0].guideId).toBe(draft.id);
expect((await saveGuide(learnerToken, draft.id, { revision: 1, document })).statusCode).toBe(403);
```

- [x] **Step 2: Run and verify route-not-found failures**

Run: `pnpm --filter @guideanything/api test -- guides.test.ts permissions.test.ts search.test.ts`
Expected: FAIL with status 404 or missing repository exports.

- [x] **Step 3: Implement repository transactions and route schemas**

Publication transaction validates the document, inserts the next immutable version, updates `published_version_id`, replaces FTS rows, and commits. Draft save executes `UPDATE ... WHERE id=? AND revision=?`; zero updated rows maps to HTTP 409.

- [x] **Step 4: Seed realistic ERP guides and three demo users**

Seed a published “物料主数据检查” subguide and a draft/published “ERP 销售订单创建” guide containing markdown, image metadata, video keypoints, a decision branch, lesson steps, and a pinned subguide node.

- [x] **Step 5: Run API tests and inspect seeded SQLite state**

Run: `pnpm --filter @guideanything/api test && pnpm db:reset && pnpm db:seed`
Expected: tests PASS; seed reports 3 users and 2 published guide versions.

### Task 4: Media upload safety

**Files:**
- Create: `apps/api/src/modules/media/routes.ts`, `apps/api/src/modules/media/service.ts`
- Test: `apps/api/src/modules/media/media.test.ts`

**Interfaces:**
- Produces: `POST /api/media`, `GET /api/media/:id`; consumes authenticated user and multipart stream.

- [x] **Step 1: Write failing upload tests for allowed image, bad MIME, oversize, and unauthenticated access**

Use Fastify injection multipart payloads; assert 201, 415, 413, and 401 respectively.

- [x] **Step 2: Implement stream limits, magic-byte checks, UUID filenames, and owner metadata**

Never use the client filename as a storage path. Serve `nosniff`, explicit content type, private cache headers, and content disposition inline.

- [x] **Step 3: Run media tests**

Run: `pnpm --filter @guideanything/api test -- media.test.ts`
Expected: PASS and temporary uploads are removed after each test.

### Task 5: Web shell, login, library, and API client

**Files:**
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/features/auth/*`, `apps/web/src/features/library/*`
- Test: `apps/web/src/features/auth/LoginPage.test.tsx`, `apps/web/src/features/library/LibraryPage.test.tsx`

**Interfaces:**
- Produces: authenticated routes `/library`, `/guides/:id/edit`, `/learn/:versionId`; `api.request<T>()`; token/session store.

- [x] **Step 1: Write failing component tests for login errors, search loading/empty/results, and role-aware actions**

```tsx
expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
await user.type(screen.getByRole('searchbox'), '销售订单');
expect(await screen.findByText('ERP 销售订单创建')).toBeVisible();
expect(screen.queryByRole('button', { name: '编辑指南' })).toBeNull(); // learner
```

- [x] **Step 2: Implement the shell and query states with accessible labels**

Keep auth in memory plus localStorage token, validate `/api/auth/me` on reload, and clear invalid sessions. Search debounce is 250 ms and aborts the previous request.

- [x] **Step 3: Run web tests and production build**

Run: `pnpm --filter @guideanything/web test && pnpm --filter @guideanything/web build`
Expected: PASS and Vite build exits 0.

### Task 6: Infinite canvas and multimodal editing

**Files:**
- Create: `apps/web/src/features/editor/GuideEditor.tsx`, `EditorToolbar.tsx`, `Inspector.tsx`, `useGuideDocument.ts`, `useKeyboardShortcuts.ts`
- Create: `apps/web/src/features/nodes/FlowNode.tsx`, `MarkdownNode.tsx`, `ImageNode.tsx`, `VideoNode.tsx`, `SubguideNode.tsx`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`, `apps/web/src/features/nodes/VideoNode.test.tsx`, `MarkdownNode.test.tsx`

**Interfaces:**
- Consumes: `CanvasDocument`, history/clipboard/subguide functions, guide save/media/search APIs.
- Produces: controlled React Flow editor with save/publish/insert/expand/collapse actions.

- [x] **Step 1: Write failing tests for add/connect/edit, undo/redo, paste ID rewriting, sanitization, keypoint seek, save/restore, and subguide toggling**

```tsx
expect(container.querySelector('script')).toBeNull();
await user.click(screen.getByRole('button', { name: '跳转到 00:15' }));
expect(video.currentTime).toBe(15);
expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.any(Array) }));
```

- [x] **Step 2: Implement the controlled canvas and stable memoized node types**

Enable `Background`, `MiniMap`, `Controls`, `snapToGrid`, `selectionMode=Partial`, multi-select, delete keys, pan/zoom, fit view, ports, resize controls, z-index actions, alignment actions, and aria labels.

- [x] **Step 3: Implement inspectors, uploads, Markdown preview, video keypoints, save state, and reference expansion**

Use `react-markdown`, `remark-gfm`, and `rehype-sanitize`; image uses `loading="lazy"`; video uses `preload="metadata"`. Persist viewport from `onMoveEnd` and debounce draft saves while retaining explicit Save.

- [x] **Step 4: Run editor tests and build**

Run: `pnpm --filter @guideanything/web test && pnpm --filter @guideanything/web build`
Expected: PASS.

### Task 7: Learner step playback and browser acceptance

**Files:**
- Create: `apps/web/src/features/lesson/LessonPage.tsx`, `StepNavigator.tsx`
- Create: `e2e/guide-journey.spec.ts`, `playwright.config.ts`
- Test: `apps/web/src/features/lesson/LessonPage.test.tsx`, `e2e/guide-journey.spec.ts`

**Interfaces:**
- Consumes: published version API and canvas focus/video keypoint bridge.

- [x] **Step 1: Write learner tests for ordered steps, next/previous, node focus, and keypoint seek**

- [x] **Step 2: Implement responsive read-only lesson mode**

Desktop shows canvas plus step rail; narrow screens show the current content first with an optional canvas drawer. `aria-live` announces the current step.

- [x] **Step 3: Write and run the real browser journey**

The Playwright test logs in as author, creates a guide, adds Markdown/image/video-keypoint/decision nodes, saves, publishes, searches, inserts into a host guide, expands, collapses, then logs in as learner and navigates steps.

Run: `pnpm e2e`
Expected: the critical path passes against actual API, Web, and SQLite processes; trace/screenshots are retained only on failure.

### Task 8: Performance, documentation, and completion verification

**Files:**
- Create: `packages/canvas-core/src/performance.test.ts`
- Create: `README.md`
- Modify: `docs/ACCEPTANCE.md`, `docs/PROGRESS.md`

**Interfaces:**
- Produces: reproducible local runbook and final evidence record.

- [x] **Step 1: Add and run a 1000-node expansion/collapse test**

Assert deterministic output, no duplicate IDs, and completion under 500 ms on the local test runner.

- [x] **Step 2: Write Chinese setup and operator documentation**

Document prerequisites, environment, install, migrate/seed, dev/start, demo accounts, tests, API boundaries, database inspection, upload storage, keyboard shortcuts, and pinned-reference behavior.

- [x] **Step 3: Run the complete verification matrix**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`
Expected: every command exits 0.

- [x] **Step 4: Update acceptance evidence and progress**

Mark only observed checks complete and record commands, result counts, local URLs, and browser journey evidence in `docs/PROGRESS.md`.

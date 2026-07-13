# Knowledge Workspace V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a persistent knowledge workspace around the existing guide product, with real workspaces, favorites, recent views, explicit shares, trash/restore, and reserved Source, Agent, Ontology, Conversation, and Artifact module boundaries.

**Architecture:** Keep guides as their own domain model and add a workspace_items registry for cross-module identity and lifecycle. Add focused Fastify modules for workspaces and personal views, then replace the static library navigation with URL-backed React Router pages and reusable resource lists. Intelligent modules expose contracts and honest empty states only.

**Tech Stack:** TypeScript 5.9, React 19, React Router 7, Fastify, Node 24 SQLite, Zod, Vitest, Testing Library, Playwright CLI.

## Global Constraints

- Preserve every existing user, guide ID, guide version, CanvasDocument, media asset, and pinned subguide reference.
- V1 implements GUIDE resources only; SOURCE, AGENT, ONTOLOGY, CONVERSATION, and ARTIFACT remain unconfigured module types.
- Browser code must never start a shell or invoke Codex CLI.
- Favorites and recent views are private per user.
- Explicit guide collaborators appear in 与我共享; ordinary workspace membership does not.
- Published guide versions remain readable after a guide is trashed or permanently removed from the workspace.
- API authorization is authoritative; hidden UI controls are not permission checks.
- Existing dark/light glass styling and mobile behavior must remain functional.
- Every production change follows red-green-refactor and ends in an independently reviewable commit.

---

## Planned File Structure

### Shared contracts

- Create packages/contracts/src/workspace.ts: workspace, resource, personal-view, and activity contracts.
- Create packages/contracts/src/adapters.ts and adapters.test.ts: future Source, Agent Runtime, and Ontology boundary contracts.
- Modify packages/contracts/src/api.ts: extend guide summaries with workspace identity.
- Modify packages/contracts/src/index.ts: export workspace contracts.

### Database and backend

- Create apps/api/src/db/migrations/0002_workspace_v1.sql: workspace and personal-state tables.
- Modify apps/api/src/db/migrate.ts: register migration version 2.
- Modify apps/api/src/db/migrate.test.ts: schema and upgrade assertions.
- Create apps/api/src/modules/workspaces/repository.ts: workspace reads, writes, membership, registry, and activity SQL.
- Create apps/api/src/modules/workspaces/service.ts: workspace authorization and DTO composition.
- Create apps/api/src/modules/workspaces/routes.ts: workspace REST endpoints.
- Create apps/api/src/modules/workspaces/workspaces.test.ts: workspace API integration coverage.
- Create apps/api/src/modules/personal/repository.ts: favorites, recents, shares, trash SQL.
- Create apps/api/src/modules/personal/service.ts: access checks and lifecycle rules.
- Create apps/api/src/modules/personal/routes.ts: personal-view and trash REST endpoints.
- Create apps/api/src/modules/personal/personal.test.ts: personal-state API integration coverage.
- Modify apps/api/src/modules/guides/repository.ts: workspace-linked guide writes, registry sync, archive semantics.
- Modify apps/api/src/modules/guides/service.ts: workspace permission checks and activity writes.
- Modify apps/api/src/modules/guides/routes.ts: workspaceId and list-scope query parsing.
- Modify apps/api/src/modules/guides/guides.test.ts and permissions.test.ts: workspace-aware guide behavior.
- Modify apps/api/src/modules/search/repository.ts and search.test.ts: exclude trashed resources and return workspace metadata.
- Modify apps/api/src/db/seed.ts and seed.test.ts: deterministic default workspaces, memberships, and guide backfill.
- Modify apps/api/src/test/test-app.ts: reusable workspace fixtures.
- Modify apps/api/src/app.ts: register new route modules and allow PUT.

### Frontend

- Create apps/web/src/features/workspace/types.ts: frontend aliases and view identifiers.
- Create apps/web/src/test/workspace-api-mocks.ts: authenticated workspace client spies for route tests.
- Create apps/web/src/features/workspace/WorkspaceShell.tsx: top bar, route-aware sidebar, account menu, and appearance controls.
- Create apps/web/src/features/workspace/WorkspaceDirectoryPage.tsx: all-workspaces directory.
- Create apps/web/src/features/workspace/WorkspaceOverviewPage.tsx: overview, counts, activity, and favorites.
- Create apps/web/src/features/workspace/ReservedModulePage.tsx: honest unconfigured module states.
- Create apps/web/src/features/workspace/WorkspacePages.test.tsx: workspace UI behavior.
- Create apps/web/src/features/resources/ResourceTable.tsx: generic resource rows and actions.
- Create apps/web/src/features/personal/PersonalResourcePage.tsx: favorites, recents, shares, and trash views.
- Create apps/web/src/features/personal/PersonalResourcePage.test.tsx: personal-page behavior.
- Modify apps/web/src/features/library/LibraryPage.tsx: workspace-filtered library content without shell ownership.
- Modify apps/web/src/features/library/LibraryPage.test.tsx: workspace, favorite, and trash behavior.
- Modify apps/web/src/App.tsx: URL routes and guide/editor/lesson navigation.
- Create apps/web/src/App.test.tsx: route restoration and navigation.
- Modify apps/web/src/lib/api.ts: workspace and personal REST clients.
- Modify apps/web/src/features/editor/GuideEditor.tsx: record recent view after successful load.
- Modify apps/web/src/features/lesson/LessonPage.tsx: record recent view for the parent guide version.
- Modify apps/web/src/styles.css: workspace pages, resource rows, reserved modules, and responsive states.

---

### Task 1: Shared Contracts and Migration

**Files:**
- Create: packages/contracts/src/workspace.ts
- Modify: packages/contracts/src/api.ts
- Modify: packages/contracts/src/index.ts
- Create: apps/api/src/db/migrations/0002_workspace_v1.sql
- Modify: apps/api/src/db/migrate.ts
- Modify: apps/api/src/db/migrate.test.ts

**Interfaces:**
- Produces WorkspaceSummary, WorkspaceItemSummary, WorkspaceActivity, WorkspacePermission, and WorkspaceItemKind.
- Produces SQLite tables workspaces, workspace_members, workspace_items, user_favorites, recent_views, workspace_activity.

- [ ] **Step 1: Write the failing migration and contract tests**

Add assertions to apps/api/src/db/migrate.test.ts:

~~~ts
it('creates workspace v1 tables and constraints', () => {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all() as Array<{ name: string }>;
  expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
    'workspaces',
    'workspace_members',
    'workspace_items',
    'user_favorites',
    'recent_views',
    'workspace_activity',
  ]));
  const versions = database.prepare(
    'SELECT version FROM schema_migrations ORDER BY version',
  ).all() as Array<{ version: number }>;
  expect(versions.map((row) => row.version)).toEqual([1, 2]);
});
~~~

Add packages/contracts/src/workspace.test.ts:

~~~ts
it('validates a generic guide workspace item', () => {
  expect(WorkspaceItemSummarySchema.parse({
    id: 'item-1',
    workspaceId: 'workspace-materials',
    workspaceName: '物料管理',
    kind: 'GUIDE',
    entityId: 'guide-1',
    title: '物料主数据检查',
    summary: '检查销售视图',
    updatedAt: '2026-07-13T00:00:00.000Z',
    favorite: true,
    permission: 'EDIT',
  }).kind).toBe('GUIDE');
});
~~~

- [ ] **Step 2: Run tests and verify the red state**

Run:

~~~bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/api test -- migrate.test.ts
~~~

Expected: FAIL because workspace.ts and migration version 2 do not exist.

- [ ] **Step 3: Implement complete shared schemas**

Create packages/contracts/src/workspace.ts:

~~~ts
import { z } from 'zod';

export const WorkspacePermissionSchema = z.enum(['OWNER', 'EDIT', 'VIEW']);
export const WorkspaceItemKindSchema = z.enum([
  'GUIDE',
  'SOURCE',
  'AGENT',
  'ONTOLOGY',
  'CONVERSATION',
  'ARTIFACT',
]);

export const WorkspaceSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(2_000),
  iconKey: z.string().min(1).max(50),
  colorKey: z.string().min(1).max(50),
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  permission: WorkspacePermissionSchema,
  guideCount: z.number().int().min(0),
  updatedAt: z.string().datetime(),
});

export const WorkspaceItemSummarySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  kind: WorkspaceItemKindSchema,
  entityId: z.string().min(1),
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000),
  updatedAt: z.string().datetime(),
  favorite: z.boolean(),
  permission: WorkspacePermissionSchema,
  deletedAt: z.string().datetime().nullable().optional(),
  deletedByName: z.string().nullable().optional(),
  authorName: z.string().nullable().optional(),
  publishedVersionId: z.string().nullable().optional(),
  lastViewedAt: z.string().datetime().nullable().optional(),
  viewCount: z.number().int().min(0).optional(),
});

export const WorkspaceActivitySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
  action: z.enum([
    'GUIDE_CREATED',
    'GUIDE_UPDATED',
    'GUIDE_PUBLISHED',
    'COLLABORATOR_ADDED',
    'ITEM_TRASHED',
    'ITEM_RESTORED',
  ]),
  itemId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type WorkspacePermission = z.infer<typeof WorkspacePermissionSchema>;
export type WorkspaceItemKind = z.infer<typeof WorkspaceItemKindSchema>;
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type WorkspaceItemSummary = z.infer<typeof WorkspaceItemSummarySchema>;
export type WorkspaceActivity = z.infer<typeof WorkspaceActivitySchema>;
~~~

Export the file from packages/contracts/src/index.ts and extend GuideSummarySchema with workspaceId and workspaceItemId.

- [ ] **Step 4: Implement migration version 2**

Create apps/api/src/db/migrations/0002_workspace_v1.sql with strict tables, foreign keys, checks, indexes, and cascade behavior:

~~~sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_key TEXT NOT NULL,
  color_key TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('OWNER', 'EDIT', 'VIEW')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE workspace_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('GUIDE','SOURCE','AGENT','ONTOLOGY','CONVERSATION','ARTIFACT')),
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, entity_id)
) STRICT;

CREATE INDEX workspace_items_workspace_idx
  ON workspace_items(workspace_id, deleted_at, updated_at DESC);

CREATE TABLE user_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE recent_views (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES workspace_items(id) ON DELETE CASCADE,
  last_viewed_at TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 1 CHECK (view_count > 0),
  context_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, item_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE workspace_activity (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN (
    'GUIDE_CREATED','GUIDE_UPDATED','GUIDE_PUBLISHED',
    'COLLABORATOR_ADDED','ITEM_TRASHED','ITEM_RESTORED'
  )),
  item_id TEXT REFERENCES workspace_items(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
) STRICT;
~~~

Register migration version 2 in migrate.ts using readFileSync.

- [ ] **Step 5: Run migration and contract tests**

Run:

~~~bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/api test -- migrate.test.ts
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/api typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add packages/contracts/src apps/api/src/db
git commit -m "feat: add workspace v1 schema"
~~~

---

### Task 2: Workspace Repository, Service, Routes, and Seed Backfill

**Files:**
- Create: apps/api/src/modules/workspaces/repository.ts
- Create: apps/api/src/modules/workspaces/service.ts
- Create: apps/api/src/modules/workspaces/routes.ts
- Create: apps/api/src/modules/workspaces/workspaces.test.ts
- Modify: apps/api/src/app.ts
- Modify: apps/api/src/db/seed.ts
- Modify: apps/api/src/db/seed.test.ts
- Modify: apps/api/src/test/test-app.ts

**Interfaces:**
- Consumes WorkspaceSummary and WorkspaceItemSummary.
- Produces ensureDefaultWorkspaces, listWorkspacesForUser, getWorkspaceForUser, listWorkspaceItems, createWorkspace, updateWorkspace, addWorkspaceMember, removeWorkspaceMember, recordActivity.

- [ ] **Step 1: Write failing workspace API tests**

Create workspaces.test.ts covering listing, detail, permissions, and default data:

~~~ts
it('lists only accessible workspaces with guide counts', async () => {
  const context = await createTestContext();
  const workspace = seedTestWorkspace(context.database, context.userIds.author, {
    id: 'workspace-materials',
    slug: 'materials',
    name: '物料管理',
  });
  addTestWorkspaceMember(context.database, workspace.id, context.userIds.learner, 'VIEW');
  const response = await context.app.inject({
    method: 'GET',
    url: '/api/workspaces',
    headers: authorization(context.tokens.learner),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().items).toEqual([
    expect.objectContaining({ id: workspace.id, name: '物料管理', permission: 'VIEW' }),
  ]);
  await context.close();
});

it('returns 404 instead of leaking an inaccessible workspace', async () => {
  const context = await createTestContext();
  seedTestWorkspace(context.database, context.userIds.author, {
    id: 'workspace-private',
    slug: 'private',
    name: '私有空间',
  });
  const response = await context.app.inject({
    method: 'GET',
    url: '/api/workspaces/workspace-private',
    headers: authorization(context.tokens.learner),
  });
  expect(response.statusCode).toBe(404);
  await context.close();
});
~~~

- [ ] **Step 2: Run the workspace tests and verify failure**

Run:

~~~bash
pnpm --filter @guideanything/api test -- workspaces.test.ts
~~~

Expected: FAIL with route not found.

- [ ] **Step 3: Implement repository functions**

Create repository.ts with exact public API:

~~~ts
export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description: string;
  iconKey: string;
  colorKey: string;
}

export function createWorkspace(
  database: DatabaseSync,
  ownerId: string,
  input: CreateWorkspaceInput,
): WorkspaceSummary;

export function listWorkspacesForUser(
  database: DatabaseSync,
  userId: string,
): WorkspaceSummary[];

export function getWorkspaceForUser(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
): WorkspaceSummary | null;

export function getWorkspacePermission(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
): WorkspacePermission | null;

export function listWorkspaceItems(
  database: DatabaseSync,
  workspaceId: string,
  userId: string,
  kind?: WorkspaceItemKind,
): WorkspaceItemSummary[];

export function recordActivity(
  database: DatabaseSync,
  input: {
    workspaceId: string;
    actorId: string;
    action: WorkspaceActivity['action'];
    itemId?: string;
    metadata?: Record<string, unknown>;
  },
): void;
~~~

Use one membership-aware SQL join for summary reads. Filter workspace_items.deleted_at IS NULL in active lists.

- [ ] **Step 4: Implement service authorization and routes**

Create WorkspaceService with AUTHOR-only create, OWNER-only settings/member writes, and read access for OWNER, EDIT, or VIEW members. Register:

~~~ts
app.get('/api/workspaces', { preHandler: app.authenticateRequest }, handler);
app.post('/api/workspaces', { preHandler: app.authenticateRequest }, handler);
app.get('/api/workspaces/:id', { preHandler: app.authenticateRequest }, handler);
app.patch('/api/workspaces/:id', { preHandler: app.authenticateRequest }, handler);
app.get('/api/workspaces/:id/items', { preHandler: app.authenticateRequest }, handler);
app.get('/api/workspaces/:id/activity', { preHandler: app.authenticateRequest }, handler);
app.get('/api/workspaces/:id/members', { preHandler: app.authenticateRequest }, handler);
app.post('/api/workspaces/:id/members', { preHandler: app.authenticateRequest }, handler);
app.delete('/api/workspaces/:id/members/:userId', { preHandler: app.authenticateRequest }, handler);
~~~

Update app.ts to register the module and include PUT in CORS methods.

- [ ] **Step 5: Implement deterministic defaults and test fixtures**

In seed.ts define six stable IDs:

~~~ts
const DEFAULT_WORKSPACES = [
  ['workspace-finance', 'finance', '财务管理', 'ChartLineUp', 'finance'],
  ['workspace-materials', 'materials', '物料管理', 'FileText', 'materials'],
  ['workspace-sales', 'sales', '销售与分销', 'ChartLineUp', 'sales'],
  ['workspace-production', 'production', '生产计划', 'SquaresFour', 'production'],
  ['workspace-people', 'people', '人力资源', 'UsersThree', 'people'],
  ['workspace-general', 'general', '通用工作区', 'SquaresFour', 'general'],
] as const;
~~~

After seeding users, upsert workspaces, add the author as OWNER, editor as EDIT, learner as VIEW, and create one GUIDE workspace_item for every existing guide. Put the material guide in workspace-materials and the sales guide in workspace-sales.

Add seedTestWorkspace and addTestWorkspaceMember helpers to test-app.ts.

- [ ] **Step 6: Run workspace and seed tests**

Run:

~~~bash
pnpm --filter @guideanything/api test -- workspaces.test.ts seed.test.ts
pnpm --filter @guideanything/api typecheck
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add apps/api/src/modules/workspaces apps/api/src/app.ts apps/api/src/db/seed.ts apps/api/src/db/seed.test.ts apps/api/src/test/test-app.ts
git commit -m "feat: add persistent workspaces"
~~~

---

### Task 3: Workspace-Aware Guide Lifecycle and Search

**Files:**
- Modify: apps/api/src/modules/guides/repository.ts
- Modify: apps/api/src/modules/guides/service.ts
- Modify: apps/api/src/modules/guides/routes.ts
- Modify: apps/api/src/modules/guides/guides.test.ts
- Modify: apps/api/src/modules/guides/permissions.test.ts
- Modify: apps/api/src/modules/search/repository.ts
- Modify: apps/api/src/modules/search/search.test.ts
- Modify: apps/api/src/test/test-app.ts
- Modify: packages/contracts/src/api.ts

**Interfaces:**
- Consumes getWorkspacePermission and recordActivity.
- Produces guide DTO fields workspaceId and workspaceItemId.
- POST /api/guides requires workspaceId.
- GET /api/guides accepts workspaceId and scope.

- [ ] **Step 1: Write failing guide integration tests**

Add:

~~~ts
it('creates a guide and resource item in the selected editable workspace', async () => {
  const context = await createTestContext();
  const workspace = seedTestWorkspace(context.database, context.userIds.author, {
    id: 'workspace-sales',
    slug: 'sales',
    name: '销售与分销',
  });
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: authorization(context.tokens.author),
    payload: { workspaceId: workspace.id, title: '创建销售订单', summary: '', tags: ['销售'] },
  });
  expect(response.statusCode).toBe(201);
  expect(response.json().guide).toEqual(expect.objectContaining({
    workspaceId: workspace.id,
    workspaceItemId: expect.any(String),
  }));
  const registry = context.database.prepare(
    "SELECT kind, workspace_id FROM workspace_items WHERE entity_id = ?",
  ).get(response.json().guide.id);
  expect(registry).toEqual({ kind: 'GUIDE', workspace_id: workspace.id });
  await context.close();
});

~~~

- [ ] **Step 2: Run guide tests and verify failure**

Run:

~~~bash
pnpm --filter @guideanything/api test -- guides.test.ts permissions.test.ts search.test.ts
~~~

Expected: FAIL because workspaceId is not parsed and guide DTOs lack workspace metadata.

- [ ] **Step 3: Update guide repository transactions**

Change createGuide signature:

~~~ts
export function createGuide(
  database: DatabaseSync,
  ownerId: string,
  workspaceId: string,
  input: { title: string; summary: string; tags: string[] },
): GuideDraft;
~~~

Inside one BEGIN IMMEDIATE transaction:

1. Insert guides.
2. Insert workspace_items with kind GUIDE and entity_id equal to guide ID.
3. Insert GUIDE_CREATED activity.
4. Commit or roll back all three writes.

Extend GuideRow joins through workspace_items and workspaces. Update guide title and summary snapshots in the same transaction as updateGuide. Record GUIDE_UPDATED, GUIDE_PUBLISHED, and COLLABORATOR_ADDED activities from service operations.

- [ ] **Step 4: Update authorization and route parsing**

CreateGuideSchema:

~~~ts
const CreateGuideSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2_000).default(''),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});
~~~

GuideService.create requires global AUTHOR and workspace OWNER or EDIT. GuideService.list accepts:

~~~ts
type GuideListScope = 'owned' | 'editable' | 'shared';
list(userId: string, options: { workspaceId?: string; scope?: GuideListScope }): GuideDraft[];
~~~

shared returns explicit guide_collaborators only and excludes the owner.

- [ ] **Step 5: Make search workspace-aware**

Join workspace_items and workspaces in both search branches. Require workspace_items.deleted_at IS NULL and workspaces.status = ACTIVE. Return workspaceId, workspaceItemId, workspaceName, and favorite state for the current user. Update search route to pass request.authUser.id into repository.

- [ ] **Step 6: Run guide/search tests and typechecks**

Run:

~~~bash
pnpm --filter @guideanything/api test -- guides.test.ts permissions.test.ts search.test.ts
pnpm --filter @guideanything/api typecheck
pnpm --filter @guideanything/contracts typecheck
~~~

Expected: PASS.

- [ ] **Step 7: Add a reusable published-guide fixture**

Import expect from vitest in test-app.ts and add this helper after Task 3 routes are green:

~~~ts
export async function createWorkspaceGuideFixture() {
  const context = await createTestContext();
  const workspace = seedTestWorkspace(context.database, context.userIds.author, {
    id: 'workspace-fixture',
    slug: 'fixture',
    name: '测试工作区',
  });
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: authorization(context.tokens.author),
    payload: { workspaceId: workspace.id, title: '可检索测试指南', summary: '', tags: ['测试'] },
  });
  expect(created.statusCode).toBe(201);
  const guide = created.json().guide as { id: string; workspaceItemId: string };
  const saved = await context.app.inject({
    method: 'PATCH',
    url: `/api/guides/${guide.id}`,
    headers: authorization(context.tokens.author),
    payload: { revision: 0, document: sampleDocument('# 可检索测试指南\n用于回收站检索测试。') },
  });
  expect(saved.statusCode).toBe(200);
  const published = await context.app.inject({
    method: 'POST',
    url: `/api/guides/${guide.id}/publish`,
    headers: authorization(context.tokens.author),
  });
  expect(published.statusCode).toBe(201);
  return {
    ...context,
    workspaceId: workspace.id,
    workspaceItemId: guide.workspaceItemId,
    guideId: guide.id,
    versionId: published.json().version.id as string,
  };
}
~~~

- [ ] **Step 8: Commit**

~~~bash
git add apps/api/src/modules/guides apps/api/src/modules/search apps/api/src/test/test-app.ts packages/contracts/src/api.ts
git commit -m "feat: link guides to workspaces"
~~~

---

### Task 4: Favorites, Recent Views, Shares, Trash, and Restore

**Files:**
- Create: apps/api/src/modules/personal/repository.ts
- Create: apps/api/src/modules/personal/service.ts
- Create: apps/api/src/modules/personal/routes.ts
- Create: apps/api/src/modules/personal/personal.test.ts
- Modify: apps/api/src/app.ts
- Modify: apps/api/src/modules/search/search.test.ts

**Interfaces:**
- Produces listFavorites, setFavorite, removeFavorite, recordRecentView, listRecentViews, listSharedItems, listTrash, trashItem, restoreItem, permanentlyRemoveItem.
- Provides all /api/me and /api/workspace-items lifecycle endpoints.

- [ ] **Step 1: Write failing personal-state tests**

Create personal.test.ts:

~~~ts
it('persists favorites idempotently and keeps them private', async () => {
  const context = await createWorkspaceGuideFixture();
  const itemId = context.workspaceItemId;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await context.app.inject({
      method: 'PUT',
      url: '/api/me/favorites/' + itemId,
      headers: authorization(context.tokens.author),
    });
    expect(response.statusCode).toBe(200);
  }
  const author = await context.app.inject({
    method: 'GET',
    url: '/api/me/favorites',
    headers: authorization(context.tokens.author),
  });
  const learner = await context.app.inject({
    method: 'GET',
    url: '/api/me/favorites',
    headers: authorization(context.tokens.learner),
  });
  expect(author.json().items).toHaveLength(1);
  expect(learner.json().items).toHaveLength(0);
});

it('upserts recent views and sorts by last viewed time', async () => {
  const context = await createWorkspaceGuideFixture();
  await context.app.inject({
    method: 'PUT',
    url: '/api/me/recent/' + context.workspaceItemId,
    headers: authorization(context.tokens.author),
    payload: { context: { mode: 'lesson', versionId: context.versionId } },
  });
  await context.app.inject({
    method: 'PUT',
    url: '/api/me/recent/' + context.workspaceItemId,
    headers: authorization(context.tokens.author),
    payload: { context: { mode: 'lesson', versionId: context.versionId } },
  });
  const row = context.database.prepare(
    'SELECT view_count FROM recent_views WHERE user_id = ? AND item_id = ?',
  ).get(context.userIds.author, context.workspaceItemId);
  expect(row).toEqual({ view_count: 2 });
});

it('trashes and restores an owned guide without deleting published versions', async () => {
  const context = await createWorkspaceGuideFixture();
  const trashed = await context.app.inject({
    method: 'POST',
    url: '/api/workspace-items/' + context.workspaceItemId + '/trash',
    headers: authorization(context.tokens.author),
  });
  expect(trashed.statusCode).toBe(200);
  expect(context.database.prepare(
    'SELECT COUNT(*) AS count FROM guide_versions WHERE guide_id = ?',
  ).get(context.guideId)).toEqual({ count: 1 });
  const restored = await context.app.inject({
    method: 'POST',
    url: '/api/workspace-items/' + context.workspaceItemId + '/restore',
    headers: authorization(context.tokens.author),
  });
  expect(restored.statusCode).toBe(200);
});
~~~

- [ ] **Step 2: Run personal tests and verify failure**

Run:

~~~bash
pnpm --filter @guideanything/api test -- personal.test.ts
~~~

Expected: FAIL with route not found.

- [ ] **Step 3: Implement repository queries**

Use a shared item-summary SELECT that joins workspaces, favorites, guide owner, published version, and membership. Exclude deleted items from favorites, recents, and shares. listTrash selects deleted items only and requires OWNER or resource ownership.

Implement recent upsert:

~~~sql
INSERT INTO recent_views (user_id, item_id, last_viewed_at, view_count, context_json)
VALUES (?, ?, ?, 1, ?)
ON CONFLICT (user_id, item_id) DO UPDATE SET
  last_viewed_at = excluded.last_viewed_at,
  view_count = recent_views.view_count + 1,
  context_json = excluded.context_json;
~~~

- [ ] **Step 4: Implement lifecycle rules**

PersonalService must:

- Verify access before favorite or recent writes.
- Allow trash for guide owner or workspace OWNER.
- Set deleted_at and deleted_by; remove the current published guide from FTS.
- Restore by clearing deleted fields and rebuilding FTS from the current published version.
- For an unpublished guide, permanent removal deletes workspace_item then guides.
- For a published guide, permanent removal sets guides.status to ARCHIVED, removes favorites, recents, and workspace_item, but retains guide_versions.
- Record ITEM_TRASHED and ITEM_RESTORED activity.

Register routes:

~~~ts
app.get('/api/me/favorites', auth, handler);
app.put('/api/me/favorites/:itemId', auth, handler);
app.delete('/api/me/favorites/:itemId', auth, handler);
app.get('/api/me/recent', auth, handler);
app.put('/api/me/recent/:itemId', auth, handler);
app.get('/api/me/shared', auth, handler);
app.get('/api/me/trash', auth, handler);
app.post('/api/workspace-items/:itemId/trash', auth, handler);
app.post('/api/workspace-items/:itemId/restore', auth, handler);
app.delete('/api/workspace-items/:itemId', auth, handler);
~~~

- [ ] **Step 5: Add and pass the post-trash search test**

Add to search.test.ts:

~~~ts
it('removes trashed guides from search and restores them to the index', async () => {
  const context = await createWorkspaceGuideFixture();
  const search = () => context.app.inject({
    method: 'GET',
    url: '/api/search?q=' + encodeURIComponent('可检索测试指南'),
    headers: authorization(context.tokens.author),
  });
  expect((await search()).json().items).toEqual([
    expect.objectContaining({ id: context.guideId, workspaceItemId: context.workspaceItemId }),
  ]);
  const trashed = await context.app.inject({
    method: 'POST',
    url: `/api/workspace-items/${context.workspaceItemId}/trash`,
    headers: authorization(context.tokens.author),
  });
  expect(trashed.statusCode).toBe(200);
  expect((await search()).json().items).toEqual([]);
  const restored = await context.app.inject({
    method: 'POST',
    url: `/api/workspace-items/${context.workspaceItemId}/restore`,
    headers: authorization(context.tokens.author),
  });
  expect(restored.statusCode).toBe(200);
  expect((await search()).json().items).toEqual([
    expect.objectContaining({ id: context.guideId, workspaceItemId: context.workspaceItemId }),
  ]);
  await context.close();
});
~~~

- [ ] **Step 6: Run backend regression**

Run:

~~~bash
pnpm --filter @guideanything/api test
pnpm --filter @guideanything/api typecheck
~~~

Expected: all API tests PASS.

- [ ] **Step 7: Commit**

~~~bash
git add apps/api/src/modules/personal apps/api/src/app.ts apps/api/src/modules/search/search.test.ts
git commit -m "feat: add personal workspace views"
~~~

---

### Task 5: Workspace API Client and URL-Backed App Routing

**Files:**
- Create: apps/web/src/features/workspace/types.ts
- Create: apps/web/src/test/workspace-api-mocks.ts
- Modify: apps/web/src/lib/api.ts
- Modify: apps/web/src/App.tsx
- Create: apps/web/src/App.test.tsx

**Interfaces:**
- Consumes backend WorkspaceSummary and WorkspaceItemSummary DTOs.
- Produces WorkspaceApi and PersonalApi clients.
- Produces routes for library, personal views, workspace pages, editor, and lesson.

- [ ] **Step 1: Write failing route restoration tests**

Create workspace-api-mocks.ts with one explicit spy installer:

~~~ts
export function mockAuthenticatedWorkspaceApi(input: {
  workspaces?: WorkspaceSummary[];
  favorites?: WorkspaceItemSummary[];
}) {
  vi.spyOn(ApiClient.prototype, 'hasToken', 'get').mockReturnValue(true);
  vi.spyOn(ApiClient.prototype, 'me').mockResolvedValue({
    id: 'user-author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR',
  });
  vi.spyOn(ApiClient.prototype, 'workspaceApi').mockReturnValue({
    list: vi.fn().mockResolvedValue(input.workspaces ?? []),
    get: vi.fn(),
    listItems: vi.fn().mockResolvedValue([]),
  });
  vi.spyOn(ApiClient.prototype, 'personalApi').mockReturnValue({
    listFavorites: vi.fn().mockResolvedValue(input.favorites ?? []),
    listRecent: vi.fn().mockResolvedValue([]),
    listShared: vi.fn().mockResolvedValue([]),
    listTrash: vi.fn().mockResolvedValue([]),
    favorite: vi.fn(), unfavorite: vi.fn(), recordRecent: vi.fn(),
    trashItem: vi.fn(), restoreItem: vi.fn(), permanentlyRemoveItem: vi.fn(),
  });
}
~~~

Create App.test.tsx with a browser-history initial URL and call that installer:

~~~ts
it('restores the favorites route after authentication', async () => {
  window.history.replaceState(null, '', '/favorites');
  mockAuthenticatedWorkspaceApi({
    workspaces: [],
    favorites: [],
  });
  render(<App />);
  expect(await screen.findByRole('heading', { name: '收藏夹' })).toBeVisible();
  expect(screen.getByRole('button', { name: '收藏夹' })).toHaveAttribute('aria-current', 'page');
});

it('opens a workspace URL and keeps it after reload', async () => {
  window.history.replaceState(null, '', '/workspaces/workspace-materials');
  mockAuthenticatedWorkspaceApi({
    workspaces: [{ id: 'workspace-materials', name: '物料管理' }],
  });
  render(<App />);
  expect(await screen.findByRole('heading', { name: '物料管理' })).toBeVisible();
});
~~~

Use vi.spyOn(ApiClient.prototype, methodName) rather than a global fake server.

- [ ] **Step 2: Run web tests and verify failure**

Run:

~~~bash
pnpm --filter @guideanything/web test -- App.test.tsx
~~~

Expected: FAIL because App uses local page state and has no routes.

- [ ] **Step 3: Add focused API clients**

Extend ApiClient:

~~~ts
workspaceApi() {
  return {
    list: () => this.request<{ items: WorkspaceSummary[] }>('/workspaces'),
    get: (id: string) => this.request<{ workspace: WorkspaceSummary; counts: Record<WorkspaceItemKind, number> }>('/workspaces/' + id),
    listItems: (id: string, kind?: WorkspaceItemKind) =>
      this.request<{ items: WorkspaceItemSummary[] }>(
        '/workspaces/' + id + '/items' + (kind ? '?kind=' + kind : ''),
      ),
    activity: (id: string) =>
      this.request<{ items: WorkspaceActivity[] }>('/workspaces/' + id + '/activity'),
  };
}

personalApi() {
  return {
    favorites: () => this.request<{ items: WorkspaceItemSummary[] }>('/me/favorites'),
    recent: () => this.request<{ items: WorkspaceItemSummary[] }>('/me/recent'),
    shared: () => this.request<{ items: WorkspaceItemSummary[] }>('/me/shared'),
    trash: () => this.request<{ items: WorkspaceItemSummary[] }>('/me/trash'),
    favorite: (itemId: string) => this.request('/me/favorites/' + itemId, { method: 'PUT' }),
    unfavorite: (itemId: string) => this.request('/me/favorites/' + itemId, { method: 'DELETE' }),
    recordRecent: (itemId: string, context: Record<string, unknown>) =>
      this.request('/me/recent/' + itemId, { method: 'PUT', body: JSON.stringify({ context }) }),
    trashItem: (itemId: string) => this.request('/workspace-items/' + itemId + '/trash', { method: 'POST' }),
    restoreItem: (itemId: string) => this.request('/workspace-items/' + itemId + '/restore', { method: 'POST' }),
    permanentlyRemoveItem: (itemId: string) => this.request('/workspace-items/' + itemId, { method: 'DELETE' }),
  };
}
~~~

- [ ] **Step 4: Replace App local page state with BrowserRouter routes**

Define routes:

~~~tsx
<Routes>
  <Route element={<AuthenticatedWorkspaceLayout user={user} />}>
    <Route path="/" element={<Navigate to="/library" replace />} />
    <Route path="/library" element={<LibraryPage />} />
    <Route path="/favorites" element={<PersonalResourcePage kind="favorites" />} />
    <Route path="/recent" element={<PersonalResourcePage kind="recent" />} />
    <Route path="/shared" element={<PersonalResourcePage kind="shared" />} />
    <Route path="/trash" element={<PersonalResourcePage kind="trash" />} />
    <Route path="/workspaces" element={<WorkspaceDirectoryPage />} />
    <Route path="/workspaces/:workspaceId" element={<WorkspaceOverviewPage />} />
    <Route path="/workspaces/:workspaceId/guides" element={<LibraryPage />} />
    <Route path="/workspaces/:workspaceId/:module" element={<ReservedModulePage />} />
  </Route>
  <Route path="/guides/:guideId/edit" element={<GuideEditorRoute />} />
  <Route path="/versions/:versionId/learn" element={<LessonRoute />} />
</Routes>
~~~

Keep login outside authenticated routes. Replace onEdit and onLearn callbacks with navigate calls.

- [ ] **Step 5: Run App tests and typecheck**

Run:

~~~bash
pnpm --filter @guideanything/web test -- App.test.tsx
pnpm --filter @guideanything/web typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/lib/api.ts apps/web/src/features/workspace/types.ts apps/web/src/test/workspace-api-mocks.ts
git commit -m "feat: add workspace routes and clients"
~~~

---

### Task 6: Workspace Shell, Directory, Overview, and Reserved Modules

**Files:**
- Create: apps/web/src/features/workspace/WorkspaceShell.tsx
- Create: apps/web/src/features/workspace/WorkspaceDirectoryPage.tsx
- Create: apps/web/src/features/workspace/WorkspaceOverviewPage.tsx
- Create: apps/web/src/features/workspace/ReservedModulePage.tsx
- Create: apps/web/src/features/workspace/WorkspacePages.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**
- Consumes WorkspaceApi and PersonalApi.
- WorkspaceShell receives user, workspaceApi, personalApi, and onLogout; it renders Outlet and a route-aware sidebar.
- ReservedModulePage supports sources, agents, ontology, and artifacts.

- [ ] **Step 1: Write failing workspace page tests**

Define the route harness at the top of WorkspacePages.test.tsx so the tests use production routing rather than undeclared globals:

~~~tsx
function renderWorkspaceRoutes(input: { initialPath: string; workspaces: WorkspaceSummary[] }) {
  const workspaceApi: WorkspaceApi = {
    list: vi.fn().mockResolvedValue(input.workspaces),
    get: vi.fn(async (id) => ({
      workspace: input.workspaces.find((item) => item.id === id)!,
      counts: { GUIDE: 0, SOURCE: 0, AGENT: 0, ONTOLOGY: 0, CONVERSATION: 0, ARTIFACT: 0 },
    })),
    listItems: vi.fn().mockResolvedValue([]),
  };
  const personalApi = createEmptyPersonalApi();
  render(
    <MemoryRouter initialEntries={[input.initialPath]}>
      <Routes>
        <Route element={<WorkspaceShell user={authorUser} workspaceApi={workspaceApi} personalApi={personalApi} onLogout={vi.fn()} />}>
          <Route path="/library" element={<h1>指南库</h1>} />
          <Route path="/workspaces/:workspaceId" element={<WorkspaceOverviewPage workspaceApi={workspaceApi} />} />
          <Route path="/workspaces/:workspaceId/:module" element={<ReservedModulePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
~~~

In the same test file, define the user and personal client:

~~~ts
const authorUser: AuthUser = {
  id: 'user-author', displayName: '王作者', email: 'author@guide.local', role: 'AUTHOR',
};

function createEmptyPersonalApi(): PersonalApi {
  return {
    listFavorites: vi.fn().mockResolvedValue([]),
    listRecent: vi.fn().mockResolvedValue([]),
    listShared: vi.fn().mockResolvedValue([]),
    listTrash: vi.fn().mockResolvedValue([]),
    favorite: vi.fn(), unfavorite: vi.fn(), recordRecent: vi.fn(),
    trashItem: vi.fn(), restoreItem: vi.fn(), permanentlyRemoveItem: vi.fn(),
  };
}
~~~

~~~tsx
it('activates real sidebar routes and opens a workspace overview', async () => {
  const user = userEvent.setup();
  renderWorkspaceRoutes({
    initialPath: '/library',
    workspaces: [{ id: 'workspace-materials', name: '物料管理', iconKey: 'FileText', colorKey: 'materials' }],
  });
  await user.click(await screen.findByRole('link', { name: '物料管理' }));
  expect(await screen.findByRole('heading', { name: '物料管理' })).toBeVisible();
  expect(screen.getByText('工作区概览')).toBeVisible();
});

it('shows honest empty states for reserved modules', async () => {
  renderWorkspaceRoutes({
    initialPath: '/workspaces/workspace-materials/agents',
    workspaces: [{ id: 'workspace-materials', name: '物料管理' }],
  });
  expect(await screen.findByRole('heading', { name: 'Agent' })).toBeVisible();
  expect(screen.getByText('尚未配置 Agent Runtime')).toBeVisible();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
~~~

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~bash
pnpm --filter @guideanything/web test -- WorkspacePages.test.tsx
~~~

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Extract WorkspaceShell from LibraryPage**

Move top bar, sidebar, account menu, appearance toggle, and workspace loading into WorkspaceShell. Use NavLink for all routes:

~~~tsx
<NavLink to="/favorites" className={navClass}>
  <BookmarkSimple size={21} />
  <span>收藏夹</span>
</NavLink>
~~~

Map workspaces from API. Show the five most recently updated and link 查看全部 to /workspaces. Render Outlet inside workspace-content.

- [ ] **Step 4: Implement directory and overview**

WorkspaceDirectoryPage renders a responsive card grid with name, description, owner, permission, guide count, and last update.

WorkspaceOverviewPage loads workspace detail, activity, and GUIDE items in parallel. Render:

~~~tsx
<section className="workspace-overview">
  <WorkspaceHero workspace={workspace} />
  <ModuleGrid counts={counts} workspaceId={workspace.id} />
  <RecentActivity items={activity} />
  <FavoriteResources items={items.filter((item) => item.favorite)} />
</section>
~~~

ModuleGrid links GUIDE to guides and reserved kinds to their honest empty states.

- [ ] **Step 5: Implement reserved module copy**

Use fixed content:

~~~ts
const reservedModules = {
  sources: {
    title: '资料源',
    status: '尚未配置知识来源',
    description: '未来可接入服务器目录、PDF、Markdown、数据库和外部知识库。',
  },
  agents: {
    title: 'Agent',
    status: '尚未配置 Agent Runtime',
    description: '未来通过受控 Runtime Bridge 接入 Codex CLI，并保留权限确认和审计记录。',
  },
  ontology: {
    title: 'Ontology',
    status: '尚未建立工作区 Ontology',
    description: '未来从指南与资料中提取概念、关系、术语和业务规则。',
  },
  artifacts: {
    title: '会话与产物',
    status: '尚未产生会话或产物',
    description: '未来保存咨询记录、报告、分析结果和指南草稿。',
  },
} as const;
~~~

- [ ] **Step 6: Add responsive styles and run tests**

Add workspace-directory-grid, workspace-overview, module-grid, activity-list, reserved-module, loading, empty, error, dark, light, 900px, and 760px rules.

Run:

~~~bash
pnpm --filter @guideanything/web test -- WorkspacePages.test.tsx
pnpm --filter @guideanything/web typecheck
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add apps/web/src/features/workspace apps/web/src/styles.css
git commit -m "feat: build workspace shell and overview"
~~~

---

### Task 7: Generic Resource Table and Personal Pages

**Files:**
- Create: apps/web/src/features/resources/ResourceTable.tsx
- Create: apps/web/src/features/personal/PersonalResourcePage.tsx
- Create: apps/web/src/features/personal/PersonalResourcePage.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**
- Consumes WorkspaceItemSummary and PersonalApi.
- ResourceTable accepts mode, items, onOpen, onFavorite, onTrash, onRestore, onPermanentRemove.

- [ ] **Step 1: Write failing personal page tests**

Define deterministic builders in PersonalResourcePage.test.tsx:

~~~ts
function guideResource(overrides: Partial<WorkspaceItemSummary> = {}): WorkspaceItemSummary {
  return {
    id: 'item-guide',
    workspaceId: 'workspace-materials',
    workspaceName: '物料管理',
    kind: 'GUIDE',
    entityId: 'guide-1',
    title: '测试指南',
    summary: '',
    updatedAt: '2026-07-13T00:00:00.000Z',
    favorite: false,
    permission: 'EDIT',
    publishedVersionId: 'version-1',
    ...overrides,
  };
}

function createPersonalApi(input: {
  favorites?: WorkspaceItemSummary[];
  recent?: WorkspaceItemSummary[];
  shared?: WorkspaceItemSummary[];
  trash?: WorkspaceItemSummary[];
}): PersonalApi {
  return {
    listFavorites: vi.fn().mockResolvedValue(input.favorites ?? []),
    listRecent: vi.fn().mockResolvedValue(input.recent ?? []),
    listShared: vi.fn().mockResolvedValue(input.shared ?? []),
    listTrash: vi.fn().mockResolvedValue(input.trash ?? []),
    favorite: vi.fn().mockResolvedValue(undefined),
    unfavorite: vi.fn().mockResolvedValue(undefined),
    recordRecent: vi.fn().mockResolvedValue(undefined),
    trashItem: vi.fn().mockResolvedValue(undefined),
    restoreItem: vi.fn().mockResolvedValue(undefined),
    permanentlyRemoveItem: vi.fn().mockResolvedValue(undefined),
  };
}
~~~

~~~tsx
it('loads favorites and removes one without a reload', async () => {
  const user = userEvent.setup();
  const api = createPersonalApi({
    favorites: [guideResource({ id: 'item-1', title: '物料主数据检查', favorite: true })],
  });
  render(<PersonalResourcePage kind="favorites" api={api} onOpen={vi.fn()} />);
  expect(await screen.findByText('物料主数据检查')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '取消收藏 物料主数据检查' }));
  expect(api.unfavorite).toHaveBeenCalledWith('item-1');
  expect(screen.queryByText('物料主数据检查')).not.toBeInTheDocument();
});

it('restores an item from trash', async () => {
  const user = userEvent.setup();
  const api = createPersonalApi({
    trash: [guideResource({ id: 'item-2', title: '销售订单草稿', deletedAt: '2026-07-13T00:00:00.000Z' })],
  });
  render(<PersonalResourcePage kind="trash" api={api} onOpen={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: '恢复 销售订单草稿' }));
  expect(api.restoreItem).toHaveBeenCalledWith('item-2');
  expect(screen.queryByText('销售订单草稿')).not.toBeInTheDocument();
});
~~~

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~bash
pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx
~~~

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement ResourceTable**

Use semantic article rows and one action menu per row. Map kind to Phosphor icons. The GUIDE open action chooses edit when permission is OWNER or EDIT and no publishedVersionId exists; otherwise it opens learning mode.

Expose exact props:

~~~ts
interface ResourceTableProps {
  mode: 'default' | 'favorites' | 'recent' | 'shared' | 'trash';
  items: WorkspaceItemSummary[];
  onOpen: (item: WorkspaceItemSummary) => void;
  onFavorite: (item: WorkspaceItemSummary, favorite: boolean) => Promise<void>;
  onTrash: (item: WorkspaceItemSummary) => Promise<void>;
  onRestore: (item: WorkspaceItemSummary) => Promise<void>;
  onPermanentRemove: (item: WorkspaceItemSummary) => Promise<void>;
}
~~~

Confirm trash and permanent removal with an accessible dialog. Permanent removal copy must state that published snapshots remain for pinned references.

- [ ] **Step 4: Implement PersonalResourcePage**

Map route kind to title, description, loader, and empty copy:

~~~ts
const pageConfig = {
  favorites: ['收藏夹', '保存的常用资源', '还没有收藏任何资源'],
  recent: ['最近查看', '继续上次的工作', '还没有查看记录'],
  shared: ['与我共享', '别人明确邀请你协作的资源', '还没有共享给你的资源'],
  trash: ['回收站', '恢复或永久移除资源', '回收站为空'],
} as const;
~~~

After a successful mutation, update local state. On failure, keep the item and display the server message.

- [ ] **Step 5: Style and verify**

Add resource-table, resource-row, resource-kind, resource-workspace, action-menu, confirm-dialog, and mobile stacked-row rules.

Run:

~~~bash
pnpm --filter @guideanything/web test -- PersonalResourcePage.test.tsx
pnpm --filter @guideanything/web typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add apps/web/src/features/resources apps/web/src/features/personal apps/web/src/styles.css
git commit -m "feat: add personal resource pages"
~~~

---

### Task 8: Library, Editor, and Lesson Integration

**Files:**
- Modify: apps/web/src/features/library/LibraryPage.tsx
- Modify: apps/web/src/features/library/LibraryPage.test.tsx
- Modify: apps/web/src/features/editor/GuideEditor.tsx
- Modify: apps/web/src/features/editor/GuideEditor.test.tsx
- Modify: apps/web/src/features/lesson/LessonPage.tsx
- Modify: apps/web/src/features/lesson/LessonPage.test.tsx
- Modify: apps/web/src/lib/api.ts
- Modify: apps/web/src/styles.css

**Interfaces:**
- Consumes WorkspaceShell, ResourceTable, WorkspaceApi, PersonalApi.
- Global creation selects a workspace; workspace-scoped creation uses current workspace.
- Editor and lesson routes record recent views only after successful resource load.

- [ ] **Step 1: Write failing integration tests**

Add these typed builders before the library tests:

~~~ts
function workspace(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'workspace-default', slug: 'default', name: '默认工作区', description: '',
    iconKey: 'BookOpen', colorKey: 'blue', ownerId: 'user-author', ownerName: '王作者',
    permission: 'OWNER', guideCount: 0, updatedAt: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

function createLibraryApi(input: { workspaces: WorkspaceSummary[] }): LibraryApi {
  return {
    listEditableWorkspaces: vi.fn().mockResolvedValue(input.workspaces),
    listDrafts: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    createGuide: vi.fn().mockResolvedValue({ id: 'guide-new' }),
  };
}
~~~

Change LibraryApi.createGuide to accept workspaceId and add listEditableWorkspaces to the interface. Then add the library tests:

~~~tsx
it('selects a workspace before creating from the global library', async () => {
  const user = userEvent.setup();
  const api = createLibraryApi({
    workspaces: [
      workspace({ id: 'workspace-sales', name: '销售与分销', permission: 'EDIT' }),
      workspace({ id: 'workspace-materials', name: '物料管理', permission: 'OWNER' }),
    ],
  });
  render(<LibraryPage api={api} />);
  await user.click(screen.getByRole('button', { name: '新建指南' }));
  await user.click(screen.getByRole('button', { name: '在物料管理中新建' }));
  expect(api.createGuide).toHaveBeenCalledWith('workspace-materials');
});

it('creates directly inside the current workspace', async () => {
  const user = userEvent.setup();
  const api = createLibraryApi({ workspaces: [] });
  render(<LibraryPage api={api} workspaceId="workspace-sales" />);
  await user.click(screen.getByRole('button', { name: '新建指南' }));
  expect(api.createGuide).toHaveBeenCalledWith('workspace-sales');
});
~~~

Add editor and lesson assertions:

~~~ts
expect(personalApi.recordRecent).toHaveBeenCalledWith(
  'item-guide-1',
  expect.objectContaining({ mode: 'edit' }),
);

expect(personalApi.recordRecent).toHaveBeenCalledWith(
  'item-guide-1',
  expect.objectContaining({ mode: 'lesson', versionId: 'version-1' }),
);
~~~

- [ ] **Step 2: Run tests and verify failure**

Run:

~~~bash
pnpm --filter @guideanything/web test -- LibraryPage.test.tsx GuideEditor.test.tsx LessonPage.test.tsx
~~~

Expected: FAIL because createGuide has no workspace argument and recent recording is absent.

- [ ] **Step 3: Refactor LibraryPage into route content**

Remove shell ownership from LibraryPage. Accept workspaceId from route params, load search results with workspace metadata, and render ResourceTable. Keep the existing published and draft sections where needed, but use shared actions.

Change LibraryApi:

~~~ts
interface LibraryApi {
  listDrafts: (workspaceId?: string) => Promise<DraftItem[]>;
  search: (query: string, workspaceId?: string) => Promise<SearchItem[]>;
  createGuide: (workspaceId: string) => Promise<{ id: string }>;
  listEditableWorkspaces: () => Promise<WorkspaceSummary[]>;
}
~~~

When global creation has more than one editable workspace, open WorkspacePickerDialog. When one exists, create directly. When none exists, show “没有可创建指南的工作区”.

- [ ] **Step 4: Add favorite and trash row actions**

Published and draft guide rows receive workspaceItemId and favorite. Add actions:

- 收藏 or 取消收藏.
- 打开学习 or 编辑.
- 移到回收站 when authorized.

After trash, remove the row locally and update the count. Do not navigate away.

- [ ] **Step 5: Record recent views**

Guide draft DTO and version DTO must expose workspaceItemId. After GuideEditor getGuide resolves, call:

~~~ts
void personalApi.recordRecent(guide.workspaceItemId, {
  mode: 'edit',
  guideId: guide.id,
});
~~~

After LessonPage loads the root version, call:

~~~ts
void personalApi.recordRecent(version.workspaceItemId, {
  mode: 'lesson',
  versionId: version.id,
});
~~~

Do not record subguide navigation as a separate recent item unless the child version belongs to a different workspace item returned by the API.

- [ ] **Step 6: Run web regression**

Run:

~~~bash
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
~~~

Expected: all web tests and build PASS.

- [ ] **Step 7: Commit**

~~~bash
git add apps/web/src/features/library apps/web/src/features/editor apps/web/src/features/lesson apps/web/src/lib/api.ts apps/web/src/styles.css
git commit -m "feat: integrate guides with workspaces"
~~~

---

### Task 9: Future Adapter Contracts, Documentation, and End-to-End Verification

**Files:**
- Create: packages/contracts/src/adapters.ts
- Create: packages/contracts/src/adapters.test.ts
- Modify: packages/contracts/src/index.ts
- Modify: docs/ARCHITECTURE.md
- Modify: docs/DATA_MODEL.md
- Modify: docs/ACCEPTANCE.md
- Modify: design-qa.md

**Interfaces:**
- Produces KnowledgeSourceAdapter, AgentRuntimeAdapter, OntologyProvider types without runtime implementations.
- Documents the final workspace topology and acceptance evidence.

- [ ] **Step 1: Write failing adapter contract tests**

~~~ts
it('keeps runtime capabilities explicit and serializable', () => {
  expect(AgentCapabilitySchema.parse({
    id: 'read-workspace',
    label: '读取工作区资料',
    risk: 'READ',
    requiresApproval: false,
  })).toEqual(expect.objectContaining({ risk: 'READ' }));
  expect(AgentCapabilitySchema.parse({
    id: 'run-command',
    label: '运行本地命令',
    risk: 'EXECUTE',
    requiresApproval: true,
  })).toEqual(expect.objectContaining({ requiresApproval: true }));
});
~~~

- [ ] **Step 2: Run contract test and verify failure**

Run:

~~~bash
pnpm --filter @guideanything/contracts test -- adapters.test.ts
~~~

Expected: FAIL because adapters.ts does not exist.

- [ ] **Step 3: Add adapter contracts only**

Create adapters.ts with serializable config/result schemas plus TypeScript interfaces:

~~~ts
export const AgentRiskSchema = z.enum(['READ', 'WRITE', 'EXECUTE']);
export const AgentCapabilitySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  risk: AgentRiskSchema,
  requiresApproval: z.boolean(),
});

export const SyncResultSchema = z.object({
  sourceId: z.string().min(1),
  indexedDocuments: z.number().int().min(0),
  completedAt: z.string().datetime(),
});
export const KnowledgeHitSchema = z.object({
  sourceId: z.string().min(1),
  documentId: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string(),
  score: z.number().min(0),
});
export const AgentSessionInputSchema = z.object({
  workspaceId: z.string().min(1),
  agentItemId: z.string().min(1),
  initiatedBy: z.string().min(1),
});
export const AgentSessionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  status: z.enum(['READY', 'RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED']),
});
export const AgentEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  type: z.enum(['MESSAGE', 'TOOL_REQUEST', 'TOOL_RESULT', 'STATUS', 'ERROR']),
  payload: z.record(z.string(), z.unknown()),
});
export const OntologyBuildSchema = z.object({
  id: z.string().min(1), workspaceId: z.string().min(1), status: z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED']),
});
export const OntologyResultSchema = z.object({
  entities: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), kind: z.string().min(1) })),
  relations: z.array(z.object({ sourceId: z.string().min(1), targetId: z.string().min(1), kind: z.string().min(1) })),
});
export const OntologyExplanationSchema = z.object({
  entityId: z.string().min(1), summary: z.string(), evidenceItemIds: z.array(z.string().min(1)),
});

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;
export type AgentSessionInput = z.infer<typeof AgentSessionInputSchema>;
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type OntologyBuild = z.infer<typeof OntologyBuildSchema>;
export type OntologyResult = z.infer<typeof OntologyResultSchema>;
export type OntologyExplanation = z.infer<typeof OntologyExplanationSchema>;

export interface KnowledgeSourceAdapter {
  readonly kind: string;
  validateConfiguration(input: unknown): Promise<void>;
  sync(sourceId: string, signal: AbortSignal): Promise<SyncResult>;
  search(sourceIds: string[], query: string): Promise<KnowledgeHit[]>;
}

export interface AgentRuntimeAdapter {
  readonly kind: string;
  capabilities(): Promise<AgentCapability[]>;
  createSession(input: AgentSessionInput): Promise<AgentSession>;
  send(sessionId: string, message: string): AsyncIterable<AgentEvent>;
  cancel(sessionId: string): Promise<void>;
}

export interface OntologyProvider {
  rebuild(workspaceId: string, sourceItemIds: string[]): Promise<OntologyBuild>;
  query(workspaceId: string, query: string): Promise<OntologyResult>;
  explain(workspaceId: string, entityId: string): Promise<OntologyExplanation>;
}
~~~

Export all schemas, inferred DTOs, and interfaces from packages/contracts/src/index.ts. Do not create a concrete adapter or process-spawning code.

- [ ] **Step 4: Update durable project documentation**

Update:

- ARCHITECTURE.md with workspace and future Runtime Bridge topology.
- DATA_MODEL.md with all version 2 tables and lifecycle rules.
- ACCEPTANCE.md with the eight browser journeys from the approved design.
- design-qa.md with new routes, dark/light/mobile evidence, interactions tested, and final result.

- [ ] **Step 5: Run complete automated verification**

Run:

~~~bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
~~~

Expected: all commands PASS.

- [ ] **Step 6: Run browser acceptance**

Using the existing dev server:

1. Author opens /workspaces/workspace-materials.
2. Author creates a guide inside that workspace.
3. Author favorites it and confirms /favorites persists after reload.
4. Author opens it and confirms /recent updates without duplicates.
5. Editor confirms /shared contains explicitly shared guides.
6. Author trashes and restores a draft.
7. Reserved Agent, Source, Ontology, and Artifact pages show honest empty states with no fake input.
8. Repeat shell checks at 1440 × 1024 and 390 × 844 in dark and light themes.
9. Confirm browser console has zero errors.

Save final screenshots under .playwright-cli so they remain ignored.

- [ ] **Step 7: Commit**

~~~bash
git add packages/contracts/src docs/ARCHITECTURE.md docs/DATA_MODEL.md docs/ACCEPTANCE.md design-qa.md
git commit -m "docs: finalize workspace v1 architecture"
~~~

---

## Plan Self-Review

- Spec coverage: Tasks 1-4 cover data, permissions, workspaces, personal views, lifecycle, migration, and search. Tasks 5-8 cover URL navigation, shell, overview, generic resources, guide integration, recent tracking, and honest reserved modules. Task 9 covers adapter boundaries, durable docs, and browser acceptance.
- Type consistency: WorkspaceSummary, WorkspaceItemSummary, WorkspacePermission, WorkspaceItemKind, and WorkspaceActivity originate in Task 1 and are consumed unchanged in later tasks.
- Lifecycle consistency: trash uses workspace_items.deleted_at; unpublished permanent removal deletes the draft; published permanent removal archives the guide while retaining guide_versions.
- Scope consistency: no task starts Codex CLI, syncs knowledge sources, builds an ontology, or creates an Agent chat surface.
- Test discipline: every production task begins with a failing test, verifies the red state, implements one bounded unit, verifies green, and commits.

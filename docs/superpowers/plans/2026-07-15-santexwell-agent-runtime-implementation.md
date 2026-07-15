# Santexwell Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a read-only Santexwell and workspace-aware QA system with deterministic flow/document retrieval, reasoning-based routing, persisted streaming conversations, safe citations, and validated artifacts.

**Architecture:** Add shared Zod protocols and a pure FlowKnowledgeSnapshot compiler, then persist rebuildable knowledge indexes and authoritative conversation/run records in SQLite. A localhost Runtime Bridge wraps Codex App Server JSON-RPC; the API owns retrieval, budgets, Prompt Harness, scheduling, citation validation, and SSE replay. React pages consume explicit REST façades and authenticated fetch-based SSE without exposing vault paths or runtime credentials.

**Tech Stack:** TypeScript 5.9, Node.js 24, pnpm 10, Zod 4, SQLite/FTS5, Fastify 5, Codex App Server JSON-RPC over stdio, React 19, React Router 7, React Flow 12, Vitest, Testing Library.

## Global Constraints

- Santexwell vault, published guides, and guide drafts are read-only to Agent runtime and web QA users.
- No Ontology route, navigation entry, table, build, entity, relation, or combined graph is implemented.
- The browser never receives an absolute vault path, bridge token, model credential, shell capability, or model-generated href.
- The API is authoritative for authentication, workspace access, conversation ownership, source switches, budgets, citations, and artifact validation.
- Santexwell Agent is a built-in read-only capability; do not create a fake editable AGENT workspace item.
- Global Santexwell conversations use `GLOBAL_SANTEXWELL`; workspace conversations use `WORKSPACE` and never fake a workspace id.
- Fast Gate is deterministic only. All non-trivial semantic questions use the Reasoning Router at medium effort and conditional high-effort Deep Router review.
- DIRECT and FOCUSED routes never start an unnecessary reducer or broad vault scan; Scheduler enforces every route budget in code.
- Streamed plan/progress/draft output is provisional. Only schema-, permission-, and citation-validated output becomes committed.
- Runtime uses approval `never`, read-only sandbox, explicit roots, no network, and no write/execute tools.
- Runtime Bridge uses a dedicated minimal `CODEX_HOME`; it must not inherit operator AGENTS, skills, plugins, MCP servers, tools, or web search.
- Every new production behavior follows red-green-refactor; tests must be observed failing for the expected reason before implementation.
- Preserve all current guide, version, media, workspace, personal-view, canvas, and subguide behavior.
- Do not modify or depend on the unrelated uncommitted files in the main checkout.

---

## Planned File Structure

### Shared protocols and flow compiler

- Create `packages/contracts/src/flow-knowledge.ts` and `.test.ts`: snapshot, locator, stages, nodes, attachments, diagnostics.
- Create `packages/contracts/src/agent-runtime.ts` and `.test.ts`: source, conversation, routing, run event, answer, citation, artifact, bridge DTOs.
- Modify `packages/contracts/src/adapters.ts`: reuse the new runtime event/session types while keeping existing exports compatible.
- Modify `packages/contracts/src/index.ts`: export both new modules.
- Create `packages/canvas-core/src/flow-knowledge.ts` and `.test.ts`: deterministic snapshot compiler.
- Modify `packages/canvas-core/src/index.ts`: export the compiler.

### Persistence and knowledge services

- Create `apps/api/src/db/migrations/0003_santexwell_agent_runtime.sql`.
- Modify `apps/api/src/db/migrate.ts` and `migrate.test.ts`.
- Create `apps/api/src/modules/knowledge/markdown.ts`, `search-text.ts`, `extractor.ts`, `repository.ts`, `vault-indexer.ts`, `flow-indexer.ts`, `service.ts`, `routes.ts`, and focused tests.
- Create `apps/api/src/modules/conversations/repository.ts`, `service.ts`, `events.ts`, `routes.ts`, and focused tests.
- Modify `apps/api/src/modules/guides/service.ts` or its repository transaction boundary to refresh flow snapshots after successful save/publish.
- Modify `apps/api/src/app.ts`, `server.ts`, `config.ts`, `test/test-app.ts`, `.env.example`, and `apps/api/package.json`.

### Codex Runtime Bridge

- Create `apps/runtime-bridge/package.json`, `tsconfig.json`, and `src/config.ts`.
- Create `apps/runtime-bridge/src/json-rpc.ts`, `codex-client.ts`, `types.ts`, `app.ts`, `server.ts`, and tests.
- Modify `.env.example` with localhost bridge configuration and semantic model roles.

### Orchestration

- Create `apps/api/src/modules/agents/runtime-client.ts`, `prompt-harness.ts`, `fast-gate.ts`, `router.ts`, `scheduler.ts`, `validator.ts`, `orchestrator.ts`, `routes.ts`, `sse.ts`, and tests.
- Register agents and global Santexwell conversation routes in `apps/api/src/app.ts`.

### Web product

- Create `apps/web/src/features/knowledge/SantexwellKnowledgePage.tsx` and tests.
- Create `apps/web/src/features/sources/WorkspaceSourcesPage.tsx` and tests.
- Create `apps/web/src/features/agents/AgentConversationPanel.tsx`, `AgentRunTimeline.tsx`, `WorkspaceAgentsPage.tsx`, `useAgentRunStream.ts`, and tests.
- Create `apps/web/src/features/artifacts/WorkspaceArtifactsPage.tsx`, `ArtifactViewer.tsx`, and tests.
- Create `apps/web/src/features/references/ReferencePage.tsx` and tests.
- Create `apps/web/src/features/markdown/SanitizedMarkdown.tsx`.
- Modify `apps/web/src/lib/api.ts`, `App.tsx`, `App.test.tsx`, `WorkspaceShell.tsx`, `WorkspaceOverviewPage.tsx`, `WorkspacePages.test.tsx`, `LessonPage.tsx`, `LessonPage.test.tsx`, and `styles.css`.

---

### Task 1: Shared Runtime Protocols and FlowKnowledgeSnapshot Compiler

**Files:**
- Create: `packages/contracts/src/flow-knowledge.ts`
- Create: `packages/contracts/src/flow-knowledge.test.ts`
- Create: `packages/contracts/src/agent-runtime.ts`
- Create: `packages/contracts/src/agent-runtime.test.ts`
- Modify: `packages/contracts/src/adapters.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/canvas-core/src/flow-knowledge.ts`
- Create: `packages/canvas-core/src/flow-knowledge.test.ts`
- Modify: `packages/canvas-core/src/index.ts`

**Interfaces:**
- Produces `FlowLocatorV1`, `FlowKnowledgeSnapshotV1`, `compileFlowKnowledgeSnapshotV1(input)`.
- Produces `SourceOptionsV1`, `RouteDecisionV1`, `TaskFindingV1`, `AgentRunEventV1`, `AgentInternalAnswerV1`, `CitationV1`, `ArtifactV1`, and bridge request/event DTOs.
- Snapshot compiler accepts an API-provided `snapshotId`; it has no time, randomness, database, filesystem, or React dependency.

- [ ] **Step 1: Write failing schema and compiler tests**

Add contract cases that parse a DRAFT and PUBLISHED origin, reject locator/snapshot mismatch, reject invalid event payloads, and discriminate artifacts. Add compiler fixtures proving stable output, stage/lane mapping, branch labels, one/two-hop neighborhoods, attachments, unattached resources, derived-node exclusion, and hidden subguide continuation recovery.

```ts
it('compiles the same semantic snapshot after presentation-only movement', () => {
  const first = compileFlowKnowledgeSnapshotV1(input(document));
  const moved = compileFlowKnowledgeSnapshotV1(input({
    ...document,
    viewport: { x: 900, y: -200, zoom: 0.6 },
    nodes: document.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + 500, y: node.position.y + 100 },
      zIndex: node.zIndex + 10,
    })),
  }));
  expect(moved).toEqual(first);
});

it('keeps route events ordered and JSON-safe', () => {
  const event = AgentRunEventV1Schema.parse({
    id: 'event-1', runId: 'run-1', sequence: 1, planVersion: 1,
    phase: 'PROVISIONAL', type: 'route.completed',
    payload: { route: 'FOCUSED', userFacingPlan: '先检查当前流程节点。' },
    createdAt: '2026-07-15T00:00:00.000Z',
  });
  expect(JSON.parse(JSON.stringify(event))).toEqual(event);
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
pnpm --filter @guideanything/contracts test -- flow-knowledge.test.ts agent-runtime.test.ts
pnpm --filter @guideanything/canvas-core test -- flow-knowledge.test.ts
```

Expected: FAIL because schemas and compiler exports do not exist.

- [ ] **Step 3: Implement the shared Zod protocols**

Use discriminated unions, bounded strings/arrays, strict locator kinds, and the route budget shape below. Keep internal locators out of public citation DTOs.

```ts
export const RouteBudgetV1Schema = z.object({
  maxWorkers: z.number().int().min(0).max(4),
  maxConcurrency: z.number().int().min(1).max(3),
  maxWorkspaceCandidates: z.number().int().min(0).max(12),
  maxFlowHops: z.number().int().min(0).max(2),
  maxVaultClusters: z.number().int().min(0).max(2),
  maxVaultDigests: z.number().int().min(0).max(6),
  allowRaw: z.boolean(),
  useReducer: z.boolean(),
});

export const SourceOptionsV1Schema = z.object({
  workspaceFlows: z.boolean(),
  workspaceDocuments: z.boolean(),
  sessionAttachments: z.boolean(),
  santexwell: z.boolean(),
});
```

- [ ] **Step 4: Implement the pure compiler**

Build `Map`/`Set` indexes once. Include only primary nodes without `source`; exclude `sourceTrace` edges; recover hidden continuation edges listed by a subguide; sort by stable IDs/order; never use coordinates. Attachment locators use their own node IDs. Dangling relations go to diagnostics rather than throwing.

```ts
export function compileFlowKnowledgeSnapshotV1(
  input: CompileFlowKnowledgeSnapshotInputV1,
): FlowKnowledgeSnapshotV1 {
  const document = CanvasDocumentSchema.parse(input.document);
  const primary = document.nodes.filter((node) => PRIMARY_TYPES.has(node.type) && !node.source);
  const primaryIds = new Set(primary.map((node) => node.id));
  const adjacency = buildLogicalAdjacency(document, primaryIds);
  const attachments = collectAttachments(document, primaryIds, input.guideId, input.snapshotId);
  return FlowKnowledgeSnapshotV1Schema.parse(buildSnapshot(input, primary, adjacency, attachments));
}
```

- [ ] **Step 5: Verify GREEN, typecheck, and commit**

```bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/canvas-core test
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/canvas-core typecheck
git add packages/contracts packages/canvas-core
git commit -m "feat: add agent protocols and flow knowledge snapshots"
```

### Task 2: SQLite Runtime Persistence and Configuration

**Files:**
- Create: `apps/api/src/db/migrations/0003_santexwell_agent_runtime.sql`
- Modify: `apps/api/src/db/migrate.ts`
- Modify: `apps/api/src/db/migrate.test.ts`
- Modify: `apps/api/src/config.ts`
- Create: `apps/api/src/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces authoritative tables for sources/documents/fragments/snapshots/conversations/messages/runs/events/citations/artifacts/attachments.
- `AppConfig` gains an explicit `bridge | fake` runtime mode, `santexwellVaultPath`, `bridgeUrl`, `bridgeToken`, timeouts, concurrency, and semantic model-role settings.
- Private conversations and artifacts are owner-scoped records and are not registered in the currently workspace-visible `workspace_items` table.
- Flow snapshots and opaque references are immutable identities; repository code never replaces an existing snapshot/reference in place.

- [ ] **Step 1: Write failing migration and config tests**

Assert versions `[1, 2, 3]`, all tables/indexes, global/workspace conversation CHECK constraints, source scope constraints, unique per-conversation client message ids, unique run sequence, immutable DRAFT/PUBLISHED snapshot origins, JSON validity, event type/phase constraints, and cascading deletion only for private conversation-owned data. Prove that deleting one conversation removes its messages/runs/events/citations/artifacts/attachments/SESSION source and FTS rows while preserving other users' conversations plus GLOBAL and WORKSPACE sources. Assert blank bridge token is rejected outside explicit fake-runtime test setup and production rejects fake mode.

```ts
expect(tableNames(database)).toEqual(expect.arrayContaining([
  'knowledge_sources', 'knowledge_documents', 'knowledge_fragments',
  'flow_knowledge_snapshots', 'conversations', 'conversation_messages',
  'agent_runs', 'agent_run_events', 'answer_citations', 'artifacts',
  'conversation_attachments',
]));
expect(() => database.prepare(
  `INSERT INTO conversations (id, scope, workspace_id, owner_id, title, status, created_at, updated_at)
   VALUES ('bad', 'GLOBAL_SANTEXWELL', 'workspace-materials', 'user-author', 'x', 'ACTIVE', ?, ?)`,
).run(now, now)).toThrow();
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @guideanything/api test -- migrate.test.ts config.test.ts
```

Expected: FAIL because migration 3 and new config fields do not exist.

- [ ] **Step 3: Implement migration 3**

Use `STRICT`, short foreign-key chains, ISO text timestamps, explicit CHECK constraints, and FTS5. Store sensitive locators only in internal JSON columns. `conversations.workspace_id` is nullable exactly when scope is `GLOBAL_SANTEXWELL`. Avoid a message/run foreign-key cycle: runs belong to a conversation and may reference their initiating user message in one direction only. User/workspace deletion is `NO ACTION`; only conversation-owned private data cascades.

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL_SANTEXWELL','WORKSPACE')),
  workspace_id TEXT REFERENCES workspaces(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  runtime_thread_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((scope = 'GLOBAL_SANTEXWELL' AND workspace_id IS NULL)
      OR (scope = 'WORKSPACE' AND workspace_id IS NOT NULL))
) STRICT;

CREATE TABLE agent_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  phase TEXT NOT NULL CHECK (phase IN ('PROVISIONAL','COMMITTED')),
  type TEXT NOT NULL CHECK (type IN (
    'route.started','route.completed','plan.committed',
    'task.started','task.progress','task.finding','task.completed','reduce.started',
    'answer.draft.delta','answer.validating','citation.committed','answer.committed',
    'artifact.committed','run.cancelled','run.failed','run.completed'
  )),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0,1)),
  created_at TEXT NOT NULL,
  CHECK (phase != 'COMMITTED' OR stale = 0),
  UNIQUE (run_id, sequence)
) STRICT;
```

Create `knowledge_fragment_search` as the only non-STRICT virtual table. Index only opaque fragment id, title, heading, content, and a derived `search_text` used for CJK bigrams. Keep internal locators/storage paths out of FTS, and install explicit insert/update/delete triggers so document/source/conversation cascades cannot leave stale shadow rows. Test insert, update, and cascade-delete MATCH behavior plus `PRAGMA foreign_key_check`.

`knowledge_sources` has mutually exclusive `GLOBAL | WORKSPACE | SESSION` ownership columns. `flow_knowledge_snapshots` has mutually exclusive DRAFT revision versus PUBLISHED version identity and unique origins. `answer_citations.reference_id` is globally unique and opaque; href is never stored. `conversation_attachments` stores only an internal storage key plus bounded size/status/expiry metadata; deleting rows does not claim to delete the physical file.

- [ ] **Step 4: Implement strict config loading**

Split pure environment parsing from `.env` loading. Resolve filesystem paths at the server boundary without requiring the vault to exist. Accept only root-path `http://127.0.0.1` or `http://localhost` bridge URLs with no credentials/query/fragment, cap concurrency to 3, validate bounded integer phase/run timeouts, and never expose `bridgeToken` through health DTOs. `AGENT_RUNTIME_MODE` defaults to `bridge`; explicit `fake` may omit the token only outside production. Production rejects fake mode, missing/short tokens, and the documented local-development sentinel. Model role values are nullable semantic configuration and never silently replaced with hardcoded model ids.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --filter @guideanything/api test -- migrate.test.ts config.test.ts
pnpm --filter @guideanything/api typecheck
git add .env.example apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/db
git commit -m "feat: persist knowledge and agent runtime state"
```

### Task 3: Read-only Knowledge Indexing, Uploads, Search, and Flow Sync

**Files:**
- Modify: `apps/api/package.json`, `pnpm-lock.yaml`
- Create: `apps/api/src/modules/knowledge/markdown.ts`
- Create: `apps/api/src/modules/knowledge/search-text.ts`
- Create: `apps/api/src/modules/knowledge/extractor.ts`
- Create: `apps/api/src/modules/knowledge/repository.ts`
- Create: `apps/api/src/modules/knowledge/vault-indexer.ts`
- Create: `apps/api/src/modules/knowledge/flow-indexer.ts`
- Create: `apps/api/src/modules/knowledge/service.ts`
- Create: `apps/api/src/modules/knowledge/routes.ts`
- Create: `apps/api/src/modules/knowledge/knowledge.test.ts`
- Create: `apps/api/src/modules/knowledge/vault-indexer.test.ts`
- Modify: `apps/api/src/modules/guides/service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/test/test-app.ts`

**Interfaces:**
- `indexSantexwellVault(database, root, signal): Promise<IndexSummary>` scans only allowed Markdown beneath `wiki_v2` and trusted harness files.
- `searchKnowledge(database, query, scope): KnowledgeSearchHitV1[]` returns validated opaque document/fragment IDs and internal locators.
- `syncGuideFlowSnapshot(database, guideContext): FlowKnowledgeSnapshotV1` runs after successful draft save and publish.
- REST: status/search/document for global knowledge; list/upload for workspace sources; list flow snapshots.

- [ ] **Step 1: Add failing parser/index/search/upload tests**

Use temporary roots containing a MOC, concept, digest, hidden file, outside-root symlink, and changed checksum. Assert headings/wikilinks, incremental replacement, CJK bigram search, no raw indexing, no absolute path in DTOs, and correct 404/403 upload behavior.

```ts
it('indexes only allowed vault markdown without exposing root paths', async () => {
  const summary = await indexSantexwellVault(database, vaultRoot, AbortSignal.timeout(2_000));
  expect(summary.indexedDocuments).toBe(3);
  const response = await app.inject({ method: 'GET', url: '/api/knowledge/santexwell/search?q=花式纱', headers: auth });
  expect(response.statusCode).toBe(200);
  expect(response.body).not.toContain(vaultRoot);
  expect(response.json().items[0].sourceKind).toBe('SANTEXWELL');
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @guideanything/api test -- knowledge.test.ts vault-indexer.test.ts
```

- [ ] **Step 3: Add document extraction dependencies and implementation**

Install pinned `pdf-parse@2.4.5` and `mammoth@1.12.0`. Verify MIME signature, extension, and size before writing a UUID filename. Markdown/text decode as UTF-8; PDF/DOCX extraction failures set `FAILED` and return an actionable message.

```bash
pnpm --filter @guideanything/api add pdf-parse@2.4.5 mammoth@1.12.0
```

- [ ] **Step 4: Implement safe Markdown parsing and incremental vault indexing**

Realpath every candidate and require it to remain inside the configured root. Split on headings with bounded 4,000-character fragments. Build search text from lowercase Latin tokens and CJK bigrams. Use a short transaction per document; never hold a transaction for the full scan.

- [ ] **Step 5: Implement repository/service/routes and flow sync**

Register read-only global routes and workspace-authorized source routes. `VIEW/LEARNER` can read workspace sources but cannot create persistent ones. After guide save/publish succeeds, compile and upsert the matching flow snapshot plus searchable node/attachment fragments.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm --filter @guideanything/api test -- knowledge.test.ts vault-indexer.test.ts guides.test.ts permissions.test.ts
pnpm --filter @guideanything/api typecheck
git add apps/api pnpm-lock.yaml
git commit -m "feat: index vault documents and guide flows"
```

### Task 4: Codex App Server Runtime Bridge

**Files:**
- Create: `apps/runtime-bridge/package.json`
- Create: `apps/runtime-bridge/tsconfig.json`
- Create: `apps/runtime-bridge/src/config.ts`
- Create: `apps/runtime-bridge/src/types.ts`
- Create: `apps/runtime-bridge/src/json-rpc.ts`
- Create: `apps/runtime-bridge/src/codex-client.ts`
- Create: `apps/runtime-bridge/src/app.ts`
- Create: `apps/runtime-bridge/src/server.ts`
- Create: `apps/runtime-bridge/src/json-rpc.test.ts`
- Create: `apps/runtime-bridge/src/app.test.ts`
- Create: `apps/runtime-bridge/src/codex-home.ts`
- Create: `apps/runtime-bridge/src/codex-home.test.ts`
- Modify: `.env.example`

**Interfaces:**
- `CodexRpcClient.initialize()`, `listModels()`, `startOrResumeThread()`, `runTurn()`, `steer()`, `interrupt()`, `close()`.
- `POST /v1/generate` emits authenticated NDJSON bridge events: delta, final, completed, failed.
- `GET /health` reports ready/degraded and semantic model-role resolution without credentials.

- [ ] **Step 1: Write failing JSON-RPC framing and bridge auth tests**

Use a fake child process stream. Assert monotonically allocated request IDs, out-of-order response resolution, notification dispatch, malformed line isolation, process-exit rejection, required bridge token, final-answer phase handling, dedicated runtime-home creation, top-level `web_search = "disabled"`, all required `--disable` flags, `personality: "none"`, empty instruction sources, and rejection of MCP/tool notifications.

```ts
it('treats phase-less and commentary deltas as provisional', async () => {
  const events = await collect(client.runTurn(request));
  expect(events).toContainEqual({ type: 'delta', phase: 'PROVISIONAL', text: '正在检查流程' });
  expect(events).toContainEqual({ type: 'final', phase: 'FINAL', text: expect.any(String) });
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @guideanything/runtime-bridge test
```

- [ ] **Step 3: Implement JSON-RPC client and Codex lifecycle**

Spawn `codex app-server --stdio` with a dedicated minimal `CODEX_HOME`; the operator supplies authentication without copying personal configuration. Disable plugins, remote plugins, apps, browser/computer/image, hooks, goals, shell/unified exec, workspace dependencies, multi-agent, tool suggestion and skill installation. Send `initialize`, then `initialized`; call `model/list`; use `thread/start` or `thread/resume`; start turns with text input and output schema. Thread and turn requests must set `approvalPolicy: 'never'`, `sandbox: 'read-only'`, explicit runtime roots, empty dynamic tools, no environments, `personality: 'none'`, and configured effort.

- [ ] **Step 4: Implement localhost bridge API and role resolution**

Accept only constant-time token matches. Resolve role model IDs against `model/list` and confirm requested effort is supported. Stream only agent message deltas/final/terminal errors; never forward command/file/tool/reasoning item contents. Health becomes degraded if a thread reports non-empty `instructionSources`, any MCP/tool startup is observed, or a configurable baseline context budget is exceeded.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --filter @guideanything/runtime-bridge test
pnpm --filter @guideanything/runtime-bridge typecheck
git add apps/runtime-bridge .env.example pnpm-lock.yaml
git commit -m "feat: add read-only codex runtime bridge"
```

### Task 5: Reasoning Router, Scheduler, Persisted Runs, SSE, Cancel, and Steer

**Files:**
- Create: `apps/api/src/modules/conversations/repository.ts`
- Create: `apps/api/src/modules/conversations/service.ts`
- Create: `apps/api/src/modules/conversations/events.ts`
- Create: `apps/api/src/modules/conversations/routes.ts`
- Create: `apps/api/src/modules/conversations/conversations.test.ts`
- Create: `apps/api/src/modules/agents/runtime-client.ts`
- Create: `apps/api/src/modules/agents/prompt-harness.ts`
- Create: `apps/api/src/modules/agents/fast-gate.ts`
- Create: `apps/api/src/modules/agents/router.ts`
- Create: `apps/api/src/modules/agents/scheduler.ts`
- Create: `apps/api/src/modules/agents/validator.ts`
- Create: `apps/api/src/modules/agents/orchestrator.ts`
- Create: `apps/api/src/modules/agents/routes.ts`
- Create: `apps/api/src/modules/agents/sse.ts`
- Create: `apps/api/src/modules/agents/agents.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/test/test-app.ts`

**Interfaces:**
- Workspace and global conversation CRUD, message creation, run snapshot, events, cancel, steer, artifacts, citations.
- `AgentRuntimeClient.run(request): AsyncIterable<BridgeEventV1>` is injected; tests use a finite fake.
- `AgentOrchestrator.execute(runId, signal)` persists each event before publish.

- [ ] **Step 1: Write failing route, budget, event-replay, and failure tests**

Cover global/workspace ownership, idempotent `clientMessageId`, source switches, Direct/Focused/Composite/Open budgets, conditional Deep Router, reducer prohibition, persisted event sequence, Last-Event-ID replay, cancellation, steer/stale plan versions, runtime errors, invalid schema repair once, invalid citations, and vault unavailable degradation.

```ts
it('does not search Santexwell or reduce a focused workspace-only question', async () => {
  const run = await sendMessage({
    text: '这个节点的负责人是谁？',
    sources: { workspaceFlows: true, workspaceDocuments: false, sessionAttachments: false, santexwell: false },
    selectedContext: { kind: 'FLOW_NODE', snapshotId: 'snapshot-1', nodeId: 'approve' },
  });
  expect(fakeRuntime.roles()).toEqual(['router', 'focused_worker']);
  expect(searchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ sourceKind: 'SANTEXWELL' }));
  expect(eventTypes(run.id)).not.toContain('reduce.started');
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @guideanything/api test -- conversations.test.ts agents.test.ts
```

- [ ] **Step 3: Implement conversations, event broker, and SSE replay**

Authorize before headers. Persist event, then notify in-memory subscribers. SSE writes `id`, `event`, and JSON `data`, handles backpressure, emits heartbeat comments, and stops only on terminal state or client disconnect. Disconnecting a viewer must not cancel the run.

- [ ] **Step 4: Implement Prompt Harness and Router**

Encode user and retrieved data as JSON. Safety/developer instructions state read-only, no network, untrusted context, no invented evidence, and output schema. Fast Gate only handles deterministic controls/unique selected context. Router output is schema constrained; Deep Router reviews trigger conditions from the design.

- [ ] **Step 5: Implement Scheduler, workers, reducer, and validator**

Clamp every model-produced budget to route constants. Retrieve workspace flows/documents first. Only invoke Santexwell when enabled and still needed. Run independent workers with a semaphore of at most 3. Reducer receives typed findings only. Validate all citations against current permissions and storage before creating public refs/hrefs.

- [ ] **Step 6: Implement background execution, cancel, and steer**

Return the accepted run before work completes. Use one AbortController per active run. Steer increments `planVersion`, marks older provisional events stale, interrupts active Codex turns, and restarts routing with the new instruction while retaining still-valid committed evidence.

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm --filter @guideanything/api test -- conversations.test.ts agents.test.ts knowledge.test.ts
pnpm --filter @guideanything/api typecheck
git add apps/api/src/modules apps/api/src/app.ts apps/api/src/server.ts apps/api/src/test
git commit -m "feat: orchestrate routed streaming knowledge conversations"
```

### Task 6: Santexwell Portal and Workspace Sources UI

**Files:**
- Create: `apps/web/src/features/markdown/SanitizedMarkdown.tsx`
- Create: `apps/web/src/features/knowledge/SantexwellKnowledgePage.tsx`
- Create: `apps/web/src/features/knowledge/SantexwellKnowledgePage.test.tsx`
- Create: `apps/web/src/features/sources/WorkspaceSourcesPage.tsx`
- Create: `apps/web/src/features/sources/WorkspaceSourcesPage.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceShell.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceOverviewPage.tsx`
- Modify: `apps/web/src/features/workspace/WorkspacePages.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `knowledgeApi()` exposes status, clusters/MOCs, search, document read, and global conversation create.
- `sourcesApi()` exposes workspace source/snapshot list and persistent upload.
- UI adds `/knowledge/santexwell`, explicit `/workspaces/:id/sources`, and removes ontology route/tile.

- [ ] **Step 1: Write failing route, portal, source, and permission tests**

Assert global navigation, URL refresh restoration, MOC/search/document states, unavailable vault, persistent upload only for AUTHOR/EDITOR with OWNER/EDIT, flow snapshot list, parsing/failed states, and no `/ontology` product route.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @guideanything/web test -- App.test.tsx WorkspacePages.test.tsx SantexwellKnowledgePage.test.tsx WorkspaceSourcesPage.test.tsx
```

- [ ] **Step 3: Implement API façades and product routes**

Keep JWT private in `ApiClient`; pages receive small injected APIs. Register explicit routes instead of generic `:module`. Use existing sanitized Markdown libraries and workspace tokens.

- [ ] **Step 4: Implement responsive portal and source states**

Provide loading, empty, unavailable, failed, selected, focus, and permission-disabled states. Show indexed revision/time and never render server paths. At 900/760px collapse columns without horizontal blocking overflow.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --filter @guideanything/web test -- App.test.tsx WorkspacePages.test.tsx SantexwellKnowledgePage.test.tsx WorkspaceSourcesPage.test.tsx
pnpm --filter @guideanything/web typecheck
git add apps/web
git commit -m "feat: add santexwell portal and workspace sources"
```

### Task 7: Streaming Agent Conversations, Artifacts, and Safe Reference Navigation

**Files:**
- Create: `apps/web/src/features/agents/useAgentRunStream.ts`
- Create: `apps/web/src/features/agents/useAgentRunStream.test.ts`
- Create: `apps/web/src/features/agents/AgentRunTimeline.tsx`
- Create: `apps/web/src/features/agents/AgentConversationPanel.tsx`
- Create: `apps/web/src/features/agents/AgentConversationPanel.test.tsx`
- Create: `apps/web/src/features/agents/WorkspaceAgentsPage.tsx`
- Create: `apps/web/src/features/artifacts/WorkspaceArtifactsPage.tsx`
- Create: `apps/web/src/features/artifacts/ArtifactViewer.tsx`
- Create: `apps/web/src/features/artifacts/WorkspaceArtifactsPage.test.tsx`
- Create: `apps/web/src/features/references/ReferencePage.tsx`
- Create: `apps/web/src/features/references/ReferencePage.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.tsx`
- Modify: `apps/web/src/features/lesson/LessonPage.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Authenticated fetch-based SSE parser supports arbitrary chunk splits, Last-Event-ID, bounded retry, sequence de-duplication, terminal stop, and AbortController.
- Global portal uses Santexwell-only chat; workspace page exposes all four per-message source switches.
- Reference page consumes backend-provided href/invalid reason and preserves safe `returnTo`.

- [ ] **Step 1: Write failing stream parser and conversation tests**

Test split UTF-8 chunks, multiple events per chunk, duplicate sequence, reconnect, stale plan versions, provisional/committed separation, cancel, steer, conversation URL restoration, and source switches.

```ts
it('never promotes a provisional draft into the committed answer', async () => {
  renderConversation(stream([
    event(1, 'answer.draft.delta', 'PROVISIONAL', { delta: '暂定结论' }),
    event(2, 'answer.committed', 'COMMITTED', { answer: supportedAnswer }),
  ]));
  expect(await screen.findByText('暂定结论')).toHaveClass('agent-draft');
  expect(await screen.findByText(supportedAnswer.conclusion)).toHaveClass('agent-answer-committed');
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @guideanything/web test -- useAgentRunStream.test.ts AgentConversationPanel.test.tsx WorkspaceArtifactsPage.test.tsx ReferencePage.test.tsx LessonPage.test.tsx
```

- [ ] **Step 3: Implement authenticated SSE and chat UI**

Parse streams inside `ApiClient` so Bearer JWT never enters a query string or component. Use `useReducer` for route/plan/tasks/draft/committed state. Page unmount only aborts the viewer stream; Cancel is an explicit POST. `aria-live` announces phase changes and committed answers, not every delta.

- [ ] **Step 4: Implement artifact rendering**

REPORT uses sanitized Markdown. DIAGRAM validates node/edge payload and uses a locked React Flow viewport. FLOW_PROPOSAL is visually distinct and has no apply mutation. REFERENCE_COLLECTION is a list of opaque public references.

- [ ] **Step 5: Implement reference navigation and focused lesson nodes**

The frontend never builds href from locators. Published node href may pass `nodeId` to `LessonPage`; select its lesson step if present, otherwise fit the node and show “未编排为教学步骤”. Missing/unauthorized refs show an invalid state without a fake link.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm --filter @guideanything/web test -- useAgentRunStream.test.ts AgentConversationPanel.test.tsx WorkspaceArtifactsPage.test.tsx ReferencePage.test.tsx LessonPage.test.tsx
pnpm --filter @guideanything/web typecheck
git add apps/web
git commit -m "feat: add streaming agent conversations and artifacts"
```

### Task 8: End-to-end Hardening, Documentation, and Visual QA

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/PROGRESS.md`
- Modify: affected tests and implementation only when a failing acceptance check proves a defect.

**Interfaces:**
- A documented local/server runbook with vault path, bridge token, model roles, indexing, API/web/bridge ports, failure states, and SQLite inspection commands.

- [ ] **Step 1: Run full automated validation**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Record that `pnpm lint` has no package lint scripts if that remains true; do not claim lint coverage from an empty `--if-present` run.

- [ ] **Step 2: Run isolated-stack smoke tests**

Use an independent SQLite file and ports 3002/3012/5175. Verify listeners belong to this worktree before starting/stopping. Run fake-runtime smoke first, then real Bridge health/model discovery and one bounded Santexwell query when Codex authentication is available.

- [ ] **Step 3: Perform local rendered UI inspection**

Inspect 1440×1024 and 390×844, light and dark themes. Cover portal search/read/QA, workspace sources, Direct and Composite streams, reconnect, cancel, steer, citations, artifacts, unavailable vault/bridge, loading/empty/error/focus states, overflow, clipping, and console errors/warnings. This is local product QA only; no external web research is required.

- [ ] **Step 4: Run security and failure probes**

Attempt `../` paths, root symlinks, prompt instructions embedded in documents, invalid model hrefs, disabled Santexwell, cross-workspace IDs, other users' conversation IDs, duplicate client message IDs, invalid Last-Event-ID, stream disconnect, Runtime exit, and malformed final JSON. Confirm no absolute path/token appears in responses or logs.

- [ ] **Step 5: Update durable documentation and operator commands**

Document actual endpoints and verified commands only. Include exact SQLite queries for source status, run route/status, event sequence, citation kind, and artifact kind.

- [ ] **Step 6: Final diff review and commit**

```bash
git status --short
git diff --stat "$(git merge-base main HEAD)"..HEAD
git diff --check "$(git merge-base main HEAD)"..HEAD
git add README.md docs apps packages pnpm-lock.yaml .env.example
git commit -m "docs: document santexwell agent runtime operations"
```

Do not push, create a PR, deploy, merge, or modify production/server configuration without explicit user confirmation.

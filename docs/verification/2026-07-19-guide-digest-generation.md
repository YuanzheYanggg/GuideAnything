# Guide Digest Generation Verification

Date: 2026-07-19  
Branch: `codex/guide-digest-generation`  
Base: `fba5c43`

## Scope

This verification covers the snapshot-first guide digest workflow described in:

- `docs/superpowers/specs/2026-07-19-guide-digest-generation-design.md`
- `docs/superpowers/plans/2026-07-19-guide-digest-generation.md`

The workflow normalizes the saved canvas into an agent-readable snapshot, generates a strictly validated digest proposal through the Runtime Bridge, renders deterministic Markdown, and requires explicit editor review before any summary or tag is applied.

## Deterministic verification

The final branch is verified with:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check fba5c43..HEAD
```

The final run passed 975 tests: contracts 104, canvas-core 93, Runtime Bridge 93, API 403, and Web 282. Type checking and production builds passed for every configured package. Migration tests include fresh databases and upgrades through the renderer-aware v10 digest identity schema.

## Live acceptance

Live acceptance used an isolated worktree and an SQLite backup. Existing main-checkout listeners on Web `5174`, API `3001`, and Runtime Bridge `3010` were identified and left running. The feature stack used Web `5188`, API `3101`, and Runtime Bridge `3110`; Bridge health reported `READY` with every configured role ready.

The acceptance guide was `打样提案流程` (`22c6fb40-62dc-43ab-b037-0742330d060f`). Its saved snapshot contained:

- three business stages and two primary process nodes;
- Markdown, image, and video resources linked to `确认原料`;
- eight image annotations and two video key points;
- a four-step learning path.

Verified outcomes:

1. Opening the digest review did not save the guide or increment its revision.
2. A real `GUIDE_DIGEST` Bridge run produced a `DRAFT` proposal from revision 182 with bundle revision 3, one model attempt, no repair attempt, and a deterministic 4,694-character Markdown rendering.
3. Existing `ERP` and suggested tags were visually distinct. Suggested tags were unchecked by default and displayed category plus human-readable provenance.
4. The proposal exposed summary differences, tag suggestions, information gaps, stages, rules, image annotations, video key points, and traceable source references.
5. Applying only the proposed summary and `客人提案` tag advanced the guide exactly once, from revision 182 to 183. Existing `ERP` was preserved. `accepted_markdown` remained `0`.
6. The canvas document SHA-256 remained `baccdc2834f9da3053d0d73d588e5de49c3da84e796532b138cdbd644f16b485` before and after apply. The selected summary became ordinary guide metadata as intended; digest-only Markdown markers (`guide-digest-v1`, `可追溯引用`, and `图片标注与视频关键点索引`) were absent from all 81 guide knowledge fragments.
7. A second real run for revision 183 completed in 46.16 seconds with one attempt. Editing the ordinary summary then produced one guide `PATCH`, advanced revision to 184, and produced no additional digest-generation request.
8. The open proposal immediately displayed the old-revision warning and disabled every apply control. A guarded apply request returned `409 GUIDE_DIGEST_PROPOSAL_STALE`; persistence changed to `STALE` with audit reason `BASE_REVISION_CHANGED`.
9. The live browser showed pre-existing media authorization console errors caused by initial unauthenticated media element requests; authenticated retries succeeded. No digest UI error remained after the bundle revision 3 validation repair.

## Post-review regression

After the independent review fixes, the isolated API was restarted against the same acceptance backup so migration v10 and the final source were loaded. A fresh real Runtime Bridge run then produced proposal `c761b224-55b5-4c45-94bc-0f3371b62267` for revision 184 with:

- bundle revision 5 and renderer `guide-digest-markdown-v3`;
- one model attempt, no repair attempt, and no resource truncation;
- a deterministic 4,807-character Markdown rendering;
- server-owned missing-entry, missing-exit, and empty-stage gaps;
- authoritative snapshot-derived labels for step, stage, resource, annotation, and key-point provenance.

The request completed with HTTP 201 in 50.11 seconds. The review remained opt-in: the proposed summary, four proposed tags, and Markdown acceptance were all unchecked. Desktop and 600 px layouts were visually inspected. Resizing temporarily moved browser focus outside the dialog; document-level Escape still closed it, and the editor restored focus to the actual `生成指南总览` opener after the inert subtree was removed.

The final code additionally verifies that old bundle or renderer proposals become `STALE` on apply, the complete model-addressable snapshot ID namespace is globally unique, all graph-derived gap claims are server-owned, tag changes made during apply receive a normalized three-way merge, and same-field summary conflicts are explicitly surfaced rather than silently overwritten.

## Evidence boundaries

- Model output is never trusted directly: strict schema, length limits, enum checks, globally unique addressable IDs, semantic source and relation checks, deterministic structural gaps, and duplicate-label checks run before persistence.
- Failed proposals retain only safe failure codes and generation metadata; raw invalid model output is not stored.
- Markdown acceptance is an audit choice only. It does not write Markdown to the canvas, guide summary, tags, or retrieval index.
- Revision, snapshot, bundle, and renderer drift are enforced by the database transaction; known revision drift is also surfaced in the editor before apply.
- The live database and all acceptance mutations were confined to the temporary backup; the main checkout database was not modified.

# Architecture Audit — Per-Round Modified-File List (Workstream 1)

**Date:** 2026-06-16
**Auditor:** audit-then-commit session
**Scope (Rust + type bridge):**

- `src-tauri/crates/session-persistence/src/turn_files.rs` (new)
- `src-tauri/crates/session-persistence/src/turn_index.rs`
- `src-tauri/crates/session-persistence/src/schema.rs`
- `src-tauri/crates/session-persistence/src/lib.rs`
- `src/api/tauri/rpc/schemas/sessionCore.ts` (Zod bridge)
- `src/engines/SessionCore/storage/sqliteCache.ts` (TS interface)

## Acceptance criteria covered

- [x] Compiles (`cargo test -p session_persistence` builds `agent_core` + `session_persistence`)
- [x] turn_files unit tests pass (8), turn_index tests pass (9)
- [x] Type bridge symmetric across Rust ↔ Zod ↔ TS interface
- [x] No duplicate type definitions
- [x] Wire payload inspected (camelCase JSON shape)

## Layer-by-layer

### L1 Compilation

Clean. `cargo test -p session_persistence --lib turn_files` → 8 passed; `--lib turn_index` → 9 passed. No new warnings introduced by the diff.

### L2 Dead code / dedup

`TurnFileAccumulator` exposes both `files(&self) -> &[..]` (used by `rebuild_turn_index_inner` to serialize) and `into_files(self)` (used only by unit tests). `into_files` is test-only today. **keep with reason:** it is a natural owned-drain counterpart to the borrow accessor and is exercised by 7 of the 8 unit tests; not aspirational dead code. No parallel file-extraction path exists elsewhere — `turn_files` is the single materializer.

### L3 Naming

`TurnModifiedFile` (Rust) ↔ `TurnModifiedFile` (TS interface) ↔ `TurnModifiedFileSchema` (Zod) — consistent. `modified_files_json` (DB column) ↔ `modified_files` (Rust field, `#[serde(default)]`) ↔ `modifiedFiles` (camelCase wire) — consistent and documented. No stale names.

### L4 Semantic overloading

"status" here is the file-change status (`created`/`modified`/`deleted`), distinct from `TurnStatus` (`pending`/`completed`/`interrupted`/`failed`). They never mix — `TurnModifiedFile.status` is a separate enum in both the Zod schema and the TS interface. No overloading risk.

### L5 Default branch analysis

- `status_for_function` `_ => STATUS_MODIFIED` — correct: every tool in `is_file_modify_function` that is not delete/create is an edit/patch, so "modified" is the right universal default. A future write tool added to `is_file_modify_function` defaults to "modified", which is the safe/conservative label.
- `serde_json::from_str(...).unwrap_or_else(|_| Vec::new())` on `modified_files_json` read — correct: tolerates legacy/empty rows. `#[serde(default)]` on `modified_files` covers older cached summaries missing the field.

### L6 Cross-domain leakage

`turn_files.rs` depends on `agent_core::tools::names` for the canonical tool-name constants rather than hardcoding strings — good. No session-variant-specific concept leaks into the shared indexer.

### L7 New-developer clarity

Module doc comment states the intent ("不要前端算，写 db") and the read-only-tools exclusion. `merge()` documents "latest event wins for status". Clear.

### L8 Wire protocol

`#[serde(rename_all = "camelCase")]` on `TurnModifiedFile` → emits `{ path, fileName, status, additions, deletions }`. The Zod `TurnModifiedFileSchema` matches exactly, with `status: z.enum(["created","modified","deleted"])` and `modifiedFiles` defaulting to `[]`. `additions`/`deletions` are `u32` → `z.number()`. No extra fields. Symmetric.

### L9 Init parity

`schema.rs` adds the column via `ALTER TABLE session_turns ADD COLUMN modified_files_json TEXT NOT NULL DEFAULT '[]'` wrapped in `.ok()`. **fix candidate (non-blocking):** per anti-pattern #43 ("pre-user schema change disguised as migration"), the canonical `CREATE TABLE session_turns` DDL should carry this column directly rather than an idempotent `ALTER`. Functionally correct today (fresh DB: CREATE without column → ALTER adds it; existing DB: ALTER's duplicate-column error is swallowed by `.ok()`), and the `TURN_INDEX_VERSION` bump 5→6 forces a rebuild so the column is repopulated. Recommend folding the column into the `CREATE TABLE` in a follow-up so the DDL is the single source of truth. Not blocking — both code paths produce the same end state.

### L10 Resolver symmetry

`load_index_rows` now SELECTs `args_json` in addition to `result_json`; all three `IndexEventRow` construction sites (main query, `load_existing_user_event_keys`, test factory) were updated to set `args_json` — symmetric, no missing site. The `rebuild`/`load`/`get_turn_summary` SQL trio all add `modified_files_json` to their column lists consistently (INSERT ?16, SELECT col 14).

## Correctness notes

- `extract_event_files` reads line stats from both top-level (`linesAdded`) and nested `success.linesAdded` — matches the two result shapes the file tools emit (tested by `edit_file_extracts_path_and_line_stats` + `duplicate_path_merges_and_sums`).
- `result_is_error` cheaply guards `Error`-prefixed outputs (tested). Malformed JSON tolerated (tested).
- `saturating_add` on line stats prevents overflow on pathological repeated edits.

## Summary

- 0 blocking issues
- 1 fix candidate (L9: prefer canonical CREATE TABLE over idempotent ALTER — anti-pattern #43)
- 1 keep-with-reason (L2: `into_files` test-only but legitimate)

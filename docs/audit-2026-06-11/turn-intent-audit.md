# turn_intent audit — 2026-06-11

**Scope:** commits `988645ed..fc01bea7` + `92174462` introducing a canonical user-intent lifecycle id (`turn_intent_id`) propagated through DB store → BE pipeline → FE dispatch → turn indexer.

**Files touched (1-line index)**

| Layer       | File                                                                  | Role                                                 |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| DB          | `src-tauri/crates/session-persistence/src/turn_intents.rs`            | New canonical lifecycle store + FSM whitelist        |
| DB          | `src-tauri/crates/session-persistence/src/schema.rs`                  | Table DDL (`session_turn_intents`)                   |
| DB          | `src-tauri/crates/session-persistence/src/turn_index.rs`              | Indexer consumes lifecycle rows for round collapse   |
| DB          | `src-tauri/crates/session-persistence/src/agent_core_bridge.rs`       | IoC adapters wiring agent-core ↔ session-persistence |
| BE bridge   | `src-tauri/crates/agent-core/src/foundation/session_bridge.rs`        | IoC slots, bridge enums                              |
| BE pipeline | `src-tauri/crates/agent-core/src/state/commands/session/message.rs`   | `send_message_impl` upserts at `Queued`              |
| BE pipeline | `src-tauri/crates/agent-core/src/state/commands/session/mod.rs`       | Tauri command arg shape                              |
| BE pipeline | `src-tauri/crates/agent-core/src/core/session/scheduler.rs`           | Transitions `Queued`→`Running`→terminal              |
| BE pipeline | `src-tauri/crates/agent-core/src/core/session/wingman/loop_runner.rs` | Wingman caller of `upsert_turn_intent`               |
| BE pipeline | `src-tauri/crates/agent-core/src/core/session/turn/processor/mod.rs`  | Mints `transcript_intent_id` (inbox path)            |
| FE          | `src/engines/SessionCore/sync/adapters/shared/eventFactories.ts`      | `mintTurnIntentId()`                                 |
| FE          | `src/engines/SessionCore/sync/adapters/createRustAgentAdapter.ts`     | Threads id to Rust adapter                           |
| FE          | `src/engines/SessionCore/services/types.ts` + `SessionService.ts`     | Service layer threads id                             |
| FE          | `src/engines/ChatPanel/hooks/useWorkspaceChat/useWorkspaceChat.ts`    | Submit boundary mints id                             |
| FE          | `src/engines/ChatPanel/hooks/useWorkspaceChat/useMessageDispatch.ts`  | Direct dispatch threads id                           |
| FE          | `src/engines/SessionCore/hooks/session/useQueueDispatch.ts`           | Queue + Force Send carry-id                          |
| FE          | `src/engines/ChatPanel/events/interactive_events/next-step/index.tsx` | Next-step interactive button mints id                |
| FE          | `src/store/ui/messageQueueAtom.ts`                                    | Dedupe-by-turnIntentId                               |

---

## Term-usage table

| Term             | Where                                                                           | Meaning                                | Verdict                                                                                   |
| ---------------- | ------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `turn_intent_id` | Rust + SQL + JSON body                                                          | canonical id minted at submit boundary | unique, no collision                                                                      |
| `turnIntentId`   | FE TypeScript + Tauri arg + persisted `result_json`                             | same value, camelCase wire shape       | unique, no collision                                                                      |
| `intent_id`      | nowhere                                                                         | —                                      | clean                                                                                     |
| `Source::*`      | enum variants `UserSubmit/Queue/ForceSend/Resume/AgentOrg/Wingman/MobileRemote` | origin classification                  | **5 of 7 unused** (see TI-HIGH-1)                                                         |
| `Status::*`      | 8 variants including `Optimistic`, `Cancelled`, `Superseded`                    | FSM phase                              | **`Optimistic`, `Cancelled`, `Superseded` unproduced** (TI-CRIT-1 + TI-HIGH-2 + TI-MED-5) |

---

## Entry-point × turn_intent_id matrix

Rows = code paths that can start a turn. Columns: "mint new id?" / "thread caller id?" / "upsert lifecycle row?".

| Entry point                                        | mint?              | thread?                                         | upsert?                    | source written                            |
| -------------------------------------------------- | ------------------ | ----------------------------------------------- | -------------------------- | ----------------------------------------- |
| ChatPanel direct submit (`useWorkspaceChat:250`)   | ✅ FE              | → wire                                          | ✅ via `send_message_impl` | `UserSubmit` ✅                           |
| Queue normal flush (`useQueueDispatch:213`)        | ✅ FE              | → wire                                          | ✅                         | `UserSubmit` ⚠ (should be `Queue`)        |
| Force Send (`useQueueDispatch:234`)                | ⚠ reuses queued id | → wire                                          | ✅                         | `UserSubmit` ⚠ (should be `ForceSend`)    |
| Next-step interactive (`next-step:234`)            | ✅ FE              | → wire                                          | ✅                         | `UserSubmit` ⚠                            |
| Wingman inner loop (`loop_runner.rs:243`)          | BE                 | uses msg.turn_intent_id                         | ✅                         | `Wingman` ✅                              |
| Wake / inbox auto-resume (`message.rs:108`)        | ❌ FE              | BE fallback at `:146` mints                     | ✅                         | `UserSubmit` ⚠ (should be `Resume`)       |
| Mobile remote (`SessionDetail.tsx:326`)            | ❌ FE              | BE fallback at `:146` mints                     | ✅                         | `UserSubmit` ⚠ (should be `MobileRemote`) |
| Test debug endpoint (`api/agent/test/core.rs:178`) | ❌                 | calls `process_message` not `send_message_impl` | **❌**                     | —                                         |
| Inbox transcript replay (`processor/mod.rs:586`)   | mints local        | not threaded to bridge                          | **❌**                     | —                                         |

The 5 ⚠ rows mean lifecycle rows exist but the `source` column is fiction. The 2 **❌** rows mean a `user_message` event lands with a `turnIntentId` set but **no row in `session_turn_intents`** — so the indexer's `intent_status_overlay` silently falls back to the legacy `body_event_count > 0` heuristic.

---

## Findings

### TI-CRIT-1 — `mark_superseded` is dead code; entire Superseded branch unwired

- **Severity:** Critical (design contract broken, no behaviour bug yet because the path is unreachable)
- **Anti-pattern:** #29 (grep-alive ≠ alive), #5 (dead FSM branch promised in module doc)
- **Location:** `src-tauri/crates/session-persistence/src/turn_intents.rs:332-365` (the function), `:115-117` (the `Superseded` variant), `:176` (the `superseded_by` field), `:213-215` (transition_allowed entry), `schema.rs:139` (column).
- **Issue:** The module doc at `turn_intents.rs:30-31` claims:
  > "Stop / Send-Now-on-restored-draft mark the previous intent superseded with `superseded_by` pointing at the replacement."
  > Grep for callers: `mark_superseded` is referenced **only** inside its own file (definition + 2 tests). No bridge slot is registered in `session_bridge.rs`; no IoC adapter exists in `agent_core_bridge.rs`. The whole supersede path is impossible to reach from production code. The 5 transition arms in `transition_allowed` mentioning `Superseded` (lines 213, 215) are dead. The `superseded_by` column will always be NULL.
- **Suggestion:** Either (a) wire the supersede path — likely from `consumeRestoredStopDraft` in `useWorkspaceChat.ts:262` carrying the replacing `turnIntentId` through to BE and `send_message_impl` calling `mark_superseded(old_id, new_id)` — or (b) delete `mark_superseded` + the `Superseded` variant + the `superseded_by` column + the 4 transition arms + tests. Don't leave a half-built supersede mechanism in the public API.

### TI-HIGH-1 — Every production caller hard-codes `Source::UserSubmit`

- **Severity:** High
- **Anti-pattern:** #5 (hidden default), #29 (5 unproduced enum variants)
- **Location:** `state/commands/session/message.rs:441` (direct submit), `:146` (server-side fallback for `send_message_impl_for_wake` / `send_message_impl_for_mobile_remote` / `send_message_impl_for_test`).
- **Issue:** `send_message_impl` does not accept a source parameter. Every Tauri-driven submit becomes `TurnIntentBridgeSource::UserSubmit` regardless of whether it came from FE direct submit, FE queue flush, FE force-send, FE next-step, mobile remote (BE fallback), wake hook (BE fallback), or test endpoint (BE fallback). 5 of the 7 enum variants — `Queue`, `ForceSend`, `Resume`, `AgentOrg`, `MobileRemote` — have **zero producers**. The lifecycle telemetry that the new table was supposed to support is fiction.
- **Suggestion:** Thread `source: TurnIntentBridgeSource` into `send_message_impl` as a required parameter; callers pass the correct discriminant. `send_message_impl_for_mobile_remote` → `MobileRemote`. `send_message_impl_for_wake` → `Resume`. Future FE work threads `Queue` / `ForceSend` from `useQueueDispatch.ts` — a new optional Tauri arg `turnIntentSource: Option<String>` (camelCase per existing convention) plus FE plumbing. Until that lands, BE callers should at minimum pass the correct fallback source.

### TI-HIGH-2 — Scheduler conflates Cancelled and Failed

- **Severity:** High
- **Anti-pattern:** #50 (cancel semantics drift)
- **Location:** `src-tauri/crates/agent-core/src/core/session/scheduler.rs:420`, `:438`.
- **Issue:** `TurnIntentStatus::Cancelled` is part of the FSM whitelist (terminal, distinct from `Failed`) and the indexer's `intent_status_overlay` reads them as distinct values. But the scheduler's terminal-handler branches do not split user-cancel (from `cancel_flag`) from execution-failure (provider/exec error) — both paths write `Failed`. As a result, no row in `session_turn_intents` will ever hold `status = 'cancelled'`. The user-visible round-collapse view cannot distinguish "I pressed Stop" from "the LLM call errored".
- **Suggestion:** In the scheduler's terminal handler, branch on whether the cancel_flag fired before the provider returned (or on whether the error came from `TurnInterrupted`/equivalent cancellation marker) and call `update_turn_intent_status(.., Cancelled)` in that case; reserve `Failed` for genuine errors.

### TI-HIGH-3 — Inbox-transcript path persists `user_message` with `turnIntentId` but no lifecycle row

- **Severity:** High
- **Anti-pattern:** #29 (event without backing DB row), Layer 9 init parity gap
- **Location:** `src-tauri/crates/agent-core/src/core/session/turn/processor/mod.rs:586-602`.
- **Issue:** A fresh `transcript_intent_id` is minted locally and baked into the persisted `user_message.result_json.turnIntentId`, but `session_bridge::upsert_turn_intent(…)` is never called. When `turn_index.rs:153-172` (`load_stale_intent_ids` + `load_intent_status_overlay`) is queried later, this inbox transcript intent has no row, so the indexer silently falls back to the legacy `body_event_count > 0` heuristic for this turn alone.
- **Suggestion:** After minting `transcript_intent_id`, immediately call `crate::foundation::session_bridge::upsert_turn_intent(&session_id, &transcript_intent_id, None, TurnIntentBridgeSource::AgentOrg, TurnIntentBridgeStatus::Running)`. If the surrounding context can already error before the upsert, scope it as fire-and-forget with a warn-log on failure (same pattern as `agent_core_bridge.rs:78-82`).

### TI-HIGH-4 — Empty `turn_intent_id` reaching the store is silently accepted

- **Severity:** High
- **Anti-pattern:** #5 (silent skip), #51-#54 (no warning)
- **Location:** `agent_core_bridge.rs:68-82` (`upsert_turn_intent_adapter`), `turn_intents.rs:255-292` (`upsert_initial`).
- **Issue:** `upsert_initial` writes whatever `turn_intent_id` it receives. There's no `.is_empty()` check. If a caller threads an empty string (e.g. an FE bug where `mintTurnIntentId()` returns `""`, or a Tauri arg that comes through as `Some("")` instead of `None`), the row is inserted with PRIMARY KEY `(session_id, "")` and every subsequent submit with an empty id will be deduped onto the same row. The bridge slot at `session_bridge.rs:393` has no warn-log on this path either.
- **Suggestion:** At the bridge entry (`session_bridge.rs:upsert_turn_intent` and `update_turn_intent_status`), early-return with `tracing::warn!("upsert_turn_intent called with empty turn_intent_id; ignoring")` when `turn_intent_id.is_empty()`. Alternatively, use a newtype `TurnIntentId(String)` whose constructor rejects empty strings; this is the safer fix but a wider refactor.

### TI-HIGH-5 — `row_from_sql` silently coerces unknown source values to `UserSubmit`

- **Severity:** High (down-graded from Critical because table is write-controlled)
- **Anti-pattern:** #5 (hidden default), Layer 5
- **Location:** `turn_intents.rs:229`.
- **Issue:** `TurnIntentSource::parse(&source_str).unwrap_or(TurnIntentSource::UserSubmit)`. If a future commit adds a new variant and an older binary reads a row written by a newer binary (or any data corruption), the source silently becomes `UserSubmit`. Compare to line 230, where unknown `status` correctly returns an `Err` and refuses to deserialise the row.
- **Suggestion:** Change to symmetric error handling: `let source = TurnIntentSource::parse(&source_str).ok_or_else(|| rusqlite::Error::FromSqlConversionFailure(3, Type::Text, format!("unknown turn_intents.source value: {source_str}").into()))?;` — mirrors the `status` parsing one line below. Downgrade vs status would be a deliberate Layer-5 violation.

### TI-MED-1 — Test/debug endpoints bypass lifecycle row

- **Severity:** Medium
- **Anti-pattern:** Layer 9 init parity, #44 (helper endpoint side-effecting via different code path)
- **Location:** `src-tauri/src/api/agent/test/core.rs:178` and `process_message` callers that don't go through `send_message_impl`.
- **Issue:** Test endpoints call `process_message` directly without the `send_message_impl` wrapper that calls `upsert_turn_intent(Queued)`. Same risk as TI-HIGH-3: persisted event has `turnIntentId` but no lifecycle row.
- **Suggestion:** Either (a) route through `send_message_impl_for_test`, or (b) add explicit `upsert_turn_intent` at every test endpoint with source `UserSubmit` (acceptable since these are test paths, but document).

### TI-MED-2 — BE-side fallback mint at `message.rs:146` is asymmetric

- **Severity:** Medium
- **Anti-pattern:** Layer 10 (resolver asymmetry)
- **Location:** `state/commands/session/message.rs:145-146`.
- **Issue:** FE _always_ mints; BE _sometimes_ mints (when caller didn't pass). The mixed-responsibility resolver makes it hard to reason about uniqueness guarantees. If both FE and a future legacy BE caller mint, there's no contract preventing dupes.
- **Suggestion:** Either make the Tauri arg required and remove the BE fallback (forces every caller to mint), or document the resolver chain in the rustdoc on `send_message_impl` and add a `tracing::warn!` on the fallback so any production hit shows in logs.

### TI-MED-3 — FE Stop pre-accept race: a fresh submit can land before `invalidate_pending` walks

- **Severity:** Medium
- **Anti-pattern:** #48 (generation counter / FSM race)
- **Location:** scheduler's `invalidate_pending` at `scheduler.rs:294` + FE submit boundary `useWorkspaceChat.ts:268-280`.
- **Issue:** Between FE pressing Stop and BE walking `invalidate_pending` to mark all queued rows stale, a queued submit can race in and be `update_status(Running)` before its row is staled. Since rows already have generation-checked queue logic, this race is bounded — but it isn't tested.
- **Suggestion:** Add a regression test that simulates a Stop concurrent with a queued submit and asserts the queued row ends up `Stale`, not `Running`.

### TI-MED-4 — `unwrap_or_default()` in indexer hides DB-read failures

- **Severity:** Medium
- **Anti-pattern:** #5 (hidden default; failure mode is silent and produces wrong UI)
- **Location:** `turn_index.rs:161` (`load_stale_intent_ids`) and `:171` (`load_intent_status_overlay`).
- **Issue:** If the SQL read fails, the indexer returns an empty set / map. Result: stale rows are treated as not-stale, and the overlay is empty so the legacy `body_event_count` heuristic runs. The user sees rounds the indexer should have collapsed.
- **Suggestion:** Replace `unwrap_or_default()` with a `match` that logs at `warn!` and returns the empty fallback explicitly — at least observable in logs. Same pattern as `agent_core_bridge.rs:78-82` already uses.

### TI-MED-5 — `Optimistic` status declared but unproduced

- **Severity:** Medium (consistent with TI-CRIT-1 but lower because it's an FSM entry-state and the FE could legitimately want it later)
- **Anti-pattern:** #29
- **Location:** `turn_intents.rs:94-100` (variant), `:204-205, :212-213` (transitions out).
- **Issue:** Doc says "Frontend has minted and rendered the optimistic row but the backend has not yet accepted enqueue". No production code path writes `Optimistic`. Every FE submit already produces a row directly at `Queued` via `send_message_impl`. The "optimistic" slot exists for a future FE-first write path that hasn't been built.
- **Suggestion:** Either build the FE-first write path (FE calls a new Tauri command `mark_turn_intent_optimistic` immediately on render, then `send_message_impl` upserts to `Queued`) or remove the variant + the 4 transitions + the doc. Same call as TI-CRIT-1.

### TI-LOW-1 — `mark_superseded` test only exercises Queued→Superseded

- Coverage gap; if Critical-1 is wired, expand tests.

### TI-LOW-2 — see TI-HIGH-5 (duplicate severity entry, treat as same finding).

### TI-LOW-3 — Bridge slot doesn't warn when unwired

- **Location:** `session_bridge.rs:380-388`. `register_*` are silent no-ops if a registration is missed at startup. Add a `tracing::error!` if a bridge slot is called before registration.

---

## Anti-patterns swept

| #                          | Anti-pattern                            | Scope-relevant?                                                              | Result                                                                                                                           |
| -------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| #5                         | Default-branch papers over inputs       | yes                                                                          | 3 found (TI-HIGH-1, TI-HIGH-4, TI-HIGH-5)                                                                                        |
| #29                        | grep-alive ≠ alive                      | yes                                                                          | 2 found (TI-CRIT-1, TI-MED-5; also implicit in TI-HIGH-1's 5 unused enum variants)                                               |
| #30                        | Naming collision                        | yes                                                                          | clean — no other `turn_intent` / `TurnIntent*` symbol elsewhere                                                                  |
| #47                        | FSM duplication                         | yes                                                                          | clean — lifecycle FSM (lifecycle.rs equivalent in turn_intents.rs) is separate from in-memory `turnLifecycle.ts` FSM, no overlap |
| #48                        | Generation counter not aligned with FSM | yes                                                                          | mostly clean (TI-MED-3 residual race)                                                                                            |
| #50                        | Cancel semantics drift                  | yes                                                                          | 1 found (TI-HIGH-2)                                                                                                              |
| #51-#54                    | Silent skip / no warning                | yes                                                                          | 1 found (TI-HIGH-4) + LOW-3                                                                                                      |
| Layer 3 naming             | yes                                     | clean — `turn_intent_id`/`turnIntentId` consistent across boundary           |
| Layer 4 semantic overload  | yes                                     | clean — disambiguated against `message_id` / `turn_id` (scheduler.rs:63 doc) |
| Layer 8 wire protocol      | yes                                     | clean — JSON shape matches FE↔BE                                             |
| Layer 9 init parity        | yes                                     | gaps at TI-HIGH-3, TI-MED-1, TI-MED-3                                        |
| Layer 10 resolver symmetry | yes                                     | asymmetric (TI-MED-2)                                                        |

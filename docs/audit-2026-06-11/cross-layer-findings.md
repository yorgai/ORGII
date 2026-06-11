# Cross-layer findings — 2026-06-11

Issues that span both hot topics (turn_intent + agent-defs) or sit at the FE↔BE boundary.

---

## XL-MED-1 — Tauri command arg shape mixes snake_case and camelCase

- **Severity:** Medium (pre-existing — not introduced by this commit range, but turn_intent extends it)
- **Anti-pattern:** Layer 3 + Layer 8 (wire shape inconsistency)
- **Location:** `src-tauri/crates/agent-core/src/state/commands/session/mod.rs:163-180`.
- **Issue:** `agent_send_message` accepts both `session_id`, `account_id`, `workspace_path`, `ide_context` (snake_case) and `#[allow(non_snake_case)] displayText`, `isResume`, `clientMessageId`, `turnIntentId` (camelCase). The mixed convention means FE callers must remember which params are which case. Tauri's default IPC layer auto-converts snake_case Rust ↔ camelCase JS, but the explicit camelCase forced via `#[allow(non_snake_case)]` bypasses that. New `turnIntentId` arg (added in 48c32db7) silently picked the camelCase side, perpetuating the inconsistency.
- **Suggestion:** Pick one. Tauri convention is snake_case in Rust + camelCase auto-conversion. Remove the `#[allow(non_snake_case)]` arms (`displayText` → `display_text`, `isResume` → `is_resume`, `clientMessageId` → `client_message_id`, `turnIntentId` → `turn_intent_id`) and let Tauri's auto-conversion handle the wire shape. FE callsites stay the same (they're already camelCase). One-pass migration in `agent_send_message` + grep for any FE callers passing the literal Rust names (there shouldn't be any).

## XL-LOW-1 — `event_pipeline/agent_core_bridge.rs:151` adds `turn_intent_id` extraction

- **Severity:** Low (informational; verified clean)
- **Location:** `src-tauri/src/agent_sessions/event_pipeline/agent_core_bridge.rs:151,167`.
- **Issue:** Event pipeline reads `turn_intent_id` from event metadata and persists it into the `user_message` `result_json.turnIntentId`. Wire shape correct (camelCase in JSON).
- **Verification:** This is the FE-readable surface. Turn indexer at `turn_index.rs:129` reads back through this same field name. End-to-end consistency: ✅.

## XL-LOW-2 — `useAgentDefinitions.ts` event hook doesn't unsubscribe on session change

- **Severity:** Low
- **Anti-pattern:** lifecycle hygiene
- **Location:** `src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions.ts:57`.
- **Issue:** The new `orgii-agent-defs-changed` Tauri event listener is wired in a `useEffect`. The cleanup function unsubscribes on unmount, which is correct, but the dependencies array is `[]`, so the subscription persists across the lifetime of the host component. If the host re-mounts often (route change), a brief double-subscribe window can fire 2× re-syncs on a single change event.
- **Suggestion:** Verify cleanup runs synchronously before re-mount. If not, debounce the re-sync. Cosmetic, not a correctness bug.

---

## Naming-collision sweep

Pulled symbol names against the codebase for collisions in this commit range.

| Name                                     | Modules                                                             | Result                                                 |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `TurnIntent*`                            | only `session-persistence` + `agent-core/foundation/session_bridge` | clean                                                  |
| `Store`                                  | `AgentOrgsStore`, `IntegrationsStore`, generic test `Store`         | name shared, no semantic collision in hot paths        |
| `Definition`                             | `AgentDefinition`, `OrgDefinition`                                  | distinct domains, OK                                   |
| `disabled_skills`                        | new field in `IntegrationsConfig`                                   | unique; should rename to `excluded_skills` (AD-HIGH-1) |
| `excluded_tools`                         | `AgentDefinition.tools.user_excluded_tools`                         | recent rename, consistent with style                   |
| `overlay`, `delta`, `override`           | `store.rs` mixed                                                    | 3-way inconsistency, see AD-MED-1                      |
| `mark_pending_stale` / `mark_superseded` | `turn_intents.rs`                                                   | unique; latter is **dead** (TI-CRIT-1)                 |
| `mintTurnIntentId`                       | FE-only                                                             | unique                                                 |
| `transcript_intent_id`                   | `processor/mod.rs` local var                                        | shadows `turn_intent_id` semantics — TI-HIGH-3         |

No critical collisions. The three soft smells (`Store`, `Definition`, overlay/delta/override) are documented above.

---

## Layer-9 init parity matrix (consolidated)

Every entry point that starts a turn × init steps it performs.

| Entry point                                             | Resolves session identity? | Upserts `Queued` row?      | Mints `turn_intent_id`? | Source written        |
| ------------------------------------------------------- | -------------------------- | -------------------------- | ----------------------- | --------------------- |
| `agent_send_message` (Tauri)                            | ✅                         | ✅ at `:441`               | FE mints OR BE fallback | always `UserSubmit` ⚠ |
| `send_message_impl_for_wake`                            | ✅ (uses session defaults) | ✅                         | BE fallback at `:146`   | `UserSubmit` ⚠        |
| `send_message_impl_for_mobile_remote`                   | ✅ (defaults)              | ✅                         | BE fallback at `:146`   | `UserSubmit` ⚠        |
| `send_message_impl_for_test` (debug)                    | ✅                         | ✅                         | BE fallback             | `UserSubmit` ⚠        |
| Wingman inner loop                                      | ✅ via runtime             | ✅ at `loop_runner.rs:243` | uses msg.turn_intent_id | `Wingman` ✅          |
| Inbox-transcript replay (`processor/mod.rs:586`)        | already in session         | ❌ no upsert               | mints locally           | (no row) ❌           |
| Test `/agent/test/core.rs:178` (process_message direct) | partial                    | ❌ no upsert               | depends on caller       | (no row) ❌           |

5 ⚠ rows + 2 ❌ rows. All called out in `turn-intent-audit.md`:

- 5 ⚠ → TI-HIGH-1
- 2 ❌ → TI-HIGH-3 / TI-MED-1

---

## Coordination notes for the next agent

- **Don't fix OPEN bugs from workspace memory in this PR cluster.** `workspace_workstation_toggle_right_blank`, `workspace_sessionreplay_file_blank`, `workspace_mode_switch_clears_draft` all have live TEMP DIAG logs waiting on user repro. Leave them alone (per `feedback_stop_speculating_add_diagnostic`).
- **Local working-tree edits to `src-tauri/src/lib.rs` + `src-tauri/tauri.conf.json`** are dev-local (signing identity, file-history prune robustness) and should not be committed as part of any audit-driven PR.
- **Memory-update suggestions** (for `~/.orgii/workspace-memory` after the next session):
  - Add `workspace_turn_intent_lifecycle.md` documenting the 7-source / 8-status FSM + bridge slots, with the 5-unused-source caveat until TI-HIGH-1 is fixed.
  - Update `workspace_force_send_queue_dispatch.md` to mention that Force Send now carries the same `turnIntentId` as the parked queue row (verified at `useQueueDispatch.ts:234`).
  - Update `workspace_two_agent_execution_paths.md` (CLI fork vs builtin turn_executor) to note the new lifecycle row writes through `session_bridge` IoC and is shared across both paths.

# Architecture Audit — 2026-06-11 (hot-topic scope)

**Scope:** the two upstream commit clusters that landed in `80fa4b3f..d5604460` (27 commits total) most likely to introduce FSM / split-brain / ownership bugs:

1. **`turn_intent` chain** — new canonical user-intent lifecycle id threaded through DB store, BE pipeline, FE dispatch, turn indexer (`988645ed..fc01bea7`, plus `92174462`).
2. **`agent-defs` refactor cluster** — dead-field deletion, singleton store, delta overlays, tools/config/MCP ownership (`c7b371bd`, `d79449a9`, `f155925c`, `dca01558`, `d08b3edf`).

Out-of-scope (table-checked only): turn_intent E2E rewires, ade-manager squash, routines scheduler, openai-compat think-channel, miscellaneous fixes. Per user request — only the two hot topics get the full 10-layer treatment.

**Method:** ORGII workspace skill `architecture-audit` (10 layers + anti-patterns #1–#54). 2 parallel `builtin:explore` subagents ran the layer sweeps in parallel; main context did the FSM / lifecycle / wire-protocol cross-checks.

**Source-code state at audit-start:** clean HEAD = `d5604460` after `git pull --rebase`. Local working tree had only `src-tauri/src/lib.rs` + `src-tauri/tauri.conf.json` modifications and the new `docs/audit-2026-06-11/` directory; explicitly **out of audit scope** (local dev config).

---

## Verification status (Layer 1)

| Check                                              | Result                                    |
| -------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `cargo check --workspace --all-targets`            | ✅ zero errors, zero warnings (2m 08s)    |
| `pnpm exec tsc --noEmit` filtered to changed files | ✅ zero new errors                        |
| `pnpm exec tsc --noEmit` repo-wide                 | ⚠ pre-existing baseline only (RefObject<… | null> + DispatchCategory in sessionImportExport.ts) — see workspace memory `tsc_noemit_preexisting_noise.md` |

---

## Top-5 immediate priorities (ranked by blast radius)

| #   | Finding                                                                                                                        | Why now                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **TI-HIGH-1**: every `send_message_impl` call site hard-codes `TurnIntentBridgeSource::UserSubmit` regardless of actual origin | 5 of 7 source enum variants (`Queue`, `ForceSend`, `Resume`, `AgentOrg`, `MobileRemote`) **have zero producers**. Lifecycle telemetry is fiction. Cheap fix: thread the source through `send_message_impl`.                                  |
| 2   | **TI-HIGH-2**: scheduler conflates Cancelled and Failed at `scheduler.rs:420/438`                                              | `TurnIntentStatus::Cancelled` is part of the FSM whitelist and consumed by the indexer overlay, but the scheduler always writes `Failed` on a cancel-flag terminal. User-cancelled vs error-failed are indistinguishable in the round index. |
| 3   | **TI-CRIT-1**: `mark_superseded` is dead code                                                                                  | No bridge slot, no IoC registration, no production caller. Module doc (`turn_intents.rs:30`) promises "Stop / Send-Now-on-restored-draft mark the previous intent superseded" — promised path was never wired.                               |
| 4   | **AD-HIGH-1**: `disabled_skills` field name says mechanism, not intent                                                         | Anti-pattern #21–#23. Should be `excluded_skills` to match the recently-renamed `excluded_tools`. Soft smell, pure rename, mechanical PR.                                                                                                    |
| 5   | **AD-HIGH-2**: in-memory store and on-disk delta have asymmetric write shape                                                   | `update_with_overlay` writes wholesale into the in-memory entry, then `delta_against_builtin` re-derives per-top-level-field. Composition rule is not symmetric across field types (see `cross-layer-findings.md` AD-MED-2).                 |

Three are 1-PR-each "cheap, mechanical, low-risk" fixes; #2 and #5 need real review.

---

## Findings count

|             | Critical | High  | Medium | Low    |
| ----------- | -------- | ----- | ------ | ------ |
| turn_intent | **1**    | 4     | 3      | 3      |
| agent-defs  | 0        | **2** | 5      | 8      |
| **Total**   | **1**    | **6** | **8**  | **11** |

The single Critical is dead-code (no behaviour bug today, but the design contract is broken). The 6 High findings are real semantic bugs or contracts that are silently violated.

---

## Sub-reports

| File                                                 | Subject                                                                  | Subagent                          | Severity tally    |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------- | ----------------- |
| [turn-intent-audit.md](./turn-intent-audit.md)       | New canonical user-intent lifecycle id end-to-end                        | builtin:explore #1 + main context | 1C / 4H / 3M / 3L |
| [agent-defs-audit.md](./agent-defs-audit.md)         | Definitions/orgs singleton + delta overlays + tools/skills/MCP ownership | builtin:explore #2                | 0C / 2H / 5M / 8L |
| [cross-layer-findings.md](./cross-layer-findings.md) | Shared / cross-cutting issues, naming-collision sweep, AC checklist      | main context                      | —                 |

---

## Acceptance Criteria — "30-item verifiable checklist"

Tick each when its claim is verified against current code. Anchors cite `file:line` so the next agent can re-validate.

### turn_intent — lifecycle & wire (AC1–AC18)

- [ ] **AC1** — FE submits at 3 boundaries (`useWorkspaceChat:250`, `useQueueDispatch:213/234`, `next-step/index.tsx:234`) all use `mintTurnIntentId()`. (TI-OK)
- [ ] **AC2** — Tauri command arg shape preserved: `agent_send_message(..., turnIntentId: Option<String>)` at `state/commands/session/mod.rs:178`, camelCase. (TI-OK; pre-existing Layer 3 inconsistency, not a regression.)
- [ ] **AC3** — Every `send_message_impl` call site passes a `TurnIntentBridgeSource` matching origin (no hard-coded `UserSubmit`). **(blocked by TI-HIGH-1)**
- [ ] **AC4** — `Queue`, `ForceSend`, `Resume`, `AgentOrg`, `MobileRemote` enum variants each have ≥ 1 producer call site. **(blocked by TI-HIGH-1)**
- [ ] **AC5** — `mobile-pwa/src/SessionDetail.tsx:326` either passes a minted `turn_intent_id` or the BE-side mobile dispatch path mints with `MobileRemote` source. **(blocked by TI-HIGH-1)**
- [ ] **AC6** — Scheduler distinguishes Cancelled (cancel_flag fired) from Failed (provider/exec error) at `scheduler.rs:420` and `:438`. **(blocked by TI-HIGH-2)**
- [ ] **AC7** — `mark_superseded` either has ≥ 1 production caller or is deleted along with the `Superseded` enum branch + `superseded_by` column. **(blocked by TI-CRIT-1)**
- [ ] **AC8** — Inbox-transcript path in `turn/processor/mod.rs:586` calls `upsert_turn_intent(..., AgentOrg, Running)` before persisting the `user_message` event. **(blocked by TI-HIGH-3)**
- [ ] **AC9** — Empty-string `turn_intent_id` reaching `upsert_turn_intent` / `update_turn_intent_status` emits a `tracing::warn!` (or is statically impossible via newtype). **(blocked by TI-HIGH-4)**
- [ ] **AC10** — Force Send carries the SAME `turn_intent_id` as the parked queue row (FE: `useQueueDispatch.ts:234`). (TI-OK; covered by E2E pin `agentQueuedControlScenarios.mjs:1600`.)
- [ ] **AC11** — `invalidate_pending` walks every `Optimistic | Queued` row → `Stale` and is wired to scheduler generation bump. (TI-OK; `scheduler.rs:294`.)
- [ ] **AC12** — `transition_allowed` whitelist (`turn_intents.rs:197-220`) rejects every backward walk from a terminal. (TI-OK; tested.)
- [ ] **AC13** — `row_from_sql` (`turn_intents.rs:229`) — unknown `source` no longer silently coerces to `UserSubmit`. **(blocked by TI-LOW-2)**
- [ ] **AC14** — `load_stale_intent_ids` (`turn_index.rs:161`) and `load_intent_status_overlay` (`:164`) replace `unwrap_or_default()` with an explicit error branch. **(blocked by TI-MED-4)**
- [ ] **AC15** — Indexer overlay distinguishes `Completed` / `Failed` / `Cancelled` (currently the last two collapse). **(blocked by TI-HIGH-2 + indexer overlay logic.)**
- [ ] **AC16** — Indexer `rebuild_turn_index` is idempotent against legacy DBs missing the table (covered at `turn_index.rs:510-516`). (TI-OK.)
- [ ] **AC17** — Wire field `turnIntentId` consistent across FE service (`services/types.ts:98`), adapter (`sync/types.ts:153`), adapter→Rust (`createRustAgentAdapter.ts:579`), persisted `user_message.result_json.turnIntentId`. (TI-OK.)
- [ ] **AC18** — FE dedupe-by-turnIntentId is enforced in `enqueueMessageAtom` (`messageQueueAtom.ts:116-122`). (TI-OK; content-fallback branch is now reachable only on legacy in-flight queue items.)

### agent-defs — singleton, delta, ownership (AC19–AC30)

- [ ] **AC19** — Singleton `definitions_store()` is the only handle used by all entry points (Tauri commands, gateway, debug endpoints, offline subsystems). (AD-OK; verified.)
- [ ] **AC20** — Single write chokepoint: every mutation goes through `insert / replace / remove` (`store.rs:227, 265, 284, 309, 335, 362`). (AD-OK.)
- [ ] **AC21** — `orgii-agent-defs-changed` event fires AFTER successful persist on every mutation (anti-#2 check). (AD-OK.)
- [ ] **AC22** — Builtin delta overlay round-trips: snapshot → delta-against-builtin → compose-from-delta-and-builtin is identity for every builtin agent (5 new tests added). (AD-OK.)
- [ ] **AC23** — Field-level delta granularity for compound fields (`tools`, `system_prompt`, `rosters`). **(blocked by AD-HIGH-2 / AD-MED-2; `tools` is wholesale today.)**
- [ ] **AC24** — Explicit `null` in stored delta means "user cleared the field" (composition uses None vs Some(null) distinction). (AD-OK in current draft; needs invariant doc.)
- [ ] **AC25** — Field name `disabled_skills` → `excluded_skills` (anti-pattern #21–#23 rename). **(blocked by AD-HIGH-1.)**
- [ ] **AC26** — RPC + LLM-tool agent_def writes share the same uniqueness rule (id + case-insensitive name). (AD-OK; `orgs.rs:115`.)
- [ ] **AC27** — `agent_definitions_remove` refuses to delete an agent referenced by an org. (AD-OK; verified.)
- [ ] **AC28** — `skills_toggle` ownership: `agent_id` present → per-agent exclude; absent → app-global `IntegrationsConfig.disabled_skills`. (AD-OK; doc at `commands.rs:146-153`.)
- [ ] **AC29** — `derive_disabled_tools` is a single-pass `.filter().collect()` (anti-#15). (AD-OK; `defaults.rs:74`.)
- [ ] **AC30** — Background subsystems (memory consolidation, etc.) read via narrower accessors, not full `ResolvedAgent::resolve` (anti-pattern #32). (AD-OK; rustdoc at `resolved.rs:240-271` documents the warning; caller side is clean.)

**Status legend:** "(TI-OK)" / "(AD-OK)" = verified clean. **"(blocked by X)"** = item depends on the listed Finding being addressed first.

---

## What this audit did NOT do (explicit non-scope)

- Did **not** touch source code. Read-only audit. `git status` outside `docs/audit-2026-06-11/` is unchanged.
- Did **not** run `cargo clippy --all-targets` (workspace skill says this is the gold-standard Layer 1 step, but is slow; cargo check passed clean and earlier commit message claims clippy clean — re-verify before merging PRs from these findings).
- Did **not** run the agent-defs E2E suites (`tests/e2e/specs/core/agent-settings/*`).
- Did **not** audit the 19 out-of-scope commits beyond surface build check. Specifically: turn_intent E2E rewires (`ab30dbd9`, `fc01bea7`), routine scheduler (`0d7e1305`), openai-compat think-channel (`bdccf046`), agent-session UX fixes (`562dccd8`), ade-manager squash (`f300151b`, `8a3c75c7`) — these may have their own findings.
- Did **not** speculate fixes for OPEN bugs in workspace-memory (`workspace_workstation_toggle_right_blank`, `workspace_sessionreplay_file_blank`, `workspace_mode_switch_clears_draft`). They remain open and waiting on user repro logs.

---

## How to verify

```bash
# Layer 1 (already done by this audit):
cd src-tauri && cargo check --workspace --all-targets
pnpm exec tsc --noEmit | grep -E "<your touched files>"

# turn_intent specific:
cargo test -p session_persistence --lib turn_intents
cargo test -p session_persistence --lib turn_index
cargo test -p agent_core --lib core::session::scheduler

# agent-defs specific:
cargo test -p agent_core --lib definitions
cargo test -p agent_core --lib skills

# E2E (turn_intent round-collapse contract):
pnpm wdio tests/e2e/specs/core/session/agentQueuedControlScenarios.mjs
```

# agent-defs refactor audit — 2026-06-11

**Scope:** commits `c7b371bd` (dead-field deletion + builtin autonomy), `d79449a9` (process-wide store singletons, kill split brain), `f155925c` (single write chokepoint + delta overlays + change events), `dca01558` (tools single-source gating + policy chokepoints), `d08b3edf` (skills + MCP ownership-layer fixes).

Audit performed by parallel `builtin:explore` subagent; this report is the verbatim subagent output with minor formatting.

---

## 1. Files touched (1-line index, grouped)

| Group                | Path                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definitions store    | `src-tauri/crates/agent-core/src/core/definitions/{store,orgs,commands,resolver,resolved,schema,learnings_lookup}.rs`                                                                                                                                                                                                                                                           |
| Definitions builtins | `…/definitions/builtin/{wingman,work_item_manager}.rs`                                                                                                                                                                                                                                                                                                                          |
| Tools                | `…/core/tools/{policy,defaults}.rs`, `…/tools/impls/agent_def/{agent_actions,org_actions,mod}.rs`, `…/tools/impls/orchestration/agent/{linked_session,mod,schema}.rs`, `…/tools/tests/{defaults_tests,policy_tests,registry_tests}.rs`                                                                                                                                          |
| Skills               | `…/intelligence/skills/{loader/{scanner,commands},prefetch}.rs`                                                                                                                                                                                                                                                                                                                 |
| MCP                  | `…/intelligence/mcp/{bridge,commands,config,manager/lifecycle}.rs`                                                                                                                                                                                                                                                                                                              |
| Integrations         | `…/integrations/{config,patch}.rs`                                                                                                                                                                                                                                                                                                                                              |
| Init                 | `…/init/{mod,launch_spec,mcp_wiring,session_factory,agent_definition_loader}.rs`                                                                                                                                                                                                                                                                                                |
| Session              | `…/core/session/{launch,overrides,prompt/{cache,sections},turn/processor/{prefetch,prompt}}.rs`, `…/lifecycle.rs`                                                                                                                                                                                                                                                               |
| API (BE)             | `src-tauri/src/api/agent/{public,test/{core,learning,sde,agent_org}}.rs`, `src-tauri/src/agent_sessions/{cli/session_runner/session,unified_stats/conversion}.rs`, `src-tauri/src/benchmark.rs`                                                                                                                                                                                 |
| Deleted              | `src-tauri/src/coding_agent/{commands,mod}.rs` (576+280 lines)                                                                                                                                                                                                                                                                                                                  |
| FE                   | `src/api/tauri/agent/config.ts`, `src/api/tauri/rpc/{procedures,schemas}/agentDef.ts`, `src/app/root/e2e/helpers/config.ts`, `src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions.ts`, `src/modules/MainApp/Settings/config/customAgent/{useCustomAgentConfig,useAgentToolEditor,CustomAgentToolsSection}.tsx`, `src/modules/MainApp/Integrations/.../useAgentLearnings.ts` |

---

## 2. Term-usage tables

### "store"

| Symbol                  | Module                      | Concept                        |
| ----------------------- | --------------------------- | ------------------------------ |
| `definitions_store()`   | `core::definitions`         | Singleton agent-defs accessor  |
| `AgentOrgsStore`        | `core::definitions::orgs`   | Org-membership store           |
| `IntegrationsStore`     | `state::integrations_store` | App-global integrations config |
| `definitions::store::*` | crate-private impl          | Process-wide map               |

Verdict: shared verb across many subsystems but **no semantic collision in hot paths** — each store is single-domain.

### "definition" / "agent_def"

Used consistently: `AgentDefinition` (one agent), `OrgDefinition` (org membership), `definitions_store()` (the map). RPC + Tauri layer uses `agentDef` (camelCase) on the wire. No drift found.

### "overlay" / "delta" / "override"

| Term                         | Where                    | Meaning                                                       |
| ---------------------------- | ------------------------ | ------------------------------------------------------------- |
| `update_with_overlay`        | `store.rs` (method name) | Apply field-level delta to in-memory entry                    |
| `compose_builtin_with_delta` | `store.rs` (fn)          | Compose effective def from compiled-in builtin + stored delta |
| `delta_against_builtin`      | `store.rs` (fn)          | Compute delta from effective def for storage                  |
| `builtin-overrides.json`     | filesystem               | Stored deltas                                                 |
| `builtin_overrides` (field)  | atom/state               | Same                                                          |

**Verdict: 3-way naming inconsistency.** "overlay" appears in method names, "delta" in fn names, "override" in file/field names. Same concept, three labels. → **AD-MED-1.**

---

## 3. Delta-overlay composition matrix

Rows = top-level builtin fields. Columns = source, delta key, composition rule, explicit-null behaviour.

| Field                                     | Compiled-in source            | Delta key                        | Composition rule                | Explicit-null handling                  |
| ----------------------------------------- | ----------------------------- | -------------------------------- | ------------------------------- | --------------------------------------- |
| `system_prompt`                           | builtin Rust const            | `system_prompt`                  | string replace                  | Some(null) = use builtin (cleared) — ✅ |
| `display_name`                            | builtin Rust const            | `display_name`                   | string replace                  | Some(null) = builtin — ✅               |
| `rosters`                                 | builtin Rust const            | `rosters`                        | Vec replace                     | Some(null) = builtin — ✅               |
| `tools.user_excluded_tools`               | builtin (empty by convention) | delta key replaces whole `tools` | **whole-object replace** ⚠      | as `tools` field                        |
| `tools.system_restrict_to_tools`          | builtin                       | delta key replaces whole `tools` | **whole-object replace** ⚠      | as `tools` field                        |
| `tools.user_excluded_mcp_servers`         | builtin                       | delta key replaces whole `tools` | **whole-object replace** ⚠      | as `tools` field                        |
| `learnings_enabled`                       | builtin                       | top-level                        | bool replace                    | Some(null) = builtin — ✅               |
| `disabled_skills` (app-global, NOT delta) | `IntegrationsConfig`          | —                                | unioned with per-agent excluded | —                                       |

**Asymmetry:** `tools` field is composed wholesale (the entire `AgentToolConfig` is replaced when a delta sets any tools subkey). Other compound fields (`rosters`) are similar — Vec replace, not element-level. The partial `AgentToolSelectionPatch` exists at the API layer for field-level tool patches, but `update_with_overlay` writes `agent.tools` wholesale into the in-memory entry. → **AD-MED-2** + **AD-HIGH-2**.

---

## 4. Singleton entry-point matrix

Rows = code paths that read agent defs. Columns: uses singleton? / constructs own? / reads disk directly?

| Entry point                          | Singleton?                     | Own store? | Disk?           |
| ------------------------------------ | ------------------------------ | ---------- | --------------- |
| `agent_send_message` Tauri command   | ✅                             | —          | —               |
| `agent_create_session` Tauri command | ✅                             | —          | —               |
| Gateway `/agent/test/sde`            | ✅                             | —          | —               |
| Gateway `/agent/test/learning`       | ✅                             | —          | —               |
| Gateway `/agent/test/agent-org`      | ✅                             | —          | —               |
| memory consolidation (offline)       | ✅ via narrower accessor       | —          | —               |
| reflection / active learning         | ✅ via narrower accessor       | —          | —               |
| `init::load_agent_definitions`       | ✅ writes to singleton at boot | —          | reads disk once |
| MCP wiring                           | ✅                             | —          | —               |
| skills loader                        | ✅                             | —          | —               |

Clean — d79449a9 successfully eliminated per-call stores; every reader funnels through `definitions_store()`.

---

## 5. Findings

### AD-HIGH-1 — `disabled_skills` field name says mechanism, not intent

- **Severity:** High (style + future-proofing; mechanical rename PR)
- **Anti-pattern:** #21, #22, #23
- **Location:** `integrations/config.rs:disabled_skills` field, `IntegrationsConfig`, all FE references.
- **Issue:** The codebase recently renamed `disabled_tools` → `excluded_tools` (anti-pattern #23 precedent). For consistency and to express _why_ the list exists ("user excluded these from the default set" rather than "we wrote False to a boolean somewhere"), `disabled_skills` should be `excluded_skills`. The current name describes the mechanism (deny-list), not the intent.
- **Suggestion:** Mechanical rename across `integrations/config.rs`, `patch.rs`, `skills/loader/commands.rs`, FE atoms, RPC schema. No behaviour change. Match the per-agent `excluded_tools` vocabulary exactly.

### AD-HIGH-2 — `update_with_overlay` writes wholesale; `delta_against_builtin` re-derives per-field

- **Severity:** High
- **Anti-pattern:** Layer 10 (resolver asymmetry), composition vs decomposition mismatch
- **Location:** `definitions/store.rs:update_with_overlay`, `:compose_builtin_with_delta`, `:delta_against_builtin`.
- **Issue:** The in-memory entry is mutated by overwriting `agent.tools` (and similar Vec/struct fields) with the patch value as a whole. But when the entry is serialised back out via `delta_against_builtin`, the delta is re-derived per top-level field — meaning the on-disk shape (per-field deltas) doesn't match the in-memory shape (mutated whole). Two consequences:
  1. A user who only changed `tools.user_excluded_tools` may, after a round-trip, have their `tools.system_restrict_to_tools` value silently replaced by the builtin default (because the in-memory mutation took the whole `tools` patch object and lost the original system_restrict).
  2. The promise in the commit message ("Ship-time updates to builtin tool lists/prompts/rosters now reach users who customised other fields") only holds at the top-level field granularity, NOT at the `tools.*` subfield granularity.
- **Suggestion:** Make `update_with_overlay` itself field-level for compound types. The `AgentToolSelectionPatch` at the API layer already encodes per-subfield optionality; carry the same shape into the store mutation. Add round-trip tests at the `tools.*` subfield level (e.g. user_excluded set + system_restrict default → no drift on round-trip).

### AD-MED-1 — Triple naming: overlay / delta / override

- **Severity:** Medium
- **Anti-pattern:** #21 (field name says mechanism), #30 (cross-module naming inconsistency)
- **Location:** `store.rs:9-16` (doc), method name `update_with_overlay`, fn `compose_builtin_with_delta`, file `builtin-overrides.json`, field `builtin_overrides`.
- **Suggestion:** Pick one term. Recommend **"delta"** everywhere (matches the on-disk shape and the design intent: "field-level delta against compiled-in builtin"). Rename `update_with_overlay` → `update_builtin_delta`, file `builtin-overrides.json` → `builtin-deltas.json` (migration: read both names for one release, write only the new). Atoms and TS types follow.

### AD-MED-2 — `tools` field composed wholesale

See AD-HIGH-2 — same root cause, called out separately so the AC can tick it independently.

### AD-MED-3 — `excluded_tools` works "by accident"

- **Severity:** Medium
- **Anti-pattern:** #5 (default works by coincidence)
- **Location:** `defaults.rs:derive_disabled_tools` + builtin definitions shipping `tools.user_excluded_tools = []`.
- **Issue:** The capability-gated tool resolver assumes that an "excluded tools" list of `[]` on a builtin means "user excluded nothing." This works today because every shipped builtin has the empty list. The moment a builtin ships with a default exclusion (e.g. "wingman ships with `file_review` excluded"), the per-agent override semantics become ambiguous: does the user's `excluded_tools = []` mean "I want to re-include what builtin excluded" or "I haven't customised"?
- **Suggestion:** Document the invariant explicitly in `defaults.rs` rustdoc, or migrate `excluded_tools` to `Option<Vec<String>>` where `None` means "use builtin" and `Some([])` means "explicit empty set".

### AD-MED-4 — `built_in: bool` flag carries multiple concerns

- **Severity:** Medium
- **Anti-pattern:** #11 (boolean flag dimension mismatch)
- **Location:** `AgentDefinition.built_in`.
- **Issue:** The bool conflates "compiled-in identity" with "delta storage rules" with "RPC visibility". User-created agents have `built_in=false`; the entire agent is stored on disk. Builtins have `built_in=true` and only the delta is stored. Some RPC paths skip certain fields when `built_in=true`. This is two unrelated decisions (storage shape + RPC shape) on one boolean.
- **Suggestion:** Split into `storage_kind: StorageKind { Full, BuiltinDelta }` and `is_compiled_in: bool`. Most code wants `storage_kind`; only display/UI wants `is_compiled_in`.

### AD-MED-5 — Defs ↔ Orgs stores cross-reference

- **Severity:** Medium (architectural; not a bug today)
- **Anti-pattern:** #6 (cross-domain leakage)
- **Location:** `definitions/orgs.rs` calling into `definitions/store.rs` for agent_id existence checks; coordinator + member refs validated at write-time.
- **Issue:** The org store enforces that referenced `agent_id`s exist. This couples Orgs to Defs at write time. If a hot path needs to bulk-update defs (e.g. import 100 agents in a single transaction), the org store's per-write validation forces serial calls.
- **Suggestion:** Acceptable today (no bulk path exists), but document the coupling in `orgs.rs` rustdoc so future bulk-import work doesn't surprise. No action needed now.

### AD-LOW-1 — `restrict_to_workspace` field name still appears in `ToolDeps` params

- **Severity:** Low
- **Anti-pattern:** #29 (grep-alive ≠ alive; remnant after deletion)
- **Location:** Various `ToolDeps` constructors.
- **Issue:** `restrict_to_workspace` was deleted from `AgentDefinition` and `ResolvedAgent` in c7b371bd but the same name appears as a local param in `ToolDeps`. Different concept (a different "restrict workspace" decision), but same name reads as a contradiction.
- **Suggestion:** Rename the `ToolDeps` param to `workspace_restriction_policy` or similar to dispel confusion.

### AD-LOW-2 — `expect("…")` for mutex poisoning in store.rs

- **Severity:** Low (intentional, but worth a comment)
- **Location:** `definitions/store.rs` poisoned-mutex sites.
- **Issue:** Several `.expect("definitions store mutex poisoned")` calls. The convention is fine but a one-line rustdoc explaining why panicking is correct here (state is unrecoverable) would help newcomers.

### AD-LOW-3 — `IntegrationsConfig::load_or_default()` still public

- **Severity:** Low
- **Issue:** Background callers that should use the narrower accessor for app-global config can still call `load_or_default`. Rare. Add `#[deprecated]` once the narrower path is verified.

### AD-LOW-4 — `change-events` subscriber count not bounded

- **Severity:** Low
- **Location:** `useAgentDefinitions.ts` subscribing to `orgii-agent-defs-changed`.
- **Issue:** Every mount adds a subscriber. Unmount removes. Standard React pattern, no leak detected — but if a future code path mounts in a loop, the change-event hook bus could OOM. Add a debug assertion or unit test.

### AD-LOW-5 — `delta_against_builtin` returns `None` silently for unknown builtin id

- **Location:** `store.rs`.
- **Issue:** If a user's stored delta references a builtin id that no longer exists in the compiled-in catalogue (shipped agent was removed), the function returns `None` and the entry is dropped on next write. Should warn-log.

### AD-LOW-6 — `built_in` propagation to RPC schemas relies on Rust→TS sync

- **Anti-pattern:** Layer 8 (wire protocol drift potential)
- **Location:** `rpc/schemas/agentDef.ts`.
- **Issue:** TS schema is hand-maintained and could drift if a Rust field gains/loses the rename. Add a serialisation contract test.

### AD-LOW-7 — `Store` shared name across many subsystems

- **Anti-pattern:** #30 in principle; OK in practice
- **Issue:** `AgentOrgsStore`, `IntegrationsStore`, generic `Store` in tests. No semantic collision today but a `use foo::Store` import could be ambiguous to a newcomer. Style only.

### AD-LOW-8 — `IntegrationsConfig.disabled_skills` cohesion

- **Anti-pattern:** #31 (config struct cohesion)
- **Issue:** Sits next to `embedding`, `learnings`, etc. — all "app-level cross-agent" but different update cadences. Acceptable per the cohesion test on the current design, but flag for future split if either domain grows.

---

## Acceptance Criteria (subagent-suggested, merged into README AC19–AC30)

See `README.md` AC19–AC30 for the consolidated checklist; subagent originals here:

- AC-A: Singleton enforced
- AC-B: Single write chokepoint
- AC-C: Change-event fires post-persist
- AC-D: Builtin delta round-trips at top-level field granularity
- AC-E: Builtin delta round-trips at `tools.*` subfield granularity (blocked by AD-HIGH-2)
- AC-F: Explicit-null in stored delta means "user cleared"
- AC-G: `disabled_skills` → `excluded_skills` (blocked by AD-HIGH-1)
- AC-H: Uniqueness rule shared across RPC + LLM-tool paths
- AC-I: `agent_definitions_remove` refuses dangling ref
- AC-J: `skills_toggle` dimension switch documented
- AC-K: `derive_disabled_tools` single-pass
- AC-L: Background subsystems use narrower accessor

---

## Anti-patterns swept

| #       | Pattern                                        | Verdict                                                         |
| ------- | ---------------------------------------------- | --------------------------------------------------------------- |
| #2      | Broadcast-only success                         | OK — hook fires AFTER persist on every chokepoint               |
| #5      | Denylist by subtraction                        | AD-MED-3 (excluded_tools works by accident)                     |
| #6      | Cross-domain leakage                           | AD-MED-5 (defs ↔ orgs coupling, acceptable today)               |
| #10     | Resolver asymmetry across field types          | AD-MED-2 / AD-HIGH-2                                            |
| #11     | Boolean-flag dimension mismatch                | AD-MED-4 (`built_in` bool carries multiple concerns)            |
| #21–#23 | Atom multi-purpose / field name says mechanism | AD-HIGH-1 (`disabled_skills` → `excluded_skills`)               |
| #29     | Grep-alive after deletion                      | AD-LOW-1, AD-LOW-3 (remnants; otherwise c7b371bd lands cleanly) |
| #30     | Cross-module naming collision                  | AD-LOW-7 (`Store` shared, OK)                                   |
| #31     | Config struct cohesion                         | AD-LOW-8 (`disabled_skills` cohesion borderline)                |
| #32     | Background subsystem coupling                  | OK — narrower accessors used; rustdoc warns                     |
| #33     | `expect()` on fallback that can fail           | AD-LOW-2 (mutex-poisoning expects, intentional)                 |

---

## Summary

The refactor cluster lands cleanly. Hot-path invariants — single singleton, single write chokepoint, delta overlays, dimension-switched skills toggle, capability-gated tool resolution — all hold under read. **No critical findings**, **2 high**, **5 medium**, **8 low**.

Two highest-leverage follow-ups for parallel work:

- **Slice A — Delta granularity for compound fields (AD-MED-2 / AD-HIGH-2).** Independent file: `store.rs` (compose/delta fns) + tests. Touches no other crate.
- **Slice B — Vocabulary unification (AD-HIGH-1 + AD-MED-1, rename `disabled_skills` → `excluded_skills`, `overlay/override` → `delta`).** Wide but mechanical; touches `integrations/config.rs`, `patch.rs`, `skills/loader/commands.rs`, FE atoms, RPC schema. Pure rename, no behaviour change.

These slices share no mutable state and can be split across parallel PRs.

---
name: architecture-audit
description: Systematic architecture audit and refactoring methodology for Rust + TypeScript codebases. Use when performing refactoring, cleanup, unification, code review, dead code removal, module reorganization, or tech debt elimination. Ensures no naming confusion, semantic overloading, hidden defaults, duplicate logic, or architectural inconsistencies are missed.
---

# Architecture Audit & Refactor Methodology

Lessons learned from multiple rounds of agent architecture refactoring where critical issues were repeatedly missed despite "thorough" audits.

| Date | Change |
|------|--------|
| 2026-04 | Added Layers 8–10 (Wire Protocol, Init Parity, Resolver Symmetry) and Systematic Sweep discipline after schemars/proxy token-bloat incident |
| 2026-04 | Added anti-patterns 22–34 (learnings-config refactor: config cohesion, background resolver coupling, fallback parity, session-layer decisions) |
| 2026-05 | Added anti-patterns 35–46 (control-flow, Agent Org finality, task-runtime, schema discipline, E2E false-path, team-mode, queue-progress) |
| 2026-06 | Added anti-patterns 47–54 (queue/turn lifecycle unification: FSM single source of truth, generation counters, cancel semantics, duplicate dispatchers) |

## When To Use

- Before ANY refactoring plan is finalized
- When user reports confusion about code that you previously audited
- When cleaning up a domain (e.g., "unified agent architecture")
- When doing dead code removal or module reorganization

## Core Principle: Acceptance Criteria First

Before writing any plan, define the **completion checklist** — measurable criteria the codebase must satisfy when done. Every phase must map to at least one checklist item.

```
- [ ] Zero compiler warnings (cargo check / tsc --noEmit)
- [ ] Zero clippy warnings (cargo clippy --all-targets)
- [ ] Zero hardcoded domain strings (grep for known patterns)
- [ ] Zero duplicate type definitions across modules
- [ ] Zero layer violations (lower layers do not import upper layers)
- [ ] All files under size limit (per workspace rules)
- [ ] No backward-compat shims remaining (grep "compat", "legacy", "backward")
- [ ] Pre-user schema changes modify canonical DDL directly; no `ALTER TABLE`, legacy rebuilds, or migration tests unless explicitly requested
- [ ] No duplicate logic patterns (manual audit of init/setup/registration flows)
- [ ] No unused pub items (compiler warnings or manual grep)
- [ ] Term overloading table complete (Layer 4)
- [ ] Default branch analysis complete (Layer 5)
- [ ] Core modules free of variant-specific leakage (Layer 6)
- [ ] Wire payloads inspected for bloat/unwanted fields (Layer 8)
- [ ] All entry points perform identical init steps — comparison matrix complete (Layer 9)
- [ ] Multi-field resolvers use symmetric fallback chains — fallback matrix complete (Layer 10)
- [ ] Every found issue class has been swept globally, not just fixed at the reported site
- [ ] No types alive only in definition + re-export + test chains (Layer 2 call-chain trace)
- [ ] No cross-module naming collisions (same type name, different fields)
- [ ] No config structs spanning multiple unrelated domains (embedding + learnings + model selection in one struct)
- [ ] No background subsystems calling full session resolvers that enforce model-presence invariants
- [ ] No `expect()` on fallback paths that share the same failure mode as the primary path
- [ ] Session-layer decisions (LLM model, account) stay in session records, not agent config layer
- [ ] User-visible control actions have one dispatcher/source of truth, not UI-side duplicate send/cancel paths
- [ ] Runtime-completed assistant output is written to the authoritative EventStore, not only broadcast over transient UI channels
- [ ] Cancel APIs distinguish user Stop from programmatic Force Send so one path cannot poison the next turn
- [ ] Long-running orchestration surfaces reconcile finality from durable state, not from optimistic UI/session assumptions
- [ ] Run status, session status, task status, and member activity are asserted as separate dimensions
- [ ] No ownerless `in_progress`/claimed work can be persisted; if open work remains after all workers are terminal, the run is explicitly abandoned/failed/cancelled, not running
- [ ] Multi-agent task tools are role-aware: member self-claim is distinct from coordinator assignment, and recoverable misuse returns structured guidance rather than trajectory-visible execution errors
- [ ] Live orchestration context (task board, inbox, member activity) is marked volatile or revision-keyed; it is never hidden inside a stale stable prompt cache
- [ ] Rendered E2E for orchestration proves final outcome, durable invariants, prompt/context evidence, readable UI evidence, and absence of hidden tool-error trajectory leaks
- [ ] Rendered E2E does not use debug/helper endpoints as the side-effect path for the user-visible behavior under assertion; helpers may seed or inspect only
- [ ] Control/sentinel records (`redo:*`, batch envelopes, internal markers) are excluded from user-actionable UI registries and transcript input surfaces unless explicitly rendered as diagnostic metadata
- [ ] Team-mode / Agent Org member identity is sourced from runtime `member_id`/member name, not inferred from `agent_definition_id` or `agent_id` (one definition can back coordinator + multiple members)
- [ ] Drained inbox/mailbox messages are persisted as visible turn input before agent execution; LLM-only ephemeral attachments are not enough, and raw XML/internal payloads must not leak into the UI transcript
- [ ] Member turn completion maps to idle/available semantics, not terminal session completion; run finality must remain separate from per-turn member availability
- [ ] Task queue progress is event-driven: blocked assigned tasks are not notified early, dependency completion redispatches newly ready assigned tasks, and coordinator/cross-member tool calls cannot persist another member's work as `in_progress`
- [ ] Agent Org E2E asserts production inbox drain: unread member inbox rows must become visible turn input through the real member session path, and ready assigned open work must have either an active owner turn or unread wake row
- [ ] Adding a new E2E helper (`setTextarea`, custom drain endpoint, seeded snapshot helper, etc.) includes a sweep of all semantically matching call sites so old helpers do not keep driving the wrong DOM/runtime shape
- [ ] Turn finality has exactly one authoritative source (an FSM or equivalent monotonic state machine); `runtimeStatus` atoms, rendered events, heuristic timestamps, and streaming deltas are UI mirrors only and MUST NOT drive queue-flush decisions
- [ ] Every turn-ending signal (provider terminal, stream end, error, user Stop) carries a monotonically increasing generation counter; signals whose generation does not match the current turn are silently discarded
- [ ] The queue dispatcher reads a single gate (`turnPhase === "idle"`) — it does not read multiple atoms, boolean flags, or heuristic conditions to decide whether to send or queue
- [ ] User Stop and programmatic interrupt (Force Send cancel) travel separate code paths with explicit intent encoding; no shared cancel atom, flag, or default branch handles both simultaneously
- [ ] No separate "hold" atom or boolean flag shadows FSM state (e.g. "don't flush even if idle"); the FSM phase is the only source of truth for whether the queue may flush
- [ ] Provider events (stream end, tool call complete, error) are FSM *inputs*, not direct setters of `runtimeStatus`; the FSM transitions on them, the UI mirrors the FSM
- [ ] For every user-visible send/submit control, there is exactly one code path from button click to message dispatch; UI shortcut paths and background dispatcher paths that perform the same mutation are eliminated
- [ ] Atoms or flags that serve more than one concern (e.g. "signal user Stop" AND "gate draft restoration") are split; each concern has its own named atom with a single documented purpose
```

---

## The 10-Layer Audit

Every audit MUST cover all 10 layers. Previous failures came from only covering layers 1-3, then layers 1-7 (missing wire protocol and init parity), then layers 1-9 (missing resolver symmetry).

### Layer 1: Compilation Correctness

- Does it compile? (`cargo check`, `tsc --noEmit`)
- Zero warnings? (`cargo clippy --all-targets`)

### Layer 2: Dead Code & Structural Deduplication

- Duplicate functions/structs across modules?
- Parallel code paths doing the same work?
- Abstractions created but never wired into execution path?
- Types that only appear in definition + re-export chains + tests?

**Method: Call-Chain Tracing (not static grep)**

For each major entry point:

1. Identify entry point (e.g., "user sends message" -> Tauri command -> handler)
2. Trace forward: what functions does it call? What structs does it construct?
3. Mark every touched function/struct as "alive"
4. Everything NOT marked is a deletion candidate
5. For "alive" items: is the same work done in >1 place? -> duplication candidate

Static grep for `TODO`, `legacy`, `dead` only finds self-documented problems. It misses structs never instantiated, functions never called, and duplicate logic in parallel paths.

**CRITICAL: Reference counting is NOT a dead code audit.** A type with 15+ grep hits can still be dead if all hits are: (a) its own definition, (b) re-export chains (`types/mod.rs` → `session/mod.rs`), (c) internal conversion methods, and (d) tests that only exercise those conversions. Trace from **business entry points** (Tauri commands, API handlers, gateway dispatchers) forward — if no production code path constructs or consumes the type, it's dead. See anti-pattern #26.

### Layer 3: Naming Consistency

- Are renamed items updated everywhere?
- Old names still referenced in comments/strings?

### Layer 4: Semantic Overloading (CRITICAL — Often Missed)

**Search for the same word used with different meanings across the codebase.**

Method: Pick every domain term and search ALL usages. Build a table:

```
Term: "gateway"
Usage 1: ProviderSpec.is_gateway -> means API aggregator
Usage 2: AgentVariant::Gateway -> means message routing agent
Usage 3: GATEWAY_AGENT_TYPES -> means Azure cross-provider proxy
VERDICT: Rename usages 1 and 3 to avoid confusion
```

Common overloaded terms: gateway, session, channel, provider, context, runtime, config, state, manager, handler, bridge, proxy, client.

### Layer 5: Default Branch Analysis (CRITICAL — Often Missed)

**Find every `match` with `_ =>` or `else` catch-all and ask: "Is the default correct for ALL current and future variants?"**

Dangerous pattern:

```rust
match variant {
    Sde => SdePromptBuilder,
    _ => OsPromptBuilder, // Custom agents silently get OS identity!
}
```

Audit every:

- `match x { ..., _ => default }` — is the default truly universal?
- `if is_os { ... } else { ... }` — does the else work for Custom/Gateway/future variants?
- `unwrap_or(some_default)` — is the default always correct?

### Layer 6: Cross-Domain Concept Leakage (Often Missed)

**Check if domain-specific concepts leak into shared/core modules.**

Examples: `sde_config` field on shared `SessionRuntime`, hardcoded `AgentVariant::Os.agent_id()` in shared work item code, display labels "SDE Agent" hardcoded in shared aggregation code.

Method: For every file in `core/` or shared modules, grep for variant-specific terms. Each hit needs justification.

### Layer 7: "New Developer Confusion" Test (Often Missed)

Read the code as if you've never seen the codebase. For each function/struct:

1. Does the name accurately describe what it does?
2. Would a new developer understand this without tribal knowledge?
3. Are there misleading names that suggest a relationship that doesn't exist?

### Layer 8: Wire Protocol & Serialization Audit (CRITICAL — Added 2026-04)

**Check what the code ACTUALLY SENDS over the wire, not just what the source looks like.**

This layer was added after `schemars::openapi3()` silently injected `$schema`, `title`, `nullable`, and `default` fields into tool schemas. The Rust source looked perfectly reasonable — the problem was only visible in the serialized JSON output, and only triggered by a specific proxy resolving the `$schema` URL.

Method:

1. **Dump real payloads**: For every external API call (LLM, HTTP, WebSocket), add a temporary debug dump of the serialized body to a file. Inspect the actual bytes, not the source structs.
2. **Check schema generation libraries**: If using `schemars`, `serde_json::to_value`, or any schema generator, inspect the output for fields the target API does not expect (`$schema`, `title`, `nullable`, `default`, `examples`, `$ref`).
3. **Test against actual endpoints**: A payload that "should work" per the source code may fail at a proxy or gateway. Always verify with a real call, not just `cargo test`.
4. **Measure token impact**: For LLM APIs, check `prompt_tokens` in the response. If it's 10x higher than expected, the payload has hidden bloat.

Dangerous patterns:

```rust
// Looks fine in source, but openapi3() adds $schema URL, title, nullable
schemars::generate::SchemaSettings::openapi3()

// Fix: use draft07 with no meta_schema
schemars::generate::SchemaSettings::draft07()
    .with(|s| { s.meta_schema = None; })
```

Checklist:

- Every `to_value()` / `to_string()` that crosses a network boundary: inspect the output
- Every schema generator: verify no unwanted fields in output
- Every proxy/gateway in the call chain: test with real payloads

### Layer 9: Init Parity Across Entry Points (Added 2026-04)

**Every entry point (production, test, E2E, API endpoint) must perform the SAME initialization steps.**

This layer was added after the E2E test endpoint (`/agent/test/sde`) skipped `AgentSession` registration, causing `init.rs` to miss definition-level disabled tools — but production code via Tauri commands did register it.

Method:

1. **List ALL entry points** that create or initialize a session:
   - Tauri commands (production)
   - HTTP API endpoints (gateway/test)
   - Test helpers (`#[cfg(test)]`)
   - CLI entry points
2. **For each entry point, list the initialization steps** it performs (in order)
3. **Build a comparison matrix**: rows = entry points, columns = init steps
4. **Every cell must be filled** — if an entry point skips a step, it needs explicit justification
5. **Missing steps are bugs**, not "simplifications for testing"

Dangerous pattern:

```rust
// Production path: registers definition, then inits session
state.register_session(agent_session).await;
ensure_session_initialized(&state, &session_id, &model).await;

// Test endpoint: skips registration, so init can't read definition
// This means disabled_tools from definition are never applied!
ensure_session_initialized(&state, &session_id, &model).await;
```

### Layer 10: Resolver Symmetry (Added 2026-04)

**When a single function resolves multiple fields using a priority chain (overrides → cache → DB → fallback), every field MUST follow the same chain unless there is an explicit, documented reason to diverge.**

This was found in `identity.rs` where `model` only checked overrides + runtime (2 layers), while `account_id` and `workspace_root` checked overrides + runtime + DB (3 layers). The DB always had a valid `model` (required at creation time), but the resolver skipped it — causing an error on app restart when the frontend lost its `lastModelSelectionAtom` and the in-memory runtime hadn't been initialised yet.

Method:

1. **Find every multi-field resolver** — functions that resolve N related fields from the same set of sources
2. **Build a fallback matrix**: rows = fields, columns = data sources. Mark which sources each field checks.
3. **Every cell should be filled** — if a field skips a source, ask "why doesn't field X check source Y?"
4. **Check the DB query trigger condition** — if the DB query is conditional (lazy), verify the condition accounts for ALL fields, not just a subset

Dangerous pattern:

```rust
// model checks 2 layers, account_id and workspace check 3 — asymmetric!
let model = overrides.model
    .or_else(|| runtime.model.clone());  // stops here — no DB fallback
let model = model.ok_or("model is required")?;  // errors on app restart

let account_id = overrides.account_id
    .or_else(|| runtime.account_id.clone())
    .or_else(|| db_record.account_id.clone());  // has DB fallback

// Fix: all fields follow the same chain
let model = overrides.model
    .or_else(|| runtime.model.clone())
    .or_else(|| db_record.model.clone())  // now symmetric
    .ok_or("model is required")?;
```

Also watch for the DB query gate:

```rust
// BAD: gate only checks 2 of 3 fields — model miss won't trigger DB
let db_record = if account_id.is_none() || workspace.is_none() { query_db() }

// GOOD: gate checks all fields that may need DB fallback
let needs_db = model.is_none() || account_id.is_none() || workspace.is_none();
let db_record = if needs_db { query_db() }
```

Also audit for **dimension mismatch**: when a boolean flag (like `is_channel`) is used to branch behavior, check whether the flag's semantic dimension matches the actual requirement. Example: `is_channel_session` (dimension: "message source") was used to decide workspace path (dimension: "agent type"). OS Agent from the UI had no workspace — but `is_channel_session` was `false` for UI-launched sessions, so it hit the wrong branch.

---

## Plan Structure

### Phase ordering rules

1. **Delete dead code first** (Phase 1 always) — reduces noise for all subsequent phases
2. **Unify duplicated logic next** — establishes shared foundations
3. **Structural/naming cleanup last** — cosmetic changes on a clean codebase

### Phase granularity

Each phase must be:

- **Independently verifiable**: `cargo check` passes after each phase
- **Scope-bounded**: affects at most ~20 files
- **Both-sides**: if a Rust change affects frontend types, the frontend change is in the SAME phase

### Plan anti-patterns

- "Create abstraction" without "Wire it in" — creates dead code. Every "create" must have "integrate" + "delete old" in same phase.
- Phase marked "complete" without verification — each phase ends with `cargo check --all-targets` + zero warnings.
- Auditing one layer (Rust) but not the other (TypeScript) — audit both together for shared concepts.
- "Future" or "deferred" items — if worth noting, worth doing now or explicitly descoping with user.
- "It compiles, ship it" — compilation says nothing about semantic correctness.
- "Not in my task scope" — always expand audit scope to adjacent systems that share terminology.

---

## Execution Discipline

### Before each phase

1. Verify starting state: `cargo check` passes, note warning count
2. Read the files you're about to change (never edit blind)

### After each phase

1. `cargo check` — zero errors
2. Warning count must be <= previous (ideally decreasing)
3. For frontend: `tsc --noEmit` or equivalent

### Global verification (after all phases)

Run every checklist item. If any fails, the refactor is not complete.

---

## Common Refactoring Patterns

### Unifying duplicate initialization

When two code paths do overlapping work:

1. List every step each path performs (side by side)
2. Mark shared steps vs variant-specific steps
3. Create factory function for shared steps, returns "base" result
4. Each variant calls factory, adds variant-specific work
5. Delete duplicated code from each variant

### Eliminating dead abstractions

1. Confirm zero callers (grep + compiler warnings)
2. If abstraction SHOULD be used: integrate it properly
3. If not: delete entirely
4. Never leave "aspirational" code

### Replacing hardcoded strings with typed constants

1. Define enum/const in ONE canonical location
2. Add `as_str()` for serialization boundaries
3. Replace ALL occurrences (including tests and comments)
4. Verify zero remaining with grep

### Introducing an FSM to replace scattered boolean/atom state

When "is the system in state X?" is answered by reading multiple atoms:

1. List every atom/boolean that contributes to the answer
2. Define the complete set of mutually-exclusive states (phases) as an enum/union type
3. Write transition functions for each edge (e.g. `beginTurn`, `markRunning`, `markTerminal`, `forceIdle`)
4. Add a monotonically increasing `generation` field; bump it synchronously in every `begin*` transition
5. All signal handlers check `signal.generation === current.generation` before acting
6. Delete the old atoms; derive any needed UI booleans from the FSM phase
7. Verify: grep the codebase for the old atom names — zero remaining reads outside the FSM module

---

## Systematic Sweep Discipline (Added 2026-04)

**When you find one instance of a problem category, you MUST sweep the entire codebase for all instances before moving on.**

This was the single biggest failure mode in the 2026-04 audit cycle: fixing one `blocking I/O` site but not scanning for all others, fixing one `error swallowing` pattern but only in JSON/serde contexts.

### The Rule

For every issue found:

1. **Classify it** — what is the general pattern? (e.g., "sync I/O in async fn", "unwrap_or_default hiding errors", "hardcoded string instead of const")
2. **Write a grep pattern** that catches ALL instances of this class, not just the one you found
3. **Run the grep across the entire target scope** (e.g., all of `agent_core/`)
4. **Record the full hit list** before fixing any
5. **Fix ALL instances** or explicitly defer with user agreement

### Common sweep patterns

```bash
# Blocking I/O in async context
rg "std::fs::" --type rust -l  # then check if callers are async

# Error-swallowing unwrap_or_default
rg "unwrap_or_default\(\)" --type rust

# HTTP client construction hiding errors
rg "\.build\(\)\.unwrap_or" --type rust

# Hardcoded finish_reason strings
rg '"stop"|"tool_calls"|"end_turn"' --type rust

# Schema generators that may add unwanted fields
rg "SchemaSettings|into_root_schema" --type rust

# Repeated state lookups in one function (consolidation candidate)
rg "get_session\(&session_id\)" --type rust -c  # >1 per file = suspect

# Guaranteed-Some Option wrappers (ok_or followed by Some())
rg "ok_or.*\?\s*;" --type rust  # then check if result is wrapped in Some()

# Non-atomic multi-step DB writes (split-brain window)
rg "update_status|upsert_session" --type rust  # multiple calls in sequence = candidate for merge

# DEPRECATED fields still being assigned or read — remove or migrate first
rg -i "deprecated" --type rust -C 3  # then check: is the deprecated item still assigned/read?

# Types alive only in definition + re-export chains (zombie types)
# For each pub struct: count callers outside its own file + mod.rs re-exports + tests
# If all hits are definition/re-export/test → dead

# Cross-module naming collisions
# Export every pub struct name, sort, find duplicates across modules
rg "^pub struct " --type rust -l  # list files, then grep struct names across all
```

### TypeScript/JavaScript sweep patterns

```bash
# TypeScript: atoms serving multiple concerns
rg "Atom\b" --type ts -l  # list files, then check each atom name for conjunctions

# TypeScript: event handlers directly setting runtime status
rg "setRuntimeStatus|setIsRunning|isRunning\s*=" --type ts

# TypeScript: duplicate send paths (direct transport calls outside dispatcher)
rg "dispatchMessage|sendMessage" --type ts -l  # >1 file calling transport = suspect

# TypeScript: UI components importing transport/dispatch directly
rg "from.*dispatcher|from.*transport" --type ts  # should only appear in the dispatcher file

# TypeScript: atoms reset in multiple places for different concerns
rg "set\(.*Atom.*false\)" --type ts  # find atoms cleared in multiple locations
```

### Anti-pattern: "Fix the one, forget the class"

```
Round 1: Found blocking I/O in memory/commands.rs. Fixed it. Declared "blocking I/O: done."
Round 2: Found blocking I/O in init_helpers.rs, channel.rs, prompt_sections.rs, prompt_helpers.rs.

Why? Because round 1 only fixed the reported instance, never swept for the pattern.
```

---

## Anti-Patterns That Caused Missed Issues

1. **"It compiles, ship it"** — `_ => OsPromptBuilder` compiles perfectly but gives Custom agents the wrong identity. Compilation correctness != semantic correctness.

2. **"Not in my task scope"** — Provider naming was missed because task was "unify agents". Always expand audit to adjacent systems sharing terminology.

3. **"Grep-and-skim"** — Searching `AgentVariant::Os` finds explicit uses but misses `_ =>` branches. Read the logic, not just pattern matches.

4. **"Fix what's reported, not what's wrong"** — Fixing variant branches is shallow. The deeper issue (prompts fundamentally different, init 80% duplicated) requires reading full code paths.

5. **"One more pass will catch everything"** — Same mental model finds same category of issues. Use different audit lenses (the 7 layers) to find different categories.

6. **"Fix the one, forget the class"** (Added 2026-04) — Finding one blocking I/O site and fixing only that site. The correct response is: classify the pattern, grep the entire codebase, fix ALL instances. See "Systematic Sweep Discipline" above.

7. **"Source looks fine, must be fine"** (Added 2026-04) — `schemars::openapi3()` looks like a perfectly reasonable API call. The bug is in the OUTPUT, not the source. For anything that crosses a network boundary, inspect the serialized output, not just the source code. See Layer 8.

8. **"Tests are simpler, they don't need full init"** (Added 2026-04) — E2E test endpoints skipping `AgentSession` registration because "it's just a test." Every entry point must do the same init steps as production. See Layer 9.

9. **"Infrastructure code doesn't need auditing"** (Added 2026-04) — HTTP client construction, schema generation, serialization format — these are "boring plumbing" that gets skipped during audits. But they're exactly where silent failures hide (wrong TLS config via `unwrap_or_default()`, bloated schemas, missing headers).

10. **"Some fields need fewer fallback layers"** (Added 2026-04) — A resolver function resolves model, account_id, and workspace_root from the same source chain. Model skips the DB layer because "it's always provided by the frontend." But on app restart the frontend may not have it cached. All fields in the same resolver should follow the same priority chain. See Layer 10.

11. **"Boolean flag matches the branching need"** (Added 2026-04) — `is_channel_session` (semantic: message source) was used to branch workspace resolution (semantic: agent type). OS Agent sessions launched from the UI were `is_channel_session = false`, so they took the wrong path. When a flag drives branching, verify the flag's dimension matches the decision's dimension.

12. **"Scatter lookups across the function"** (Added 2026-04) — `state.get_session(&id).await` called 4+ times in one function, each time to extract a different field. Each call acquires a lock, clones an Arc, and makes the function harder to reason about. Consolidate into one lookup after the point where the session is guaranteed to exist, then extract all fields at once.

13. **"Wrap a guaranteed value in Option to match old patterns"** (Added 2026-04) — After `ok_or_else` proves a value exists, wrapping it in `Some(...)` to feed an `if let Some(ref x) = ...` downstream. This erases the compiler-enforced guarantee and forces every use-site to re-check a condition that can never be false. The downstream pattern should be updated to use the value directly.

14. **"Pre-clone Arc fields before the closure even though the parent Arc is moved in"** (Added 2026-04) — `let provider = Arc::clone(&runtime.provider);` outside a closure, then moving both `provider` and `runtime` into the closure. Since `runtime` (an `Arc<T>`) is moved in anyway, `Arc::clone(&runtime.provider)` can be done inside the closure, eliminating the redundant intermediate variable.

15. **"Build a denylist by subtracting from the full set instead of building an allowlist directly"** (Added 2026-04) — Capability-derived tool availability was implemented as 4 mutable layers: (1) iterate all tools, disable those lacking capability; (2) if allowlist exists, iterate all tools again and disable those not in it; (3) apply explicit denylist; (4) hard-deny specialist tools. Plus a `META_TOOLS` in-file constant patching tools the first loop missed. The correct approach: single-pass filter over the tool catalog, producing the disabled set in one `collect()`. Conditions are AND'd (capability satisfied, not specialist, in allowlist if one exists, not in denylist). One function, one pass, no mutable accumulator, no in-file patches, no layer numbering.

---

## Refactoring Planning Rules

1. **Never declare "final" in a plan name** — there's always more. Use descriptive names.
2. **Build term overloading table FIRST** — before any plan, map every domain term to all usages.
3. **Trace full call path** — from frontend -> Tauri command -> core -> variant code. Issues hide at boundaries.
4. **Check default branches** — for every enum match, verify `_` is intentional and correct.
5. **Question "shared" modules** — if a "shared" module references specific variants, it's not truly shared.
6. **Read adjacent systems** — auditing agent definitions? Also audit providers, sessions, tools.
7. **Ask "what happens when someone adds a new variant?"** — if adding `AgentVariant::Research` breaks things silently, fix now.
8. **Sweep the class, not the instance** — when you find a bug, define its category, grep the entire scope, fix all hits. Never fix one and move on.
9. **Dump and inspect wire payloads** — for any code that sends data to an external service, serialize and inspect the actual output. Source code is not enough.
10. **Compare all entry points** — build a matrix of (entry point) x (init steps). Missing cells are bugs.
11. **Check resolver symmetry** — when a function resolves N fields from the same source chain, build a (field) x (source) matrix. Every field should check every source. Asymmetry is a latent bug.
12. **Match flag dimension to decision dimension** — when a boolean flag drives an `if/else`, ask: "does this flag's semantic axis match the decision being made?" `is_channel` (message source) branching on workspace path (agent type) is a dimension mismatch.
13. **Consolidate repeated lookups** — when `state.get_session(&id).await` (or any map/lock lookup) appears N times in one function, consolidate into one lookup and extract all needed fields. Each extra lookup is a wasted lock acquisition and a readability tax.
14. **Eliminate guaranteed-Some Option wrappers** — when a value is produced by an `ok_or` / `ok_or_else` (guaranteed non-None), do NOT wrap it in `Option` just to match a legacy `if let Some(ref x)` pattern downstream. The `Option` wrapper erases the guarantee and forces defensive code throughout.
15. **Prefer single-pass set derivation over multi-layer mutation** — when building a set of items to include/exclude, write a single `.iter().filter().collect()` with all conditions in the filter predicate. Do NOT build a mutable set and add/remove across multiple passes/layers. The single-pass version is easier to read, harder to break, and eliminates the need for in-file constant patches when the tool catalog evolves.
16. **Count sources of truth for "is the queue allowed to flush?"** — before finalizing any queue or lifecycle design, list every atom, boolean, and condition that the dispatcher checks before deciding to send. If the count is >1, reduce to exactly 1 by introducing a single FSM `phase` field. Every other signal becomes a UI mirror or a FSM input, not a decision gate.
17. **Add generation counters to every async start/stop protocol** — any time a turn, task, or job can start and stop multiple times in a session, and signals can arrive asynchronously, add a monotonically increasing integer generation to every start call. All terminal signals must carry the generation they belong to, and the handler must discard signals whose generation does not match.
18. **Audit cancel APIs for postcondition symmetry before implementation** — before writing a cancel function, list its postconditions (draft restore? mark interrupted? poison next context?). If two callers have different postconditions, the function must accept an intent parameter or be split into two functions. Never rely on frontend call timing or flag-reset order to differentiate cancel semantics.
19. **Delete shadow boolean atoms that replicate FSM phase** — when a boolean like `holdForStop` or `isRunning` is added "for safety" alongside an FSM, it almost always duplicates an FSM phase. Find the phase it corresponds to, route writers through the FSM transition, and delete the boolean. Having both guarantees they will diverge under race conditions.
20. **Trace every event handler that directly sets runtime status** — for every handler that writes `isRunning`, `runtimeStatus`, or equivalent "turn active" atoms in response to a provider event, ask: "what happens if this event arrives late, out of order, or not at all?" If the answer is "the UI freezes" or "a new turn is reset to idle," route it through the FSM with generation-checking and deadman timers instead.
21. **Enumerate all send-path call sites before shipping a queue** — before a queue dispatch system is considered complete, grep every call to the backend transport layer (`dispatchMessageBySessionType`, `sendMessage`, etc.). If >1 call site can fire for the same logical user action, there is a duplicate path. All UI controls must signal intent to the queue state machine; only the dispatcher calls the transport.
22. **Split multi-purpose atoms before they compound** — any atom whose name uses a conjunction (e.g. `userInitiatedCancelAtom` doing "mark stop episode open" AND "gate draft restoration") will cause cross-concern bleed when either concern needs to be cleared independently. At design time, name each concern separately and write one atom per concern.
23. **Name fields by their purpose, not their mechanism** — `disabled_tools` / `allowed_tools` describe the _mechanism_ (deny/allow) but not the _intent_ (user exclusion delta / subagent strict subset). Use `excluded_tools` ("tools the user/definition removed from the default set") and `restrict_to_tools` ("if non-empty, only these tools are available"). A new developer should be able to read the field name and understand _why_ the list exists without reading the surrounding code.
24. **Separate per-turn data from app-level infrastructure in request structs** — if a "per-request" struct contains fields that every single caller sets to the same app-level singleton value, those fields belong on a higher-scoped parameter (e.g. a separate `app_handle` argument) — not on the per-request struct. The struct should only contain data that genuinely varies per invocation. When app-level resources are needed inside the callee, derive them from the infrastructure handle via small extractors.
25. **Eliminate derivable constructor parameters** — when a constructor parameter is a pure function of other parameters already being passed, compute it inside the constructor body. External derivation adds maintenance burden and risks divergence when the logic is updated in one call site but not others.
26. **Audit config struct field cohesion** — for every config struct, ask: "do all fields describe the same concern?" If embedding settings, sub-agent toggles, and LLM overrides coexist in one struct, it needs splitting. One struct = one domain. Name each domain explicitly; find the right owner in the architecture (global config, per-agent definition, session record).
27. **Background subsystems must not call session-startup resolvers** — `ResolvedAgent::resolve()`, session init, and similar startup paths often enforce invariants (model present, account configured) that are valid at session-start but not in background/offline contexts. Background jobs (reflection, consolidation, cleanup) should have their own lightweight config accessors that read only what they need.
28. **Verify fallback paths for the same failure mode as the primary** — before writing `primary().unwrap_or_else(|| fallback().expect("always works"))`, ask: "can `fallback()` fail for the same reason `primary()` failed?" If the answer is yes, the `.expect()` is a latent panic. The fallback must handle the failure case, not assume it cannot occur.

22. **"Keep a deprecated snapshot field for convenience"** (Added 2026-04) — `SessionRuntime.project_path: Option<PathBuf>` was a snapshot set at initialization; the live source of truth was `workspace_state: Arc<RwLock<SessionWorkspace>>` (updated by `/add-dir`, `/rm-dir`). The snapshot was never updated, so any mutation made it stale. Four consumers read the snapshot; all could read `workspace_state.read().tool_cwd()` instead. When a mutable, canonical data source exists (e.g. `workspace_state`), do NOT also store a snapshot of the same data on the same struct. The snapshot will inevitably drift, and every reader faces a hidden correctness choice between the two sources.

23. **"Clone an owned value into a struct constructor instead of moving it"** (Added 2026-04) — `resolved: resolved.clone()` when `resolved` is an owned `ResolvedAgent` that is never used after the constructor. The `.clone()` on a large struct (with nested `Vec`, `HashMap`, `Arc` fields) wastes CPU and memory for zero benefit. Before writing `.clone()`, check: is the variable used after this point? If not, move it. Same applies to any owned value being assembled into a struct: `integrations.clone()`, `overrides.clone()`, `log_prefix.clone()` — if it's the last use site, move it.

24. **"Pass a bare path where a structured workspace type exists"** (Added 2026-04) — `SessionRuntimeRequest` accepted `workspace_path: PathBuf`. The callee immediately wrapped it in `SessionWorkspace::new(path)` to get the structured workspace type with `project_root`, `original_cwd`, and `additional_directories`. Worse, a SECOND `SessionWorkspace::new(path.clone())` was constructed elsewhere in the same function for `AgentToolConfig`, creating two independent workspace objects from the same path — a split-brain if `additional_directories` ever differed. Fix: rename to `project_root: PathBuf` (semantically precise for what the callee receives) and use the canonical `Arc<RwLock<SessionWorkspace>>` returned by the factory for all downstream consumers. When a structured type exists for a concept, pass it (or its constituent fields with precise names), not a bare primitive that forces the receiver to re-derive the structure.

25. **"Relay struct that mirrors the destination struct field-for-field"** (Added 2026-04) — `SessionRuntimeRequest` (28 fields) existed only to ferry values from `init.rs` to `build_session_runtime`, which immediately unpacked 20 of them into `ToolDeps` (the struct tool constructors actually consume). Three fields (`mode_switch_manager`, `max_tokens`, `temperature`) were packed into the request but **never read** by the callee — dead code. The struct added no abstraction, no validation, no transformation; it was pure mechanical relay with a `.clone()` tax on every field transition. Fix: the caller (`init.rs`) constructs `ToolDeps` directly and passes it to the factory alongside the small set of factory-specific params (`model`, `account_id`, `disabled_tools`, `disabled_mcp_servers`, `policy_config`, `log_prefix`). **Detection rule:** when > 60 % of a struct's fields appear verbatim (same name, same type, zero transformation) in the destination struct, the relay struct is overhead. Delete it and let the caller assemble the destination struct directly.

26. **"Copy session-level fields into a per-turn request struct via .with\_\*() chains"** (Added 2026-04) — `message.rs` called `UnifiedRequest::new()` then `apply_standard_config()` + 15 `.with_*()` builder calls to copy fields from `SessionRuntime` → `UnifiedRequest` every turn. The same fields (model, max*tokens, temperature, skills, workspace_state, etc.) were set identically for every turn in the same session. Fix: `UnifiedRequest::from_runtime(&SessionRuntime)` constructor reads all session-level fields from the runtime in a SINGLE place; callers only add per-turn fields (`mode`, `images`, `cancel_flag`, etc.). **Detection rule:** when > 50 % of a builder's `.with*\*()`calls are setting values that come from a single source struct and never change across calls, the builder needs a`from_source()`constructor. **Corollary — workspace split-brain:**`process_message`constructed a NEW`SessionWorkspace::new(path)`from`request.project_path`+ DB hydration even though`request.workspace_state`already held the identical, fully-hydrated workspace from`init.rs`. Fix: prefer `workspace_state.read().clone()` when available; fall back to DB reconstruction only for callers without a workspace_state (gateway path).

27. **"Pass app-level singletons through per-turn input structs"** (Added 2026-04) — `TurnInput` carried infrastructure handles (`app_handle`, `lsp_manager`, `screenshot_store`, `project_path`) that were app-level singletons or derivable from `SessionRuntime`. Every caller had to extract these from `AgentAppState` and pack them into `TurnInput`; `process_message` then unpacked them to build `EventHandlerConfig` and `UnifiedMessageProcessor`. The singletons never varied per-turn — they were constant for the app's lifetime. Fix: `process_message` accepts `app_handle: Option<tauri::AppHandle>` as a separate parameter and derives infrastructure handles internally via small extractors (`extract_lsp_manager`, `extract_screenshot_store`). `TurnInput` is reduced to only per-turn variable data (content, mode, images, ide_context, is_resume, channel, chat_id). **Detection rule:** if a per-turn/per-request struct field is set to the same value by every single caller and the value comes from a global/app-level source, it belongs on a higher-scoped parameter — not on the per-turn struct. **Corollary — inconsistent fallback:** when `TurnInput.screenshot_store` was `None`, `process_message` created a NEW empty `ScreenshotStore` instead of using the global one from `AgentAppState`. The extractor pattern fixes this: `extract_screenshot_store` always returns `AgentAppState.screenshot_store` when available, falling back to an empty store only when no app handle exists (test/public endpoints).

28. **"Pass a derived value as a constructor parameter when the constructor already holds the source"** (Added 2026-04) — `process_message` computed `agent_id = runtime.agent_definition_id.unwrap_or(session.id)` then passed it to `UnifiedMessageProcessor::new(runtime, session, ..., agent_id, ...)`. The processor already held both `runtime` and `session` as fields, so `agent_id` was fully derivable inside the constructor. Passing it externally added a parameter, created a maintenance burden (callers must remember the derivation logic), and risked divergence if the logic were updated in one place but not the other. Fix: compute `agent_id` inside the constructor body from the already-available `runtime` and `session` fields. **Detection rule:** when a constructor parameter is a pure function of other parameters already being passed to the same constructor, eliminate it and compute inside.

29. **"Grep-alive = alive" — reference counting is not a dead code audit** (Added 2026-04) — `UnifiedSession` (253 lines, 10 builder methods) appeared "alive" because `grep` found 15+ hits — definition, re-export chain (`types/session.rs` → `types/mod.rs` → `session/mod.rs`), `from_session()` / `to_session()` conversion methods, and a test calling those methods. But tracing from actual business entry points (Tauri commands, gateway handlers) revealed that **no production code path ever constructed or consumed `UnifiedSession`**. The runtime used `AgentSession` + `SessionRuntime`; the DB layer used `UnifiedSessionRecord` directly. The entire type hierarchy existed only to service a single round-trip test. **Detection rule:** when auditing whether a type is alive, trace from business entry points forward — not from the type's definition outward. A type that only appears in its own definition file, re-export chains, internal conversion methods, and tests is dead regardless of grep hit count. Corollary: **"aspirational abstraction"** — builder methods (`with_label`, `with_channel`, `with_project_path`) with zero callers are a strong signal the type was designed for a future that never materialized.

30. **"Same name, different struct" — cross-module naming collision** (Added 2026-04) — Two `SessionFilter` structs existed in different modules with completely different fields: one in `types/filter.rs` (6 fields: `type_name`, `status`, `channel`, `project_path_prefix`, `limit`, `offset`) for DB queries, and another in `unified_stats/types.rs` (9 fields: `category`, `status`, `key_source`, `repo_path`, `text_query`, `sort_by`, `sort_order`, `limit`, `offset`) for frontend API. In `aggregation.rs`, both appeared in the same file distinguished only by full path (`crate::agent_core::session::SessionFilter` vs local `SessionFilter`). A new developer cannot tell which is which without reading both definitions. **Fix:** rename to make the domain explicit — `SessionListFilter` (persistence layer) vs `SessionFilter` (frontend API). **Detection rule:** after any audit, grep every exported type name across the entire codebase. If the same name appears in >1 module with different field sets, rename the narrower-scoped one.

31. **"Overloaded config struct — one name, three unrelated domains"** (Added 2026-04) — `MemorySearchConfig` simultaneously held: (a) embedding engine settings (`provider`, `model`, `max_chunks`, `chunk_size`), (b) per-agent L3 learnings policy (`learnings_enabled`, `extract_memories_enabled`, `auto_dream_enabled`), and (c) a consolidation model override (`consolidation_model_override`). The name suggested "memory retrieval tuning" but the struct actually controlled write-path sub-agents and LLM selection. The mismatch meant every new developer had to read the full struct to understand what each field actually did. **Fix:** split by domain — `EmbeddingConfig` (app-global embedding engine, lives in `IntegrationsConfig`) + `AgentLearningsConfig` (per-agent write-path policy, lives in `AgentDefinition`). **Detection rule:** when a config struct's fields span multiple distinct subsystems (storage, LLM selection, sub-agent toggles), it is doing too many jobs. Name each concern, find the right owner, split.

32. **"Background subsystem over-couples to full session resolver"** (Added 2026-04) — `reflection.rs` and `active_learning.rs` both called `ResolvedAgent::resolve()` just to read one boolean flag (`learnings_enabled`). But `ResolvedAgent::resolve()` enforces a strict invariant: `selected_model_id` must be present. Background subsystems run after a session ends, at which point the in-memory session is gone and the agent definition on disk may not have a model configured (OS agent never has one). Result: `reflection-pipeline` E2E silently failed with `builtin:sde has no selected_model_id`. **Fix:** introduce a lightweight `resolve_learnings_for(agent_id)` helper that uses `resolver::resolve_definition` (no model requirement) to extract only config flags. Background subsystems should call this, not `ResolvedAgent::resolve()`. **Detection rule:** any background/offline subsystem (consolidation, reflection, cleanup jobs) that calls `ResolvedAgent::resolve()` is a red flag — ask "does this code path actually need a model?" If not, use the definition resolver instead.

33. **"expect() on a fallback path that can never succeed"** (Added 2026-04) — `GET /agent/config` called `ResolvedAgent::resolve()` on the live OS agent definition, and on failure called `.expect("fallback os_agent must resolve")` on the compiled-in `os_agent()` builtin. But `os_agent()` has `selected_model_id: None` — the fallback had the same failure mode as the primary path. The `.expect()` was a guaranteed panic disguised as defensive code. **Fix:** the fallback must use a code path that actually handles the missing-model case — in this case `AgentRuntimeView::from_definition()` which reads `learnings` and `embedding` without requiring a model. **Detection rule:** whenever you see `X.unwrap_or_else(|| Y.expect("Y must work"))`, ask "can Y actually fail for the same reason X failed?" If yes, the fallback is a lie.

34. **"Session-layer decision misplaced in agent config layer"** (Added 2026-04) — `MemorySearchConfig.consolidation_model_override` let agent definitions override which LLM model consolidation uses. But consolidation processes learnings from a specific past session, and that session already recorded the exact model and account used at runtime (`agent_sessions.model`, `agent_sessions.account_id`). The agent-config override could diverge from what the session actually used, creating inconsistency. More importantly: the session layer already owns this decision. **Fix:** delete the override field; consolidation always reads model/account from the session record. **Detection rule:** when a background job processes per-session data, its LLM/resource selection should come from the session record — not from the agent definition. The definition controls "how the agent behaves during a live session"; the session record captures "what was actually used." Post-session processing belongs to the session record's data.

35. **"Broadcast-only success path"** (Added 2026-05) — A Rust turn completed successfully and token usage proved the provider returned text, but the rendered chat showed only user events because the assistant message was only emitted through a transient `agent:streaming_complete` broadcast path. If the frontend listener misses, filters, or fails to upsert that broadcast, runtime truth and UI truth diverge. **Fix:** completed assistant output must be pushed to the authoritative EventStore from the runtime side; broadcasts may remain as notifications, but not as the sole persistence/visibility path. **Detection rule:** whenever an event changes durable UI history, trace whether the backend writes the canonical store directly or only emits a notification that another layer may or may not consume.

36. **"Control action has two send/cancel dispatchers"** (Added 2026-05) — Force Send appeared to work, but `ChatView` had a duplicate direct append + send path while `useQueueDispatch` already owned queued dispatch semantics. Double paths drifted on status, model selection, queue removal, cancel timing, and error handling. **Fix:** visible queue controls should only promote/cancel/request dispatch; exactly one dispatcher owns append, dequeue, model resolution, send, and error handling. **Detection rule:** for every control button, trace from click to side effect; more than one mutation path means split ownership. (See planning rule #27.)

37. **"Cancel flag has one meaning for Stop and Force Send"** (Added 2026-05) — User Stop and programmatic Force Send both called cancel, but their semantics differ: Stop should restore/rollback and may mark the next turn as interrupted; Force Send should cut the current turn without poisoning the follow-up turn or leaking `[Request interrupted by user]`. Sharing one cancel flag/default branch caused the next Force Send turn to be cancelled immediately or to inherit synthetic interruption text. **Fix:** cancel APIs must carry intent (`user stop` vs `programmatic interrupt`) and runtime code must branch explicitly. **Detection rule:** when two controls share a cancel path, compare postconditions; differing postconditions require separate entry points. (See planning rule #24.)

38. **"Local row/card assertions equal orchestration success"** (Added 2026-05) — Agent Org tests proved task rows, inbox rows, and overview cards existed, but a real run still stopped at 4/6 tasks with all sessions terminal and `agent_org_runs.status = running`. The assertions were local implementation milestones, not final product outcomes. **Fix:** every orchestration audit must define final user outcome, durable run/session/task invariants, rendered UI evidence, runtime path evidence, and anti-false-positive checks before implementation. **Detection rule:** if a test would pass with `running` run + terminal sessions + open/ownerless tasks, it is not an orchestration scenario test.

39. **"One status dimension explains the whole UI"** (Added 2026-05) — Task completion, member session liveness, member activity/intervention, and run finality are different dimensions. Mixing them makes a session look crossed-out/completed while the run says running, or hides abandoned work behind completed styling. **Fix:** store and render each dimension separately, and reconcile run finality from durable session/task state before projecting UI. **Detection rule:** every Agent Org/queue UI row should expose/assert the specific dimension it displays (`run.status`, `sessionRuntime.status`, `task.status`, owner/member activity), not infer one from another.

40. **"Single-agent claim semantics copied into a multi-agent runtime"** (Added 2026-05) — A task tool can safely infer "current agent owns this" in a single-agent todo list, but the same inference is wrong for a coordinator in a multi-agent org. `status=in_progress` without `owner` means different things depending on caller role: a member may self-claim; a coordinator must assign a member or leave work pending. **Fix:** make task-tool semantics role-aware at the tool boundary, before store invariants fire. Recoverable misuse should return structured guidance, not an execution failure. **Detection rule:** when a tool mutates shared multi-actor state, audit caller identity (`coordinator`, `member_id`, `agent_id`, session id) before copying behavior from a single-actor system.

41. **"Live task-board context hidden in stable prompt cache"** (Added 2026-05) — A prompt section can look correct in a dump but be stale during the next turn if it contains live DB state while marked `StableUntilClear`. For Agent Org, a stale task snapshot causes duplicate `task_create`, invalid `task_update`, and model confusion even when the store is correct. **Fix:** task board / inbox / member activity prompt sections must be `Volatile` or revision-keyed and tested through the real prompt cache policy matrix. **Detection rule:** any prompt text containing persisted runtime state must answer: what revision invalidates this, and does the cache policy enforce it?

42. **"Clean UI while trajectory leaks tool errors"** (Added 2026-05) — Rendered UI can pass while the hidden tool trajectory contains `Error executing task_*`, SQL constraint errors, or store invariant failures. The user still sees broken agent behavior because the model consumed those errors. **Fix:** orchestration E2E must assert negative trajectory patterns alongside positive UI and DB evidence. Common model-correction paths should return JSON guidance fields (`guidance`, `already_exists`, `status_ignored`, etc.) rather than exception-shaped text. **Detection rule:** after fixing a tool error, add an E2E assertion that the previous error string cannot appear in task-tool results or live conversation trajectory.

43. **"Pre-user schema change disguised as migration"** (Added 2026-05) — During the no-external-user stage, adding `ALTER TABLE`, legacy-table rebuilds, compatibility tests, or migration shims for a schema change creates dead compatibility logic and hides the real source of truth. **Fix:** update the canonical `CREATE TABLE` / initialization DDL directly, reset the affected local and isolated E2E databases, and verify the fresh schema path. Only write a real migration when the user explicitly says existing persisted data must be preserved. **Detection rule:** if a diff adds `ALTER TABLE`, `PRAGMA table_info` compatibility probes, `legacy` schema rebuild code, or tests named around old-table migration, stop and ask whether persisted-user compatibility is actually required.

44. **"Debug helper marks state, test expects rendered product history"** (Added 2026-05) — A rendered Agent Org test called a debug drain endpoint that used a throwaway session, marked inbox rows read, and returned rendered messages, then expected the real coordinator chat history to contain those messages. The helper proved helper-side state, not the production caller path. **Fix:** rendered E2E must drive the same production action a user would trigger (`send_message_impl`, button click, wake/resume path) before asserting chat history. Debug endpoints may seed prerequisites or inspect state, but cannot be the mutation path for the rendered behavior under test. **Detection rule:** if a test calls `/test/*`, `debug*`, or helper-isolation endpoints and then asserts visible chat/cards changed, trace whether the endpoint writes the same EventStore/session/UI state as production; if not, the test is invalid.

45. **"Control/sentinel records registered as user-actionable UI state"** (Added 2026-05) — File review polling treated `redo:rewind` snapshots as normal pending review entries. That re-registered a control snapshot into the pending-review registry and cleared the actual Redo anchor, disabling Redo All immediately after Undo. Similar leaks show up when protocol envelopes like `<inbox-batch ...>` become visible user text. **Fix:** every UI registry that consumes durable records must define an explicit inclusion predicate and exclude sentinel/control records (`redo:*`, internal batch envelopes, synthetic markers) unless the surface is an intentional diagnostic viewer. **Detection rule:** whenever a backend introduces a sentinel/prefix/control row, grep every generic list/registry consumer and add positive inclusion or explicit exclusion before shipping.

46. **"New helper added without call-site sweep"** (Added 2026-05) — A `setTextarea` E2E helper existed, but the Agent Org description field still used `setInput`, so the spec failed with `input-missing`. Adding the helper did not update semantically matching call sites. **Fix:** introducing a specialized helper requires a sweep of all selectors/components with the same DOM/runtime shape and updating call sites in the same change. **Detection rule:** if a helper name narrows a mechanism (`setTextarea`, `selectOptionBySelector`, `drainInboxForFixture`), grep for nearby generic helper calls (`setInput`, raw debug drain, generic click) against matching test IDs/components before declaring the E2E fixed.

47. **"Split-brain turn finality — multiple independent 'is the turn done?' signals"** (Added 2026-06) — The queue had four independent "is the session idle?" signals: `runtimeStatus` (derived from provider events), a separate `isRunning` boolean, `queueFlushRequestAtom` heuristics, and `holdSessionQueueForStopAtom`. Each defined "done" slightly differently. When they disagreed, the queue either refused to flush (frozen UI where the composer stuck in Stop state permanently) or flushed too early (next queued message sent before the previous turn fully closed, causing duplicate messages in the transcript). Any signal that can independently say "idle" is a split-brain candidate. **Fix:** introduce one canonical FSM (`turnLifecycle.ts`) with a single `phase` field. All other atoms (`runtimeStatus`, `isRunning`) become UI mirrors — they are derived from FSM transitions and cannot independently change the decision of whether to flush. The queue dispatcher reads exactly one gate: `phase === "idle"`. **Detection rule:** count the atoms/booleans your queue dispatcher reads before deciding to send — any count >1 is split-brain; reduce to one named source.

48. **"No generation counter — stale signals from old turns poison new turns"** (Added 2026-06) — When a turn ended and a new one began immediately (e.g. Force Send into a queued follow-up), late-arriving terminal signals from the OLD turn (stream-end events that crossed the network after the new turn was already `dispatching`) would reset the NEW turn's FSM to `idle`, unlocking the queue prematurely. The FSM had no way to distinguish "signal for the current turn" from "signal for a past turn." This caused the queue to flush a third message while the second turn was still initializing. **Fix:** every `beginTurnDispatch` bumps a monotonically increasing `generation` integer synchronously (before the first `await`). Every terminal signal carries the generation it belongs to. In `markTurnTerminal`, if `signal.generation !== state.generation`, the signal is discarded silently. `forceTurnIdle` (rewind, deadman) also bumps generation to invalidate any in-flight terminal. **Detection rule:** any async start/stop system where signals can arrive out of order must carry a generation counter on every terminal signal; a terminal handler that does not check which episode it belongs to is a latent stale-signal bug.

49. **"Dispatcher duplicates FSM logic — multiple atoms consulted for send-vs-queue"** (Added 2026-06) — The message dispatcher (the function that decides "send now or enqueue?") read `runtimeStatus`, `holdSessionQueueForStopAtom`, `queueFlushRequestAtom`, and a timing heuristic to reconstruct a rough picture of whether a turn was active. This was the FSM logic — just scattered across four atoms instead of centralized. When the FSM added a new phase (`stopping`), the dispatcher didn't know about it and kept flushing during stop. When `holdForStop` was set, the dispatcher blocked even when `runtimeStatus` was already `idle`, creating a 1–2 second frozen window. **Fix:** the dispatcher reads one field: `getTurnPhase(sessionId)`. If `"idle"` → send directly; otherwise → enqueue. All phase semantics live inside the FSM; the dispatcher has no conditional logic about what "not idle" means. **Detection rule:** grep every atom/boolean read inside the dispatch-vs-queue branch — if >1, the dispatcher is reimplementing FSM state; expose a single `getTurnPhase()` query instead.

50. **"Cancel semantics conflated — user Stop and programmatic Force Send share the same cancel path"** (Added 2026-06) — User Stop (which should: cancel the current turn, restore the draft text, mark the follow-up as a post-stop dispatch) and programmatic Force Send (which should: cut the current turn cleanly so the queued message can send, without poisoning the next turn with interruption text) both called the same `cancelSession()` function with the same flags. The shared path set `userInitiatedCancelAtom = true`, which then caused draft restoration to fire on Force Send too. Worse, the backend received a generic cancel that prepended `[Request interrupted by user]` synthetic text to both the stopped turn and the next turn's context — causing Force Send to appear in the transcript as "user pressed Stop." **Fix:** expose two distinct cancel APIs: `stopSession()` (user intent, restores draft, marks `userInitiatedCancelAtom`) and `interruptSession()` (programmatic, no draft restoration, no poisoning of next context). The backend cancel command must carry intent too so it knows whether to prepend synthetic interruption text. **Detection rule:** if two controls share a cancel function and have differing postconditions (draft restore, interruption text, priority marking), they need separate API entry points — not a shared path plus timing differences.

51. **"Separate 'hold' atom duplicating FSM state — two simultaneous sources of truth for queue flush"** (Added 2026-06) — `holdSessionQueueForStopAtom` was an independent boolean that said "don't flush the queue even when `runtimeStatus` is idle." It was set on Stop and cleared after a delay. This created a window where `turnPhase = "idle"` AND `holdForStop = true` simultaneously — the FSM said "go ahead", the hold atom said "wait." The queue checked both, but the clearing of `holdForStop` was on a timeout rather than tied to the actual terminal signal. Result: queue flush was delayed by the timeout even when the provider had already delivered the terminal and the FSM was idle. **Fix:** delete `holdSessionQueueForStopAtom`. The FSM `stopping` phase is the hold — when Stop is pressed, transition to `stopping`; when the terminal arrives, transition to `idle`. The queue only looks at `phase`. No separate boolean, no timeout-based clearing. **Detection rule:** for every boolean that says "don't do X even when another condition says yes," ask whether an FSM phase already represents that hold — if so, the boolean is a shadow copy and should be deleted.

52. **"Turn finality derived from unreliable provider events instead of FSM"** (Added 2026-06) — Provider events (stream-end, `tool_call_complete`, `error`) were the sole signal driving `runtimeStatus` directly: an event handler listened on a WebSocket channel and set `isRunning = false` upon receiving any of these. But provider events are unreliable: they can arrive out of order (a `stream_complete` event arriving after a `error` from the same turn), arrive late (after a new turn has already started), or not arrive at all (network drop, backend crash). When they didn't arrive, the UI stayed frozen in "running" state until a manual refresh. **Fix:** provider events are FSM *inputs* that call `markTurnTerminal` or `markTurnRunning`. The FSM decides whether to act on them (generation check, phase guard). The UI reflects the FSM `phase`, not the raw events. Deadman timers on `dispatching` and `stopping` phases provide a hard upper bound on freeze time when events drop. **Detection rule:** grep for event handlers that directly set `isRunning`, `runtimeStatus`, or equivalent turn-active atoms without going through the FSM — each is a late/out-of-order signal vulnerability.

53. **"Duplicate send paths in UI components — same message can be appended and dispatched twice"** (Added 2026-06) — `ChatView` had a direct `appendAndSend()` shortcut for Force Send (promoting a queued item to immediate dispatch). `useSubmitMessage` independently had its own append + dispatch path (the normal submit flow). When Force Send triggered, both paths could fire in the same React event batch: `ChatView` called `appendAndSend` directly, and the queue dispatcher also dequeued and called `dispatchMessageBySessionType`. The message appeared twice in the transcript with two different event IDs. **Fix:** exactly one dispatcher owns append + dequeue + model-resolution + dispatch + error handling. Visible queue controls (Force Send button, reorder handles) signal *intent* to the queue state machine (promote priority, mark `requiresExplicitDispatch`). The single dispatcher observes the change and executes. No UI component directly calls the transport layer. **Detection rule:** trace every backend-send call site — if >1 can fire for the same user action, there is a duplicate path; route all through the single dispatcher.

54. **"Multi-purpose cancel atom causing cross-concern bleed"** (Added 2026-06) — `userInitiatedCancelAtom` carried two unrelated concerns: (1) "the user pressed Stop — any submit during this episode is a post-Stop explicit dispatch that gets `priority: now`" and (2) "the Stop episode is open — gate draft restoration until the terminal arrives." These two concerns were both gated on the same atom. When Force Send programmatically cleared the cancel (by calling `interruptSession` without setting `userInitiatedCancelAtom`), the draft-restoration logic didn't fire. But when the cancel path *did* set `userInitiatedCancelAtom = true` (user pressed Stop normally), draft restoration and priority dispatch both shared state — so clearing the atom for dispatch priority also prematurely closed the draft-restoration window. **Fix:** name each concern explicitly. `userInitiatedCancelAtom` → renamed to `postStopDispatchEpisodeAtom` (concern: "next submit is a post-Stop explicit dispatch"). Draft restoration is driven by `lastUserMessageAtom` + a separate `stopDraftRestorationPendingAtom` that is only set by actual user-Stop, not by programmatic interrupts. Each concern is cleared independently. **Detection rule:** when an atom name contains a conjunction (e.g. "cancel AND restore"), it carries two concerns — split it; grep all set/clear sites to confirm each concern has exactly one writer.


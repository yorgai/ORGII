# ORGII E2E Testing

ORGII keeps two separate E2E surfaces. Do not use one as proof for the other.

1. **Core UI E2E** — `tests/e2e/specs/core/`, driven by WebDriverIO against the debug-built Tauri app.
2. **Rust runtime E2E** — `src-tauri/crates/e2e-test/`, a Rust HTTP client against debug-only `/agent/test/*` endpoints.

A Rust HTTP scenario can prove runtime state. It does not prove a user can see, click, or recover through the rendered UI. If a feature has a button, card, menu item, wizard field, status pill, or visible chat behavior, it needs rendered UI coverage.

## Core UI E2E policy

`tests/e2e` is the final UI regression suite. Keep it small and clean.

Rules:

- Extend an existing core spec before creating a new one.
- Do not put historical audits, migration sweeps, subsystem experiments, or one-off debug specs under `tests/e2e`.
- Every UI spec must perform a real rendered action or assert a real rendered result. Debug helpers may seed state, but cannot be the only proof.
- Provider capacity failures, especially Gemini 429/rate-limit/capacity errors, are infra/provider issues unless ORGII mishandles the rendered error or runtime state.
- OAuth refresh failures with permanent invalid-token messages are account health blockers. ORGII should record the failure and disable the account immediately; UI E2E should report them separately from product regressions and continue through configured account/model fallback chains when available.

## Anti-false-prosperity policy

A green E2E result is not accepted unless it proves the production behavior being claimed.

- Do not mark a scenario `PASS` when the critical action is replaced by a frontend mock, synthetic success flag, debug-only responder, or helper that bypasses the production command/event path.
- Debug helpers may establish deterministic preconditions, but the user-visible action under test must still use the production click/command/dispatcher path.
- Do not use corrective follow-up prompts, extra retry prompts, or stronger second instructions to make an agent pass after the original user path failed. The first-path failure is the product signal.
- Do not count a matrix run as proof for multiple labels unless each requested label produced independent evidence. Combined fallback output is not per-label proof.
- Do not promote old green rows after prompt text, harness setup, account fallback, or product semantics changed. Rerun only the affected rows and record current-code evidence.
- For interactive cards, assert the full lifecycle: rendered reason/body, actionable button, production response command, backend/runtime state change, and final rendered state. A pill text change alone is not enough.
- For mode/tool claims, assert session-scoped effective tools (`agent_list_effective_tools_for_session`, `/agent/test/effective-tools/:session_id`, or `__e2e.listEffectiveToolsForSession`) rather than global registry or historical renderability.
- Treat provider quota/capacity blocks as `BLOCKED`, not `PASS`; never route around them silently to manufacture green coverage.

## Real-interaction regression policy

If a bug was found by a human using the rendered app, the regression test must replay the human interaction path closely enough to fail before the fix.

- Prefer `browser.keys`, real clicks, focus/blur, menu navigation, and visible-state waits over `browser.execute` text injection. Direct DOM mutation is allowed only for deterministic setup, never as proof that input handling works.
- Contenteditable tests must first prove the keystroke/input actually changed the rendered editor text before asserting menus or buttons. A keydown-only signal (menu opened but `editor.textContent` stayed empty) is a harness/product bug signal, not proof that `@query` or `/query` works.
- Prefer real keyboard clearing for contenteditable surfaces (`Cmd/Ctrl+A`, delete/backspace, then `browser.keys(...)`) and wait for the rendered editor text to stabilize before menu assertions. Do not require `document.activeElement` to remain the editor after `@` or `/` opens a portal/menu; focus may legitimately move while the editor text remains the source of truth.
- If Tauri WebDriver element-click/focus is flaky for a contenteditable surface, the spec may use `document.execCommand('insertText')` plus a real bubbling `InputEvent` to exercise the product `onInput` path, but it must assert the editor text, query consumption, and final visible result. Do not use plain `textContent = ...` as the behavior under test.
- If a test helper replaces DOM text directly, it must be limited to deterministic seed/setup. A regression for inline `@`/slash/menu behavior must use keyboard input or an `InputEvent` path that can fail when React draft state restores stale text.
- A composer/menu test must assert all user-visible invariants: previous draft text preserved, transient query text consumed, inserted pill/chip visible, focus restored when product requires it, and send/stop state correct.
- Stop/Pause/Queue tests must assert immediate button state, composer interactivity, stream cessation, queue retention/non-autoflush, and draft restoration when a not-yet-sent message is canceled.
- Use seeded events only to create durable transcript preconditions. Rendering assertions must still inspect the actual chat UI, including grouped/aggregated blocks, not only `data-testid` fragments that disappear under aggregation.
- A test helper that calls `setTextarea`, `insertText`, `ensureRepoSelected`, or a debug seed path must include a comment or assertion explaining which production behavior is still being exercised afterward.
- If a prior test used a shortcut and missed a bug, update the skill/spec so future tests forbid the shortcut for that class of interaction.

## Multi-repo workspace regression policy

Multi-root behavior must be treated as a first-class product contract, not a display patch.

- Distinguish durable session root, primary workspace folder, active editor folder, search result source repo, and tool-event target path. Do not use active editor focus as a durable session root unless the user explicitly selected it.
- Explicitly test that `activeFolderAtom` / active editor focus can move to a secondary repo without changing the durable launch root. Agent session launch defaults to the primary workspace folder; active folder is only a UI/current-focus concept.
- Every multi-repo UI test should include at least two repos with colliding filenames so source attribution cannot be inferred from basename alone.
- `@` search and context menus must render persistent source evidence (`repoName`/path badge), not only hover-only titles.
- File-path extraction must go through a shared extractor that handles canonical payload variants (`file_path`, `filePath`, `target_file`, `targetFile`, `path`) across backend normalization, frontend props, summaries, and grouped chat blocks. Do not add component-local `a || b || c` chains.
- Read-file rendering tests must cover single blocks, grouped `ReadFileGroup`, and aggregate `ActionSummaryGroup` summaries, including camelCase Cursor-style tool payloads.
- Multi-repo session launch tests must assert the selected durable repo path in the launch payload/runtime snapshot, and separately assert that UI search/source badges remain accurate for non-primary repos.
- Multi-root E2E setup helpers must not silently call single-repo pinning (`repoPath: E2E_REPO_PATH`, `ensureRepoSelected`, or equivalent) after seeding multiple folders. If a creator/helper needs account/model setup only, pass through the existing selected multi-root workspace and assert `workspaceFolders`/source evidence afterward.
- Multi-repo path-rendering tests must use self-contained fixture paths with colliding basenames and payload key variants (`targetFile`, `file_path`, nested `success.filePath`, etc.). Do not depend on another local checkout such as `claude_code`, and do not accept generic labels like `file` as path evidence.
- Multi-repo search tests must validate both the visible source badge and the selected path/pill value. A menu that merely contains two basenames is not enough; the chosen secondary repo result must survive click/keyboard selection into the composer context.
- When a multi-repo bug is fixed in one surface, sweep all equivalent surfaces: session creator, existing chat composer, context menu, event normalizer, props extraction, tool-call summary, grouped transcript rendering, and E2E seed helpers.
- Audit duplicate workspace state sources before adding patches. If both a canonical store path and an older/legacy workspace atom module exist, tests must import the production path and the diff must not add another derived source of truth.
- Any E2E helper that sets `activeFolder`, `selectedRepo`, `workspaceFolders`, or launch workspace fields must return a snapshot of all related atoms/paths and the test must assert the durable/active distinction immediately. If a failure message shows the target path inside the folder dump but matching failed, inspect argument marshaling and path normalization before adding fallback display logic.
- Do not fix multi-repo bugs with display-only band-aids. A valid fix names the data contract, centralizes extraction/resolution once, wires all consumers to that contract, and adds negative tests that would fail if a component-local fallback or single-repo pinning returned.

### Multi-repo acceptance matrix

For any multi-repo fix, cover these dimensions or explicitly state why a dimension is out of scope:

- Session Creator launch payload: primary root is durable `workspace_path`; secondary roots are `additional_directories`.
- Rendered Session Creator `@` search: colliding basenames show persistent repo badges and insert a pill from the chosen repo.
- Existing chat composer `@` search: same source badge/pill behavior after a session already exists.
- Context menu search roots: all workspace folders searched; same relative path in two repos remains two distinct rows.
- Active-folder drift: focusing/selecting a secondary file changes current UI folder only, not default agent launch root.
- Read-file rendering: individual block, grouped read block, and action-summary aggregation all show real paths.
- Payload variants: snake_case, camelCase, nested success/output payloads, and filename fallback are all tested through shared extractors.
- E2E helpers: setup/cleanup may restore single repo only after assertions, never between multi-root seed and the behavior under test.

## Matrix evidence policy

For requested provider/runtime matrices, each row needs current-code evidence and a clear outcome.

- Record the exact account/model/runtime row, command/spec/scenario, and result (`PASS`, `BLOCKED`, or `FAIL`).
- A fallback due to Gemini 429/capacity may satisfy the user flow only if the row records the original provider block and the fallback model that actually produced evidence.
- Do not claim “9 matrix all green” from a subset run, a prior commit, or a combined fallback. Every row must produce independent evidence or be explicitly marked `BLOCKED` with provider/account reason.
- Matrix rows should reuse deterministic fake-provider/debug bridges for product invariants and reserve live-provider rows for integration smoke, otherwise provider flakiness hides product regressions.

## Workspace fixture policy

Core UI E2E must not depend on `yorg_frontend`, `yoyo-evolve`, or any external local project.

The WDIO runner creates a self-contained git fixture repo by default:

- Path: `/tmp/orgii-e2e-workspace-repo`
- Rebuilt at runner startup
- Contains `README.md`, `package.json`, `src/math.ts`, and an initial git commit
- Safe for agent mutation tests

Only set `E2E_REPO_PATH` when intentionally overriding with another sandbox git repo. The runner must reject explicit paths that do not exist, are not git repos, or lack the baseline files.

Session launch specs should pass the fixture `repoPath` through the same session configure/launch caller path the user uses. Do not add a separate `before` hook that only calls `ensureRepoSelected`; that helper can time out before the app is fully settled and can mask the real launch path with WebDriver harness failures.

Recommended isolated UI run when the developer app may already be using `1998`:

```bash
E2E_ISOLATED_RUN=1 \
E2E_ORGII_HOME="/tmp/orgii-e2e-home" \
E2E_FRONTEND_PORT=21998 \
E2E_WEBDRIVER_PORT=24444 \
E2E_IDE_SERVER_PORT=23847 \
npm test
```

WDIO managed runs must not kill or reuse a developer's active ORGII app by default. The runner should fail fast if its managed ports are occupied unless `E2E_ALLOW_PORT_CLEANUP=1` is explicitly set. When `E2E_FRONTEND_PORT` differs from `1998`, the WDIO runner must make that real by building the webdriver debug app against a temporary Tauri `devUrl` pointing at the requested port, then restoring `src-tauri/tauri.conf.json` exactly. Merely starting webpack on a non-1998 port is false isolation because an unpatched debug app still loads `http://localhost:1998`.

## Rust runtime E2E policy

`e2e-test` is a deterministic runtime contract suite, not a second UI suite and not a live-provider platform matrix. Keep it much smaller than the historical audit-era suite.

Keep:

- Backend/runtime invariants not covered by rendered UI E2E.
- Deterministic debug-endpoint coverage for memory, learning, permissions, worktree, session recovery, housekeeping, LSP, gateway/sync/MCP contracts, subagent dispatch, and tool execution invariants.
- Tool-policy and agent-definition contracts that are hard to observe from UI alone, especially positive/negative schema or policy assertions. Use the session-scoped effective-tools surface (`agent_list_effective_tools_for_session`, `/agent/test/effective-tools/:session_id`, or `__e2e.listEffectiveToolsForSession`) rather than global `list_all_tools` or registry-only `/agent/test/tool-schemas/:session_id` when asserting what a running agent can actually see in a mode-filtered prompt.
- Scenarios with stable setup, stable assertions, and explicit teardown/isolation.

Delete or move out:

- Historical phase/audit scenarios whose invariant is already covered by a canonical scenario.
- Long-running live-LLM scenarios that mainly duplicate UI/platform matrix behavior.
- Provider-specific smoke tests that are better covered by core UI matrix rows.
- Memory/learning tests that only prove the model can recall rendered text; keep state/DB/policy pins instead.
- Plan lifecycle tests that assert user-visible card/button behavior; keep only backend policy/snapshot invariants in Rust.
- Scenarios whose only assertion is `HTTP 200` or loose text without a stable invariant.
- Dead helper modules/functions not registered in `main.rs` and not called by a registered scenario.

When cleaning Rust E2E:

1. Inspect `src-tauri/crates/e2e-test/src/main.rs` scenario registry.
2. Count groups with `cargo run -p e2e-test -- --list` or a local registry parser.
3. Remove entries only when their invariant is duplicated, obsolete, flaky by design, or moved to UI E2E.
4. Delete the module/function after removing the registry entry.
5. Run `cargo check -p e2e-test` and `cargo fmt`.

## Choosing the right layer

| Claim                                  | Required coverage                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime state/tool behavior is correct | Rust `e2e-test` or deterministic debug endpoint                                                                                    |
| Tauri command shape is correct         | Command call plus TypeScript contract/type check                                                                                   |
| Card/button/menu/slash action works    | WDIO rendered-app test                                                                                                             |
| Configurable UI field works            | Five-layer alignment plus rendered submit-path coverage                                                                            |
| Unsupported feature is gone            | Negative UI assertion and/or backend action-list assertion                                                                         |
| Provider returns 429/capacity          | classify as provider capacity unless ORGII mishandles it                                                                           |
| Agent has the right tools              | session-scoped effective-tools API plus backend schema/policy negative+positive test; add UI smoke only when the tools are visible |

## Commands

Rust runtime:

```bash
cd src-tauri
cargo run -p e2e-test -- --list
cargo run -p e2e-test -- --scenario plan-mode-denies-writes
cargo run -p e2e-test -- --group memory
cargo check -p e2e-test
cargo fmt -p e2e-test
```

Core UI:

```bash
cd tests/e2e
npm test
npm test -- --spec './specs/core/session-plan-ui.spec.mjs'
E2E_CONTROL_SCENARIOS=plan-update npm test -- --spec './specs/core/session-controls-ui.spec.mjs'
E2E_CONTROL_SCENARIOS=plan-edit-resend npm test -- --spec './specs/core/session-controls-ui.spec.mjs'
```

## Result-driven orchestration regressions

Rendered orchestration tests must start from the final user result and durable end-state, not from implementation breadcrumbs. A test that creates rows/cards but would still pass when a run stops with incomplete work is a false positive.

For Agent Org / multi-member / queue scenarios, every complex spec should state or encode:

- Final user outcome: what the org/team should have achieved.
- Final DB invariants: run status converged; all completed tasks are actually completed; open work is visibly blocked/abandoned; no `in_progress` task lacks an owner.
- Final UI evidence: resident member sessions are visible and switchable in the left sidebar, member transcripts open, and task board status does not contradict run/session state.
- Runtime path evidence: production launch, task tools, member wake/drain, inbox delivery, and member-session messaging paths ran; debug helpers only seed or inspect.
- Anti-false-positive checks: scenario-named tasks, passive inbox rows, synthetic cards, or a second corrective prompt do not count as success.
- Latest-session evidence: after a user reports a stuck or contradictory Agent Org run, inspect the newest run/session/task/inbox durable state and the latest terminal/app log before claiming the fix is verified. Do not infer success from an older green scenario or from a different synthetic run.

A Rust runtime E2E that posts protocol messages or calls debug endpoints is not proof that Agent Org works in the app. Rendered Agent Org acceptance must drive the production launch path from the UI, wait for production wake/drain/member-session turns, and then assert both UI and durable DB finality. Unit tests and Rust E2E can pin regressions, but they cannot be used as the sole evidence for “Agent Org advances correctly.”

Minimum failure cases that a valid Agent Org spec must catch:

- A `running` run with `pending` / `in_progress` tasks, no active member session, and no unread inbox work to wake/drain.
- A ready assigned `pending` task whose dependencies are all completed, but whose owner has no unread `TaskAssigned` inbox row and no active member turn.
- Unread org inbox rows that remain unread after the owner/member production session has gone idle/completed a turn.
- `status = "in_progress"` with `owner = null`, or `status = "in_progress"` set by the coordinator for another member rather than by the owning member's claim/drain path.
- A `completed` run that still has `pending` or `in_progress` tasks.
- Member sessions visible in the coordinator overview but absent from the left sidebar.
- Multiple org members sharing the same `agent_id` / `agent_definition_id` while inbox delivery, wake, drain, task owner, and task-tool authorization are only keyed by `agent_id`.
- A run that appears visually populated but cannot make forward progress from the original user prompt without a corrective second prompt.

## Plan, rewind, and streaming regressions

Rendered plan tests must pin the caller path, not only derived UI helpers:

- Rewind/edit-resend must invalidate stale queued turns and cancel the active turn before sending the replacement message.
- Plan update/edit-resend tests must assert no duplicate pending/drafting cards, only the latest plan is buildable, and stale revisions remain visible only as archived history when appropriate.
- Plan card diagnostics must distinguish surfaces by `data-plan-surface`: `transcript` cards in chat history, `current` cards in the pending review bar, and communication-side preview cards.
- Stop/Send button E2E clicks must be atomic with the expected `data-state`.
- Long-running debug HTTP endpoints must be called from the WDIO Node process, not through `browser.executeAsyncScript(fetch(...))`.
- Streaming marker assertions must wait for the full expected marker, not only for assistant text to become non-empty or change.

## Hard rules

- Never change product business semantics to make an E2E pass. E2E fixes should wire the existing backend/runtime path, assert the current UI contract, or expose a real product bug.
- Never run mutation-capable UI E2E against `yorg_frontend`.
- Never claim “E2E passed” after only running unit tests, focused module tests, `cargo check`, or Rust protocol/debug-endpoint scenarios. Name the exact surface that passed: unit, Rust runtime E2E, or Core UI E2E.
- Never add a rendered UI claim to Rust-only coverage.
- Never add a debug endpoint that tests only a helper when the bug is in the caller path.
- Never preserve an obsolete scenario just because it once caught a phase bug; keep the invariant, not the phase artifact.

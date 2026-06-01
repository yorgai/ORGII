# cursor-bridge

Drive a running Cursor.app instance via the Chrome DevTools Protocol
exposed by `--remote-debugging-port=<port>` (renderer), by reaching
into Cursor's renderer-side workbench services (`composerService`,
`composerChatService`, `composerModesService`, `modelConfigService`,
`agentRepositoryService`, `glassActiveAgentService`).

## What this crate provides

| Module        | Public function                      | Cursor service                                                                                               |
| ------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `composer.rs` | `open_new_composer(unified_mode)`    | `composerService.createComposer({ partialState })`                                                           |
| `composer.rs` | `send_chat_message_to(text, target)` | `composerChatService.submitChatMaybeAbortCurrent`                                                            |
| `routing.rs`  | `route_to_composer(agent_id)`        | `HBC.onSelectAgent` (fallback: `glassActiveAgentService.setActiveAgentId`)                                   |
| `routing.rs`  | `list_agents()`                      | `agentRepositoryService.delegate._agentHeaderById`                                                           |
| `models.rs`   | `list_models()`                      | `modelConfigService.getAvailableDefaultModels`                                                               |
| `models.rs`   | `set_model_for_composer(id, name)`   | `modelConfigService.setModelConfigForComposer` (per-composer) → `setSpecificModel("composer", …)` (fallback) |
| `modes.rs`    | `list_modes()`                       | `composerModesService.getAllModes`                                                                           |
| `modes.rs`    | `set_mode_for_composer(id, mode)`    | `composerModesService.setComposerUnifiedMode`                                                                |

All seven services are reached through a shared bootstrap helper in
`workbench::PRELUDE` — a small JS payload that walks React fibers
anchored on `[data-composer-id]` / `.monaco-workbench` / `body` and
returns the workbench `IInstantiationService` regardless of whether
the surface is a warm composer view or a cold standalone Agents view.

## Why this design (vs. the old DOM-driving approach)

Earlier phases used CDP `Input.insertText` + `Input.dispatchKeyEvent`
to type into the live ProseMirror editor and press Enter. That worked
for warm composers but had several brittleness modes:

1. Required a focused `.ui-prompt-input-editor__input` in the DOM —
   broke when the workbench wasn't on a composer view.
2. Required the new composer to mount within ~3 s before we could
   type — broke on a cold probe (no `[data-composer-id]` to poll
   for change).
3. Required snapshotting `state.vscdb` before/after each submit and
   diffing it to recover the new composer id, since `Input.*` has no
   return value channel.
4. Tied us to ProseMirror's exact submit handler — would break if
   Cursor switched editors.

Going through `composerService` / `composerChatService` directly is
the same channel the user's Enter key eventually feeds into, just
one layer higher. No DOM dependency, no input focus dance, no Enter
key press, no polling for mount, no DB diffing — `createComposer`
returns the composer id authoritatively and `submitChatMaybeAbortCurrent`
submits to any composer by id whether it's visible or not.

## One-time Cursor setup

The probe runs against an isolated Cursor instance (separate
`--user-data-dir`) so it doesn't disturb your real Cursor session.
`lifecycle::ensure_running` rsync-seeds the isolated user-data-dir
from your real one on first use; the seed excludes large directories
(workspaceStorage, History, Backups, logs, CachedData, IndexedDB)
so it's a few hundred MB instead of the multi-GB raw copy.

The macOS keychain entry that encrypts Cursor's auth blob is keyed
by the binary, so the isolated instance decrypts it successfully and
shows up logged in.

Verify the renderer DevTools endpoint responds:

```bash
curl -s http://127.0.0.1:9230/json/list | jq '.[] | {id, type, title}'
```

You should see one `Page` target titled `Cursor Agents`.

## Shared-attach: skip the second Cursor window

By default ORGII spawns a second Cursor process (the "probe") with a
separate `--user-data-dir`. That keeps the user's main Cursor
untouched, but it costs an extra ~500 MB-1 GB of RAM and shows up
as a second Cursor window/dock icon.

If you don't mind ORGII driving the same Cursor you work in
day-to-day, launch _your_ Cursor with `--remote-debugging-port=9230`
and ORGII will attach to it instead of spawning the probe:

```bash
# In ~/.zshrc or ~/.bashrc:
alias cursor='/Applications/Cursor.app/Contents/MacOS/Cursor --remote-debugging-port=9230 &'
```

`lifecycle::detect_cursor_mode` reports one of:

- `sharedAttached { isProbe: false }` — your daily-driver Cursor.
  No probe ever runs.
- `sharedAttached { isProbe: true }` — the probe spawned by an
  earlier `ensure_running`.
- `realRunningNoDebugPort { realPids: [...] }` — your Cursor is
  running but doesn't expose the flag. The probe spawns alongside
  it (they're isolated by `--user-data-dir`); the result reports
  this mode so the UI can show a hint encouraging you to restart
  with the alias.
- `needProbe` — no Cursor anywhere; the probe is spawned.

### Trade-offs

| Mode            | Pros                                          | Cons                                                                   |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Shared (alias)  | One Cursor process, your real chats, no rsync | ORGII drives your real Cursor — bugs in send code can affect your chats |
| Probe (default) | Total isolation; user's Cursor never touched  | Two Cursors, ~10 s first-run rsync, a few hundred MB seed dir          |

## Probe usage

```bash
PROBE=~/.cargo/shared-target/debug/cursor-bridge-probe
cargo build -p cursor_bridge --bin cursor-bridge-probe

# Sanity check — list renderer targets.
$PROBE --port 9230 list-targets

# Open a fresh composer in agent mode and seed it with a prompt.
$PROBE --port 9230 --target-filter "" new-composer --mode agent --text "say hello"

# Send a follow-up to a specific composer (id from the new-composer call).
$PROBE --port 9230 --target-filter "" send --target-agent-id <uuid> --text "now in french"

# Switch the composer's mode + model.
$PROBE --port 9230 --target-filter "" set-mode --agent-id <uuid> --mode plan
$PROBE --port 9230 --target-filter "" set-model --agent-id <uuid> --model gpt-5.3-codex
```

All subcommands accept `--json` for machine-readable output, plus
the global flags `--port`, `--host`, `--target-filter`, `--target-id`,
and `--timeout-secs`.

`RUST_LOG=cursor_bridge_probe=debug,cursor_bridge=debug` enables
verbose tracing on stderr.

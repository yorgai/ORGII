//! Channel inbound handler: routes external channel messages to the OS
//! singleton-per-chat session (`osagent-<channel>-<chat_id>[-v{n}]`) and
//! dispatches slash commands against that session.
//!
//! The previous design ran every un-bound message through a
//! `gateway-singleton` LLM that decided which specialist agent to spawn.
//! Dogfooding (Apr 2026) showed this "pure router" pattern rejected the
//! bulk of conversational traffic (news, writing, advice) because the
//! routing prompt was scoped to coding/OS tasks. We now treat the OS
//! agent as the single channel-facing entry point — it handles
//! conversation directly and delegates coding tasks to `builtin:sde`
//! via the unified subagent tool.
//!
//! Submodules:
//! - `dispatch`   — `GatewayInboundHandler` + `dispatch_to_session` + the
//!   small helpers it needs (session-id minting, reset-notice prepend,
//!   debug-outbound mirror).
//! - `slash`      — `/help`, `/new`, `/status`, `/compact` handling.
//! - `idle_reset` — idle-archive detection + reset bookkeeping.
//! - `lifecycle`  — process bootstrap + the two `#[tauri::command]`
//!   surfaces (`agent_toggle_channel`, `agent_set_gateway_model`) plus
//!   the `restore_*` / `ensure_*` entry points used by `lib.rs` and tests.

mod dispatch;
mod idle_reset;
mod lifecycle;
mod slash;

pub use lifecycle::ensure_gateway_infra;
pub use lifecycle::{agent_set_gateway_model, agent_toggle_channel, restore_enabled_channels};

// `#[tauri::command]` generates a sibling `__cmd__<name>` module next to
// each command fn. The `tauri::generate_handler!` invocation in
// `commands/handler_list.inc` looks them up via the same path it uses
// for the fn — i.e. `channel_handler::__cmd__agent_*` — so we re-export
// the helper modules from the original location to keep that path
// resolvable after the split.
pub use lifecycle::{__cmd__agent_set_gateway_model, __cmd__agent_toggle_channel};

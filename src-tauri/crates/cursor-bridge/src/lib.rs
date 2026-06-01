//! `cursor_bridge` — drive a running Cursor.app via the Chrome
//! DevTools Protocol exposed by Cursor's `--remote-debugging-port=<port>`
//! flag.
//!
//! ## Public surface
//!
//!  - [`send_chat_message`] / [`send_chat_message_to`]: submit a
//!    prompt to a Cursor composer via
//!    `composerChatService.submitChatMaybeAbortCurrent`. The `_to`
//!    variant takes an explicit composer id; the plain variant
//!    submits to whichever composer Cursor has selected.
//!  - [`open_new_composer`]: create a fresh composer via
//!    `composerService.createComposer`. Returns the new composer's
//!    id directly — no DOM polling, no dependency on a pre-existing
//!    composer in the workbench. Pair with `send_chat_message_to`
//!    (passing the returned id) to seed the new composer with the
//!    user's first prompt.
//!  - [`route_to_composer`]: switch the standalone Agents view to
//!    a target composer id without sending anything. Useful for
//!    "open this conversation" affordances (Phase 3a).
//!  - [`list_agents`]: enumerate every composer the probe Cursor
//!    knows about, with title / timestamps / archived flag — what
//!    the picker UI shows.
//!  - [`list_models`] / [`set_model_for_composer`]: read Cursor's
//!    available LLM list and pick which one the next prompt uses
//!    (Phase 3d). Both round-trip through Cursor's own
//!    `modelConfigService` so the picker reflects whatever Cursor
//!    has in its catalog *right now*.
//!  - [`list_modes`] / [`set_mode_for_composer`]: read Cursor's
//!    unified-mode picker (Agent / Plan / Debug / Ask / Multitask
//!    / Project) and switch a specific composer between them. Talks
//!    to `composerModesService` the same way the model helpers talk
//!    to `modelConfigService`.
//!  - [`CdpClient`]: low-level CDP transport. Opens a WebSocket to a
//!    target's `webSocketDebuggerUrl` and exposes `Runtime.evaluate`
//!    plus a generic [`CdpClient::call`] for arbitrary CDP methods
//!    (e.g. `Input.insertText`).
//!  - [`discover_targets`]: hit `http://<host>:<port>/json/list` and
//!    parse the inspector's target list so callers can pick the
//!    renderer `Page` to attach to.
//!  - The `cursor-bridge-probe` binary (in `src/bin/probe.rs`) wires
//!    these together with a `clap` CLI for manual / CI validation.
//!
//! ## Why a separate crate
//!
//! - **Build isolation.** CDP sits behind WebSocket / HTTP /
//!   serde_json plumbing the main app doesn't otherwise need.
//!   Keeping it in its own compile unit means a probe tweak doesn't
//!   invalidate the main app's incremental build cache.
//! - **Separable shipping.** The probe binary is internal tooling —
//!   keeping it out of the Tauri target avoids accidentally bundling
//!   it into a release.
//! - **Stable lib boundary.** The main `app` Tauri binary depends on
//!   this crate's high-level helpers (`send_chat_message_to`,
//!   `list_agents`, `list_models`, …) without pulling in the probe
//!   CLI.

pub mod cdp;
pub mod composer;
pub mod error;
pub mod models;
pub mod modes;
pub mod routing;
pub mod workbench;

pub use cdp::{
    discover_targets, CdpClient, EvalOutcome, EvalResult, RuntimeException, Target, TargetType,
};
pub use composer::{
    inject_delta_observer, open_new_composer, send_chat_message, send_chat_message_to,
    DeltaPayload, NewComposerOutcome, SendOutcome,
};
pub use error::{CdpError, Result};
pub use models::{list_models, set_model_for_composer, ModelCapabilities, ModelEntry};
pub use modes::{list_modes, set_mode_for_composer, ModeEntry};
pub use routing::{list_agents, route_to_composer, AgentHeaderSummary, RouteOutcome};

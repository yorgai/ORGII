//! Cursor IDE Control
//!
//! Drive a running Cursor.app instance over the Chrome DevTools Protocol
//! exposed by `--remote-debugging-port=<port>` so the user can submit
//! prompts to a Cursor chat from inside ORGII without leaving our app.
//!
//! ## Layering
//!
//! - The low-level CDP transport + the `composerService` /
//!   `composerChatService` glue live in the standalone
//!   [`cursor_bridge`] crate (`src-tauri/crates/cursor-bridge/`).
//!   That crate is the unit that gets validated end-to-end by
//!   `cursor-bridge-probe` against a real Cursor install.
//! - This crate (`cursor_bridge_app`,
//!   `src-tauri/crates/cursor-bridge-app/`) is the *Tauri-side
//!   wrapper*: `#[tauri::command]` handlers, isolated probe-instance
//!   lifecycle (launch / status / port plumbing), and the offline
//!   `state.vscdb` model fallback for when the probe isn't up yet.
//!
//! ## Cursor process selection
//!
//! When a Cursor instance is already reachable on the debug port, ORGII
//! attaches to it. When no Cursor is running, ORGII may start an isolated
//! probe instance. When the user's real Cursor is already running without
//! the debug port, ORGII asks before restarting that same instance instead
//! of silently opening a second window; history follow-ups must target the
//! Cursor process that owns the conversation DB.
//!
//! ## Module layout
//!
//! - `client` — connect to a renderer Page target and run lib
//!   functions (`send_chat_message_to`, `open_new_composer`,
//!   `route_to_composer`, `list_agents`, `list_models`,
//!   `set_model_for_composer`) against it.
//! - `vscdb_models` — offline fallback: read Cursor's available-
//!   model list straight from `state.vscdb` when the probe Cursor
//!   isn't running yet.
//! - `lifecycle` — ensure the isolated Cursor probe instance is
//!   running and reachable on the configured port.
//! - `commands` — `#[tauri::command]` handlers wired into
//!   `handler_list.inc`.

pub mod client;
pub mod commands;
pub mod lifecycle;
pub mod vscdb_models;

pub use commands::*;
pub use cursor_bridge::DeltaPayload;

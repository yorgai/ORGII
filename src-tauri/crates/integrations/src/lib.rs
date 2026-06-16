//! External Integrations
//!
//! External service integrations. Bundles `computer_use_lock` (single-session
//! file lock for Computer Use tools), `external_ide` (open-in-IDE Tauri
//! commands), `github` (REST + gh-cli token detection), and `proxy` (per-session
//! MITM HTTPS proxy + ORGII-cloud allocate/release).
//!
//! This crate's `#[tauri::command]` macros stay in-crate (key-vault /
//! cursor-bridge pattern); the `app` crate just re-registers them in
//! `commands/handler_list.inc`. The single back-edge into `app` —
//! `computer_use_lock::request_abort` broadcasting `agent:computer_use_aborted`
//! — flows through [`computer_use_lock::register_abort_broadcaster`], wired
//! once at startup so this crate never depends on `agent_core`.
//!
//! Note: Cursor and Kiro runner-specific modules (credential capture, usage
//! tracking, SSO) live in `agent_sessions::cli::platform_adapters::{cursor,kiro}`.

pub mod commands;
pub mod computer_use_lock;
pub mod external_ide;
pub mod github;
pub mod proxy;

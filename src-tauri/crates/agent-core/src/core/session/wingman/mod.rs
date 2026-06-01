//! Wingman mode — periodic screen-observation background task.
//!
//! ## Overview
//!
//! When Wingman mode is active the agent acts as a silent senior-engineer
//! sitting next to the user. Every observation interval the loop:
//!
//! 1. Captures a screenshot via native ScreenCaptureKit.
//! 2. Pulls recent activity from `FlowStore` (file edits, commands, errors).
//! 3. Enqueues a synthetic "observe" turn on the session's `DialogScheduler`,
//!    which processes it through the normal LLM pipeline in Wingman mode.
//! 4. The session broadcasts `agent:complete` as usual; additionally
//!    `loop_runner` broadcasts `wingman:observation` so the frontend can
//!    surface the nudge in the overlay without attaching a chat message.
//!
//! ## Lifecycle
//!
//! ```text
//!   wingman::start(session_id, mission)
//!       └─ spawns WingmanLoop::run()
//!              └─ loop { sleep(interval) → observe → enqueue }
//!   wingman::stop(session_id)
//!       └─ drops CancellationToken → loop exits
//! ```
//!
//! `WingmanSessionState` (with the live `WingmanHandle`) is stored on
//! `AgentSession.wingman`. The handle is `None` while Wingman is inactive
//! and `Some` while running.
//!
//! ## Module layout
//!
//! - [`handle`] — `WingmanHandle` + `WingmanSessionState` (per-session state)
//! - [`lifecycle`] — public `start` / `stop` / `prewarm` / `close` / `toggle`
//! - [`loop_runner`] — the background `WingmanLoop` (observe + enqueue)
//! - [`monitors`] — display enumeration shared by panel + bar
//! - [`window`] — the always-on-top Wingman floating panel
//! - [`bar`] — the bottom dock-hugging strip (Zoom-style toolbar pill)
//! - [`observation`] — screenshot capture + observation prompt builder
//! - [`macos_window`] *(macOS only)* — Cocoa window-behavior tweaks
//! - [`bar_native`] *(macOS, `wingman-bar-native`)* — Swift FFI bar driver

mod handle;
mod lifecycle;
mod loop_runner;
mod monitors;
mod window;

mod observation;

mod bar;

#[cfg(target_os = "macos")]
mod macos_window;

#[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
pub(crate) mod bar_native;

#[cfg(target_os = "windows")]
mod windows_bar;

// External callers import via `session::wingman::wingman_bar_native::*`.
// Keep that path stable while the implementation lives in the `bar_native`
// module file (cleaner filename — matches the `bar` naming elsewhere).
#[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
pub(crate) use bar_native as wingman_bar_native;

pub use handle::WingmanSessionState;
pub use lifecycle::{prewarm_wingman_windows, start, stop};
pub use monitors::WingmanMonitorInfo;

pub(crate) use bar::{close_wingman_bar, is_wingman_bar_visible, open_wingman_bar};
pub(crate) use lifecycle::{close_wingman_windows, toggle_panel};
pub(crate) use monitors::list_monitors;
pub(crate) use window::{
    hide_wingman_window, is_wingman_window_visible, open_wingman_window,
    show_desktop_operation_caption, show_existing_wingman_window,
};

//! Platform-specific FFI shims hoisted out of `app::infrastructure::platform`
//! so workspace crates (notably `agent_core`) can depend on them without
//! depending back on the `app` crate.
//!
//! Currently exposes only the macOS `objc_bridge` — additional sibling
//! modules (e.g. Windows DWM helpers) can be added here as the
//! modularization work progresses.

#[cfg(target_os = "macos")]
pub mod objc_bridge;

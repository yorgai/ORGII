//! Desktop integration support for macOS.
//!
//! Agent-facing desktop automation is exposed through the bundled Peekaboo CLI
//! wrapper. The native modules below remain for app-owned desktop surfaces such
//! as permissions, overlays, screenshots, and cursor feedback.

#[cfg(target_os = "macos")]
pub mod escape_hotkey;
mod peekaboo_cli_tool;
#[cfg(target_os = "macos")]
pub mod permissions;
#[cfg(target_os = "macos")]
pub mod screen_capture;

pub use peekaboo_cli_tool::{
    restore_desktop_operation_visibility_now, show_desktop_operation_visibility_test,
    PeekabooCliTool,
};

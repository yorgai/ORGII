//! Tee tool-call lifecycle events to the Wingman bar overlay.
//!
//! Wingman sessions get an extra `wingman:tool-status` broadcast so the
//! always-on-top bar can render a short preview of what the agent is doing
//! ("running grep for foo", "edit_file done", "shell error"). On macOS with
//! the native bar feature flag we additionally drive the NSPanel directly
//! so the status text is updated outside the webview event loop.

use serde_json::Value;

use crate::bus::broadcast_event;
use crate::definitions::prefix_lookup::is_wingman_session_id;

use super::helpers::tool_status_preview_from_args;

#[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
use crate::session::wingman::wingman_bar_native;

/// Tee the `running` half of a tool-call to the Wingman bar.
pub(super) fn tee_tool_call(session_id: &str, tool_name: &str, args: &Value) {
    if !is_wingman_session_id(session_id) {
        return;
    }
    let preview = tool_status_preview_from_args(tool_name, args);
    broadcast_event(
        "wingman:tool-status",
        serde_json::json!({
            "sessionId": session_id,
            "tool": tool_name,
            "status": "running",
            "preview": preview,
        }),
    );
    #[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
    {
        wingman_bar_native::set_status(&preview);
        wingman_bar_native::set_tool_indicator(1);
    }
    #[cfg(not(all(target_os = "macos", feature = "wingman-bar-native")))]
    let _ = preview;
}

/// Tee the `done` / `error` half of a tool-call to the Wingman bar.
pub(super) fn tee_tool_result(session_id: &str, tool_name: &str, result: &str) {
    if !is_wingman_session_id(session_id) {
        return;
    }
    let is_error = result.starts_with("Error");
    let short: String = result
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(80)
        .collect();
    broadcast_event(
        "wingman:tool-status",
        serde_json::json!({
            "sessionId": session_id,
            "tool": tool_name,
            "status": if is_error { "error" } else { "done" },
            "preview": short,
        }),
    );
    #[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
    {
        wingman_bar_native::set_status(&short);
        wingman_bar_native::set_tool_indicator(if is_error { 2 } else { 0 });
    }
    #[cfg(not(all(target_os = "macos", feature = "wingman-bar-native")))]
    let _ = short;
}

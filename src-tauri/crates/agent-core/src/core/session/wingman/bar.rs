//! Always-on native island surface.
//!
//! macOS uses the Swift/AppKit NSPanel implementation (`bar_native`). Other
//! platforms intentionally do not create a Tauri WebviewWindow fallback; they
//! should use a system-level implementation when added.

use tracing::warn;

#[cfg(target_os = "windows")]
use super::windows_bar;
#[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
use super::wingman_bar_native;

/// Expand the always-on native island for active work.
pub(crate) fn open_wingman_bar(
    #[allow(unused_variables)] app_handle: &tauri::AppHandle,
    #[allow(unused_variables)] session_id: &str,
    #[allow(unused_variables)] mission: &str,
    #[allow(unused_variables)] monitor_index: Option<usize>,
) {
    #[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
    {
        wingman_bar_native::init(app_handle);
        wingman_bar_native::set_status(mission);
        wingman_bar_native::set_stopped(false);
        wingman_bar_native::set_elapsed(0);
        wingman_bar_native::set_tool_indicator(0);
        wingman_bar_native::show(session_id, mission, monitor_index);
        warn!("[island] Native island expanded");
    }

    #[cfg(target_os = "windows")]
    windows_bar::show(session_id, mission, monitor_index);

    #[cfg(not(any(
        all(target_os = "macos", feature = "wingman-bar-native"),
        target_os = "windows"
    )))]
    warn!("[wingman-bar] No native Wingman bar implementation for this platform yet");
}

/// Collapse the always-on native island back to its compact closed state.
pub(crate) fn close_wingman_bar(#[allow(unused_variables)] app_handle: &tauri::AppHandle) {
    #[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
    {
        wingman_bar_native::hide();
        warn!("[island] Native island collapsed");
    }

    #[cfg(target_os = "windows")]
    windows_bar::hide();

    #[cfg(not(any(
        all(target_os = "macos", feature = "wingman-bar-native"),
        target_os = "windows"
    )))]
    warn!("[wingman-bar] No native Wingman bar implementation to hide for this platform yet");
}

pub(crate) fn is_wingman_bar_visible(
    #[allow(unused_variables)] app_handle: &tauri::AppHandle,
) -> bool {
    #[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
    {
        return wingman_bar_native::is_visible();
    }

    #[cfg(target_os = "windows")]
    {
        return windows_bar::is_visible();
    }

    #[cfg(not(any(
        all(target_os = "macos", feature = "wingman-bar-native"),
        target_os = "windows"
    )))]
    {
        false
    }
}

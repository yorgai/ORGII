//! Windows-native Wingman bar entry points.
//!
//! This module is intentionally separate from the removed Tauri Webview bar.
//! The Win32 implementation will own a system-level topmost toolbar window;
//! until that is wired, Windows callers get explicit warnings instead of a
//! hidden webview fallback.

#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

use tracing::warn;

static VISIBLE: AtomicBool = AtomicBool::new(false);

pub(crate) fn show(session_id: &str, mission: &str, monitor_index: Option<usize>) {
    VISIBLE.store(true, Ordering::SeqCst);
    warn!(
        "[wingman-bar/windows] system-level bar requested session_id={}, mission={}, monitor_index={:?}; Win32 implementation pending",
        session_id,
        mission,
        monitor_index
    );
}

pub(crate) fn hide() {
    VISIBLE.store(false, Ordering::SeqCst);
    warn!("[wingman-bar/windows] system-level bar hide requested; Win32 implementation pending");
}

pub(crate) fn is_visible() -> bool {
    VISIBLE.load(Ordering::SeqCst)
}

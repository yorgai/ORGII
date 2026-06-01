//! Windows 11+ DWM window corner preference for decorated windows.
//!
//! Sets `DWMWCP_ROUND` (8 px at 100 % DPI) so the native frame matches the
//! frontend's `--border-radius-window: 8px` on Windows (see `windowChromeRadius.ts`).

use std::ffi::c_void;

use tauri::WebviewWindow;
use tracing::warn;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};

pub(super) fn apply_dwm_rounded_corner_preference(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(handle) => handle,
        Err(err) => {
            warn!(
                target: "app_lib::window",
                "WebviewWindow::hwnd failed (skipping DWM corner preference): {}",
                err
            );
            return;
        }
    };

    let preference = DWMWCP_ROUND;
    let set_result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            std::ptr::from_ref(&preference).cast::<c_void>(),
            std::mem::size_of_val(&preference) as u32,
        )
    };

    if let Err(err) = set_result {
        warn!(
            target: "app_lib::window",
            "DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE) failed: {}",
            err
        );
    }
}

#[cfg(all(test, windows))]
#[path = "tests/windows_corner_tests.rs"]
mod windows_corner_tests;

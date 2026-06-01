//! The Wingman floating panel webview window — build, position, show, hide.
//!
//! The panel is the always-on-top 420×620 webview that surfaces observations
//! and lets the user interact with Wingman. It's prewarmed at app startup
//! (see `lifecycle::prewarm_wingman_windows`) so the first `open_wingman_window`
//! is a plain `show()` rather than a webview spin-up.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tracing::warn;

use crate::foundation::bus::broadcast_event;

use super::monitors::resolve_monitor;

#[cfg(target_os = "macos")]
use super::macos_window;

pub(super) const WINGMAN_WINDOW_LABEL: &str = "wingman";
const WINGMAN_WINDOW_WIDTH: f64 = 420.0;
const WINGMAN_WINDOW_HEIGHT: f64 = 620.0;

/// Compute the bottom-right position for the panel on `monitor_index`'s work area.
fn panel_position_for(app_handle: &tauri::AppHandle, monitor_index: Option<usize>) -> (f64, f64) {
    let margin = 20.0;
    match resolve_monitor(app_handle, monitor_index) {
        Some(monitor) => {
            let scale = monitor.scale_factor();
            let work = monitor.work_area();
            let work_x = work.position.x as f64 / scale;
            let work_y = work.position.y as f64 / scale;
            let work_w = work.size.width as f64 / scale;
            let work_h = work.size.height as f64 / scale;
            (
                work_x + work_w - WINGMAN_WINDOW_WIDTH - margin,
                work_y + work_h - WINGMAN_WINDOW_HEIGHT - margin,
            )
        }
        None => (margin, margin + 40.0),
    }
}

/// Build the always-on-top Wingman floating panel window (hidden by default).
///
/// Used both by prewarm (at app startup, `visible=false`) and as a fallback
/// in `open_wingman_window` when the prewarmed window has been destroyed.
pub(super) fn build_wingman_window(
    app_handle: &tauri::AppHandle,
    initial_url: &str,
    visible: bool,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let webview_url = WebviewUrl::App(initial_url.into());

    let builder = WebviewWindowBuilder::new(app_handle, WINGMAN_WINDOW_LABEL, webview_url)
        .title("Wingman")
        .inner_size(WINGMAN_WINDOW_WIDTH, WINGMAN_WINDOW_HEIGHT)
        .min_inner_size(280.0, 360.0)
        .resizable(true)
        .always_on_top(true)
        .decorations(true)
        .visible(visible)
        .skip_taskbar(true);

    let window = builder.build()?;

    let app_h_for_close = app_handle.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Hide instead of destroying, so reopen is instant. Only fully
            // close via `close_wingman_windows` (stop / app shutdown).
            api.prevent_close();
            if let Some(w) = app_h_for_close.get_webview_window(WINGMAN_WINDOW_LABEL) {
                let _ = w.hide();
            }
            warn!("[wingman] Caption/panel window closed; bar remains visible");
        }
    });

    #[cfg(target_os = "macos")]
    macos_window::apply_window_behavior(&window);

    Ok(window)
}

pub(crate) fn is_wingman_window_visible(app_handle: &tauri::AppHandle) -> bool {
    app_handle
        .get_webview_window(WINGMAN_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

pub(crate) fn show_existing_wingman_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window(WINGMAN_WINDOW_LABEL) {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn show_desktop_operation_caption(app_handle: &tauri::AppHandle, caption: &str) {
    let (x, y) = panel_position_for(app_handle, None);
    if let Some(window) = app_handle.get_webview_window(WINGMAN_WINDOW_LABEL) {
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let url = format!(
            "/windows/wingman?caption={}",
            encode_query_component(caption)
        );
        match build_wingman_window(app_handle, &url, true) {
            Ok(window) => {
                let _ = window
                    .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
                let _ = window.set_always_on_top(true);
                let _ = window.set_focus();
            }
            Err(err) => warn!(
                "[wingman] Failed to build desktop operation caption: {}",
                err
            ),
        }
    }

    broadcast_event(
        "wingman:window-context",
        serde_json::json!({
            "sessionId": "",
            "mission": "Desktop control",
            "caption": caption,
        }),
    );
}

fn encode_query_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte_item| match byte_item {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte_item as char]
            }
            byte_item => format!("%{byte_item:02X}").chars().collect(),
        })
        .collect()
}

pub(crate) fn hide_wingman_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window(WINGMAN_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

/// Open the always-on-top Wingman floating panel window.
///
/// If the window was prewarmed at app startup this is an O(1) reposition +
/// `show()`. Otherwise we fall back to building it on demand. Positions
/// itself in the bottom-right corner of the selected monitor (`monitor_index`
/// into `available_monitors()`); falls back to the primary monitor when
/// `None` or out of range.
pub(crate) fn open_wingman_window(
    app_handle: &tauri::AppHandle,
    session_id: &str,
    monitor_index: Option<usize>,
) {
    let (x, y) = panel_position_for(app_handle, monitor_index);

    // Happy path: window already exists (prewarmed or previously shown). Just
    // reposition + show + focus. This is the "feels like Zoom" path.
    if let Some(w) = app_handle.get_webview_window(WINGMAN_WINDOW_LABEL) {
        let _ = w.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        let _ = w.set_always_on_top(true);
        let _ = w.show();
        let _ = w.set_focus();
        broadcast_event(
            "wingman:window-context",
            serde_json::json!({ "sessionId": session_id }),
        );
        warn!("[wingman] Shown existing panel at ({}, {})", x, y);
        return;
    }

    // Cold path: no prewarmed window. Build now.
    let url_str = format!("/windows/wingman?sessionId={}", session_id);
    warn!(
        "[wingman] No prewarmed window — building fresh at {}",
        url_str
    );
    match build_wingman_window(app_handle, &url_str, true) {
        Ok(window) => {
            let _ =
                window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
            warn!("[wingman] Panel built cold at ({}, {})", x, y);
        }
        Err(err) => {
            // Tauri v2 can transiently say "label already exists" during dev
            // reloads while `get_webview_window` returns None for the same
            // label. The label registry and the webview manager settle after
            // a short yield — retry up to 5 times with a 50 ms back-off on
            // a plain OS thread so we don't block the Tauri event loop.
            warn!("[wingman] Build returned error ({}) — retrying lookup", err);
            let app_h2 = app_handle.clone();
            let sid2 = session_id.to_string();
            std::thread::spawn(move || {
                for attempt in 0..5u8 {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    if let Some(w) = app_h2.get_webview_window(WINGMAN_WINDOW_LABEL) {
                        let _ = w.set_position(tauri::Position::Logical(
                            tauri::LogicalPosition::new(x, y),
                        ));
                        let _ = w.set_always_on_top(true);
                        let _ = w.show();
                        let _ = w.set_focus();
                        broadcast_event(
                            "wingman:window-context",
                            serde_json::json!({ "sessionId": sid2 }),
                        );
                        warn!(
                            "[wingman] Recovered existing panel at ({}, {}) on attempt {}",
                            x,
                            y,
                            attempt + 1
                        );
                        return;
                    }
                }
                warn!("[wingman] FAILED to recover floating window after retries");
            });
        }
    }
}

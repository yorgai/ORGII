//! Public start/stop API for the Wingman observation loop and its companion bar.
//!
//! Every "Share screen / Stop" path goes through here. Owns the
//! orchestration of `WingmanLoop` (background task) and the bottom bar (`bar.rs`).

use std::sync::Arc;

use tauri::Manager;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::foundation::bus::broadcast_event;
use crate::state::AgentAppState;

use super::bar::{close_wingman_bar, open_wingman_bar};
use super::handle::WingmanHandle;
use super::loop_runner::WingmanLoop;

#[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
use super::wingman_bar_native;

/// Start a Wingman observation loop for the given session.
///
/// If a loop is already running for this session it is stopped first.
/// Returns an error string if the session cannot be found or has no runtime.
pub async fn start(
    state: &AgentAppState,
    session_id: String,
    mission: String,
    monitor_index: Option<usize>,
) -> Result<(), String> {
    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("[wingman] Session not found: {}", session_id))?;

    // Stop any existing loop first.
    {
        let mut guard = session.wingman.handle.lock().await;
        if let Some(existing) = guard.take() {
            info!(
                "[wingman] Stopping existing loop for session {}",
                session_id
            );
            existing.stop().await;
        }
    }

    let cancel = CancellationToken::new();
    let loop_cancel = cancel.clone();
    let loop_session_id = session_id.clone();
    let loop_mission = mission.clone();
    let loop_session = Arc::clone(&session);
    let loop_app_handle = state.app_handle.clone();

    let task = tokio::spawn(async move {
        WingmanLoop {
            session_id: loop_session_id,
            mission: loop_mission,
            session: loop_session,
            app_handle: loop_app_handle,
        }
        .run(loop_cancel)
        .await;
    });

    let handle = WingmanHandle {
        mission: mission.clone(),
        cancel,
        task,
    };

    {
        let mut guard = session.wingman.handle.lock().await;
        *guard = Some(handle);
    }

    // Open the bottom bar on the chosen display.
    let Some(ref app_h) = state.app_handle else {
        warn!("[wingman] AppHandle not available — loop is running but bar could not be opened");
        return Err("[wingman] AppHandle not available".to_string());
    };
    open_wingman_bar(app_h, &session_id, &mission, monitor_index);

    // Push this session into the island's session list (phase=running)
    #[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
    wingman_bar_native::upsert_session(&session_id, &mission, &mission, 1, 0);

    broadcast_event(
        "wingman:started",
        serde_json::json!({ "sessionId": session_id }),
    );

    info!("[wingman] Loop started for session {}", session_id);
    Ok(())
}

/// Stop the Wingman loop for the given session.
///
/// Always closes the windows regardless of whether the session exists or has
/// a live loop — so a stale Wingman bar is never left on screen if the session
/// was already dropped (restart, crash, reload). Returns `Ok(())` in all cases.
pub async fn stop(state: &AgentAppState, session_id: &str) -> Result<(), String> {
    // Always close windows first — even when the session no longer exists.
    // A missing session must never leave a stale bar visible on screen.
    if let Some(ref app_h) = state.app_handle {
        close_wingman_windows(app_h);
        restore_main_window(app_h);
    }

    let Some(session) = state.get_session(session_id).await else {
        info!(
            "[wingman] Stop called for unknown session {} — windows closed",
            session_id
        );
        return Ok(());
    };

    let mut guard = session.wingman.handle.lock().await;
    if let Some(handle) = guard.take() {
        info!("[wingman] Stopping loop for session {}", session_id);
        handle.stop().await;
        broadcast_event(
            "wingman:stopped",
            serde_json::json!({ "sessionId": session_id }),
        );
        #[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
        {
            wingman_bar_native::set_stopped(true);
            // Mark the session as completed in the island list (phase=4)
            wingman_bar_native::upsert_session(session_id, "", "Done", 4, 0);
        }
    }
    Ok(())
}

/// Bring the main window back after Wingman finishes.
fn restore_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Close Wingman UI surfaces and restore main-window visibility.
pub(crate) fn close_wingman_windows(app_handle: &tauri::AppHandle) {
    close_wingman_bar(app_handle);
    crate::tools::impls::desktop::restore_desktop_operation_visibility_now(app_handle);
    restore_main_window(app_handle);
    broadcast_event("wingman:stopped", serde_json::json!({ "sessionId": "" }));
    #[cfg(all(target_os = "macos", feature = "wingman-bar-native"))]
    wingman_bar_native::set_stopped(true);
}

//! Native Wingman bar bridge.
//!
//! IMPORTANT — threading: every Swift FFI in `orgii-wingman-bar` goes through
//! `safeOnMain` which calls `DispatchQueue.main.sync` when invoked off the
//! main thread. Calling `.sync` from a tokio worker is allowed by GCD but is
//! a deadlock landmine if main is busy painting / running a modal — and on
//! macOS 26.3 it's also been responsible for silent failures where the
//! panel never appears. Instead we dispatch every call to the Tauri main
//! thread via `app.run_on_main_thread(...)` first, so by the time Swift
//! sees the call `Thread.isMainThread == true` and `safeOnMain` becomes a
//! plain inline call (no `.sync`, no deadlock window).
//!
//! All call sites also wrap the Swift FFI in `with_objc_catch` so any
//! AppKit `NSException` (e.g. from a race during prewarm) becomes a logged
//! warning instead of a process abort.

#![cfg(all(target_os = "macos", feature = "wingman-bar-native"))]

use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tracing::warn;

use app_platform::objc_bridge::with_objc_catch;

extern "C" {
    fn orgii_bar_init(on_stop: extern "C" fn(), on_chat: extern "C" fn());
    fn orgii_bar_hide();
    fn orgii_bar_set_status(text: *const std::ffi::c_char);
    fn orgii_bar_set_tool_indicator(status: i32);
    fn orgii_bar_set_elapsed(seconds: i32);
    fn orgii_bar_set_stopped(stopped: bool);
    fn orgii_bar_kiss_dock(screen_index: i32);
    fn orgii_bar_upsert_session(
        session_id: *const std::ffi::c_char,
        title: *const std::ffi::c_char,
        status: *const std::ffi::c_char,
        phase: i32,
        elapsed: i32,
    );
}

static INITIALIZED: AtomicBool = AtomicBool::new(false);
static VISIBLE: AtomicBool = AtomicBool::new(false);

static STOP_SESSION_ID: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
static LAST_STATUS: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Returns the most recent status string pushed via `set_status`.
pub fn last_status() -> String {
    LAST_STATUS.lock().unwrap().clone()
}

extern "C" fn on_stop_callback() {
    let sid = STOP_SESSION_ID.lock().unwrap().clone();
    if let Some(app) = APP_HANDLE.get() {
        let app = app.clone();
        std::thread::spawn(move || {
            super::close_wingman_windows(&app);
            crate::foundation::bus::broadcast_event(
                "wingman:stopped",
                serde_json::json!({ "sessionId": sid }),
            );
        });
    }
}

extern "C" fn on_chat_callback() {
    if let Some(app) = APP_HANDLE.get() {
        let app = app.clone();
        std::thread::spawn(move || {
            super::toggle_panel(&app);
        });
    }
}

/// Run `f` on the Tauri main thread + inside an ObjC @try/@catch.
///
/// `label` is used for the diagnostic warning if either an NSException
/// fires or the AppHandle is missing. We swallow errors here because the
/// bar is non-essential UI — losing one update should never abort.
fn on_main<F>(label: &'static str, f: F)
where
    F: FnOnce() + Send + 'static,
{
    let Some(app) = APP_HANDLE.get() else {
        warn!("[wingman-bar] {} skipped: AppHandle not set yet", label);
        return;
    };
    let app = app.clone();
    warn!("[wingman-bar] dispatching {} to main thread", label);
    if let Err(e) = app.run_on_main_thread(move || {
        warn!("[wingman-bar] {} running on main", label);
        if let Err(msg) = with_objc_catch(label, f) {
            warn!("[wingman-bar] {}", msg);
        } else {
            warn!("[wingman-bar] {} completed", label);
        }
    }) {
        warn!("[wingman-bar] {} dispatch failed: {}", label, e);
    }
}

pub fn init(app_handle: &tauri::AppHandle) {
    if INITIALIZED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = APP_HANDLE.set(app_handle.clone());
    // init may run from the prewarm main-thread closure already — call
    // directly, no extra dispatch needed.
    if let Err(msg) = with_objc_catch("orgii_bar_init", || unsafe {
        orgii_bar_init(on_stop_callback, on_chat_callback)
    }) {
        warn!("[wingman-bar] {}", msg);
    }
}

pub fn show(session_id: &str, _mission: &str, screen_index: Option<usize>) {
    if !INITIALIZED.load(Ordering::SeqCst) {
        warn!("[wingman-bar] show() called before init — ignoring");
        return;
    }
    *STOP_SESSION_ID.lock().unwrap() = session_id.to_string();
    VISIBLE.store(true, Ordering::SeqCst);
    let idx = screen_index.map(|i| i as i32).unwrap_or(0);
    warn!("[wingman-bar] native show requested screen_index={}", idx);
    on_main("orgii_bar_kiss_dock", move || unsafe {
        orgii_bar_kiss_dock(idx)
    });
    reassert_show(idx);
}

fn reassert_show(screen_index: i32) {
    std::thread::spawn(move || {
        for delay_ms in [80_u64, 220, 500] {
            std::thread::sleep(Duration::from_millis(delay_ms));
            if !VISIBLE.load(Ordering::SeqCst) {
                warn!(
                    "[wingman-bar] native show reassert skipped after {}ms: bar no longer visible",
                    delay_ms
                );
                return;
            }
            warn!(
                "[wingman-bar] native show reassert after {}ms screen_index={}",
                delay_ms, screen_index
            );
            on_main("orgii_bar_kiss_dock_reassert", move || unsafe {
                orgii_bar_kiss_dock(screen_index)
            });
        }
    });
}

pub fn hide() {
    if !INITIALIZED.load(Ordering::SeqCst) {
        return;
    }
    VISIBLE.store(false, Ordering::SeqCst);
    on_main("orgii_bar_hide", || unsafe { orgii_bar_hide() });
}

pub fn is_visible() -> bool {
    INITIALIZED.load(Ordering::SeqCst) && VISIBLE.load(Ordering::SeqCst)
}

pub fn set_status(text: &str) {
    if !INITIALIZED.load(Ordering::SeqCst) {
        return;
    }
    *LAST_STATUS.lock().unwrap() = text.to_string();
    let Ok(c) = CString::new(text) else { return };
    // CString must live for the duration of the call — move it into the
    // closure so it stays alive until Swift has copied the bytes.
    on_main("orgii_bar_set_status", move || unsafe {
        orgii_bar_set_status(c.as_ptr())
    });
}

pub fn set_tool_indicator(status: i32) {
    if !INITIALIZED.load(Ordering::SeqCst) {
        return;
    }
    on_main("orgii_bar_set_tool_indicator", move || unsafe {
        orgii_bar_set_tool_indicator(status)
    });
}

pub fn set_elapsed(seconds: i32) {
    if !INITIALIZED.load(Ordering::SeqCst) {
        return;
    }
    on_main("orgii_bar_set_elapsed", move || unsafe {
        orgii_bar_set_elapsed(seconds)
    });
}

pub fn set_stopped(stopped: bool) {
    if !INITIALIZED.load(Ordering::SeqCst) {
        return;
    }
    on_main("orgii_bar_set_stopped", move || unsafe {
        orgii_bar_set_stopped(stopped)
    });
}

/// Phase values matching `IslandSessionPhase` in Swift:
///   0 = idle, 1 = running, 2 = waiting, 3 = error, 4 = completed
pub fn upsert_session(session_id: &str, title: &str, status: &str, phase: i32, elapsed: i32) {
    if !INITIALIZED.load(Ordering::SeqCst) {
        return;
    }
    let Ok(id_c) = CString::new(session_id) else {
        return;
    };
    let Ok(title_c) = CString::new(title) else {
        return;
    };
    let Ok(status_c) = CString::new(status) else {
        return;
    };
    on_main("orgii_bar_upsert_session", move || unsafe {
        orgii_bar_upsert_session(
            id_c.as_ptr(),
            title_c.as_ptr(),
            status_c.as_ptr(),
            phase,
            elapsed,
        )
    });
}

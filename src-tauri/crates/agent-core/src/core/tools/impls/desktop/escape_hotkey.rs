//! System-wide Escape key monitor that aborts in-flight desktop automation.
//!
//! This is an **observer** (`kCGEventTapOptionListenOnly`) — we never mutate the
//! event stream, so we can't accidentally swallow Escape in other apps. We only
//! watch real (non-synthetic) Escape keydowns and trigger
//! [`computer_use_lock::request_abort`] when one fires.
//!
//! ## Suppressing our own Escape
//!
//! Desktop automation paths that synthesize Escape call [`notify_expected_escape`]
//! first. That bumps a short-lived counter which the tap callback decrements on
//! the next Escape event, preventing a self-abort.
//!
//! The tap runs on its own thread with its own CFRunLoop. Started lazily on
//! first call to [`ensure_started`], stopped never (1 thread total for the
//! app's lifetime).

// Module-level `#[cfg(target_os = "macos")]` lives at the `pub mod
// escape_hotkey;` declaration in `desktop/mod.rs`; not repeated here.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;

/// Bumped by `notify_expected_escape`, decremented when we see an Escape.
static EXPECTED_ESCAPES: AtomicU32 = AtomicU32::new(0);
/// Set once the tap thread has been spawned.
static MONITOR_STARTED: AtomicBool = AtomicBool::new(false);
/// Disables abort-on-escape while still counting Expected Escapes. Useful for
/// tests or when the user has toggled the sub-gate off at runtime.
static ENABLED: AtomicBool = AtomicBool::new(true);
static START_LOCK: Mutex<()> = Mutex::new(());

/// Tell the monitor that the next Escape event is coming from us — don't abort.
pub fn notify_expected_escape() {
    EXPECTED_ESCAPES.fetch_add(1, Ordering::Relaxed);
}

/// Enable or disable the abort action (the tap itself keeps running).
pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

/// Start the escape-hotkey event tap if it hasn't been started yet.
/// Safe to call from any thread, any number of times.
pub fn ensure_started() {
    if MONITOR_STARTED.load(Ordering::Acquire) {
        return;
    }
    let _guard = START_LOCK.lock().unwrap();
    if MONITOR_STARTED.load(Ordering::Acquire) {
        return;
    }

    std::thread::Builder::new()
        .name("orgii-escape-monitor".into())
        .spawn(run_event_tap)
        .expect("failed to spawn escape-hotkey thread");

    MONITOR_STARTED.store(true, Ordering::Release);
}

// ── CoreGraphics event tap plumbing ────────────────────────────────

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: extern "C" fn(
            proxy: *mut std::ffi::c_void,
            event_type: u32,
            event: *mut std::ffi::c_void,
            user_info: *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_void,
        user_info: *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void;

    fn CFMachPortCreateRunLoopSource(
        allocator: *const std::ffi::c_void,
        port: *mut std::ffi::c_void,
        order: i64,
    ) -> *mut std::ffi::c_void;

    fn CFRunLoopGetCurrent() -> *mut std::ffi::c_void;
    fn CFRunLoopAddSource(
        rl: *mut std::ffi::c_void,
        source: *mut std::ffi::c_void,
        mode: *const std::ffi::c_void,
    );
    fn CFRunLoopRun();
    fn CGEventGetIntegerValueField(event: *mut std::ffi::c_void, field: u32) -> i64;
    fn CFRelease(cf: *const std::ffi::c_void);
}

extern "C" {
    static kCFRunLoopCommonModes: *const std::ffi::c_void;
}

const K_CG_HID_EVENT_TAP: u32 = 0;
const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
const K_CG_EVENT_TAP_OPTION_LISTEN: u32 = 1;

const K_CG_EVENT_KEY_DOWN: u32 = 10;
const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
const K_CG_EVENT_SOURCE_STATE_ID: u32 = 45;
const CG_EVENT_SOURCE_STATE_HID: i64 = 1;

const KEYCODE_ESCAPE: i64 = 53;

const EVENT_MASK_KEY_DOWN: u64 = 1 << K_CG_EVENT_KEY_DOWN;

extern "C" fn escape_tap_callback(
    _proxy: *mut std::ffi::c_void,
    event_type: u32,
    event: *mut std::ffi::c_void,
    _user_info: *mut std::ffi::c_void,
) -> *mut std::ffi::c_void {
    if event.is_null() || event_type != K_CG_EVENT_KEY_DOWN {
        return event;
    }

    let keycode = unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) };
    if keycode != KEYCODE_ESCAPE {
        return event;
    }

    // Skip our own synthesized escapes (either tagged by the event source or
    // pre-announced via notify_expected_escape).
    let source_state = unsafe { CGEventGetIntegerValueField(event, K_CG_EVENT_SOURCE_STATE_ID) };
    let is_synthetic = source_state != CG_EVENT_SOURCE_STATE_HID;
    if is_synthetic {
        return event;
    }
    if EXPECTED_ESCAPES
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
            if n > 0 {
                Some(n - 1)
            } else {
                None
            }
        })
        .is_ok()
    {
        return event;
    }

    if !ENABLED.load(Ordering::Relaxed) {
        return event;
    }

    use integrations::computer_use_lock;
    if computer_use_lock::is_held_locally() {
        tracing::warn!(target: "desktop.escape_hotkey", "user pressed Escape — requesting abort");
        computer_use_lock::request_abort();
    }

    event
}

fn run_event_tap() {
    unsafe {
        let tap = CGEventTapCreate(
            K_CG_HID_EVENT_TAP,
            K_CG_HEAD_INSERT_EVENT_TAP,
            K_CG_EVENT_TAP_OPTION_LISTEN,
            EVENT_MASK_KEY_DOWN,
            escape_tap_callback,
            std::ptr::null_mut(),
        );
        if tap.is_null() {
            tracing::warn!(
                target: "desktop.escape_hotkey",
                "CGEventTapCreate returned null — Accessibility permission missing? Escape abort is disabled."
            );
            return;
        }

        let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
        if source.is_null() {
            CFRelease(tap);
            return;
        }

        let rl = CFRunLoopGetCurrent();
        CFRunLoopAddSource(rl, source, kCFRunLoopCommonModes);
        CFRunLoopRun();

        CFRelease(source);
        CFRelease(tap);
    }
}

//! macOS-specific window behavior for Wingman windows.
//!
//! AppKit-only helpers that configure the floating panel and bar windows:
//!   - `apply_window_behavior` — float level + Mission Control spaces + full-screen aux
//!
//! All NSWindow APIs require the main thread. Callers from background tasks
//! should route through `AppHandle::run_on_main_thread` before invoking these.

/// Apply macOS-specific window behavior so a Wingman window:
///   - floats above all apps (NSFloatingWindowLevel)
///   - follows the user across all Mission Control spaces
///   - stays visible when another app goes full-screen
pub(super) fn apply_window_behavior(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let ns_window_ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(_) => return,
    };
    let ns_window_addr = ns_window_ptr as usize;

    // NSWindow APIs must be called on the main thread. This function is
    // currently only invoked from the main thread (either inside a Tauri
    // command handler or via `run_on_main_thread` during prewarm). A
    // previous `dispatch::Queue::main().exec_sync(...)` here caused a
    // libdispatch self-deadlock ("dispatch_sync called on queue already
    // owned by current thread") when run from the prewarm path, which
    // already hops to main. If we're ever called off-main in the future,
    // the caller should marshal to main explicitly.
    let run = move || {
        let ns_window = ns_window_addr as *mut AnyObject;

        unsafe {
            // NSWindowCollectionBehaviorCanJoinAllSpaces = 1 << 0
            // NSWindowCollectionBehaviorStationary       = 1 << 4
            // NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8
            let behavior: usize = (1 << 0) | (1 << 4) | (1 << 8);
            let _: () = msg_send![ns_window, setCollectionBehavior: behavior];

            // NSFloatingWindowLevel = 3
            let _: () = msg_send![ns_window, setLevel: 3_i64];
        }
    };

    if is_main_thread() {
        run();
    } else {
        dispatch2::DispatchQueue::main().exec_sync(run);
    }
}

/// True when called from the process's main thread.
fn is_main_thread() -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    unsafe {
        let Some(cls) = AnyClass::get(c"NSThread") else {
            return false;
        };
        let is_main: bool = msg_send![cls, isMainThread];
        is_main
    }
}

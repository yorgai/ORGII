//! Rust-side wrapper around `objc_catch.m` — an Objective-C `@try/@catch`
//! trampoline so ObjC exceptions from AppKit / Foundation / CoreGraphics
//! can be turned into Rust `Err` values instead of aborting the process.
//!
//! Without this, any background-thread call into (e.g.) `NSWorkspace`,
//! `NSRunningApplication`, or `CGDisplayCreateImage` on macOS 26.3 that
//! raises an NSException will trigger the Rust runtime's "cannot catch
//! foreign exceptions" abort path and kill the whole app.
//!
//! Usage:
//!
//! ```ignore
//! let apps = with_objc_catch("list_running_apps", || unsafe {
//!     msg_send![class!(NSWorkspace), sharedWorkspace]
//! })?;
//! ```
//!
//! The parent module declares `#[cfg(target_os = "macos")] pub mod objc_bridge;`,
//! so this file is only compiled on macOS — no inner gating is needed.

use std::ffi::{c_void, CStr};
use std::panic::{catch_unwind, AssertUnwindSafe};

type WorkFn = extern "C" fn(*mut c_void);

extern "C" {
    fn orgii_objc_catch(work: WorkFn, ctx: *mut c_void) -> *const std::os::raw::c_char;
    fn orgii_objc_free(s: *const std::os::raw::c_char);
}

/// Heap box carrying the Rust closure + its result slot across the C trampoline.
struct Trampoline<T, F: FnOnce() -> T> {
    f: Option<F>,
    result: Option<std::thread::Result<T>>,
}

extern "C" fn trampoline_thunk<T, F: FnOnce() -> T>(ctx: *mut c_void) {
    // SAFETY: ctx is the heap box we allocated in with_objc_catch.
    let tramp = unsafe { &mut *(ctx as *mut Trampoline<T, F>) };
    let f = tramp.f.take().expect("closure already consumed");
    // catch_unwind guards against Rust-level panics in the closure —
    // the ObjC @try/@catch above us already handles foreign exceptions.
    tramp.result = Some(catch_unwind(AssertUnwindSafe(f)));
}

/// Run `f` on the current thread, catching any ObjC exception it raises.
/// Returns `Err(exception_description)` if an NSException propagated, or
/// `Err("panic: …")` if the closure panicked.
pub fn with_objc_catch<T, F: FnOnce() -> T>(label: &str, f: F) -> Result<T, String> {
    let mut tramp: Trampoline<T, F> = Trampoline {
        f: Some(f),
        result: None,
    };
    let ctx = &mut tramp as *mut _ as *mut c_void;

    let err_ptr = unsafe { orgii_objc_catch(trampoline_thunk::<T, F>, ctx) };

    if !err_ptr.is_null() {
        let msg = unsafe { CStr::from_ptr(err_ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { orgii_objc_free(err_ptr) };
        return Err(format!("{}: ObjC exception: {}", label, msg));
    }

    match tramp.result {
        Some(Ok(v)) => Ok(v),
        Some(Err(_)) => Err(format!("{}: Rust panic during ObjC call", label)),
        None => Err(format!("{}: trampoline did not run", label)),
    }
}

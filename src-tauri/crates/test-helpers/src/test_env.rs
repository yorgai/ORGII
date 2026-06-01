//! Workspace-wide test sandbox for env-var-driven global state.
//!
//! # Problem this solves
//!
//! The Rust backend has several module-local `Mutex`es that serialize
//! tests which mutate process-global env vars (`ORGII_HOME`, `HOME`) or
//! reach into the shared SQLite DB via `database::db::get_connection()`.
//! Each sibling module owns its own `Mutex`, so concurrent tests in
//! different modules still race each other. Worse, a panicking test
//! poisons its module's `Mutex` AND the global `SCHEMA_INIT: Once` in
//! `database::db::connection`, producing cascades of "Once instance has
//! previously been poisoned" failures across the rest of the suite.
//!
//! This module replaces all of them with one canonical lock:
//!
//! 1. `lock_home()` — the single serializer for anything touching
//!    `ORGII_HOME` / `HOME`. Poison is always recovered via
//!    `into_inner()` so a panic in one test cannot cascade.
//!
//! 2. `SandboxGuard` — RAII handle that holds the lock, keeps the
//!    tempdir alive, points both env vars at it, and restores the
//!    prior env values on drop. After the env is set up it fires every
//!    hook registered via [`register_after_env_hook`] so the `app` crate
//!    can prime its multi-table schema without `test_helpers` depending
//!    back into `app`.
//!
//! # Usage
//!
//! ```ignore
//! use test_helpers::test_env;
//!
//! #[test]
//! fn my_test() {
//!     let _sandbox = test_env::sandbox();
//!     // `ORGII_HOME` / `HOME` now point at an empty tempdir unique to
//!     // this test invocation. If the `app` crate has registered a
//!     // schema-prime hook, `get_connection()` returns a freshly
//!     // migrated DB under that tempdir.
//!     do_thing_that_touches_orgii_home();
//! }
//! ```
//!
//! # Invariants
//!
//! - Every test that mutates `ORGII_HOME` or `HOME` MUST go through
//!   `sandbox()` (or `lock_home()` if it only needs the lock). Having
//!   any test mutate these env vars without the lock re-introduces the
//!   race.
//! - `SandboxGuard` is not `Send`. It is tied to the thread that
//!   acquired the lock. Do not ship it across `tokio::spawn` boundaries.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use tempfile::TempDir;

/// Single lock serializing every `ORGII_HOME` / `HOME` mutation in the
/// test binary. Sized to be embedded as a `static`.
///
/// Poisoning is recovered at every acquisition — one panicking test must
/// never cascade into the next. The recovery is safe because the lock
/// protects *env-var visibility*, not logical data invariants: whatever
/// state the panicking test left behind is wiped by `SandboxGuard`'s env
/// restore + a fresh tempdir on the next acquire.
fn home_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Acquire the canonical test env lock.
///
/// Most tests should prefer [`sandbox`], which also installs a tempdir
/// sandbox. Use `lock_home()` directly only when you need the
/// serialization but are managing your own tempdir/env setup (rare —
/// typically just for harnesses that need to observe the real `$HOME`).
pub fn lock_home() -> MutexGuard<'static, ()> {
    match home_lock().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// Hook fired after the sandbox env vars are set, before `sandbox()`
/// returns. Registered by the parent `app` crate's test setup so it can
/// prime the multi-table SQLite schema under the new `ORGII_HOME` without
/// `test_helpers` depending back into `app`.
pub type AfterEnvHook = fn(&Path);

fn after_env_hook_cell() -> &'static OnceLock<AfterEnvHook> {
    static CELL: OnceLock<AfterEnvHook> = OnceLock::new();
    &CELL
}

/// Register a function to run inside [`sandbox`] after `ORGII_HOME` /
/// `HOME` are pointed at the fresh tempdir but before the guard is
/// returned. Call exactly once per test binary (typically from a `#[ctor]`
/// in `app::test_utils`); subsequent calls are silently ignored.
pub fn register_after_env_hook(hook: AfterEnvHook) {
    let _ = after_env_hook_cell().set(hook);
}

/// RAII sandbox handle. On creation:
///  - Acquires the global lock.
///  - Allocates a fresh tempdir.
///  - Points `ORGII_HOME` and `HOME` at it.
///  - Runs the registered after-env hook, if any (the `app` crate
///    registers a multi-table schema-prime hook here).
///
/// On drop: restores the prior env var values, releases the lock, and
/// lets `TempDir` clean the tempdir.
#[must_use = "drop this handle at the end of the test, not at assignment"]
pub struct SandboxGuard {
    _lock: MutexGuard<'static, ()>,
    _tmp: TempDir,
    path: PathBuf,
    prev_orgii_home: Option<std::ffi::OsString>,
    prev_home: Option<std::ffi::OsString>,
}

impl SandboxGuard {
    /// Path to the sandbox root (same value as `ORGII_HOME` while the
    /// guard is alive).
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for SandboxGuard {
    fn drop(&mut self) {
        restore("ORGII_HOME", self.prev_orgii_home.take());
        restore("HOME", self.prev_home.take());
    }
}

fn restore(key: &str, prev: Option<std::ffi::OsString>) {
    match prev {
        Some(v) => std::env::set_var(key, v),
        None => std::env::remove_var(key),
    }
}

/// Install a fresh `ORGII_HOME` / `HOME` sandbox for the duration of the
/// returned guard.
pub fn sandbox() -> SandboxGuard {
    let lock = lock_home();
    let tmp = tempfile::tempdir().expect("sandbox tempdir");
    let path = tmp.path().to_path_buf();

    let prev_orgii_home = std::env::var_os("ORGII_HOME");
    let prev_home = std::env::var_os("HOME");

    std::env::set_var("ORGII_HOME", &path);
    std::env::set_var("HOME", &path);

    if let Some(hook) = after_env_hook_cell().get() {
        hook(&path);
    }

    SandboxGuard {
        _lock: lock,
        _tmp: tmp,
        path,
        prev_orgii_home,
        prev_home,
    }
}

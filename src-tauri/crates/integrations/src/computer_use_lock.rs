//! File-based lock ensuring at most one session uses desktop automation at a time.
//!
//! Semantics:
//! - Atomic creation via `O_EXCL` (exclusive-create)
//! - Reentrant within the same session (second call returns `Reentrant`)
//! - Stale-lock recovery via PID liveness probe
//! - Process-exit safety: the Drop guard on [`ComputerUseLockGuard`] releases
//!   the file even if the session panics or is killed without cleanup
//!
//! Lock file: `~/.orgii/computer-use.lock`
//! Format: `{"session_id":"…","pid":12345,"acquired_at":1713186000}`

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use app_paths as paths;

/// IoC hook: how `request_abort` notifies the rest of the app that the user
/// pressed ESC. The wiring (currently `agent_core::bus::broadcast_event`,
/// which fans out to the IPC channel and debug WebSocket) lives in `app::lib`,
/// so the `integrations` crate doesn't have to depend on `agent_core`.
pub type AbortBroadcaster = Box<dyn Fn(&str) + Send + Sync>;

static ABORT_BROADCASTER: OnceLock<AbortBroadcaster> = OnceLock::new();

/// Register the broadcaster used by [`request_abort`]. Called once at startup
/// from `app::lib::run`; absent in tests (no-op).
pub fn register_abort_broadcaster(f: AbortBroadcaster) {
    if ABORT_BROADCASTER.set(f).is_err() {
        tracing::warn!("computer_use_lock: abort broadcaster already registered");
    }
}

const LOCK_FILENAME: &str = "computer-use.lock";

/// In-memory flag: does THIS process believe it holds the lock?
/// Zero-cost check so non-CU turns never touch disk.
static HELD_LOCALLY: AtomicBool = AtomicBool::new(false);

/// The session ID that holds the lock (set on acquire, cleared on release).
static OWNER_SESSION: Mutex<Option<String>> = Mutex::new(None);

/// User-requested abort (ESC hotkey). Checked before each desktop action.
static ABORT_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LockPayload {
    session_id: String,
    pid: u32,
    acquired_at: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AcquireResult {
    /// First acquisition this turn — callers should fire enter notifications.
    Acquired,
    /// Same session already holds the lock (re-entrant call within a turn).
    Reentrant,
    /// Another live session holds the lock.
    Blocked { by: String },
}

fn lock_path() -> PathBuf {
    paths::orgii_root().join(LOCK_FILENAME)
}

fn read_lock() -> Option<LockPayload> {
    // The caller treats a `None` here as "stale lock, remove and
    // recreate" which is the right behavior for both missing and
    // corrupt files. But silently turning a corrupt lock file into
    // a stale-recovery hides forensic info: a corrupt lock usually
    // means a previous process crashed mid-write, and we want that
    // visible in logs so operators can correlate it with the crash.
    // Missing-file is the legitimate quiet path.
    let path = lock_path();
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    "[computer_use_lock] read failed at {}: {} — treating as stale lock",
                    path.display(),
                    err
                );
            }
            return None;
        }
    };
    match serde_json::from_str(&raw) {
        Ok(payload) => Some(payload),
        Err(err) => {
            warn!(
                "[computer_use_lock] JSON parse failed at {}: {} — treating as stale lock; previous session likely crashed mid-write",
                path.display(),
                err
            );
            None
        }
    }
}

fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

fn try_create_exclusive(payload: &LockPayload) -> std::io::Result<bool> {
    let path = lock_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o644)
            .open(&path)
        {
            Ok(mut file) => {
                let json = serde_json::to_string(payload).map_err(std::io::Error::other)?;
                file.write_all(json.as_bytes())?;
                Ok(true)
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(err) => Err(err),
        }
    }

    #[cfg(not(unix))]
    {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                let json = serde_json::to_string(payload).map_err(std::io::Error::other)?;
                file.write_all(json.as_bytes())?;
                Ok(true)
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(err) => Err(err),
        }
    }
}

/// Zero-syscall check: does THIS process believe it holds the lock?
pub fn is_held_locally() -> bool {
    HELD_LOCALLY.load(Ordering::SeqCst)
}

/// Try to acquire the computer-use lock for a session.
///
/// - `Acquired` — first acquisition; caller should fire enter notification
/// - `Reentrant` — same session already holds it (no-op)
/// - `Blocked { by }` — another live session holds it
pub fn try_acquire(session_id: &str) -> Result<AcquireResult, String> {
    let payload = LockPayload {
        session_id: session_id.to_string(),
        pid: std::process::id(),
        acquired_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    };

    match try_create_exclusive(&payload) {
        Ok(true) => {
            HELD_LOCALLY.store(true, Ordering::SeqCst);
            ABORT_REQUESTED.store(false, Ordering::SeqCst);
            *OWNER_SESSION.lock().unwrap() = Some(session_id.to_string());
            info!("[computer_use_lock] Acquired for session {}", session_id);
            return Ok(AcquireResult::Acquired);
        }
        Ok(false) => { /* file exists — check ownership below */ }
        Err(err) => return Err(format!("Failed to create lock file: {}", err)),
    }

    let existing = read_lock();

    // Corrupt/unparseable — treat as stale.
    let existing = match existing {
        Some(lock) => lock,
        None => {
            let _ = fs::remove_file(lock_path());
            match try_create_exclusive(&payload) {
                Ok(true) => {
                    HELD_LOCALLY.store(true, Ordering::SeqCst);
                    *OWNER_SESSION.lock().unwrap() = Some(session_id.to_string());
                    return Ok(AcquireResult::Acquired);
                }
                Ok(false) => {
                    let by = read_lock()
                        .map(|l| l.session_id)
                        .unwrap_or_else(|| "unknown".to_string());
                    return Ok(AcquireResult::Blocked { by });
                }
                Err(err) => return Err(format!("Failed to create lock file: {}", err)),
            }
        }
    };

    // Already held by this session — reentrant.
    if existing.session_id == session_id {
        HELD_LOCALLY.store(true, Ordering::SeqCst);
        *OWNER_SESSION.lock().unwrap() = Some(session_id.to_string());
        return Ok(AcquireResult::Reentrant);
    }

    // Another live session holds it — blocked.
    if is_process_running(existing.pid) {
        return Ok(AcquireResult::Blocked {
            by: existing.session_id,
        });
    }

    // Stale lock — recover.
    info!(
        "[computer_use_lock] Recovering stale lock from session {} (PID {})",
        existing.session_id, existing.pid
    );
    let _ = fs::remove_file(lock_path());
    match try_create_exclusive(&payload) {
        Ok(true) => {
            HELD_LOCALLY.store(true, Ordering::SeqCst);
            *OWNER_SESSION.lock().unwrap() = Some(session_id.to_string());
            Ok(AcquireResult::Acquired)
        }
        Ok(false) => {
            let by = read_lock()
                .map(|l| l.session_id)
                .unwrap_or_else(|| "unknown".to_string());
            Ok(AcquireResult::Blocked { by })
        }
        Err(err) => Err(format!("Failed to create lock file: {}", err)),
    }
}

/// Release the computer-use lock if the current session owns it.
/// Returns `true` if we actually unlinked (i.e., we held it).
/// Idempotent: subsequent calls return `false`.
pub fn release(session_id: &str) -> bool {
    let was_held = HELD_LOCALLY.swap(false, Ordering::SeqCst);
    ABORT_REQUESTED.store(false, Ordering::SeqCst);
    *OWNER_SESSION.lock().unwrap() = None;

    if !was_held {
        return false;
    }

    let existing = match read_lock() {
        Some(lock) => lock,
        None => return false,
    };

    if existing.session_id != session_id {
        warn!(
            "[computer_use_lock] Lock owned by {} but release requested by {}",
            existing.session_id, session_id
        );
        return false;
    }

    match fs::remove_file(lock_path()) {
        Ok(()) => {
            info!("[computer_use_lock] Released for session {}", session_id);
            true
        }
        Err(err) => {
            warn!("[computer_use_lock] Failed to remove lock file: {}", err);
            false
        }
    }
}

/// Signal the current computer-use session to abort.
/// Called from ESC hotkey handler or frontend abort button.
/// Returns `true` if abort was set (lock was held), `false` if nothing to abort.
pub fn request_abort() -> bool {
    if !HELD_LOCALLY.load(Ordering::SeqCst) {
        return false;
    }
    ABORT_REQUESTED.store(true, Ordering::SeqCst);
    info!("[computer_use_lock] Abort requested by user");

    let owner = OWNER_SESSION.lock().unwrap().clone().unwrap_or_default();
    if let Some(broadcaster) = ABORT_BROADCASTER.get() {
        broadcaster(&owner);
    }
    true
}

/// Check if an abort was requested. Clears the flag after reading.
pub fn take_abort() -> bool {
    ABORT_REQUESTED.swap(false, Ordering::SeqCst)
}

/// Check if an abort was requested without clearing.
pub fn is_abort_requested() -> bool {
    ABORT_REQUESTED.load(Ordering::SeqCst)
}

/// Force-release on process exit regardless of session ID.
/// Called from app shutdown hooks.
pub fn force_release_on_exit() {
    if !HELD_LOCALLY.swap(false, Ordering::SeqCst) {
        return;
    }
    *OWNER_SESSION.lock().unwrap() = None;

    let existing = match read_lock() {
        Some(lock) => lock,
        None => return,
    };

    if existing.pid == std::process::id() {
        let _ = fs::remove_file(lock_path());
        info!("[computer_use_lock] Force-released on exit");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_process_running_self() {
        assert!(is_process_running(std::process::id()));
    }

    #[test]
    fn is_process_running_dead() {
        assert!(!is_process_running(999_999_999));
    }

    #[test]
    fn lock_payload_roundtrip() {
        let payload = LockPayload {
            session_id: "test-session".to_string(),
            pid: 12345,
            acquired_at: 1713186000,
        };
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: LockPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.session_id, "test-session");
        assert_eq!(parsed.pid, 12345);
        assert_eq!(parsed.acquired_at, 1713186000);
    }
}

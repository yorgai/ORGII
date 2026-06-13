//! `IntegrationsStore` — thread-safe wrapper around `IntegrationsConfig`.
//!
//! the integrations-store contract (design doc §11.7 + step 6): the single writer for `integrations.json`.
//! Every mutation to the on-disk blob flows through `IntegrationsStore::update`
//! — no other code path calls `serde_json::to_writer` on the file
//! (invariant I-SINGLE-WRITE-PATH, §0 "Canonical invariants").
//!
//! # Shape
//!
//! Modeled on `AgentDefinitionsStore` (see `core/definitions/store.rs`): a
//! plain struct with a `Mutex`-guarded interior, simple `snapshot()` /
//! `update()` API. The only difference is that `update()` also persists —
//! `AgentDefinitionsStore` has an internal `persist(&[..])` that callers
//! have to remember to invoke; here we fold "mutate in memory + write to
//! disk" into one transactional call so every mutation surface is
//! atomic by construction.
//!
//! # Cloning semantics
//!
//! `snapshot()` returns an owned `IntegrationsConfig`. Callers must not
//! hold the lock across `.await` points — the Mutex is a `std::sync::Mutex`,
//! not a tokio one, because the critical section is always a tiny memory
//! copy. The snapshot is a deep clone so read sites cannot accidentally
//! mutate the store.

use std::path::PathBuf;
#[cfg(not(test))]
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use tracing::{error, info};

use crate::integrations::{IntegrationsConfig, IntegrationsError};
use app_paths as paths;

#[cfg(not(test))]
static PROCESS_STORE: OnceLock<Arc<IntegrationsStore>> = OnceLock::new();

/// Process-wide shared `IntegrationsStore`.
///
/// `AgentAppState.integrations` holds this same `Arc`, and background
/// subsystems with no state handle (consolidation, HTTP debug endpoints)
/// reach it here instead of re-reading `integrations.json` from disk —
/// eliminating the read-path split brain where in-memory edits were not
/// yet visible to direct `load_or_default()` callers. Test builds return
/// a fresh store per call for `ORGII_HOME` tempdir isolation.
pub fn integrations_store() -> Arc<IntegrationsStore> {
    #[cfg(test)]
    {
        Arc::new(IntegrationsStore::new())
    }
    #[cfg(not(test))]
    {
        PROCESS_STORE
            .get_or_init(|| Arc::new(IntegrationsStore::new()))
            .clone()
    }
}

/// Thread-safe owner of the in-memory `IntegrationsConfig`. Held by
/// `AgentAppState.integrations`.
pub struct IntegrationsStore {
    inner: Mutex<IntegrationsConfig>,
    /// Explicit on-disk path. Production callers leave `None` and the
    /// store resolves `paths::integrations()`; tests pass a temp path via
    /// [`IntegrationsStore::with_path`] to avoid touching the real
    /// `~/.orgii` directory.
    path_override: Option<PathBuf>,
    /// Whether the on-disk `integrations.json` was successfully loaded at
    /// store construction. When the file existed but failed to read or
    /// parse, this is set to `Some(reason)` and `update()` short-circuits
    /// with `UpdateError::LoadFailed` instead of persisting the in-memory
    /// `IntegrationsConfig::default()` over the corrupt-but-recoverable
    /// file. See `update()` rustdoc for the recovery flow.
    ///
    /// `None` means either (a) the file was loaded successfully, or
    /// (b) the file legitimately did not exist (ENOENT, fresh install).
    /// Both cases are safe to persist over.
    load_failure: Mutex<Option<String>>,
}

impl Default for IntegrationsStore {
    fn default() -> Self {
        Self::new()
    }
}

impl IntegrationsStore {
    /// Load `~/.orgii/integrations.json` into memory.
    ///
    /// The store always comes up in a usable state so app boot never
    /// fails on broken user config — readers (`snapshot()`) always
    /// succeed. The recovery rule for **writes** (`update()`) is more
    /// careful: if the file existed at boot but failed to read or parse,
    /// `update()` will refuse to persist over it (`UpdateError::LoadFailed`)
    /// so a single failed UI mutation cannot wipe an otherwise recoverable
    /// `integrations.json`. The user can either fix the file by hand and
    /// restart the app, or explicitly clear it (delete the file → next
    /// boot loads empty defaults legitimately).
    ///
    /// Missing files (`ErrorKind::NotFound`) are treated as legitimate
    /// fresh-install state and do **not** trigger the load-failure gate.
    pub fn new() -> Self {
        let (cfg, load_failure) = match IntegrationsConfig::load_or_default() {
            Ok(cfg) => (cfg, None),
            Err(err) => {
                let reason = err.to_string();
                error!(
                    "[integrations-store] load failed, using in-memory defaults but \
                     refusing to persist over the on-disk file until recovery: {}",
                    reason
                );
                (IntegrationsConfig::default(), Some(reason))
            }
        };
        info!("[integrations-store] loaded integrations.json");
        Self {
            inner: Mutex::new(cfg),
            path_override: None,
            load_failure: Mutex::new(load_failure),
        }
    }

    /// Construct a store reading/writing an explicit path. Tests use
    /// this to point at a `tempfile::tempdir()`; production code does
    /// **not** call this — the single source of truth is
    /// `paths::integrations()`.
    ///
    /// Mirrors `new()`'s load-failure gate so test scenarios that seed a
    /// corrupt file can assert that `update()` short-circuits.
    #[cfg(test)]
    pub fn with_path(path: PathBuf) -> Self {
        let (cfg, load_failure) = match IntegrationsConfig::load_from(&path) {
            Ok(cfg) => (cfg, None),
            Err(err) => (IntegrationsConfig::default(), Some(err.to_string())),
        };
        Self {
            inner: Mutex::new(cfg),
            path_override: Some(path),
            load_failure: Mutex::new(load_failure),
        }
    }

    fn disk_path(&self) -> PathBuf {
        self.path_override
            .clone()
            .unwrap_or_else(paths::integrations)
    }

    /// Deep-clone snapshot for read access. The lock is held only for the
    /// duration of the clone; callers can hold the returned value for
    /// arbitrarily long without blocking writers.
    pub fn snapshot(&self) -> IntegrationsConfig {
        self.inner
            .lock()
            .expect("integrations store mutex poisoned")
            .clone()
    }

    /// Apply a typed patch closure, then persist. Returns the post-mutation
    /// snapshot so callers can respond to RPC clients with the new state
    /// without a second `snapshot()` call.
    ///
    /// **Atomicity:** the closure mutates a local clone, not the store's
    /// inner state. The in-memory state is updated only after both the
    /// closure and the disk write succeed. This means a failed patch, a
    /// failed save, or a panic inside the closure all leave the store at
    /// its pre-call state.
    ///
    /// **Corrupt-file gate:** if the on-disk `integrations.json` failed
    /// to load at store construction (boot-time read or parse error),
    /// this method short-circuits with [`UpdateError::LoadFailed`] before
    /// touching the file. Without this gate, a single user-initiated
    /// mutation would persist the in-memory `IntegrationsConfig::default()`
    /// over the corrupt-but-recoverable file, permanently destroying
    /// every integration the user had configured. ENOENT (legitimate
    /// fresh-install state) does not trip the gate.
    pub fn update<F, E>(&self, patch: F) -> Result<IntegrationsConfig, UpdateError<E>>
    where
        F: FnOnce(&mut IntegrationsConfig) -> Result<(), E>,
    {
        if let Some(reason) = self
            .load_failure
            .lock()
            .expect("integrations load-failure mutex poisoned")
            .clone()
        {
            return Err(UpdateError::LoadFailed(reason));
        }
        let mut draft = {
            let guard = self
                .inner
                .lock()
                .expect("integrations store mutex poisoned");
            guard.clone()
        };
        patch(&mut draft).map_err(UpdateError::Patch)?;
        draft
            .save_to(&self.disk_path())
            .map_err(UpdateError::Persist)?;
        let mut guard = self
            .inner
            .lock()
            .expect("integrations store mutex poisoned");
        *guard = draft.clone();
        Ok(draft)
    }
}

/// Error emitted by `IntegrationsStore::update`. Separates patch-closure
/// failures from persistence failures so callers can surface an
/// appropriate error to the user (e.g., HTTP 400 for invalid patch vs
/// HTTP 500 for disk error).
#[derive(Debug, thiserror::Error)]
pub enum UpdateError<E> {
    /// The patch closure returned an error — mutation aborted before any
    /// disk write.
    #[error("integrations patch rejected: {0}")]
    Patch(E),

    /// In-memory mutation succeeded but the subsequent save failed. The
    /// in-memory state reflects the patch; a retry of `update` with a
    /// no-op patch can re-attempt persistence.
    #[error("integrations persist failed: {0}")]
    Persist(#[from] IntegrationsError),

    /// The on-disk `integrations.json` failed to load at boot (read error,
    /// parse error, or other non-NotFound failure). The store is operating
    /// against an in-memory `IntegrationsConfig::default()` to keep the UI
    /// usable, but `update()` refuses to persist over the corrupt file so
    /// the user has a chance to recover the original. The string carries
    /// the original load-error text (e.g. parse position) for the UI.
    #[error("integrations on-disk file failed to load at boot, refusing to overwrite: {0}")]
    LoadFailed(String),
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::convert::Infallible;

    /// Seeds a store pointing at a tempdir path so tests never touch the
    /// real `~/.orgii/integrations.json`.
    fn tmp_store(initial: IntegrationsConfig) -> (IntegrationsStore, tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("integrations.json");
        initial
            .save_to(&path)
            .expect("seed the tempdir with initial state");
        let store = IntegrationsStore::with_path(path.clone());
        (store, tmp, path)
    }

    #[test]
    fn snapshot_returns_deep_clone() {
        let mut initial = IntegrationsConfig::default();
        initial.web_search.api_key = "/tmp/original".into();
        let (store, _tmp, _path) = tmp_store(initial);

        let mut snap = store.snapshot();
        snap.web_search.api_key = "/tmp/mutated".into();

        let snap2 = store.snapshot();
        assert_eq!(
            snap2.web_search.api_key, "/tmp/original",
            "mutating a snapshot must not leak into the store"
        );
    }

    #[test]
    fn update_applies_patch_in_memory_and_on_disk() {
        let (store, _tmp, path) = tmp_store(IntegrationsConfig::default());

        let snap: IntegrationsConfig = store
            .update(|cfg| -> Result<(), Infallible> {
                cfg.web_search.api_key = "/tmp/via-update".into();
                Ok(())
            })
            .expect("update succeeds");

        assert_eq!(
            snap.web_search.api_key, "/tmp/via-update",
            "returned snapshot reflects the patch"
        );
        assert_eq!(
            store.snapshot().web_search.api_key,
            "/tmp/via-update",
            "in-memory state reflects the patch"
        );

        let reloaded = IntegrationsConfig::load_from(&path).expect("reload from disk");
        assert_eq!(
            reloaded.web_search.api_key, "/tmp/via-update",
            "on-disk state reflects the patch"
        );
    }

    #[test]
    fn update_with_patch_err_rolls_back_atomically() {
        let mut initial = IntegrationsConfig::default();
        initial.web_search.api_key = "/tmp/original".into();
        let (store, _tmp, path) = tmp_store(initial);

        #[derive(Debug, thiserror::Error)]
        #[error("rejected")]
        struct Rejected;

        let err = store
            .update(|cfg| -> Result<(), Rejected> {
                cfg.web_search.api_key = "/tmp/ignored".into();
                Err(Rejected)
            })
            .unwrap_err();
        assert!(matches!(err, UpdateError::Patch(_)));

        assert_eq!(
            store.snapshot().web_search.api_key,
            "/tmp/original",
            "in-memory state is unchanged after patch error"
        );
        let reloaded = IntegrationsConfig::load_from(&path).expect("reload from disk");
        assert_eq!(
            reloaded.web_search.api_key, "/tmp/original",
            "on-disk state is unchanged after patch error"
        );
    }

    #[test]
    fn update_refuses_to_overwrite_corrupt_file() {
        // Seed the tempdir with a corrupt JSON blob, then construct the
        // store via `with_path` so it goes through the same load-failure
        // detection path as production `new()`.
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("integrations.json");
        std::fs::write(&path, "{ not valid json").expect("seed corrupt blob");
        // Capture the original bytes for comparison after the failed update.
        let corrupt_before = std::fs::read(&path).expect("read corrupt before");

        let store = IntegrationsStore::with_path(path.clone());

        // The store comes up usable (snapshot returns the in-memory default).
        assert_eq!(
            store.snapshot().web_search.api_key,
            "",
            "corrupt file boots store with in-memory defaults"
        );

        // But update() must refuse — without the load-failure gate, the
        // next save would overwrite the corrupt-but-recoverable file with
        // the empty default config, permanently destroying the user's
        // integration state.
        let err = store
            .update(|cfg| -> Result<(), Infallible> {
                cfg.web_search.api_key = "/tmp/should-not-persist".into();
                Ok(())
            })
            .unwrap_err();
        assert!(
            matches!(err, UpdateError::LoadFailed(_)),
            "expected UpdateError::LoadFailed, got: {err:?}",
        );

        // Most importantly: the on-disk bytes are still the original
        // corrupt content, byte-for-byte. The user can fix the file by
        // hand and restart.
        let corrupt_after = std::fs::read(&path).expect("read corrupt after");
        assert_eq!(
            corrupt_before, corrupt_after,
            "on-disk file must be untouched when update is gated by LoadFailed"
        );
    }

    #[test]
    fn update_proceeds_when_file_is_legitimately_missing() {
        // ENOENT (fresh install / never persisted) must NOT trip the
        // load-failure gate — the whole point of the gate is to protect
        // recoverable data, and there is no recoverable data when the
        // file simply doesn't exist yet.
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("integrations.json");
        // Deliberately do not seed the path — load_from sees ENOENT.

        let store = IntegrationsStore::with_path(path.clone());

        let snap: IntegrationsConfig = store
            .update(|cfg| -> Result<(), Infallible> {
                cfg.web_search.api_key = "/tmp/fresh-install".into();
                Ok(())
            })
            .expect("ENOENT must not trip the load-failure gate");
        assert_eq!(
            snap.web_search.api_key, "/tmp/fresh-install",
            "fresh-install update path persists normally"
        );

        let reloaded = IntegrationsConfig::load_from(&path).expect("reload from disk");
        assert_eq!(
            reloaded.web_search.api_key, "/tmp/fresh-install",
            "on-disk state reflects the patch on the fresh-install path"
        );
    }
}

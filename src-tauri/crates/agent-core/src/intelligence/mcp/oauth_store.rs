//! On-disk OAuth credential store.
//!
//! Persists per-server `StoredCredentials` (from `rmcp::transport::auth`) to
//!
//!   `~/.orgii/mcp-oauth-tokens/<safe-server-name>.json`
//!
//! One file per server keeps the blast radius of a corrupt payload small —
//! a single malformed token file only takes down one server, not the whole
//! cache. Honors `ORGII_HOME` for tests.
//!
//! Built on top of the `rmcp` auth-state machine instead of reimplementing
//! the OAuth client ourselves.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use rmcp::transport::auth::{AuthError, CredentialStore, StoredCredentials};
use tokio::sync::Mutex;
use tracing::{debug, warn};

/// Directory name under `$ORGII_HOME` / `~/.orgii/` where we store one JSON
/// file per authenticated server.
const TOKENS_DIR: &str = "mcp-oauth-tokens";

fn tokens_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("ORGII_HOME") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir).join(TOKENS_DIR));
        }
    }
    dirs::home_dir().map(|home| home.join(".orgii").join(TOKENS_DIR))
}

/// Sanitize a server name for use as a file-name component. Mirrors the
/// same allow-list `normalize_name_for_mcp` in `bridge.rs` uses.
fn sanitize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        out.push('_');
    }
    out
}

fn token_path_for(server: &str) -> Option<PathBuf> {
    tokens_dir().map(|dir| dir.join(format!("{}.json", sanitize(server))))
}

/// `rmcp`'s `CredentialStore` implementation that reads/writes a single
/// JSON file on disk. Constructed per-server so the file name is baked
/// into the store — the "one file per server" layout keeps the
/// `load/save/clear` trait methods trivially correct.
#[derive(Clone)]
pub(crate) struct FileCredentialStore {
    /// The server name this store corresponds to (used for logging; path
    /// is resolved eagerly in [`FileCredentialStore::new`]).
    server: String,

    /// Full path to the token JSON file. `None` when we can't resolve
    /// `ORGII_HOME` / home dir — in that case we behave as an in-memory
    /// no-op store and log a warning.
    path: Option<PathBuf>,

    /// Serializes writes so two concurrent `save()` calls don't race.
    write_lock: Arc<Mutex<()>>,
}

impl FileCredentialStore {
    /// Build a store bound to `server`. File location is resolved
    /// eagerly so the path is stable for the lifetime of the store
    /// (tests flipping `ORGII_HOME` mid-flight still get a coherent
    /// view — they should build a new store per test).
    pub(crate) fn new(server: &str) -> Self {
        Self {
            server: server.to_string(),
            path: token_path_for(server),
            write_lock: Arc::new(Mutex::new(())),
        }
    }
}

#[cfg(test)]
impl FileCredentialStore {
    /// Absolute path this store is bound to, if one could be resolved.
    /// Test-only accessor — not part of the `rmcp` `CredentialStore`
    /// contract.
    pub(crate) fn path(&self) -> Option<&PathBuf> {
        self.path.as_ref()
    }
}

#[async_trait]
impl CredentialStore for FileCredentialStore {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        let Some(path) = &self.path else {
            return Ok(None);
        };
        let bytes = match tokio::fs::read(path).await {
            Ok(b) => b,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => {
                return Err(AuthError::InternalError(format!(
                    "mcp-oauth: read {} failed: {}",
                    path.display(),
                    err
                )));
            }
        };
        match serde_json::from_slice::<StoredCredentials>(&bytes) {
            Ok(creds) => Ok(Some(creds)),
            Err(err) => {
                warn!(
                    "[mcp:oauth-store] malformed creds for '{}' at {}: {} — treating as empty",
                    self.server,
                    path.display(),
                    err
                );
                Ok(None)
            }
        }
    }

    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        let Some(path) = self.path.clone() else {
            warn!(
                "[mcp:oauth-store] no home dir resolved — dropping creds for '{}'",
                self.server
            );
            return Ok(());
        };
        let _guard = self.write_lock.lock().await;
        if let Some(parent) = path.parent() {
            if let Err(err) = tokio::fs::create_dir_all(parent).await {
                return Err(AuthError::InternalError(format!(
                    "mcp-oauth: create_dir_all {} failed: {}",
                    parent.display(),
                    err
                )));
            }
        }
        let bytes = serde_json::to_vec_pretty(&credentials).map_err(|e| {
            AuthError::InternalError(format!(
                "mcp-oauth: serialize creds for '{}' failed: {}",
                self.server, e
            ))
        })?;
        tokio::fs::write(&path, bytes).await.map_err(|e| {
            AuthError::InternalError(format!("mcp-oauth: write {} failed: {}", path.display(), e))
        })?;
        debug!(
            "[mcp:oauth-store] saved creds for '{}' → {}",
            self.server,
            path.display()
        );
        Ok(())
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let Some(path) = self.path.clone() else {
            return Ok(());
        };
        let _guard = self.write_lock.lock().await;
        match tokio::fs::remove_file(&path).await {
            Ok(()) => {
                debug!(
                    "[mcp:oauth-store] cleared creds for '{}' ({})",
                    self.server,
                    path.display()
                );
                Ok(())
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(AuthError::InternalError(format!(
                "mcp-oauth: remove {} failed: {}",
                path.display(),
                err
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::transport::auth::StoredCredentials;

    // ORGII_HOME is process-wide; all tests go through the crate-wide
    // `test_env::sandbox()` so cross-module races and `Once` poisoning
    // are both eliminated (see `src/test_utils/test_env.rs`).
    use test_helpers::test_env::{sandbox, SandboxGuard};
    type HomeGuard = SandboxGuard;

    fn new_home_guard() -> HomeGuard {
        sandbox()
    }

    fn dummy_creds(client_id: &str) -> StoredCredentials {
        StoredCredentials::new(
            client_id.to_string(),
            None,
            vec!["openid".to_string()],
            Some(1_700_000_000),
        )
    }

    #[tokio::test]
    async fn load_on_missing_returns_none() {
        let _g = new_home_guard();
        let store = FileCredentialStore::new("alpha");
        assert!(store.load().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn save_then_load_roundtrip() {
        let _g = new_home_guard();
        let store = FileCredentialStore::new("alpha");
        store.save(dummy_creds("client-123")).await.unwrap();
        let loaded = store.load().await.unwrap().expect("some");
        assert_eq!(loaded.client_id, "client-123");
        assert_eq!(loaded.granted_scopes, vec!["openid".to_string()]);
    }

    #[tokio::test]
    async fn clear_removes_file() {
        let _g = new_home_guard();
        let store = FileCredentialStore::new("alpha");
        store.save(dummy_creds("client-123")).await.unwrap();
        assert!(store.path().unwrap().exists());
        store.clear().await.unwrap();
        assert!(!store.path().unwrap().exists());
        assert!(store.load().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn sanitize_unsafe_server_names() {
        let _g = new_home_guard();
        let store = FileCredentialStore::new("weird/name@host");
        let path = store.path().unwrap();
        let fname = path.file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(fname, "weird_name_host.json");
    }

    #[tokio::test]
    async fn malformed_file_treated_as_empty() {
        let _g = new_home_guard();
        let store = FileCredentialStore::new("alpha");
        let path = store.path().unwrap().clone();
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.unwrap();
        }
        tokio::fs::write(&path, "not-json").await.unwrap();
        assert!(store.load().await.unwrap().is_none());
    }
}

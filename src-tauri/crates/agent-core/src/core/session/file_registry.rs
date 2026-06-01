//! File-based session registry for concurrent session tracking.
//!
//! Each active session writes a JSON file to `~/.orgii/sessions/{session_id}.json`.
//! On app startup, stale entries (from a previous crash) are cleaned up.
//! This provides crash-resilient session awareness that survives process restarts.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{debug, info, warn};

/// Metadata written to disk for each active session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRegistryEntry {
    pub session_id: String,
    /// Logical agent type label (e.g. `"coding"`, `"desktop"`).
    pub agent_type: String,
    pub model: String,
    pub workspace_path: Option<String>,
    /// Session status; must be a valid [`SessionStatus`] as produced by
    /// [`SessionStatus::as_str`].
    pub status: String,
    pub started_at: String,
    pub last_updated_at: String,
}

fn sessions_dir() -> PathBuf {
    app_paths::session_registry_dir()
}

fn session_file_path(session_id: &str) -> PathBuf {
    app_paths::session_registry_file(session_id)
}

/// Register a session by writing its metadata to disk.
/// Uses atomic write (temp file + rename) to avoid partial reads.
pub fn register_session(entry: &SessionRegistryEntry) -> Result<(), String> {
    let dir = sessions_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create sessions dir: {}", err))?;

    let json = serde_json::to_string_pretty(entry)
        .map_err(|err| format!("Failed to serialize session entry: {}", err))?;

    let target = session_file_path(&entry.session_id);
    let tmp = dir.join(format!("{}.tmp", entry.session_id));

    std::fs::write(&tmp, &json).map_err(|err| format!("Failed to write temp file: {}", err))?;

    std::fs::rename(&tmp, &target)
        .map_err(|err| format!("Failed to rename temp -> target: {}", err))?;

    debug!(
        "[file_registry] Registered session {} (agent_type={})",
        entry.session_id, entry.agent_type
    );
    Ok(())
}

/// Remove a session's registry file.
pub fn unregister_session(session_id: &str) {
    let path = session_file_path(session_id);
    if path.exists() {
        if let Err(err) = std::fs::remove_file(&path) {
            warn!(
                "[file_registry] Failed to remove session file {}: {}",
                session_id, err
            );
        } else {
            debug!("[file_registry] Unregistered session {}", session_id);
        }
    }
}

/// List all registered sessions by scanning the sessions directory.
///
/// Test-only helper. Missing directory returns empty (the registry has
/// not been initialized yet). Other I/O errors return empty too but
/// surface a `tracing::warn!` so a permission-denied or transient FS
/// error doesn't look like "no sessions exist" in test logs. JSON parse
/// errors on individual registry files are also warned (rather than
/// silently dropped) so a corrupt entry is visible to the test author.
#[cfg(test)]
pub fn list_registered_sessions() -> Vec<SessionRegistryEntry> {
    let dir = sessions_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(err) => {
            warn!(
                "[file_registry] read_dir({}) failed: {}; treating as empty registry",
                dir.display(),
                err
            );
            return Vec::new();
        }
    };

    let mut result = Vec::new();
    for dir_entry in entries.flatten() {
        let path = dir_entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read_to_string(&path) {
            Ok(contents) => match serde_json::from_str::<SessionRegistryEntry>(&contents) {
                Ok(entry) => result.push(entry),
                Err(err) => warn!(
                    "[file_registry] Failed to parse {:?}: {}; skipping entry",
                    path.file_name(),
                    err
                ),
            },
            Err(err) => {
                warn!(
                    "[file_registry] Failed to read {:?}: {}",
                    path.file_name(),
                    err
                );
            }
        }
    }
    result
}

/// Remove registry files for sessions not in `active_ids`.
/// Call on startup to clean up stale sessions from a previous crash.
pub fn cleanup_stale_sessions(active_ids: &[String]) {
    let dir = sessions_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    "[file_registry] cleanup_stale_sessions: failed to read sessions dir {:?}: {}",
                    dir, err
                );
            }
            return;
        }
    };

    let mut cleaned = 0;
    for dir_entry in entries.flatten() {
        let path = dir_entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(stem) => stem.to_string(),
            None => continue,
        };
        if !active_ids.contains(&stem) {
            if let Err(err) = std::fs::remove_file(&path) {
                warn!(
                    "[file_registry] Failed to clean up stale file {:?}: {}",
                    path.file_name(),
                    err
                );
            } else {
                cleaned += 1;
            }
        }
    }
    if cleaned > 0 {
        info!(
            "[file_registry] Cleaned up {} stale session file(s)",
            cleaned
        );
    }
}

#[cfg(test)]
mod tests {
    use super::super::SessionStatus;
    use super::*;
    use test_helpers::test_env;

    fn test_entry(session_id: &str) -> SessionRegistryEntry {
        SessionRegistryEntry {
            session_id: session_id.to_string(),
            agent_type: "coding".to_string(),
            model: "test-model".to_string(),
            workspace_path: Some("/tmp/test".to_string()),
            status: SessionStatus::Running.as_str().to_string(),
            started_at: "2025-01-01T00:00:00Z".to_string(),
            last_updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    // Each test takes an isolated `ORGII_HOME` sandbox so
    // `list_registered_sessions()` (which scans the whole sessions
    // directory) cannot see files written by concurrent tests. Without
    // the sandbox, parallel runs sporadically fail when another test's
    // cleanup races this test's scan.
    #[test]
    fn register_creates_file() {
        let _sb = test_env::sandbox();
        let session_id = "sess-register";
        let entry = test_entry(session_id);
        register_session(&entry).unwrap();

        let path = session_file_path(session_id);
        assert!(path.exists());

        let contents = std::fs::read_to_string(&path).unwrap();
        let loaded: SessionRegistryEntry = serde_json::from_str(&contents).unwrap();
        assert_eq!(loaded.session_id, session_id);
        assert_eq!(loaded.agent_type, "coding");
    }

    #[test]
    fn unregister_deletes_file() {
        let _sb = test_env::sandbox();
        let session_id = "sess-unregister";
        register_session(&test_entry(session_id)).unwrap();

        let path = session_file_path(session_id);
        assert!(path.exists());

        unregister_session(session_id);
        assert!(!path.exists());
    }

    #[test]
    fn list_sessions_returns_registered() {
        let _sb = test_env::sandbox();
        register_session(&test_entry("id-1")).unwrap();
        register_session(&test_entry("id-2")).unwrap();

        let sessions = list_registered_sessions();
        let ids: Vec<&str> = sessions.iter().map(|s| s.session_id.as_str()).collect();
        assert!(ids.contains(&"id-1"));
        assert!(ids.contains(&"id-2"));
    }

    #[test]
    fn cleanup_removes_stale() {
        let _sb = test_env::sandbox();
        register_session(&test_entry("active")).unwrap();
        register_session(&test_entry("stale")).unwrap();

        cleanup_stale_sessions(&["active".to_string()]);

        assert!(session_file_path("active").exists());
        assert!(!session_file_path("stale").exists());
    }
}

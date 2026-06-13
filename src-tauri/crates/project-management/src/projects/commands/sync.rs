//! Tauri commands for the pluggable sync framework.
//!
//! These commands are the only frontend-visible surface; everything
//! else (the worker loop, the outbox CRUD, the adapters) lives behind
//! `project_management::sync` and is kept private to that module.
//!
//! Storage rules:
//! - Adapter attachment is recorded on the `projects` row itself
//!   (`sync_kind` + `sync_config_json`). One adapter per project; the
//!   detach command resets both columns to `'none'` / `NULL`.
//! - Outbox state lives in `outbox_entries`; commands only read counts
//!   here. The worker is the sole writer for status transitions.
//!
//! All commands return `Result<T, String>` per the project-store
//! convention. Heavy IO is wrapped in `spawn_blocking` so the Tauri
//! event loop never sees a synchronous SQLite call.
//!
//! ## Module layout
//!
//! | Submodule | Responsibility |
//! |-----------|----------------|
//! | `sync_oauth`   | OAuth device + PKCE flows |
//! | `sync_webhook` | Webhook install / status / rotate |
//! | `sync_adapter` | Adapter attach/detach, status, force push/pull, metrics |
//! | `sync_import`  | Bulk import, conflict resolution, outbox problems |
//! | `sync_debug`   | Debug-only e2e helpers (`#[cfg(debug_assertions)]`) |

#[path = "sync_adapter.rs"]
mod sync_adapter;
#[path = "sync_debug.rs"]
mod sync_debug;
#[path = "sync_import.rs"]
mod sync_import;
#[path = "sync_oauth.rs"]
mod sync_oauth;
#[path = "sync_webhook.rs"]
mod sync_webhook;

pub use sync_adapter::*;
#[cfg(debug_assertions)]
pub use sync_debug::*;
pub use sync_import::*;
pub use sync_oauth::*;
pub use sync_webhook::*;

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use tokio::task;
use tokio_util::sync::CancellationToken;

use crate::sync::{
    connection_store::{self, CreateConnectionRequest, SyncConnection},
    connection_token_store::{self, ConnectionTokenRecord},
};

// ============================================================================
// Shared pending-flow registry (used by sync_oauth + sync_debug)
// ============================================================================

/// In-flight OAuth flow, keyed by `(slug, adapter_id)`. Holds every
/// provider-secret bit (device code, PKCE state + verifier) so the
/// frontend never has to round-trip them. Variants mirror
/// [`oauth::OAuthFlowStart`].
pub(super) enum PendingFlow {
    /// RFC 8628 device flow (GitHub).
    Device {
        adapter_id: String,
        client_id: String,
        device_code: String,
        interval_secs: u64,
        cancel: CancellationToken,
    },
    /// Authorization Code + PKCE with loopback redirect (Linear).
    Redirect {
        adapter_id: String,
        client_id: String,
        state: String,
        code_verifier: String,
        port: u16,
        redirect_uri: String,
        cancel: CancellationToken,
    },
}

impl PendingFlow {
    pub(super) fn adapter_id(&self) -> &str {
        match self {
            PendingFlow::Device { adapter_id, .. } => adapter_id,
            PendingFlow::Redirect { adapter_id, .. } => adapter_id,
        }
    }

    pub(super) fn cancel_token(&self) -> &CancellationToken {
        match self {
            PendingFlow::Device { cancel, .. } => cancel,
            PendingFlow::Redirect { cancel, .. } => cancel,
        }
    }
}

/// Process-local pending flow registry. The mutex only wraps the map
/// itself; the inner [`CancellationToken`] is `Send + Sync` so cancel
/// commands clone it out under the lock and signal it after release.
pub(super) static PENDING_FLOWS: LazyLock<Mutex<HashMap<(String, String), PendingFlow>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone)]
pub enum PendingFlowScope {
    ConnectionId(String),
}

impl PendingFlowScope {
    pub(super) fn pending_key(&self, adapter_id: &str) -> (String, String) {
        match self {
            PendingFlowScope::ConnectionId(connection_id) => (
                format!("connection:{connection_id}"),
                adapter_id.to_string(),
            ),
        }
    }
}

pub(super) fn connection_pending_key(connection_id: &str, adapter_id: &str) -> (String, String) {
    PendingFlowScope::ConnectionId(connection_id.to_string()).pending_key(adapter_id)
}

// ============================================================================
// Connection commands
// ============================================================================

#[tauri::command]
pub async fn sync_connection_list() -> Result<Vec<SyncConnection>, String> {
    task::spawn_blocking(connection_store::list)
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn sync_connection_create_pat(
    adapter_id: String,
    label: String,
    token: String,
    account_email: Option<String>,
) -> Result<SyncConnection, String> {
    task::spawn_blocking(move || {
        let trimmed_token = token.trim().to_string();
        if trimmed_token.is_empty() {
            return Err("Personal access token is required".to_string());
        }
        let connection = connection_store::create(CreateConnectionRequest {
            adapter_id,
            label,
            auth_method: connection_store::AUTH_METHOD_PAT.to_string(),
            account_email,
        })?;
        connection_token_store::save(
            &connection.id,
            ConnectionTokenRecord {
                access_token: trimmed_token,
                refresh_token: None,
                expires_at_unix: None,
                source: connection_store::AUTH_METHOD_PAT.to_string(),
            },
        )?;
        Ok(connection)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Create a GitHub connection from a token discovered on the host
/// machine (gh CLI, credential helper, `.git-credentials`).
///
/// Validates the token against `GET https://api.github.com/user` before
/// persisting so we never store a credential we already know to be
/// dead. Returns the new connection record on success.
///
/// `adapter_id` is always `connection_store::ADAPTER_GITHUB` from the
/// frontend; we accept it as a parameter (rather than hard-coding it)
/// so a future GitLab / Bitbucket variant can reuse this command
/// shape, but for now anything other than `"github"` is rejected.
#[tauri::command]
pub async fn sync_connection_create_from_scan(
    adapter_id: String,
    label: String,
    token: String,
    account_email: Option<String>,
) -> Result<SyncConnection, String> {
    if adapter_id != connection_store::ADAPTER_GITHUB {
        return Err(format!(
            "sync_connection_create_from_scan only supports adapter '{}', got '{}'",
            connection_store::ADAPTER_GITHUB,
            adapter_id
        ));
    }
    let trimmed_token = token.trim().to_string();
    if trimmed_token.is_empty() {
        return Err("Discovered token is empty".to_string());
    }

    // Validate the token by calling GitHub's `/user` endpoint. Catches
    // expired gh-CLI tokens and stale credential-helper entries before
    // they poison the store. We do this *before* creating the
    // connection row so failures leave no detritus.
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("token {}", trimmed_token))
        .header("User-Agent", "orgii-app")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|err| format!("GitHub API request failed: {}", err))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GitHub token validation failed ({}): {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        ));
    }
    drop(resp);

    task::spawn_blocking(move || {
        let connection = connection_store::create(CreateConnectionRequest {
            adapter_id,
            label,
            auth_method: connection_store::AUTH_METHOD_SCAN.to_string(),
            account_email,
        })?;
        connection_token_store::save(
            &connection.id,
            ConnectionTokenRecord {
                access_token: trimmed_token,
                refresh_token: None,
                expires_at_unix: None,
                source: connection_token_store::SOURCE_SCAN.to_string(),
            },
        )?;
        Ok(connection)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Create a GitHub connection that authenticates via SSH.
///
/// `ssh_key_path` is the absolute path to the **private** key; we
/// store it as the connection's `access_token` (with
/// `source = "ssh"`) so clone/push consumers can ask
/// `connection_token_store` for a single uniform "what credential
/// does this connection carry?" answer. The file is not opened or
/// read here — the value is treated as opaque path metadata.
///
/// No GitHub API validation is possible for an SSH key; the only
/// way to know if it works is to attempt `ssh -T git@github.com`,
/// which we deliberately do not run on the connection-create path
/// (slow, may prompt, may modify known_hosts). Consumers test it
/// implicitly when they first clone.
#[tauri::command]
pub async fn sync_connection_create_from_ssh(
    adapter_id: String,
    label: String,
    ssh_key_path: String,
    account_email: Option<String>,
) -> Result<SyncConnection, String> {
    if adapter_id != connection_store::ADAPTER_GITHUB {
        return Err(format!(
            "sync_connection_create_from_ssh only supports adapter '{}', got '{}'",
            connection_store::ADAPTER_GITHUB,
            adapter_id
        ));
    }
    let trimmed_path = ssh_key_path.trim().to_string();
    if trimmed_path.is_empty() {
        return Err("SSH key path is required".to_string());
    }

    task::spawn_blocking(move || {
        let connection = connection_store::create(CreateConnectionRequest {
            adapter_id,
            label,
            auth_method: connection_store::AUTH_METHOD_SSH.to_string(),
            account_email,
        })?;
        connection_token_store::save(
            &connection.id,
            ConnectionTokenRecord {
                access_token: trimmed_path,
                refresh_token: None,
                expires_at_unix: None,
                source: connection_token_store::SOURCE_SSH.to_string(),
            },
        )?;
        Ok(connection)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn sync_connection_rename(
    connection_id: String,
    label: String,
) -> Result<SyncConnection, String> {
    task::spawn_blocking(move || connection_store::rename(&connection_id, &label))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn sync_connection_delete(connection_id: String) -> Result<(), String> {
    task::spawn_blocking(move || connection_store::delete(&connection_id))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

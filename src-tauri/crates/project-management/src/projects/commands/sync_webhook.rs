//! Webhook management commands for the pluggable sync framework.
//!
//! Handles `project_sync_webhook_install`, `_status`, and `_rotate`.

use tokio::task;

use crate::sync::{self, adapters};

// ============================================================================
// Public wire types
// ============================================================================

/// Wire payload returned by [`project_sync_webhook_install`] and
/// [`project_sync_webhook_rotate`].
///
/// `secret_hex` is the raw hex secret the user must paste into the
/// remote provider's webhook configuration. We surface it once
/// (immediately after install/rotate) and never read it back through
/// any frontend-facing command — the listener reads it directly from
/// `webhook_secrets`.
///
/// `url_path` is the listener path (`/sync/webhook/<adapter>/<slug>`)
/// — the frontend prepends the user-configured tunnel base URL
/// (cloudflared / ngrok / static reverse-proxy domain) to build the
/// full URL the user copy-pastes into the provider UI. We avoid
/// building a full URL server-side because the IDE doesn't know what
/// public domain (if any) is fronting `127.0.0.1:13847`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WebhookInstallInfo {
    pub url_path: String,
    pub secret_hex: String,
    pub last_rotated_at: i64,
}

/// Snapshot of a project's webhook state. `installed = false` means
/// no row in `webhook_secrets` for `(slug, adapter_id)`; the URL/
/// rotation fields are then `None`.
///
/// `last_webhook_at` is the most recent successful delivery
/// (`projects.sync_last_webhook_at`), independent of which adapter
/// was actually installed — it lives on the project row, not the
/// secret row, because the freshness gate is per-project.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WebhookStatus {
    pub adapter_id: String,
    pub installed: bool,
    pub url_path: Option<String>,
    pub last_rotated_at: Option<i64>,
    pub last_webhook_at: Option<i64>,
}

// ============================================================================
// Private helpers
// ============================================================================

/// Build the listener path for `(adapter_id, slug)`. Mirrors the
/// route registered in [`sync::webhook_listener::router`].
fn webhook_url_path(adapter_id: &str, slug: &str) -> String {
    format!(
        "{}/{}/{}",
        sync::webhook_listener::WEBHOOK_BASE_PATH,
        adapter_id,
        slug
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or(0)
}

// ============================================================================
// Tauri commands
// ============================================================================

/// Mint a fresh webhook secret for `(slug, adapter_id)` and persist
/// it. If a secret already exists for the pair the call rotates it
/// (same DB upsert path as [`project_sync_webhook_rotate`]).
///
/// Errors when:
/// - the adapter id isn't registered;
/// - the adapter doesn't advertise webhook support
///   ([`SyncAdapter::supports_webhook`] returns `false`);
/// - the project isn't bound to that adapter (a stale install
///   would land deliveries on a project the user can't see).
#[tauri::command]
pub async fn project_sync_webhook_install(
    slug: String,
    adapter_id: String,
) -> Result<WebhookInstallInfo, String> {
    let adapter = adapters::get(&adapter_id)
        .ok_or_else(|| format!("Unknown sync adapter '{}'", adapter_id))?;
    if !adapter.supports_webhook() {
        return Err(format!(
            "Adapter '{}' does not support webhook ingestion",
            adapter_id
        ));
    }

    let install_slug = slug.clone();
    let install_adapter = adapter_id.clone();
    let (secret_hex, last_rotated_at) = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        let binding = sync::io::read_adapter_binding(&connection, &install_slug)?;
        match binding {
            Some(binding) if binding.adapter_id == install_adapter => {}
            Some(binding) => {
                return Err(format!(
                    "Project '{}' is bound to adapter '{}', not '{}'",
                    install_slug, binding.adapter_id, install_adapter
                ));
            }
            None => {
                return Err(format!(
                    "Project '{}' has no adapter attached — attach '{}' first",
                    install_slug, install_adapter
                ));
            }
        }
        let now = now_ms();
        let secret = sync::webhook_secrets::rotate_secret(
            &connection,
            &install_slug,
            &install_adapter,
            now,
        )?;
        Ok::<_, String>((secret, now))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    Ok(WebhookInstallInfo {
        url_path: webhook_url_path(&adapter_id, &slug),
        secret_hex,
        last_rotated_at,
    })
}

/// Read the webhook state for `(slug, adapter_id)`. Surfaces whether
/// a secret is installed, when it was last rotated, and when the
/// most recent inbound delivery landed (so the UI can render the
/// "green dot when last_webhook_at < 10 minutes" indicator).
///
/// Never returns the secret itself — install/rotate are the only
/// commands that surface secret material, and only once.
#[tauri::command]
pub async fn project_sync_webhook_status(
    slug: String,
    adapter_id: String,
) -> Result<WebhookStatus, String> {
    if adapters::get(&adapter_id).is_none() {
        return Err(format!("Unknown sync adapter '{}'", adapter_id));
    }
    let path = webhook_url_path(&adapter_id, &slug);
    let status_slug = slug.clone();
    let status_adapter = adapter_id.clone();
    let (installed, last_rotated_at, last_webhook_at) = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        let secret = sync::webhook_secrets::get_secret(&connection, &status_slug, &status_adapter)?;
        let last_webhook_at = sync::io::read_last_webhook_at(&connection, &status_slug)?;
        Ok::<_, String>((
            secret.is_some(),
            secret.map(|sec| sec.last_rotated_at),
            last_webhook_at,
        ))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    Ok(WebhookStatus {
        adapter_id,
        installed,
        url_path: if installed { Some(path) } else { None },
        last_rotated_at,
        last_webhook_at,
    })
}

/// Rotate the webhook secret for `(slug, adapter_id)`. Surfaces the
/// fresh secret to the caller exactly once; the user must paste it
/// into the remote provider's webhook config before deliveries
/// resume succeeding.
///
/// Errors when no secret is currently installed for the pair —
/// rotation is conceptually "replace the existing secret", and a
/// silent install would mask a stale UI calling this on the wrong
/// adapter.
#[tauri::command]
pub async fn project_sync_webhook_rotate(
    slug: String,
    adapter_id: String,
) -> Result<WebhookInstallInfo, String> {
    if adapters::get(&adapter_id).is_none() {
        return Err(format!("Unknown sync adapter '{}'", adapter_id));
    }
    let rotate_slug = slug.clone();
    let rotate_adapter = adapter_id.clone();
    let (secret_hex, last_rotated_at) = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        let existing =
            sync::webhook_secrets::get_secret(&connection, &rotate_slug, &rotate_adapter)?;
        if existing.is_none() {
            return Err(format!(
                "No webhook installed for project '{}' / adapter '{}'",
                rotate_slug, rotate_adapter
            ));
        }
        let now = now_ms();
        let secret =
            sync::webhook_secrets::rotate_secret(&connection, &rotate_slug, &rotate_adapter, now)?;
        Ok::<_, String>((secret, now))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    Ok(WebhookInstallInfo {
        url_path: webhook_url_path(&adapter_id, &slug),
        secret_hex,
        last_rotated_at,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod webhook_command_tests {
    //! Command-level coverage for the
    //! `project_sync_webhook_install` / `project_sync_webhook_status` /
    //! `project_sync_webhook_rotate` surface. Same test sandbox shape
    //! as the problems tests (per-test temp dir, direct command
    //! invocation, no Tauri shell required).
    use super::*;
    use test_helpers::test_env;

    fn seed_project(slug: &str) {
        let connection = sync::io::conn().expect("conn");
        crate::projects::schema::init_project_tables(&connection).expect("init schema");
        connection
            .execute(
                "INSERT INTO projects (id, name, slug, short_id_prefix, created_at, updated_at)
                 VALUES (?1, ?1, ?2, 'AAA', 0, 0)",
                rusqlite::params![format!("p-{}", slug), slug],
            )
            .expect("insert project");
    }

    fn attach_echo(slug: &str) {
        seed_project(slug);
        let connection = sync::io::conn().expect("conn");
        sync::io::attach_adapter(&connection, slug, "echo", "{}", "connection-echo")
            .expect("attach echo");
    }

    #[tokio::test]
    async fn install_rejects_unknown_adapter() {
        let _sandbox = test_env::sandbox();
        attach_echo("alpha");
        let err = project_sync_webhook_install("alpha".to_string(), "nope".to_string())
            .await
            .unwrap_err();
        assert!(err.to_lowercase().contains("unknown"), "got {}", err);
    }

    #[tokio::test]
    async fn install_rejects_unbound_project() {
        let _sandbox = test_env::sandbox();
        seed_project("alpha");
        let err = project_sync_webhook_install("alpha".to_string(), "echo".to_string())
            .await
            .unwrap_err();
        assert!(err.to_lowercase().contains("attach"), "got {}", err);
    }

    #[tokio::test]
    async fn install_rejects_adapter_mismatch() {
        let _sandbox = test_env::sandbox();
        attach_echo("alpha");
        let err = project_sync_webhook_install("alpha".to_string(), "linear".to_string())
            .await
            .unwrap_err();
        assert!(
            err.to_lowercase().contains("bound to") || err.to_lowercase().contains("not"),
            "got {}",
            err
        );
    }

    #[tokio::test]
    async fn install_then_status_reports_installed() {
        let _sandbox = test_env::sandbox();
        attach_echo("alpha");
        let info = project_sync_webhook_install("alpha".to_string(), "echo".to_string())
            .await
            .expect("install");
        assert_eq!(info.url_path, "/sync/webhook/echo/alpha");
        assert_eq!(info.secret_hex.len(), 64);
        assert!(info.last_rotated_at > 0);

        let status = project_sync_webhook_status("alpha".to_string(), "echo".to_string())
            .await
            .expect("status");
        assert!(status.installed);
        assert_eq!(status.url_path.as_deref(), Some("/sync/webhook/echo/alpha"));
        assert_eq!(status.last_rotated_at, Some(info.last_rotated_at));
        assert_eq!(status.last_webhook_at, None);
    }

    #[tokio::test]
    async fn status_uninstalled_returns_empty_url() {
        let _sandbox = test_env::sandbox();
        attach_echo("alpha");
        let status = project_sync_webhook_status("alpha".to_string(), "echo".to_string())
            .await
            .expect("status");
        assert!(!status.installed);
        assert!(status.url_path.is_none());
        assert!(status.last_rotated_at.is_none());
    }

    #[tokio::test]
    async fn rotate_replaces_secret() {
        let _sandbox = test_env::sandbox();
        attach_echo("alpha");
        let first = project_sync_webhook_install("alpha".to_string(), "echo".to_string())
            .await
            .expect("install");
        let second = project_sync_webhook_rotate("alpha".to_string(), "echo".to_string())
            .await
            .expect("rotate");
        assert_ne!(first.secret_hex, second.secret_hex);
        assert!(second.last_rotated_at >= first.last_rotated_at);
    }

    #[tokio::test]
    async fn rotate_without_install_errors() {
        let _sandbox = test_env::sandbox();
        attach_echo("alpha");
        let err = project_sync_webhook_rotate("alpha".to_string(), "echo".to_string())
            .await
            .unwrap_err();
        assert!(err.to_lowercase().contains("no webhook"), "got {}", err);
    }
}

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

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use tokio::task;
use tokio_util::sync::CancellationToken;

use crate::sync::{
    self,
    adapter::{AdapterDescriptor, AuthMethod, SyncStatusReport},
    adapters,
    conflict_log::{self, ConflictResolution as ConflictRowResolution, ConflictRow},
    connection_store::{self, CreateConnectionRequest, SyncConnection},
    connection_token_store::{self, ConnectionTokenRecord},
    events::SyncEventTrigger,
    import::{self as sync_import, ImportProgressRow},
    metrics::{MetricKind, MetricOutcome},
    oauth::{self, OAuthFlowStart},
    types::{EntityType, OutboxProblemRow, OutboxStatus},
};

/// In-flight OAuth flow, keyed by `(slug, adapter_id)`. Holds every
/// provider-secret bit (device code, PKCE state + verifier) so the
/// frontend never has to round-trip them. Variants mirror
/// [`oauth::OAuthFlowStart`].
enum PendingFlow {
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
    fn adapter_id(&self) -> &str {
        match self {
            PendingFlow::Device { adapter_id, .. } => adapter_id,
            PendingFlow::Redirect { adapter_id, .. } => adapter_id,
        }
    }

    fn cancel_token(&self) -> &CancellationToken {
        match self {
            PendingFlow::Device { cancel, .. } => cancel,
            PendingFlow::Redirect { cancel, .. } => cancel,
        }
    }
}

/// Process-local pending flow registry. The mutex only wraps the map
/// itself; the inner [`CancellationToken`] is `Send + Sync` so cancel
/// commands clone it out under the lock and signal it after release.
static PENDING_FLOWS: LazyLock<Mutex<HashMap<(String, String), PendingFlow>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone)]
pub enum PendingFlowScope {
    ConnectionId(String),
}

impl PendingFlowScope {
    fn pending_key(&self, adapter_id: &str) -> (String, String) {
        match self {
            PendingFlowScope::ConnectionId(connection_id) => (
                format!("connection:{connection_id}"),
                adapter_id.to_string(),
            ),
        }
    }
}

fn connection_pending_key(connection_id: &str, adapter_id: &str) -> (String, String) {
    PendingFlowScope::ConnectionId(connection_id.to_string()).pending_key(adapter_id)
}

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

#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncConnectionOAuthStartResult {
    pub connection: SyncConnection,
    pub flow: OAuthFlowStart,
}

#[tauri::command]
pub async fn sync_connection_oauth_start(
    adapter_id: String,
    label: String,
    account_email: Option<String>,
) -> Result<SyncConnectionOAuthStartResult, String> {
    let connection = task::spawn_blocking({
        let adapter_id = adapter_id.clone();
        move || {
            connection_store::create(CreateConnectionRequest {
                adapter_id,
                label,
                auth_method: connection_store::AUTH_METHOD_OAUTH.to_string(),
                account_email,
            })
        }
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    let flow = start_oauth_flow_inner(
        PendingFlowScope::ConnectionId(connection.id.clone()),
        &adapter_id,
        StartOauthOptions::default(),
    )
    .await
    .inspect_err(|_err| {
        let _ = connection_store::delete(&connection.id);
    })?
    .public;

    Ok(SyncConnectionOAuthStartResult { connection, flow })
}

#[tauri::command]
pub async fn sync_connection_oauth_complete(connection_id: String) -> Result<(), String> {
    let connection = task::spawn_blocking({
        let connection_id = connection_id.clone();
        move || connection_store::get(&connection_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    let adapter_id = connection.adapter_id.clone();

    let snapshot: PendingFlowSnapshot = {
        let map = PENDING_FLOWS
            .lock()
            .map_err(|err| format!("pending-flow lock poisoned: {}", err))?;
        let entry = map
            .get(&connection_pending_key(&connection_id, &adapter_id))
            .ok_or_else(|| "no pending OAuth flow for this connection".to_string())?;
        if entry.adapter_id() != adapter_id {
            return Err("pending flow is for a different adapter".to_string());
        }
        PendingFlowSnapshot::from(entry)
    };

    let outcome = complete_oauth_flow_for_adapter(&adapter_id, snapshot).await?;
    drop_connection_pending(&connection_id, &adapter_id);

    match outcome {
        oauth::PollOutcome::Token(record) => {
            task::spawn_blocking(move || connection_token_store::save(&connection_id, record))
                .await
                .map_err(|err| format!("Task join error: {}", err))??;
            Ok(())
        }
        oauth::PollOutcome::AccessDenied => Err("oauth_access_denied".to_string()),
        oauth::PollOutcome::Expired => Err("oauth_expired".to_string()),
        oauth::PollOutcome::Cancelled => Err("oauth_cancelled".to_string()),
        oauth::PollOutcome::PollFailed(detail) => Err(format!("oauth_poll_failed: {}", detail)),
    }
}

#[tauri::command]
pub async fn sync_connection_oauth_cancel(connection_id: String) -> Result<(), String> {
    let connection = task::spawn_blocking({
        let connection_id = connection_id.clone();
        move || connection_store::get(&connection_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    if let Some(entry) = drop_connection_pending(&connection_id, &connection.adapter_id) {
        entry.cancel_token().cancel();
    }
    Ok(())
}

/// Attach `adapter_id` to `slug` with an opaque per-adapter
/// `config_json` blob (e.g. Linear team ID, repo owner/name for GitHub).
///
/// The adapter must be registered in [`adapters::registry`]; unknown ids
/// are rejected here so the user sees a clear error rather than a silent
/// no-op the first time the worker tries to push. Persistence flows
/// through `sync::io::attach_adapter` so this command does not own the
/// SQL — keeps `commands/` adapter-routing-free and means schema tweaks
/// touch one place.
#[tauri::command]
pub async fn project_sync_attach_adapter(
    slug: String,
    adapter_id: String,
    connection_id: String,
    config_json: Option<String>,
) -> Result<(), String> {
    let Some(adapter) = adapters::get(&adapter_id) else {
        return Err(format!(
            "Unknown sync adapter '{}'. Registered: {:?}",
            adapter_id,
            adapters::list_descriptors()
                .into_iter()
                .map(|descriptor| descriptor.id)
                .collect::<Vec<_>>()
        ));
    };
    let supports_import = adapter.supports_import();
    let requires_auth = adapter.descriptor().requires_auth;

    task::spawn_blocking(move || -> Result<(), String> {
        let sync_connection = connection_store::get(&connection_id)?;
        if sync_connection.adapter_id != adapter_id {
            return Err(format!(
                "Sync connection '{}' belongs to adapter '{}' but project is attaching '{}'",
                connection_id, sync_connection.adapter_id, adapter_id
            ));
        }
        if requires_auth && connection_token_store::get(&connection_id)?.is_none() {
            return Err(format!(
                "Sync connection '{}' has no stored token",
                connection_id
            ));
        }

        let connection = sync::io::conn()?;
        sync::io::attach_adapter(
            &connection,
            &slug,
            &adapter_id,
            config_json.as_deref().unwrap_or("{}"),
            &connection_id,
        )?;
        // Queue a one-shot historical import the first time an
        // import-capable adapter is attached. `ensure_pending` is
        // idempotent against re-attach (any existing row, terminal or
        // otherwise, is left untouched) so a user toggling adapters
        // doesn't accidentally re-run a completed import.
        if supports_import {
            sync_import::ensure_pending(
                &connection,
                &slug,
                &adapter_id,
                sync::worker::now_ms_pub(),
            )?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Detach whatever adapter is currently attached to `slug`. Surfaces an
/// error if the project is unknown — silently succeeding would let
/// stale UI state masquerade as a successful detach. The global sync
/// connection and token stay intact so other projects can keep using
/// the same account.
#[tauri::command]
pub async fn project_sync_detach_adapter(slug: String) -> Result<(), String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::detach_adapter(&connection, &slug)?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Snapshot of `slug`'s sync state: which adapter is attached (if any),
/// the outbox queue depth split by status, and the most recent failure.
#[tauri::command]
pub async fn project_sync_status(slug: String) -> Result<SyncStatusReport, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;

        let binding = sync::io::read_adapter_binding(&connection, &slug)?;
        let adapter_id = binding.as_ref().map(|binding| binding.adapter_id.clone());
        let sync_connection_id = binding.map(|binding| binding.connection_id);

        let pending_count = sync::io::count_by_status(&connection, &slug, OutboxStatus::Pending)?;
        let failed_count = sync::io::count_by_status(&connection, &slug, OutboxStatus::Failed)?;
        let abandoned_count =
            sync::io::count_by_status(&connection, &slug, OutboxStatus::Abandoned)?;

        let last_error = sync::io::last_error_for_project(&connection, &slug)?;
        let last_pull_at = sync::io::read_sync_cursor(&connection, &slug)?.last_pull_at;

        Ok(SyncStatusReport {
            adapter_id,
            sync_connection_id,
            last_pull_at,
            pending_count,
            failed_count,
            abandoned_count,
            last_error,
        })
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Force-requeue every `failed` and `abandoned` row for `slug` so the
/// worker picks them up on the next push tick. Returns the number of
/// rows that transitioned back to `pending`.
///
/// Emits a `orgii-project-sync-status` event with `trigger = "manual"`
/// after the requeue commits, so the UI sees the count rebalance
/// without polling. The follow-up push cycle's events are independent.
#[tauri::command]
pub async fn project_sync_force_push(slug: String) -> Result<u64, String> {
    let event_slug = slug.clone();
    let count = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::requeue_for_project(&connection, &slug)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    sync::events::emit_status(&event_slug, SyncEventTrigger::Manual);
    Ok(count)
}

/// Run one immediate pull cycle for `slug` against its attached
/// adapter. Errors when the project isn't bound to an adapter; the UI
/// is expected to surface that as "attach an adapter first."
///
/// The pull cycle itself already emits a `pull_cycle` event for this
/// project; we additionally emit a `manual` event after the pull to
/// give the UI an explicit "force-pull just succeeded" hook the
/// status bar can flash.
#[tauri::command]
pub async fn project_sync_force_pull(slug: String) -> Result<(), String> {
    let event_slug = slug.clone();
    sync::worker::pull_one_project_by_slug(slug).await?;
    sync::events::emit_status(&event_slug, SyncEventTrigger::Manual);
    Ok(())
}

/// Snapshot every registered adapter's descriptor — what the UI shows
/// in the "attach adapter" picker. Sorted by id for stable output.
#[tauri::command]
pub async fn project_sync_list_adapters() -> Result<Vec<AdapterDescriptor>, String> {
    Ok(adapters::list_descriptors())
}

// ============================================================================
// OAuth device flow
// ============================================================================

/// Knobs the inner OAuth-start path accepts. Only the debug e2e
/// surface customizes these; production calls go through
/// [`StartOauthOptions::default`].
///
/// The fields stay private so callers can't accidentally toggle
/// `skip_browser` from non-debug code paths; the only constructor
/// that flips it is [`StartOauthOptions::test_skip_browser`], which
/// is itself `#[cfg(debug_assertions)]`.
#[derive(Debug, Clone, Default)]
pub struct StartOauthOptions {
    /// When true, the redirect-flow branch skips
    /// `tauri_plugin_opener::open_url`. Headless e2e runs need this
    /// so the harness doesn't try (and fail) to spawn a system
    /// browser; the loopback listener still binds and the pending
    /// flow still installs into `PENDING_FLOWS`. No-op for the
    /// device flow (GitHub never opens a browser from the backend).
    skip_browser: bool,
}

impl StartOauthOptions {
    /// Debug-only constructor for the e2e binary. Symmetric with the
    /// other `set_test_*` overrides under `oauth::*`: production code
    /// can't see this, only the test routes wired up under
    /// `api/agent/test/sync_oauth.rs`.
    #[cfg(debug_assertions)]
    pub fn test_skip_browser() -> Self {
        Self { skip_browser: true }
    }
}

/// Output of [`start_oauth_flow_inner`]. Carries the public OAuth wire
/// shape plus the bound loopback `port` for redirect flows so the debug
/// e2e endpoint can echo it back to scenarios that assert the listener
/// bound a non-zero port. Production callers throw this away.
#[derive(Debug, Clone)]
pub struct StartedOAuthFlow {
    pub public: OAuthFlowStart,
    /// `Some(port)` for `Redirect` flows, `None` for `Device`. The
    /// number is the actual OS-assigned port the loopback listener
    /// bound to (Linear's PKCE flow asks the kernel for an ephemeral
    /// port — see `oauth::linear::start_auth_flow`).
    pub loopback_port: Option<u16>,
}

/// Shared start-flow body used by both the production Tauri command
/// and the debug e2e route. Owns:
///
/// - adapter validation (`auth_methods` includes `OAuth`),
/// - per-adapter descriptor construction (device vs PKCE),
/// - the system-browser open call (skippable for headless e2e),
/// - the canonical `PENDING_FLOWS` install (cancels any in-flight
///   flow for the same pair first).
///
/// Returns the public wire shape plus the bound loopback `port` for
/// redirect flows; production callers ignore the port and the
/// debug endpoint echoes it back to assertions.
pub async fn start_oauth_flow_inner(
    scope: PendingFlowScope,
    adapter_id: &str,
    opts: StartOauthOptions,
) -> Result<StartedOAuthFlow, String> {
    let adapter = adapters::get(adapter_id)
        .ok_or_else(|| format!("Unknown sync adapter '{}'", adapter_id))?;
    let descriptor = adapter.descriptor();
    if !descriptor.auth_methods.contains(&AuthMethod::OAuth) {
        return Err(format!(
            "Adapter '{}' does not support OAuth (auth_methods={:?})",
            adapter_id, descriptor.auth_methods
        ));
    }

    let (pending, public, loopback_port) = match adapter_id {
        "github_issues" => {
            // Use `effective_client_id` so debug builds can install a
            // synthetic id via `set_test_client_id`. In release builds
            // this collapses to `configured_client_id` (env-only).
            let client_id = oauth::github::effective_client_id().ok_or_else(|| {
                "GitHub OAuth client id not configured (build with ORGII_GITHUB_OAUTH_CLIENT_ID)"
                    .to_string()
            })?;
            let descriptor = oauth::github::start_device_flow(&client_id).await?;
            if !opts.skip_browser {
                tauri_plugin_opener::open_url(&descriptor.verification_uri, None::<&str>)
                    .map_err(|err| format!("failed to open browser: {}", err))?;
            }
            let public = descriptor.to_public();
            let pending = PendingFlow::Device {
                adapter_id: adapter_id.to_string(),
                client_id: client_id.clone(),
                device_code: descriptor.device_code.clone(),
                interval_secs: descriptor.interval_secs,
                cancel: CancellationToken::new(),
            };
            (pending, public, None)
        }
        "linear" => {
            // Symmetric with the GitHub branch above: prefer the
            // debug override so e2e can drive the start path without
            // the production env var, but production builds collapse
            // to `configured_client_id`.
            let client_id = oauth::linear::effective_client_id().ok_or_else(|| {
                "Linear OAuth client id not configured (build with ORGII_LINEAR_OAUTH_CLIENT_ID)"
                    .to_string()
            })?;
            let descriptor = oauth::linear::start_auth_flow(&client_id).await?;
            let public = descriptor.to_public();
            // Open the system browser to the authorize URL. Use
            // `tauri_plugin_opener` (already wired into the app) — it
            // is the canonical way to launch external URLs from this
            // codebase. Failure to open is a hard error: the user
            // cannot complete the flow without it, and silently
            // succeeding would strand the loopback listener.
            //
            // Debug e2e runs go through this function with
            // `skip_browser = true` so headless harnesses don't try
            // to spawn a real browser. The loopback listener and
            // `PENDING_FLOWS` install path are not skipped — only
            // the opener call is. In release builds the field is
            // unconditionally false (no constructor flips it), so
            // the branch always runs `open_url`.
            if !opts.skip_browser {
                tauri_plugin_opener::open_url(&descriptor.authorize_url, None::<&str>)
                    .map_err(|err| format!("failed to open browser: {}", err))?;
            }
            let port = descriptor.port;
            let pending = PendingFlow::Redirect {
                adapter_id: adapter_id.to_string(),
                client_id: client_id.clone(),
                state: descriptor.state.clone(),
                code_verifier: descriptor.code_verifier.clone(),
                port,
                redirect_uri: descriptor.redirect_uri.clone(),
                cancel: CancellationToken::new(),
            };
            (pending, public, Some(port))
        }
        other => {
            return Err(format!(
                "OAuth start not implemented for adapter '{}'",
                other
            ));
        }
    };

    // Drop any prior pending flow for this pair before installing the
    // new one — the user just clicked Connect a second time, or an
    // e2e scenario re-entered start without finishing the previous
    // flow.
    {
        let mut map = PENDING_FLOWS
            .lock()
            .map_err(|err| format!("pending-flow lock poisoned: {}", err))?;
        let key = scope.pending_key(adapter_id);
        if let Some(old) = map.remove(&key) {
            old.cancel_token().cancel();
        }
        map.insert(key, pending);
    }

    Ok(StartedOAuthFlow {
        public,
        loopback_port,
    })
}

/// Owned clone of a [`PendingFlow`] entry; produced under the
/// `PENDING_FLOWS` lock and consumed afterwards so the long-running
/// poll / await never blocks the registry mutex.
enum PendingFlowSnapshot {
    Device {
        client_id: String,
        device_code: String,
        interval_secs: u64,
        cancel: CancellationToken,
    },
    Redirect {
        client_id: String,
        state: String,
        code_verifier: String,
        port: u16,
        redirect_uri: String,
        cancel: CancellationToken,
    },
}

impl From<&PendingFlow> for PendingFlowSnapshot {
    fn from(entry: &PendingFlow) -> Self {
        match entry {
            PendingFlow::Device {
                client_id,
                device_code,
                interval_secs,
                cancel,
                ..
            } => PendingFlowSnapshot::Device {
                client_id: client_id.clone(),
                device_code: device_code.clone(),
                interval_secs: *interval_secs,
                cancel: cancel.clone(),
            },
            PendingFlow::Redirect {
                client_id,
                state,
                code_verifier,
                port,
                redirect_uri,
                cancel,
                ..
            } => PendingFlowSnapshot::Redirect {
                client_id: client_id.clone(),
                state: state.clone(),
                code_verifier: code_verifier.clone(),
                port: *port,
                redirect_uri: redirect_uri.clone(),
                cancel: cancel.clone(),
            },
        }
    }
}

async fn complete_oauth_flow_for_adapter(
    adapter_id: &str,
    snapshot: PendingFlowSnapshot,
) -> Result<oauth::PollOutcome, String> {
    match snapshot {
        PendingFlowSnapshot::Device {
            client_id,
            device_code,
            interval_secs,
            cancel,
        } => match adapter_id {
            connection_store::ADAPTER_GITHUB_ISSUES => {
                Ok(
                    oauth::github::poll_for_token(&client_id, &device_code, interval_secs, cancel)
                        .await,
                )
            }
            other => Err(format!(
                "OAuth complete (device) not implemented for adapter '{}'",
                other
            )),
        },
        PendingFlowSnapshot::Redirect {
            client_id,
            state,
            code_verifier,
            port,
            redirect_uri,
            cancel,
        } => match adapter_id {
            connection_store::ADAPTER_LINEAR => Ok(
                match oauth::linear::await_callback(port, &state, cancel.clone()).await {
                    Ok(code) => {
                        oauth::linear::exchange_code(
                            &client_id,
                            &code,
                            &code_verifier,
                            &redirect_uri,
                        )
                        .await
                    }
                    Err(failure) => failure,
                },
            ),
            other => Err(format!(
                "OAuth complete (redirect) not implemented for adapter '{}'",
                other
            )),
        },
    }
}

fn drop_connection_pending(connection_id: &str, adapter_id: &str) -> Option<PendingFlow> {
    PENDING_FLOWS
        .lock()
        .ok()
        .and_then(|mut map| map.remove(&connection_pending_key(connection_id, adapter_id)))
}

// ============================================================================
// Debug-only accessors for the e2e binary
// ============================================================================

/// Snapshot of a pending [`PendingFlow::Redirect`] entry's
/// non-cancel-token fields. The e2e debug binary uses this to simulate
/// the loopback callback without binding a real TCP port: the simulated
/// handler reads `state` + `code_verifier` + `client_id` + `redirect_uri`
/// from the snapshot, validates the caller-supplied `state`, and feeds
/// the `code` straight into [`oauth::linear::exchange_code`].
///
/// Debug-only so production binaries cannot accidentally surface
/// PKCE state material outside the IPC boundary.
#[cfg(debug_assertions)]
#[derive(Debug, Clone)]
pub struct DebugRedirectFlowSnapshot {
    pub adapter_id: String,
    pub client_id: String,
    pub state: String,
    pub code_verifier: String,
    pub port: u16,
    pub redirect_uri: String,
}

/// Read the pending [`PendingFlow::Redirect`] for `(connection_id, adapter_id)`
/// without removing it from the registry. Returns `None` when no
/// pending flow exists or when the pending entry is the device-flow
/// variant.
#[cfg(debug_assertions)]
pub fn debug_peek_connection_redirect_flow(
    connection_id: &str,
    adapter_id: &str,
) -> Option<DebugRedirectFlowSnapshot> {
    let map = PENDING_FLOWS.lock().ok()?;
    match map.get(&connection_pending_key(connection_id, adapter_id))? {
        PendingFlow::Redirect {
            adapter_id,
            client_id,
            state,
            code_verifier,
            port,
            redirect_uri,
            ..
        } => Some(DebugRedirectFlowSnapshot {
            adapter_id: adapter_id.clone(),
            client_id: client_id.clone(),
            state: state.clone(),
            code_verifier: code_verifier.clone(),
            port: *port,
            redirect_uri: redirect_uri.clone(),
        }),
        PendingFlow::Device { .. } => None,
    }
}

/// Drop the pending flow for `(connection_id, adapter_id)` without firing its
/// cancel token. Used by the e2e debug simulate-callback path after a
/// successful exchange.
#[cfg(debug_assertions)]
pub fn debug_drop_connection_pending(connection_id: &str, adapter_id: &str) {
    let _ = drop_connection_pending(connection_id, adapter_id);
}

// ============================================================================
// Outbox problems UI
// ============================================================================

/// List every `failed` / `abandoned` outbox row for `slug`. Powers the
/// "Failed entries" section in `SyncSection`.
///
/// Order is `last_attempted_at DESC NULLS LAST, created_at DESC` so
/// the most recently-attempted problem floats to the top. The wire
/// row drops `project_slug` (the caller already knows it) and tightens
/// `id` to non-optional (every persisted row has one).
#[tauri::command]
pub async fn project_sync_list_problems(slug: String) -> Result<Vec<OutboxProblemRow>, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::list_problems(&connection, &slug)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Requeue exactly one outbox row by id. Flips status to `pending`,
/// clears `last_attempted_at` + `last_error`, leaves `retry_count`
/// alone (backoff continuity matters: the next genuine failure picks
/// up where the previous attempt left off).
///
/// Emits a `manual` `SyncStatusEvent` for the row's project so the
/// status bar / settings panel rebalance immediately, without waiting
/// for the worker's next push tick.
///
/// Errors when no row matched the id.
#[tauri::command]
pub async fn project_sync_retry_entry(entry_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::requeue_one(&connection, entry_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    sync::events::emit_status(&project_slug, SyncEventTrigger::Manual);
    Ok(())
}

/// Hard-delete one outbox row by id. The hard-delete semantics are
/// chosen specifically because [`sync::io::requeue_for_project`] —
/// used by `project_sync_force_push` — re-queues both `Failed` and
/// `Abandoned` rows: a `status = 'abandoned'` transition would let
/// the next force-push silently un-discard everything the user just
/// discarded. See [`sync::io::discard_one`] for the long form.
///
/// Emits a `manual` `SyncStatusEvent` for the row's project after
/// the delete commits.
#[tauri::command]
pub async fn project_sync_discard_entry(entry_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::discard_one(&connection, entry_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    sync::events::emit_status(&project_slug, SyncEventTrigger::Manual);
    Ok(())
}

// ============================================================================
// Webhook install / status / rotate
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
            secret.map(|s| s.last_rotated_at),
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

/// Read up to `limit` most-recent rows from `~/.orgii/sync-metrics.jsonl`,
/// newest first. Wraps [`sync::metrics::tail`] for the dev/debug UI;
/// production code should not call this on a hot path.
///
/// The cap is enforced server-side at 1000 to keep the IPC payload
/// bounded — if the caller asks for more, we silently return that many.
/// Reading is best-effort: if the file does not exist (no sync activity
/// yet on this machine) we return an empty list rather than error.
#[tauri::command]
pub async fn project_sync_metrics_tail(
    limit: usize,
) -> Result<Vec<sync::metrics::SyncMetric>, String> {
    let capped = limit.min(1000);
    task::spawn_blocking(move || sync::metrics::tail(capped))
        .await
        .map_err(|err| format!("Task join error: {}", err))
}

// ============================================================================
// Bulk historical import
// ============================================================================

/// Read the import progress row for `(slug, adapter_id)`. Returns
/// `None` when the project has never queued an import (e.g. its
/// adapter doesn't support import). The UI uses `None` as the
/// "hide the panel entirely" signal.
#[tauri::command]
pub async fn project_sync_import_status(
    slug: String,
    adapter_id: String,
) -> Result<Option<ImportProgressRow>, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync_import::read_status(&connection, &slug, &adapter_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Cancel a pending or running import. Idempotent against a row
/// already in a terminal state — returns `Ok(())` either way so the
/// UI's "cancel" button doesn't need state-aware error handling.
///
/// Cancellation is final in v1: there is no "uncancel" path. Users
/// who change their mind can detach + re-attach the adapter to start
/// a fresh import.
#[tauri::command]
pub async fn project_sync_import_cancel(slug: String, adapter_id: String) -> Result<(), String> {
    let event_slug = slug.clone();
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync_import::mark_cancelled(&connection, &slug, &adapter_id, sync::worker::now_ms_pub())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    sync::events::emit_status(&event_slug, SyncEventTrigger::Manual);
    Ok(())
}

/// Re-queue a failed import for retry. The cursor is preserved so
/// the retry resumes mid-stream rather than re-importing from page 1.
/// Errors when the row is in any state other than `failed` — the UI
/// shouldn't be offering "retry" outside of that state, so a hit
/// here is a UI bug worth surfacing.
#[tauri::command]
pub async fn project_sync_import_retry(slug: String, adapter_id: String) -> Result<(), String> {
    let event_slug = slug.clone();
    let transitioned = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync_import::reset_for_retry(&connection, &slug, &adapter_id, sync::worker::now_ms_pub())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    if !transitioned {
        return Err(
            "import is not in failed state; nothing to retry (refresh the panel)".to_string(),
        );
    }
    sync::events::emit_status(&event_slug, SyncEventTrigger::Manual);
    Ok(())
}

// ============================================================================
// Conflict resolution
// ============================================================================

/// Listing default for the resolved-tail of `project_sync_conflicts_list`.
/// The Conflicts panel renders the open list inline and reveals the tail
/// behind a "Show recently resolved" toggle, so this number sets the
/// **toggle limit**, not the always-visible window. 25 keeps the audit
/// trail useful for "did I just click Use Local on the right one?"
/// without dragging in dead history.
const DEFAULT_RESOLVED_TAIL: usize = 25;

/// List conflicts for a project. Open rows come first (ordered by
/// `detected_at DESC`), followed by up to [`DEFAULT_RESOLVED_TAIL`]
/// recently-resolved rows. Returns an empty Vec for projects with no
/// audit history — the UI then hides the panel entirely, mirroring
/// the import-panel hide-when-empty pattern.
#[tauri::command]
pub async fn project_sync_conflicts_list(slug: String) -> Result<Vec<ConflictRow>, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        conflict_log::list_for_project(&connection, &slug, DEFAULT_RESOLVED_TAIL)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Open count, for the SyncSection panel header chip. Cheap enough
/// to call alongside `project_sync_status` without paying for a full
/// list when the count is the only thing the caller needs.
#[tauri::command]
pub async fn project_sync_conflicts_count(slug: String) -> Result<i64, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        conflict_log::count_open(&connection, &slug)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// "Use local": for every field on the conflict, append an
/// `OutboxOp::Update` carrying the local value so the next push cycle
/// drives the remote back to the local writer's intent. Stamps the
/// row resolved with [`ConflictRowResolution::UseLocal`].
///
/// Idempotent: a second click after the row was already resolved is a
/// no-op (returns `Ok(())`). Errors only when the row id is unknown
/// or the underlying outbox append fails.
///
/// Emits a `ConflictResolve` metric and a `Manual` `SyncStatusEvent`
/// so the panel and status bar refresh without waiting for the
/// worker tick.
#[tauri::command]
pub async fn project_sync_conflict_use_local(conflict_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut connection = sync::io::conn()?;
        let row = match conflict_log::read_one(&connection, conflict_id)? {
            Some(row) => row,
            None => return Err(format!("conflict row {} not found", conflict_id)),
        };
        if row.resolved_at.is_some() {
            // Already resolved (race with another click). Treat as
            // benign no-op; tell the caller "no slug to refresh on".
            return Ok(None);
        }

        // Build the partial-update payload from the captured local
        // values + append a fresh `Update` outbox row inside a single
        // transaction so a worker crash between the append and the
        // mark_resolved leaves the system in either "no-op done" or
        // "fully resolved" — never "appended but unmarked".
        let payload = conflict_log::use_local_payload(&row);
        let now_ms = sync::worker::now_ms_pub();
        let field_path = if payload.is_empty() {
            None
        } else {
            Some(payload.keys().cloned().collect::<Vec<_>>().join(","))
        };
        let payload_json = serde_json::Value::Object(payload).to_string();
        let entry = sync::types::OutboxEntry {
            id: None,
            project_slug: row.project_slug.clone(),
            entity_type: EntityType::WorkItem,
            entity_id: row.entity_id.clone(),
            op: sync::types::OutboxOp::Update,
            field_path,
            payload_json,
            created_at: now_ms,
            retry_count: 0,
            last_attempted_at: None,
            last_error: None,
            status: OutboxStatus::Pending,
        };
        let tx = connection
            .transaction()
            .map_err(|err| format!("DB error (begin tx): {}", err))?;
        sync::io::append(&tx, &entry)?;
        if !conflict_log::mark_resolved(&tx, conflict_id, ConflictRowResolution::UseLocal, now_ms)?
        {
            // Transitioned to resolved between the read and the
            // mark — abort the transaction so we don't leave a
            // stray outbox row behind.
            tx.rollback()
                .map_err(|err| format!("DB error (rollback): {}", err))?;
            return Ok(None);
        }
        tx.commit()
            .map_err(|err| format!("DB error (commit): {}", err))?;

        sync::metrics::record(
            &row.project_slug,
            &row.adapter_id,
            MetricKind::ConflictResolve,
            MetricOutcome::Ok,
            0,
            row.fields.fields.len() as u64,
        );
        Ok(Some(row.project_slug))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    if let Some(slug) = project_slug {
        sync::events::emit_status(&slug, SyncEventTrigger::Manual);
    }
    Ok(())
}

/// "Use remote": overwrite the local value(s) for every field on the
/// conflict with the captured remote value, stamping the field
/// revision to the remote watermark so the next merge cycle does not
/// re-flag the same row. Stamps the conflict resolved with
/// [`ConflictRowResolution::UseRemote`].
///
/// Idempotent. Errors only when the row id is unknown or the local
/// write fails.
#[tauri::command]
pub async fn project_sync_conflict_use_remote(conflict_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || -> Result<Option<String>, String> {
        let connection = sync::io::conn()?;
        let row = match conflict_log::read_one(&connection, conflict_id)? {
            Some(row) => row,
            None => return Err(format!("conflict row {} not found", conflict_id)),
        };
        if row.resolved_at.is_some() {
            return Ok(None);
        }
        drop(connection);

        let remote_payload = conflict_log::use_remote_payload(&row);
        let new_revisions = conflict_log::use_remote_revisions(&row);
        let update = sync::worker::partial_update_from_map(&remote_payload);

        crate::projects::io::update_work_item_partial_with_revisions(
            &row.project_slug,
            &row.entity_id,
            new_revisions,
            &update,
        )?;

        let now_ms = sync::worker::now_ms_pub();
        let connection = sync::io::conn()?;
        if !conflict_log::mark_resolved(
            &connection,
            conflict_id,
            ConflictRowResolution::UseRemote,
            now_ms,
        )? {
            return Ok(None);
        }

        sync::metrics::record(
            &row.project_slug,
            &row.adapter_id,
            MetricKind::ConflictResolve,
            MetricOutcome::Ok,
            0,
            row.fields.fields.len() as u64,
        );
        Ok(Some(row.project_slug))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    if let Some(slug) = project_slug {
        sync::events::emit_status(&slug, SyncEventTrigger::Manual);
    }
    Ok(())
}

/// "Dismiss": accept the resolver verdict as-is. No fields are
/// touched; we just mark the audit row resolved so the panel can
/// stop showing it. Useful for cases where the user has decided the
/// kept-local value is correct and doesn't want to either re-push
/// or be reminded of the row.
#[tauri::command]
pub async fn project_sync_conflict_dismiss(conflict_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || -> Result<Option<String>, String> {
        let connection = sync::io::conn()?;
        let row = match conflict_log::read_one(&connection, conflict_id)? {
            Some(row) => row,
            None => return Err(format!("conflict row {} not found", conflict_id)),
        };
        if row.resolved_at.is_some() {
            return Ok(None);
        }
        let now_ms = sync::worker::now_ms_pub();
        if !conflict_log::mark_resolved(
            &connection,
            conflict_id,
            ConflictRowResolution::Dismissed,
            now_ms,
        )? {
            return Ok(None);
        }
        sync::metrics::record(
            &row.project_slug,
            &row.adapter_id,
            MetricKind::ConflictResolve,
            MetricOutcome::Ok,
            0,
            row.fields.fields.len() as u64,
        );
        Ok(Some(row.project_slug))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    if let Some(slug) = project_slug {
        sync::events::emit_status(&slug, SyncEventTrigger::Manual);
    }
    Ok(())
}

#[cfg(test)]
mod oauth_tests {
    use super::*;
    use crate::sync::connection_token_store::SOURCE_OAUTH_DEVICE;
    use crate::sync::oauth::{DeviceFlowDescriptor, PollOutcome};
    use chrono::Utc;
    use test_helpers::test_env;

    fn install_device_pending(connection_id: &str, adapter_id: &str) -> CancellationToken {
        let cancel = CancellationToken::new();
        let mut map = PENDING_FLOWS.lock().unwrap();
        map.insert(
            connection_pending_key(connection_id, adapter_id),
            PendingFlow::Device {
                adapter_id: adapter_id.to_string(),
                client_id: "client".to_string(),
                device_code: "DEVCODE".to_string(),
                interval_secs: 1,
                cancel: cancel.clone(),
            },
        );
        cancel
    }

    fn install_redirect_pending(connection_id: &str, adapter_id: &str) -> CancellationToken {
        let cancel = CancellationToken::new();
        let mut map = PENDING_FLOWS.lock().unwrap();
        map.insert(
            connection_pending_key(connection_id, adapter_id),
            PendingFlow::Redirect {
                adapter_id: adapter_id.to_string(),
                client_id: "client".to_string(),
                state: "STATE".to_string(),
                code_verifier: "VERIFIER".to_string(),
                port: 0,
                redirect_uri: "http://127.0.0.1:0/callback".to_string(),
                cancel: cancel.clone(),
            },
        );
        cancel
    }

    #[tokio::test]
    async fn oauth_start_rejects_unknown_adapter() {
        let err = start_oauth_flow_inner(
            PendingFlowScope::ConnectionId("connection-alpha".to_string()),
            "nope",
            StartOauthOptions::default(),
        )
        .await
        .unwrap_err();
        assert!(err.to_lowercase().contains("unknown"), "got {}", err);
    }

    #[tokio::test]
    async fn oauth_start_rejects_adapter_without_oauth_method() {
        let err = start_oauth_flow_inner(
            PendingFlowScope::ConnectionId("connection-alpha".to_string()),
            "echo",
            StartOauthOptions::default(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("does not support OAuth"), "got {}", err);
    }

    #[tokio::test]
    async fn oauth_cancel_is_idempotent_when_nothing_pending() {
        let _sandbox = test_env::sandbox();
        let connection = connection_store::create(CreateConnectionRequest {
            adapter_id: connection_store::ADAPTER_GITHUB_ISSUES.to_string(),
            label: "GitHub".to_string(),
            auth_method: connection_store::AUTH_METHOD_OAUTH.to_string(),
            account_email: None,
        })
        .unwrap();

        let result = sync_connection_oauth_cancel(connection.id).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn oauth_cancel_signals_pending_device_token() {
        let _sandbox = test_env::sandbox();
        let connection = connection_store::create(CreateConnectionRequest {
            adapter_id: connection_store::ADAPTER_GITHUB_ISSUES.to_string(),
            label: "GitHub".to_string(),
            auth_method: connection_store::AUTH_METHOD_OAUTH.to_string(),
            account_email: None,
        })
        .unwrap();
        let token = install_device_pending(&connection.id, "github_issues");
        assert!(!token.is_cancelled());
        sync_connection_oauth_cancel(connection.id.clone())
            .await
            .unwrap();
        assert!(token.is_cancelled());
        assert!(PENDING_FLOWS
            .lock()
            .unwrap()
            .get(&connection_pending_key(&connection.id, "github_issues"))
            .is_none());
    }

    #[tokio::test]
    async fn oauth_cancel_signals_pending_redirect_token() {
        let _sandbox = test_env::sandbox();
        let connection = connection_store::create(CreateConnectionRequest {
            adapter_id: connection_store::ADAPTER_LINEAR.to_string(),
            label: "Linear".to_string(),
            auth_method: connection_store::AUTH_METHOD_OAUTH.to_string(),
            account_email: None,
        })
        .unwrap();
        let token = install_redirect_pending(&connection.id, "linear");
        assert!(!token.is_cancelled());
        sync_connection_oauth_cancel(connection.id.clone())
            .await
            .unwrap();
        assert!(token.is_cancelled());
        assert!(PENDING_FLOWS
            .lock()
            .unwrap()
            .get(&connection_pending_key(&connection.id, "linear"))
            .is_none());
    }

    #[tokio::test]
    async fn oauth_complete_without_pending_errors() {
        let _sandbox = test_env::sandbox();
        let connection = connection_store::create(CreateConnectionRequest {
            adapter_id: connection_store::ADAPTER_GITHUB_ISSUES.to_string(),
            label: "GitHub".to_string(),
            auth_method: connection_store::AUTH_METHOD_OAUTH.to_string(),
            account_email: None,
        })
        .unwrap();
        let err = sync_connection_oauth_complete(connection.id)
            .await
            .unwrap_err();
        assert!(err.contains("no pending"), "got {}", err);
    }

    #[test]
    fn device_flow_descriptor_redacts_device_code_in_public_form() {
        let descriptor = DeviceFlowDescriptor {
            device_code: "SECRET".to_string(),
            user_code: "USER".to_string(),
            verification_uri: "https://example.test".to_string(),
            interval_secs: 5,
            expires_at: Utc::now(),
        };
        let public = descriptor.to_public();
        let wire = serde_json::to_string(&public).unwrap();
        assert!(
            !wire.contains("SECRET"),
            "wire payload leaked device_code: {}",
            wire
        );
        assert!(wire.contains("USER"));
        assert!(
            wire.contains("\"kind\":\"device\""),
            "missing tag: {}",
            wire
        );
    }

    #[tokio::test]
    async fn poll_outcome_token_round_trips_to_connection_token_store() {
        let _sandbox = test_env::sandbox();
        let outcome = PollOutcome::Token(ConnectionTokenRecord {
            access_token: "round_trip_token".to_string(),
            refresh_token: None,
            expires_at_unix: None,
            source: SOURCE_OAUTH_DEVICE.to_string(),
        });
        if let PollOutcome::Token(record) = outcome {
            connection_token_store::save("connection-beta", record).unwrap();
        } else {
            unreachable!();
        }
        assert_eq!(
            connection_token_store::get("connection-beta")
                .unwrap()
                .map(|record| record.access_token)
                .as_deref(),
            Some("round_trip_token")
        );
    }
}

#[cfg(test)]
mod problems_tests {
    //! Command-level coverage for the
    //! `project_sync_list_problems` / `project_sync_retry_entry` /
    //! `project_sync_discard_entry` surface.
    //!
    //! These tests run inside `test_env::sandbox()` so the sqlite
    //! `projects.db` lives under a per-test temp dir, then bypass the
    //! Tauri IPC layer by calling the `#[tauri::command]` async fns
    //! directly. The events module's `test_probe` records every
    //! `emit_status` call before the (absent) `AppHandle` check, so we
    //! can verify the command emitted a `Manual` event for the right
    //! slug without spinning up a real Tauri shell.
    use super::*;
    use crate::sync::events::{test_probe, SyncEventTrigger};
    use crate::sync::types::{EntityType, OutboxEntry, OutboxOp, OutboxStatus};
    use test_helpers::test_env;

    fn seed_failed_entry(slug: &str, entity_id: &str, last_attempted: Option<i64>) -> i64 {
        let connection = sync::io::conn().expect("conn");
        crate::projects::schema::init_project_tables(&connection).expect("init schema");
        let entry = OutboxEntry {
            id: None,
            project_slug: slug.to_string(),
            entity_type: EntityType::WorkItem,
            entity_id: entity_id.to_string(),
            op: OutboxOp::Update,
            field_path: Some("title".to_string()),
            payload_json: r#"{"title":"updated"}"#.to_string(),
            created_at: 1_700_000_000_000,
            last_attempted_at: last_attempted,
            retry_count: 3,
            last_error: Some("simulated remote 500".to_string()),
            status: OutboxStatus::Pending,
        };
        let id = sync::io::append(&connection, &entry).expect("append");
        // Walk the row directly into the terminal `Failed` state so
        // the test matches the steady-state shape the UI sees.
        connection
            .execute(
                "UPDATE outbox_entries
                    SET status = ?1, last_error = ?2, retry_count = ?3, last_attempted_at = ?4
                  WHERE id = ?5",
                rusqlite::params![
                    OutboxStatus::Failed.as_db_str(),
                    "simulated remote 500",
                    3_u32,
                    last_attempted,
                    id,
                ],
            )
            .expect("force failed");
        id
    }

    #[tokio::test]
    async fn list_problems_returns_failed_rows() {
        let _sandbox = test_env::sandbox();
        let id = seed_failed_entry("alpha", "WI-1", Some(1_700_000_100_000));

        let rows = project_sync_list_problems("alpha".to_string())
            .await
            .expect("list_problems");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.id, id);
        assert_eq!(row.entity_id, "WI-1");
        assert_eq!(row.status, OutboxStatus::Failed);
        assert_eq!(row.retry_count, 3);
        assert_eq!(row.last_error.as_deref(), Some("simulated remote 500"));
    }

    #[tokio::test]
    async fn retry_entry_emits_manual_event_for_correct_slug() {
        let _sandbox = test_env::sandbox();
        let id = seed_failed_entry("alpha", "WI-1", Some(1_700_000_100_000));
        // Seed an unrelated project's row so we can assert the emit
        // is scoped to the touched project.
        let _ = seed_failed_entry("beta", "WI-9", Some(1_700_000_200_000));

        test_probe::reset();
        project_sync_retry_entry(id).await.expect("retry_entry");

        let calls = test_probe::snapshot();
        assert_eq!(
            calls.len(),
            1,
            "retry_entry must emit exactly one status event; got {:?}",
            calls
        );
        assert_eq!(calls[0].0, "alpha");
        assert_eq!(calls[0].1, SyncEventTrigger::Manual);

        // The retried row must now be Pending and out of the problems
        // list; beta's row stays put.
        let alpha = project_sync_list_problems("alpha".to_string())
            .await
            .expect("list alpha");
        assert!(
            alpha.is_empty(),
            "retried row must vanish from problems; got {:?}",
            alpha
        );
        let beta = project_sync_list_problems("beta".to_string())
            .await
            .expect("list beta");
        assert_eq!(beta.len(), 1);
    }

    #[tokio::test]
    async fn retry_entry_unknown_id_errors_without_emit() {
        let _sandbox = test_env::sandbox();
        let connection = sync::io::conn().expect("conn");
        crate::projects::schema::init_project_tables(&connection).expect("init schema");
        drop(connection);

        test_probe::reset();
        let err = project_sync_retry_entry(9_999).await.unwrap_err();
        assert!(err.contains("not found"), "got {}", err);
        assert!(
            test_probe::snapshot().is_empty(),
            "retry on unknown id must not emit"
        );
    }

    #[tokio::test]
    async fn discard_entry_emits_manual_event_and_deletes_row() {
        let _sandbox = test_env::sandbox();
        let id = seed_failed_entry("alpha", "WI-1", Some(1_700_000_100_000));

        test_probe::reset();
        project_sync_discard_entry(id).await.expect("discard_entry");

        let calls = test_probe::snapshot();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "alpha");
        assert_eq!(calls[0].1, SyncEventTrigger::Manual);

        let rows = project_sync_list_problems("alpha".to_string())
            .await
            .expect("list");
        assert!(
            rows.is_empty(),
            "discarded row must be gone; got {:?}",
            rows
        );
    }

    #[tokio::test]
    async fn discard_entry_second_call_errors_clearly() {
        let _sandbox = test_env::sandbox();
        let id = seed_failed_entry("alpha", "WI-1", Some(1_700_000_100_000));
        project_sync_discard_entry(id).await.expect("first");

        test_probe::reset();
        let err = project_sync_discard_entry(id).await.unwrap_err();
        assert!(err.contains("not found"), "got {}", err);
        assert!(
            test_probe::snapshot().is_empty(),
            "second discard must not emit"
        );
    }
}

#[cfg(test)]
mod webhook_command_tests {
    //! Command-level coverage for the
    //! `project_sync_webhook_install` / `project_sync_webhook_status` /
    //! `project_sync_webhook_rotate` surface. Same test sandbox shape
    //! as the problems tests above (per-test temp dir, direct command
    //! invocation, no Tauri shell required).
    use super::*;
    use test_helpers::test_env;

    /// Seed a project row + bind it to the `echo` adapter. The
    /// command surface assumes the project already exists in the
    /// `projects` table; the sandbox bootstrap only creates schema,
    /// not rows.
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
        // Project row exists but no adapter has been attached.
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
        // We bound `echo`; trying to install a webhook for `linear`
        // must surface the mismatch instead of silently writing a
        // dangling secret.
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

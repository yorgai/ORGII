//! OAuth flow commands for the pluggable sync framework.
//!
//! Handles `sync_connection_oauth_start`, `_complete`, and `_cancel`, plus
//! the internal helpers used by those commands and the debug e2e surface.
//! All shared state (`PENDING_FLOWS`) lives in the parent `sync` module;
//! this file only borrows it through `super::`.

use tokio::task;
use tokio_util::sync::CancellationToken;

use crate::sync::{
    adapter::AuthMethod,
    adapters,
    connection_store::{self, CreateConnectionRequest, SyncConnection},
    connection_token_store,
    oauth::{self, OAuthFlowStart},
};

use super::{PendingFlow, PendingFlowScope, PENDING_FLOWS, connection_pending_key};

// ============================================================================
// Public wire types
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncConnectionOAuthStartResult {
    pub connection: SyncConnection,
    pub flow: OAuthFlowStart,
}

// ============================================================================
// StartOauthOptions
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

// ============================================================================
// StartedOAuthFlow
// ============================================================================

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

// ============================================================================
// Tauri commands
// ============================================================================

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

// ============================================================================
// Inner helpers (pub so the debug e2e surface in `api/agent/test/sync_oauth.rs`
// can reach them via `project_management::projects::commands::sync::*`)
// ============================================================================

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
        connection_store::ADAPTER_GITHUB => {
            let client_id = oauth::github::effective_client_id().ok_or_else(|| {
                "GitHub OAuth client id not configured (override with ORGII_GITHUB_OAUTH_CLIENT_ID)"
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
        connection_store::ADAPTER_LINEAR => {
            let client_id = oauth::linear::effective_client_id().ok_or_else(|| {
                "Linear OAuth client id not configured (build with ORGII_LINEAR_OAUTH_CLIENT_ID)"
                    .to_string()
            })?;
            let descriptor = oauth::linear::start_auth_flow(&client_id).await?;
            let public = descriptor.to_public();
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
    // new one.
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

// ============================================================================
// Private helpers
// ============================================================================

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
            connection_store::ADAPTER_GITHUB => {
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

pub(super) fn drop_connection_pending(
    connection_id: &str,
    adapter_id: &str,
) -> Option<PendingFlow> {
    PENDING_FLOWS
        .lock()
        .ok()
        .and_then(|mut map| map.remove(&connection_pending_key(connection_id, adapter_id)))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod oauth_tests {
    use super::*;
    use crate::sync::connection_store::CreateConnectionRequest;
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
            adapter_id: connection_store::ADAPTER_GITHUB.to_string(),
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
            adapter_id: connection_store::ADAPTER_GITHUB.to_string(),
            label: "GitHub".to_string(),
            auth_method: connection_store::AUTH_METHOD_OAUTH.to_string(),
            account_email: None,
        })
        .unwrap();
        let token = install_device_pending(&connection.id, "github");
        assert!(!token.is_cancelled());
        sync_connection_oauth_cancel(connection.id.clone())
            .await
            .unwrap();
        assert!(token.is_cancelled());
        assert!(PENDING_FLOWS
            .lock()
            .unwrap()
            .get(&connection_pending_key(&connection.id, "github"))
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
            adapter_id: connection_store::ADAPTER_GITHUB.to_string(),
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
        let outcome = PollOutcome::Token(connection_token_store::ConnectionTokenRecord {
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

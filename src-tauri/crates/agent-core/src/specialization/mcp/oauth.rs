//! MCP OAuth 2.0 flow runner.
//!
//! Wraps `rmcp::transport::auth::OAuthState` with the two things rmcp
//! leaves to the host: (a) a local HTTP callback server to receive the
//! authorization code, and (b) opening the user's browser. Tokens land
//! in [`super::oauth_store::FileCredentialStore`] so subsequent
//! `rmcp` connect attempts can load them and upgrade the session to
//! `Authorized` without another round-trip through the browser.
//!
//! Flow shape:
//!
//!   1. Start a `oneshot` channel for the auth URL.
//!   2. Spin up an `axum` server on `127.0.0.1:<port>` with a single
//!      `GET /callback` route; its handler forwards `(code, state)`
//!      on a second `oneshot`.
//!   3. Call `OAuthState::start_authorization` to get the URL.
//!   4. Send the URL out (so the pseudo-tool can surface it to the
//!      model) and optionally open the default browser.
//!   5. Await `(code, state)` from the callback, call
//!      `handle_callback`, persist credentials through our
//!      `FileCredentialStore`.
//!
//! On any error we abort the background server and surface the error
//! via a typed [`OAuthFlowError`] — the caller (McpAuthTool) maps it
//! to the pseudo-tool's `status: 'error'` variant.

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use tokio::sync::{oneshot, Mutex};
use tracing::{debug, error, info, warn};

use rmcp::transport::auth::{AuthorizationManager, CredentialStore, OAuthState};

use super::oauth_store::FileCredentialStore;

/// Default OAuth scopes requested when the server advertises scoped
/// access. Empty slice => "let the server pick defaults + any
/// discovered `offline_access`", matching rmcp's internal behavior.
pub(crate) const DEFAULT_SCOPES: &[&str] = &[];

/// Name we send in Dynamic Client Registration so the resulting audit
/// entries on the IdP side are self-describing.
pub(crate) const OAUTH_CLIENT_NAME: &str = "ORGII MCP Client";

/// Overall hard timeout on the flow. The user may sit on the
/// authorization page for a while; 10 minutes keeps the callback
/// server from leaking if they never complete the flow.
pub(crate) const OAUTH_FLOW_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Errors the caller (McpAuthTool) needs to classify.
#[derive(Debug)]
pub(crate) enum OAuthFlowError {
    /// Could not reserve a TCP port for the callback server. Almost
    /// always means the host has absolutely no free high ports, which
    /// is exotic enough to surface as-is.
    BindCallback(std::io::Error),

    /// Underlying `rmcp` authorization call failed (network, metadata
    /// discovery, token exchange, etc.).
    Rmcp(String),

    /// We got a callback, but the IdP sent `?error=...` instead of
    /// `?code=...`. Surfaces the IdP's message verbatim.
    ProviderError(String),

    /// Flow sat idle for [`OAUTH_FLOW_TIMEOUT`] without a callback.
    Timeout,

    /// Background callback server panicked / dropped its sender. Mostly
    /// a defensive branch; we log the concrete cause.
    CallbackDropped,

    /// Could not persist the freshly-issued tokens. The tokens are
    /// still live in memory for the remainder of the process, so we
    /// warn but don't fail the flow.
    Persist(String),
}

impl std::fmt::Display for OAuthFlowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BindCallback(err) => write!(f, "could not bind OAuth callback port: {}", err),
            Self::Rmcp(msg) => write!(f, "rmcp OAuth error: {}", msg),
            Self::ProviderError(msg) => write!(f, "IdP returned OAuth error: {}", msg),
            Self::Timeout => write!(
                f,
                "OAuth flow timed out after {} seconds",
                OAUTH_FLOW_TIMEOUT.as_secs()
            ),
            Self::CallbackDropped => write!(f, "OAuth callback server dropped unexpectedly"),
            Self::Persist(msg) => write!(f, "failed to persist OAuth credentials: {}", msg),
        }
    }
}

impl std::error::Error for OAuthFlowError {}

/// What [`perform_oauth_flow`] returns once the user has authorized us.
#[derive(Debug, Clone)]
pub(crate) struct OAuthFlowOutcome {
    /// Authorization URL that was shown to the user. Exposed so the
    /// pseudo-tool can include it in its reply.
    pub(crate) auth_url: String,
}

/// Query parameters parsed off the `/callback` URL. `code` OR
/// `error` will be set; `state` is the CSRF token.
#[derive(Debug, Deserialize)]
struct CallbackParams {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Result of the callback route, forwarded on the oneshot channel.
enum CallbackOutcome {
    /// Happy path: `code` + `state`.
    Success { code: String, state: String },

    /// `error=...` variant.
    ProviderError(String),

    /// Neither `code` nor `error` — malformed callback.
    Malformed,
}

#[derive(Clone)]
struct CallbackState {
    tx: Arc<Mutex<Option<oneshot::Sender<CallbackOutcome>>>>,
}

async fn callback_handler(
    State(state): State<CallbackState>,
    Query(params): Query<CallbackParams>,
) -> impl IntoResponse {
    let outcome = if let Some(err) = params.error {
        let msg = match params.error_description {
            Some(d) => format!("{}: {}", err, d),
            None => err,
        };
        CallbackOutcome::ProviderError(msg)
    } else if let (Some(code), Some(state_tok)) = (params.code, params.state) {
        CallbackOutcome::Success {
            code,
            state: state_tok,
        }
    } else {
        CallbackOutcome::Malformed
    };

    // Send the outcome — the oneshot is `Option<Sender>` behind a mutex
    // so a duplicate callback (retries, browser weirdness) doesn't
    // panic on a closed channel.
    if let Some(sender) = state.tx.lock().await.take() {
        let _ = sender.send(match &outcome {
            CallbackOutcome::Success { code, state } => CallbackOutcome::Success {
                code: code.clone(),
                state: state.clone(),
            },
            CallbackOutcome::ProviderError(m) => CallbackOutcome::ProviderError(m.clone()),
            CallbackOutcome::Malformed => CallbackOutcome::Malformed,
        });
    }

    let body = match outcome {
        CallbackOutcome::Success { .. } => {
            r#"<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:2em">
<h2>Authentication complete.</h2>
<p>You can close this window and return to the app.</p>
</body></html>"#
        }
        CallbackOutcome::ProviderError(_) => {
            r#"<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:2em">
<h2>Authentication failed.</h2>
<p>The identity provider returned an error. Return to the app for details.</p>
</body></html>"#
        }
        CallbackOutcome::Malformed => {
            r#"<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:2em">
<h2>Unexpected callback.</h2>
<p>Return to the app and try again.</p>
</body></html>"#
        }
    };

    Html(body)
}

/// Reserve a local TCP port synchronously; the `TcpListener` is
/// returned so `axum::serve` can take it over on the next line.
fn reserve_loopback_port() -> Result<TcpListener, std::io::Error> {
    // Bind to port 0 → OS picks a free high port.
    let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)))?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// Drive the full OAuth flow for `server` pointed at `server_url`
/// (the same URL rmcp's transport uses).
///
/// `on_auth_url` is invoked the moment we have the authorization URL
/// — this lets the caller surface it to the user without waiting for
/// the whole flow to finish.
///
/// `skip_browser_open` is the headless-environment knob. Defaults to
/// `false` in callers — we open the browser eagerly in interactive
/// contexts.
pub(crate) async fn perform_oauth_flow(
    server: &str,
    server_url: &str,
    skip_browser_open: bool,
    on_auth_url: impl FnOnce(&str) + Send + 'static,
) -> Result<OAuthFlowOutcome, OAuthFlowError> {
    // 1) Reserve callback port + URL.
    let std_listener = reserve_loopback_port().map_err(OAuthFlowError::BindCallback)?;
    let local_addr = std_listener
        .local_addr()
        .map_err(OAuthFlowError::BindCallback)?;
    let redirect_uri = format!("http://{}:{}/callback", local_addr.ip(), local_addr.port());
    debug!(
        "[mcp:oauth] '{}' reserved callback at {}",
        server, redirect_uri
    );

    // 2) Prepare callback oneshot + axum router.
    let (cb_tx, cb_rx) = oneshot::channel::<CallbackOutcome>();
    let cb_state = CallbackState {
        tx: Arc::new(Mutex::new(Some(cb_tx))),
    };
    let router = Router::new()
        .route("/callback", get(callback_handler))
        .with_state(cb_state);

    // Hand the std listener off to tokio for axum::serve. We wrap the
    // shutdown sender in a small guard so *every* exit path (early
    // return, timeout, successful completion) stops the server; this
    // avoids the "use after move into closure" footgun of handing the
    // sender out manually in each error branch.
    let listener =
        tokio::net::TcpListener::from_std(std_listener).map_err(OAuthFlowError::BindCallback)?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    struct ShutdownGuard(Option<oneshot::Sender<()>>);
    impl Drop for ShutdownGuard {
        fn drop(&mut self) {
            if let Some(tx) = self.0.take() {
                let _ = tx.send(());
            }
        }
    }
    let shutdown_guard = ShutdownGuard(Some(shutdown_tx));
    let server_task = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await
        {
            warn!("[mcp:oauth] callback server exited with error: {}", err);
        }
    });

    // 3) Build an AuthorizationManager wired to our on-disk store so
    // the freshly-issued tokens get persisted.
    let store = FileCredentialStore::new(server);
    let mut manager = AuthorizationManager::new(server_url)
        .await
        .map_err(|e| OAuthFlowError::Rmcp(e.to_string()))?;
    manager.set_credential_store(store.clone());
    let mut oauth_state = OAuthState::Unauthorized(manager);

    // 4) Start authorization — rmcp internally builds the URL.
    oauth_state
        .start_authorization(DEFAULT_SCOPES, &redirect_uri, Some(OAUTH_CLIENT_NAME))
        .await
        .map_err(|e| OAuthFlowError::Rmcp(e.to_string()))?;
    let auth_url = oauth_state
        .get_authorization_url()
        .await
        .map_err(|e| OAuthFlowError::Rmcp(e.to_string()))?;

    // 5) Surface the URL to the caller + optionally kick the browser.
    on_auth_url(&auth_url);
    if !skip_browser_open {
        if let Err(err) = open::that(&auth_url) {
            warn!(
                "[mcp:oauth] failed to open browser for '{}': {} — URL is {}",
                server, err, auth_url
            );
        }
    }
    info!(
        "[mcp:oauth] '{}' awaiting browser callback (timeout {}s)",
        server,
        OAUTH_FLOW_TIMEOUT.as_secs()
    );

    // 6) Wait for the callback (bounded). Dropping the guard stops
    // the axum server whether we timeout or succeed.
    let callback = tokio::time::timeout(OAUTH_FLOW_TIMEOUT, cb_rx).await;
    drop(shutdown_guard);
    let _ = server_task.await;

    let outcome = match callback {
        Ok(Ok(o)) => o,
        Ok(Err(_)) => return Err(OAuthFlowError::CallbackDropped),
        Err(_) => return Err(OAuthFlowError::Timeout),
    };

    let (code, csrf) = match outcome {
        CallbackOutcome::Success { code, state } => (code, state),
        CallbackOutcome::ProviderError(msg) => return Err(OAuthFlowError::ProviderError(msg)),
        CallbackOutcome::Malformed => {
            return Err(OAuthFlowError::ProviderError(
                "callback had neither code nor error".to_string(),
            ));
        }
    };

    // 7) Exchange code for token. rmcp writes into our CredentialStore.
    if let Err(err) = oauth_state.handle_callback(&code, &csrf).await {
        return Err(OAuthFlowError::Rmcp(err.to_string()));
    }

    // Verify persistence — `rmcp` writes internally, but we surface a
    // warning if the file unexpectedly didn't land (e.g. permissions
    // flipped between start and finish).
    match CredentialStore::load(&store).await {
        Ok(Some(_)) => {
            info!(
                "[mcp:oauth] '{}' completed OAuth flow, creds persisted",
                server
            );
        }
        Ok(None) => {
            warn!(
                "[mcp:oauth] '{}' OAuth completed but store returned empty on readback",
                server
            );
        }
        Err(err) => {
            error!(
                "[mcp:oauth] '{}' completed OAuth but could not read back creds: {}",
                server, err
            );
            return Err(OAuthFlowError::Persist(err.to_string()));
        }
    }

    Ok(OAuthFlowOutcome { auth_url })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pure unit tests only — the full flow requires a live IdP and
    // network access, which belongs in an e2e harness.

    #[test]
    fn error_display_is_user_readable() {
        let err = OAuthFlowError::Timeout;
        let msg = format!("{}", err);
        assert!(msg.contains("timed out"));
    }

    #[test]
    fn error_display_provider_includes_message() {
        let err = OAuthFlowError::ProviderError("access_denied: user cancelled".into());
        let msg = format!("{}", err);
        assert!(msg.contains("access_denied"));
        assert!(msg.contains("user cancelled"));
    }

    #[test]
    fn reserve_loopback_port_returns_different_ports_across_calls() {
        let listener1 = reserve_loopback_port().expect("bind 1");
        let listener2 = reserve_loopback_port().expect("bind 2");
        let port1 = listener1.local_addr().unwrap().port();
        let port2 = listener2.local_addr().unwrap().port();
        assert_ne!(port1, port2, "OS should assign distinct ephemeral ports");
        assert_ne!(port1, 0);
        assert_ne!(port2, 0);
    }
}

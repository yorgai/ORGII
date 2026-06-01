//! OAuth login flows for sync adapters.
//!
//! Two grant types are supported, behind a single
//! [`OAuthFlowStart`] wire enum so the frontend "Connect with…"
//! component can drive either:
//!
//! - [`github`] — RFC 8628 device authorization grant. The user reads
//!   a short code off the desktop UI and types it into the browser.
//! - [`linear`] — Authorization Code grant with PKCE and a fixed
//!   loopback redirect (`http://localhost:45445/callback`). Linear does
//!   not implement device flow.
//!
//! ## Token contract
//!
//! Both flows funnel their result into [`super::connection_token_store::save`]
//! as a [`super::connection_token_store::ConnectionTokenRecord`]. PATs and GitHub OAuth
//! bearers carry no expiry. Linear OAuth bearers expire after 24h and
//! arrive with a `refresh_token` + `expires_in`; the worker calls
//! [`ensure_fresh_connection_token`] before each adapter request to refresh
//! transparently when the wall-clock expiry is within 60 seconds.
//!
//! ## Why a unified `OAuthFlowStart`?
//!
//! Device flow exposes a `user_code` + `verification_uri` + polling
//! interval. Redirect+PKCE has none of those — the browser is opened
//! once and the loopback awaits a single GET. The frontend needs to
//! switch UI between "show the code, here's a link" and "we opened
//! the browser, waiting for the redirect". Carrying both shapes
//! through a tagged enum is the clean wire-format way; previous
//! phases shipped with `DeviceFlowStart` directly, which is now
//! retired.

pub mod github;
pub mod linear;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::connection_token_store::{self, ConnectionTokenRecord};

/// Public wire shape returned by connection-scoped OAuth start commands.
/// The serde tag is `kind`, with values `"device"` (RFC 8628) or `"redirect"` (PKCE +
/// loopback). The frontend reads `kind` first and then the variant
/// payload.
///
/// Both variants strip provider-secret state (`device_code` for
/// GitHub, `code_verifier` + `state` for Linear) — those stay in the
/// process-local `PendingFlow` registry inside `commands/sync.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OAuthFlowStart {
    /// RFC 8628 device authorization grant (GitHub).
    Device {
        /// Short code the user types into the browser (e.g. `WDJB-MJHT`).
        user_code: String,
        /// Verification URL the user visits in their browser.
        verification_uri: String,
        /// Recommended polling interval, in seconds (server-supplied).
        interval_secs: u64,
        /// Wall-clock deadline (Unix epoch seconds) after which the
        /// device code is no longer valid; the UI uses this for a
        /// countdown.
        expires_at_unix: i64,
    },
    /// Authorization Code + PKCE with a loopback redirect (Linear).
    /// `authorize_url` is what the frontend opens in the user's
    /// browser. `expires_at_unix` is the wall-clock deadline for the
    /// whole flow (loopback timeout + provider's authorize-url TTL
    /// combined).
    Redirect {
        authorize_url: String,
        expires_at_unix: i64,
    },
}

/// What the polling / await loop returns — either a final access
/// token bundle, or a terminal RFC 8628 / PKCE error variant the UI
/// should surface.
///
/// `Token` carries the full [`ConnectionTokenRecord`] (not a bare string) so
/// the OAuth response's `refresh_token` + `expires_in` survive
/// without an extra round trip through HTTP.
///
/// `Debug` is implemented manually to redact bearer + refresh
/// material; logging either would defeat the point of running the
/// flow over TLS.
#[derive(Clone)]
pub enum PollOutcome {
    /// User approved — typed token record ready for the adapter.
    Token(ConnectionTokenRecord),
    /// User explicitly denied access on the consent screen.
    AccessDenied,
    /// Device code or authorize URL expired before the user approved.
    Expired,
    /// `cancel` command was invoked while polling / awaiting redirect.
    Cancelled,
    /// Network or transport-layer failure that the worker should
    /// surface verbatim (URL bound up, DNS error, malformed JSON,
    /// state mismatch on the redirect callback…).
    PollFailed(String),
}

impl std::fmt::Debug for PollOutcome {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PollOutcome::Token(_) => write!(f, "Token(<redacted>)"),
            PollOutcome::AccessDenied => write!(f, "AccessDenied"),
            PollOutcome::Expired => write!(f, "Expired"),
            PollOutcome::Cancelled => write!(f, "Cancelled"),
            PollOutcome::PollFailed(s) => write!(f, "PollFailed({})", s),
        }
    }
}

/// Compact metadata returned by [`github::start_device_flow`].
/// Internal to the OAuth module — the public surface uses
/// [`OAuthFlowStart::Device`] which strips the `device_code` field
/// before crossing the Tauri command boundary.
#[derive(Debug, Clone)]
pub struct DeviceFlowDescriptor {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval_secs: u64,
    pub expires_at: DateTime<Utc>,
}

impl DeviceFlowDescriptor {
    pub fn to_public(&self) -> OAuthFlowStart {
        OAuthFlowStart::Device {
            user_code: self.user_code.clone(),
            verification_uri: self.verification_uri.clone(),
            interval_secs: self.interval_secs,
            expires_at_unix: self.expires_at.timestamp(),
        }
    }
}

/// Safety margin (seconds) below `expires_at_unix` that triggers a
/// refresh. Keeps a request that was queued just before the deadline
/// from racing the expiry. 60 seconds is generous but cheap — Linear
/// refresh latency is sub-second on a healthy network.
const REFRESH_SAFETY_MARGIN_SECS: i64 = 60;

/// Look up the stored token for `connection_id` and refresh it if
/// it's expired (or about to expire). Returns the bearer string the
/// adapter should use.
///
/// Behaviour:
/// - No row → `Err("no token")`. The caller (`worker.rs`) logs and
///   skips, same as before this function existed.
/// - `expires_at_unix == None` → return `access_token` unchanged.
///   PATs and GitHub bearers fall in this bucket.
/// - Token still fresh (deadline > now + safety margin) → return
///   `access_token` unchanged.
/// - Token expired or about to expire → dispatch to the provider's
///   refresh routine (today only `linear`), persist the new
///   [`ConnectionTokenRecord`], return the fresh bearer. Refresh failures
///   propagate as `Err(_)`; the worker records the row as failed
///   rather than silently degrading.
pub async fn ensure_fresh_connection_token(
    connection_id: &str,
    adapter_id: &str,
) -> Result<String, String> {
    let record = connection_token_store::get(connection_id)?
        .ok_or_else(|| format!("no sync token for connection {connection_id}"))?;

    let Some(expires_at) = record.expires_at_unix else {
        return Ok(record.access_token);
    };

    let now = Utc::now().timestamp();
    if expires_at > now.saturating_add(REFRESH_SAFETY_MARGIN_SECS) {
        return Ok(record.access_token);
    }

    match adapter_id {
        "linear" => {
            let refresh_token = record
                .refresh_token
                .clone()
                .ok_or_else(|| "linear token expired but no refresh_token stored".to_string())?;
            let client_id = linear::effective_client_id().ok_or_else(|| {
                "Linear OAuth client id not configured (build with ORGII_LINEAR_OAUTH_CLIENT_ID)"
                    .to_string()
            })?;
            let new_record = linear::refresh(&client_id, &refresh_token).await?;
            connection_token_store::save(connection_id, new_record.clone())?;
            Ok(new_record.access_token)
        }
        other => Err(format!(
            "no refresh routine wired up for adapter '{}'",
            other
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_helpers::test_env;

    #[test]
    fn oauth_flow_start_device_serde_roundtrip() {
        let device = OAuthFlowStart::Device {
            user_code: "WDJB-MJHT".to_string(),
            verification_uri: "https://example.test/device".to_string(),
            interval_secs: 5,
            expires_at_unix: 1_900_000_000,
        };
        let wire = serde_json::to_string(&device).unwrap();
        assert!(wire.contains("\"kind\":\"device\""), "wire: {}", wire);
        assert!(wire.contains("\"user_code\":\"WDJB-MJHT\""));
        let parsed: OAuthFlowStart = serde_json::from_str(&wire).unwrap();
        match parsed {
            OAuthFlowStart::Device { user_code, .. } => assert_eq!(user_code, "WDJB-MJHT"),
            other => panic!("expected Device, got {:?}", other),
        }
    }

    #[test]
    fn oauth_flow_start_redirect_serde_roundtrip() {
        let redirect = OAuthFlowStart::Redirect {
            authorize_url: "https://linear.app/oauth/authorize?client_id=abc".to_string(),
            expires_at_unix: 1_900_000_600,
        };
        let wire = serde_json::to_string(&redirect).unwrap();
        assert!(wire.contains("\"kind\":\"redirect\""), "wire: {}", wire);
        assert!(wire.contains("\"authorize_url\""));
        // Sanity: the device-only fields must NOT leak into a
        // redirect payload.
        assert!(!wire.contains("\"user_code\""));
        assert!(!wire.contains("\"verification_uri\""));
        let parsed: OAuthFlowStart = serde_json::from_str(&wire).unwrap();
        match parsed {
            OAuthFlowStart::Redirect { authorize_url, .. } => {
                assert!(authorize_url.contains("client_id=abc"))
            }
            other => panic!("expected Redirect, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn ensure_fresh_connection_returns_pat_unchanged() {
        let _sandbox = test_env::sandbox();
        connection_token_store::save("connection-alpha", ConnectionTokenRecord::pat("lin_pat"))
            .unwrap();
        let bearer = ensure_fresh_connection_token("connection-alpha", "linear")
            .await
            .unwrap();
        assert_eq!(bearer, "lin_pat");
    }

    #[tokio::test]
    async fn ensure_fresh_connection_returns_unchanged_when_well_within_window() {
        let _sandbox = test_env::sandbox();
        let future = Utc::now().timestamp() + 24 * 60 * 60;
        let record = ConnectionTokenRecord {
            access_token: "still_fresh".into(),
            refresh_token: Some("rt".into()),
            expires_at_unix: Some(future),
            source: connection_token_store::SOURCE_OAUTH_REDIRECT.into(),
        };
        connection_token_store::save("connection-alpha", record).unwrap();
        let bearer = ensure_fresh_connection_token("connection-alpha", "linear")
            .await
            .unwrap();
        assert_eq!(bearer, "still_fresh");
    }

    #[tokio::test]
    async fn ensure_fresh_connection_errors_when_no_token_stored() {
        let _sandbox = test_env::sandbox();
        let err = ensure_fresh_connection_token("ghost", "linear")
            .await
            .unwrap_err();
        assert!(err.contains("no sync token"), "got {}", err);
    }

    #[tokio::test]
    async fn ensure_fresh_connection_errors_when_linear_client_id_missing() {
        let _sandbox = test_env::sandbox();
        let past = Utc::now().timestamp() - 600;
        let record = ConnectionTokenRecord {
            access_token: "stale_bearer".into(),
            refresh_token: Some("rt".into()),
            expires_at_unix: Some(past),
            source: connection_token_store::SOURCE_OAUTH_REDIRECT.into(),
        };
        connection_token_store::save("connection-alpha", record).unwrap();
        let result = ensure_fresh_connection_token("connection-alpha", "linear").await;
        assert!(result.is_err(), "expected error, got {:?}", result);
    }
}

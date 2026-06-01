//! HTTP client for the relay's pairing endpoints.
//!
//! Wraps `reqwest` and turns `orgii_protocol`'s pairing DTOs into typed
//! method calls. All three endpoints require an `X-User-Id` header
//! (Phase 2 temporary auth — see `orgii_mobile_relay::handlers::pairing`
//! for the relay-side rationale).
//!
//! ## URL composition
//!
//! `base_url` MUST NOT include a trailing slash. The client appends
//! endpoint paths like `"/pair/init"` directly via `format!`, so a
//! trailing slash on `base_url` would produce `"//pair/init"` and
//! 404 on most reverse proxies.

use orgii_protocol::{
    DesktopId, DeviceId, DeviceListResponse, PairingConfirmRequest, PairingConfirmResponse,
    PairingInitRequest, PairingInitResponse, SetPrimaryDesktopResponse, UserId,
};
use reqwest::{Client, Response, StatusCode};
use serde::Serialize;

use crate::error::MobileRemoteError;

/// HTTP header carrying the temporary `UserId`. Lowercase to match
/// the relay's case-insensitive `HeaderMap` lookup convention.
const HEADER_USER_ID: &str = "X-User-Id";

/// 10s connect, 30s total — pairing is human-paced; longer timeouts
/// hide bugs behind "the user gave up" rather than surfacing them.
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// Wire-side body of `POST /audit/record` on the relay. Mirrors the
/// relay's [`crate`] view of an audit row minus
/// the storage-assigned id and the `error` column (the desktop's
/// audit logger summarises the outcome to a single boolean and does
/// not persist the underlying error string).
#[derive(Debug, Clone, Serialize)]
pub struct AuditRecordRequest {
    pub user_id: String,
    pub source_device_id: String,
    pub command: String,
    pub ok: bool,
    pub latency_ms: u64,
    pub ts_ms: i64,
}

/// `reqwest`-backed pairing client. Cheap to clone (`reqwest::Client`
/// is itself an `Arc` over a connection pool).
#[derive(Debug, Clone)]
pub struct PairingHttpClient {
    base_url: String,
    user_id: UserId,
    inner: Client,
}

impl PairingHttpClient {
    /// Build a new client. `base_url` should NOT have a trailing
    /// slash (see module docs).
    pub fn new(base_url: impl Into<String>, user_id: UserId) -> Result<Self, MobileRemoteError> {
        let inner = Client::builder()
            .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|err| MobileRemoteError::Other(format!("reqwest builder failed: {err}")))?;
        Ok(Self {
            base_url: base_url.into(),
            user_id,
            inner,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn user_id(&self) -> &UserId {
        &self.user_id
    }

    /// `POST /pair/init` — desktop announces it wants to pair.
    pub async fn pair_init(
        &self,
        req: &PairingInitRequest,
    ) -> Result<PairingInitResponse, MobileRemoteError> {
        let url = format!("{}/pair/init", self.base_url);
        let response = self.send_json(&url, req).await?;
        decode_response::<PairingInitResponse>(response).await
    }

    /// `POST /pair/confirm` — desktop confirms SAS match. The mobile
    /// side calls the same endpoint via its own client; we never call
    /// `pair_claim` from the desktop.
    pub async fn pair_confirm(
        &self,
        req: &PairingConfirmRequest,
    ) -> Result<PairingConfirmResponse, MobileRemoteError> {
        let url = format!("{}/pair/confirm", self.base_url);
        let response = self.send_json(&url, req).await?;
        decode_response::<PairingConfirmResponse>(response).await
    }

    /// `GET /devices` — list paired devices for this user. Used by the
    /// desktop to reconcile its on-disk cache against server-side
    /// truth.
    pub async fn list_devices(&self) -> Result<DeviceListResponse, MobileRemoteError> {
        let url = format!("{}/devices", self.base_url);
        let response = self
            .inner
            .get(&url)
            .header(HEADER_USER_ID, self.user_id.as_str())
            .send()
            .await
            .map_err(|err| MobileRemoteError::RelayUnreachable(format!("{err}")))?;
        decode_response::<DeviceListResponse>(response).await
    }

    /// `DELETE /devices/:id` — revoke a paired device server-side. The
    /// caller is also expected to update its local cache; the relay
    /// returns 204 No Content on success and 404 if the device is
    /// unknown OR belongs to a different user (the relay deliberately
    /// conflates those to avoid leaking other users' device IDs).
    pub async fn revoke_device(&self, device_id: &DeviceId) -> Result<(), MobileRemoteError> {
        let url = format!("{}/devices/{}", self.base_url, device_id.as_str());
        let response = self
            .inner
            .delete(&url)
            .header(HEADER_USER_ID, self.user_id.as_str())
            .send()
            .await
            .map_err(|err| MobileRemoteError::RelayUnreachable(format!("{err}")))?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let status_code = status.as_u16();
        let message = match response.text().await {
            Ok(body) => extract_error_message(&body),
            Err(err) => format!("<failed to read body: {err}>"),
        };
        Err(MobileRemoteError::RelayRejected {
            status: status_code,
            message,
        })
    }

    /// `PUT /desktops/:id/primary` — mark a desktop as the user's
    /// primary. Idempotent.
    pub async fn set_primary_desktop(
        &self,
        desktop_id: &DesktopId,
    ) -> Result<SetPrimaryDesktopResponse, MobileRemoteError> {
        let url = format!("{}/desktops/{}/primary", self.base_url, desktop_id.as_str());
        let response = self
            .inner
            .put(&url)
            .header(HEADER_USER_ID, self.user_id.as_str())
            .send()
            .await
            .map_err(|err| MobileRemoteError::RelayUnreachable(format!("{err}")))?;
        decode_response::<SetPrimaryDesktopResponse>(response).await
    }

    async fn send_json<B: serde::Serialize>(
        &self,
        url: &str,
        body: &B,
    ) -> Result<Response, MobileRemoteError> {
        self.inner
            .post(url)
            .header(HEADER_USER_ID, self.user_id.as_str())
            .json(body)
            .send()
            .await
            .map_err(|err| MobileRemoteError::RelayUnreachable(format!("{err}")))
    }
}

/// `reqwest`-backed client for the relay's audit endpoints.
///
/// Carved out from [`PairingHttpClient`] because the lifecycles
/// differ: pairing happens once during the wizard, while audit runs
/// for every dispatched RPC for as long as the bridge is connected.
/// Both share the `X-User-Id` auth pattern but the call surfaces are
/// otherwise disjoint.
///
/// Cloning is cheap — `reqwest::Client` is itself an `Arc` over a
/// connection pool. Construct once on bridge startup and hand clones
/// to every audit emitter.
#[derive(Debug, Clone)]
pub struct AuditHttpClient {
    base_url: String,
    user_id: UserId,
    inner: Client,
}

impl AuditHttpClient {
    /// Build a new client. `base_url` should NOT have a trailing
    /// slash (see module docs).
    pub fn new(base_url: impl Into<String>, user_id: UserId, inner: Client) -> Self {
        Self {
            base_url: base_url.into(),
            user_id,
            inner,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn user_id(&self) -> &UserId {
        &self.user_id
    }

    /// `POST /audit/record` — desktop self-reports one audit row.
    /// Returns `Ok(())` only on `202 Accepted`; any other status is
    /// surfaced as a typed error so the caller can decide whether to
    /// log-and-drop or retry.
    pub async fn record_audit(&self, body: &AuditRecordRequest) -> Result<(), MobileRemoteError> {
        let url = format!("{}/audit/record", self.base_url);
        let response = self
            .inner
            .post(&url)
            .header(HEADER_USER_ID, self.user_id.as_str())
            .json(body)
            .send()
            .await
            .map_err(|err| MobileRemoteError::RelayUnreachable(format!("{err}")))?;
        let status = response.status();
        if status == StatusCode::ACCEPTED {
            return Ok(());
        }
        let status_code = status.as_u16();
        let message = match response.text().await {
            Ok(body) => extract_error_message(&body),
            Err(err) => format!("<failed to read body: {err}>"),
        };
        Err(MobileRemoteError::RelayRejected {
            status: status_code,
            message,
        })
    }
}

/// Decode a successful response body or convert a non-2xx status into
/// `MobileRemoteError::RelayRejected` carrying the relay's `error`
/// message (if the body is a `{ "error": "..." }` JSON object) or the
/// raw body text otherwise.
async fn decode_response<T: serde::de::DeserializeOwned>(
    response: Response,
) -> Result<T, MobileRemoteError> {
    let status = response.status();
    if status.is_success() {
        return response
            .json::<T>()
            .await
            .map_err(|err| MobileRemoteError::Other(format!("invalid relay response: {err}")));
    }
    let status_code = status.as_u16();
    let message = match response.text().await {
        Ok(body) => extract_error_message(&body),
        Err(err) => format!("<failed to read body: {err}>"),
    };
    Err(MobileRemoteError::RelayRejected {
        status: status_code,
        message,
    })
}

/// Pull the `error` field out of `{ "error": "<message>" }` JSON, or
/// fall back to the raw body when it isn't valid JSON or doesn't
/// match that shape.
fn extract_error_message(body: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(value) => value
            .get("error")
            .and_then(|v| v.as_str())
            .map(|s| s.to_owned())
            .unwrap_or_else(|| body.to_owned()),
        Err(_) => body.to_owned(),
    }
}

#[cfg(test)]
#[path = "http_tests.rs"]
mod tests;

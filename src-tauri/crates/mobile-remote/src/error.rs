//! Error type for the `mobile_remote` module.
//!
//! Tauri commands surface this as `Result<T, String>` (via `.to_string()`),
//! but internal callers use the typed enum so they can match on
//! recoverable failure modes.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum MobileRemoteError {
    #[error("desktop has no paired devices yet")]
    NotPaired,

    #[error("relay unreachable: {0}")]
    RelayUnreachable(String),

    #[error("command not allowed for this permission tier: {0}")]
    CommandNotAllowed(String),

    /// HTTP request to the relay completed but the relay returned a
    /// non-2xx status. The string is the relay's error body, surfaced
    /// to the user so a misconfigured `X-User-Id` or expired pairing
    /// code is debuggable.
    #[error("relay rejected request ({status}): {message}")]
    RelayRejected { status: u16, message: String },

    /// Pairing flow failed structurally — e.g. SAS phrase mismatch,
    /// confirm called before claim, or the relay reported expiry.
    #[error("pairing failed: {0}")]
    PairingFailed(String),

    /// Desktop called `/pair/confirm` but the relay reports the other
    /// side has not confirmed yet. The desktop wizard drives both
    /// confirms in sequence, so reaching this branch indicates a flow
    /// bug — surfacing it as an error keeps us from writing a half-
    /// finalised `PairedDeviceRecord`.
    #[error("pairing not yet finalised: relay reports awaiting other side")]
    PairingNotFinalized,

    /// Relay reported `Paired` but did not echo the freshly-issued
    /// `device_id` we need to persist. After the protocol upgrade
    /// landed in T1 every paired response carries the field, so a
    /// missing value means a relay/desktop version skew. Better to
    /// fail loudly than to write a placeholder.
    #[error("relay reported pairing complete but did not return a device id")]
    PairingResponseMissingDeviceId,

    /// Outbound WebSocket connection or upgrade handshake failed.
    /// Distinct from `RelayUnreachable` (DNS / TCP) because WS
    /// upgrade can fail at the HTTP layer (401, 403, version
    /// mismatch).
    #[error("websocket handshake failed: {0}")]
    WsHandshake(String),

    /// `tauri::AppHandle` invocation failed inside `dispatch_rpc`. The
    /// inner string is the underlying handler's error rendered for the
    /// audit log; the same value is forwarded as `RpcResult::Err`.
    #[error("dispatch handler failed: {0}")]
    DispatchHandler(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Serialize(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

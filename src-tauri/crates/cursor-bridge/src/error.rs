//! Error types for the CDP probe.
//!
//! We split CDP-protocol failures (`CdpError`) from JS-evaluation
//! failures (`RuntimeException`, defined in `cdp.rs`) intentionally:
//!
//!  - `CdpError` = "we couldn't even talk to the inspector" — wrong
//!    port, Cursor not launched with `--inspect-extensions`, target
//!    list empty, WS handshake failed, malformed CDP frame, timeout.
//!    These are *infrastructure* problems; the caller's response is
//!    "fix your environment and retry".
//!  - `RuntimeException` = "we evaluated JS and V8 reported an error"
//!    — `ReferenceError`, `TypeError`, etc. These are *content*
//!    problems; the caller wants to inspect the stack and adjust the
//!    expression.
//!
//! Conflating them would force every caller to disambiguate "is V8
//! down" from "is my code wrong", which is exactly the disambiguation
//! we already do for `CursorAgentError` vs `result.status === "error"`
//! in the SDK skill we follow elsewhere in this repo.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, CdpError>;

#[derive(Debug, Error)]
pub enum CdpError {
    /// `GET /json/list` failed at the HTTP layer (connection refused,
    /// DNS, TLS, etc.). The most common cause is "Cursor wasn't launched
    /// with `--inspect-extensions=<port>`" — surface that hint upstream.
    #[error("CDP discovery failed at {endpoint}: {source}")]
    DiscoveryHttp {
        endpoint: String,
        #[source]
        source: reqwest::Error,
    },

    /// `/json/list` responded but the body wasn't the inspector's
    /// expected JSON shape. Usually means we hit a *different* HTTP
    /// service on the same port (e.g. dev server) — useful to spot
    /// because the user-friendly error then is "is this really an
    /// inspector port?".
    #[error("CDP discovery returned malformed JSON from {endpoint}: {source}")]
    DiscoveryParse {
        endpoint: String,
        #[source]
        source: serde_json::Error,
    },

    /// The inspector responded but the target list contained no entry
    /// matching our filter. The probe falls back to "show all targets"
    /// when this fires, so the operator can pick manually.
    #[error("no CDP target matched filter `{filter}` (saw {available} target(s))")]
    NoMatchingTarget { filter: String, available: usize },

    /// `tokio_tungstenite::tungstenite::Error` is ~130 bytes (it
    /// carries a full URL + handshake response inline) which dwarfs
    /// every other variant. We box it to keep `Result<T, CdpError>`
    /// from carrying a 144-byte error in every Ok path — the clippy
    /// `result_large_err` lint catches this.
    #[error("WebSocket handshake to {url} failed: {source}")]
    WsHandshake {
        url: String,
        #[source]
        source: Box<tokio_tungstenite::tungstenite::Error>,
    },

    /// See the boxing rationale on `WsHandshake`.
    #[error("WebSocket I/O error: {source}")]
    WsIo {
        #[source]
        source: Box<tokio_tungstenite::tungstenite::Error>,
    },

    /// The CDP server closed the connection on us mid-conversation.
    /// Almost always means the inspected process exited (e.g. Cursor
    /// quit, or the extension host crashed).
    #[error("CDP connection closed unexpectedly while waiting for response to id={request_id}")]
    ConnectionClosed { request_id: u64 },

    /// CDP responded but the JSON didn't have the `id`/`result` shape
    /// we expected. The raw body is included so we can iterate on the
    /// parser without re-running the probe.
    #[error("malformed CDP response: {context}; body was: {body}")]
    MalformedResponse { context: String, body: String },

    #[error("CDP request timed out after {timeout_ms}ms (id={request_id})")]
    Timeout { request_id: u64, timeout_ms: u64 },

    /// CDP returned an `error` field (vs. a `result` field). E.g.
    /// `Runtime.evaluate` itself rejected the call. *Not* the same as
    /// `RuntimeException`, which means evaluation succeeded but the
    /// expression threw.
    #[error("CDP method returned protocol error: code={code} message={message}")]
    ProtocolError { code: i64, message: String },
}

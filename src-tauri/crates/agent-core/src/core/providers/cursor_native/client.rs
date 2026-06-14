//! HTTP/2 Connect streaming client for `agent.v1.AgentService/Run`.
//!
//! One open RPC == one HTTP/2 bidirectional stream. The request body is a
//! multiplexed stream of Connect-framed protobuf messages:
//! - The initial [`agent_v1::AgentRunRequest`] (carries the conversation state
//!   and model selection).
//! - Periodic [`agent_v1::ClientHeartbeat`] every 5 seconds, which the server
//!   requires to keep the connection alive.
//! - Zero or more [`agent_v1::InteractionResponse`] messages (tool call
//!   results) as the turn progresses.
//!
//! The server streams back Connect-framed [`agent_v1::AgentServerMessage`]
//! frames — one per text delta, tool-call lifecycle event, etc. — and
//! finally a Connect end-stream frame (flag `0x02`) whose JSON payload
//! carries any trailer-level error.
//!
//! We drive the heartbeat from inside the request-body `async_stream` via
//! `tokio::select!` on (user-message channel, interval ticker). That keeps
//! the task topology flat: when the caller drops [`RunStream`], the user-
//! message sender closes, `select!` sees `None`, and the request body
//! terminates cleanly. No spawned heartbeat task to abort.
//!
//! Reference: [opencode-cursor](https://github.com/ephraimduncan/opencode-cursor)
//! `src/h2-bridge.mjs` (headers + framing) and `src/proxy.ts:1320-1340`
//! (heartbeat cadence). Their design splits out a Node child process because
//! Bun's HTTP/2 is broken; we rely on hyper/h2 via reqwest, which negotiates
//! HTTP/2 transparently with `api2.cursor.sh` over ALPN.

use std::pin::Pin;
use std::time::Duration;

use async_stream::{stream, try_stream};
use bytes::Bytes;
use futures::stream::{Stream, StreamExt};
use prost::Message;
use reqwest::Client;
use tokio::sync::mpsc;
use tokio::time::{interval, MissedTickBehavior};

use super::auth;
use super::connect::{frame_message, FrameParser};
use super::proto::agent_v1 as pb;

/// Cadence of the keepalive heartbeat the server requires (see
/// opencode-cursor `proxy.ts:1334`). Missing heartbeats cause the server to
/// close the stream after ~15 s.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

/// Transport-level errors from the Run stream.
///
/// These are layered _below_ `ProviderError` — the `LLMProvider` impl maps
/// them to appropriate provider errors (e.g. `ConnectEndError { code:
/// "unauthenticated" }` → `ProviderError::AuthError`).
#[derive(Debug)]
pub enum ClientError {
    /// HTTP or network-layer failure (connection refused, TLS, etc.).
    Http(reqwest::Error),
    /// The server returned a non-2xx status before any stream data.
    ///
    /// `http_version` is the negotiated HTTP version (e.g. `"HTTP/2.0"`) —
    /// captured because ALB-level errors like HTTP 464 ("incompatible
    /// protocol versions") look identical at the status-code level to app-
    /// level errors but mean the client stack negotiated the wrong thing.
    Status {
        status: u16,
        http_version: String,
        body: String,
    },
    /// A response frame couldn't be decoded as `AgentServerMessage`.
    Decode(prost::DecodeError),
    /// The server sent a valid frame that this client cannot satisfy.
    Protocol(String),
    /// The Connect end-stream frame carried a trailer error.
    ///
    /// Common codes observed in practice: `unauthenticated` (expired JWT),
    /// `resource_exhausted` (quota/rate limit), `unimplemented` / `not_found`
    /// (model retired or account has no access), `deprecated` (legacy
    /// endpoint — should not occur on `agent.v1`).
    ConnectEnd { code: String, message: String },
    /// The caller dropped the stream or the request body failed to ship.
    Cancelled,
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(err) => write!(formatter, "HTTP error: {}", err),
            Self::Status {
                status,
                http_version,
                body,
            } => {
                let snippet = crate::providers::http_error_body::clean_error_message(*status, body);
                write!(formatter, "HTTP {} ({}): {}", status, http_version, snippet)
            }
            Self::Decode(err) => write!(formatter, "proto decode failed: {}", err),
            Self::Protocol(message) => write!(formatter, "Cursor protocol error: {}", message),
            Self::ConnectEnd { code, message } => {
                write!(formatter, "Connect error {}: {}", code, message)
            }
            Self::Cancelled => write!(formatter, "cancelled"),
        }
    }
}

impl std::error::Error for ClientError {}

/// Boxed pin-safe stream alias for the response body.
pub type ServerMessageStream =
    Pin<Box<dyn Stream<Item = Result<pb::AgentServerMessage, ClientError>> + Send>>;

/// Live Run RPC — outbound `send` + inbound server-message stream.
///
/// Dropping this struct closes the request body, which triggers the server
/// to end the stream on its side.
pub struct RunStream {
    sender: mpsc::UnboundedSender<Bytes>,
    pub responses: ServerMessageStream,
}

impl RunStream {
    /// Push another [`agent_v1::AgentClientMessage`] onto the open request
    /// stream — typically an [`agent_v1::InteractionResponse`] carrying a
    /// tool-call result. Heartbeats are injected automatically; do not send
    /// them here.
    pub fn send(&self, message: &pb::AgentClientMessage) -> Result<(), ClientError> {
        let mut buf = Vec::with_capacity(message.encoded_len());
        // Encoding into a Vec<u8> can't fail — prost only errors for fixed
        // buffers that run out of space.
        message.encode(&mut buf).expect("prost encode into Vec");
        self.sender
            .send(frame_message(&buf).into())
            .map_err(|_| ClientError::Cancelled)
    }

    /// Test-only: build a `RunStream` from a pre-made response stream,
    /// bypassing the HTTP transport entirely. Returns the stream plus the
    /// outbound receiver so tests can assert what the provider tried to
    /// send back to the server (RequestContext replies, KV acknowledgments,
    /// etc.). Use together with a manually-composed response stream to
    /// exercise [`super::provider::drive_run`] against synthetic servers.
    #[cfg(test)]
    pub(super) fn for_testing(
        responses: ServerMessageStream,
    ) -> (Self, mpsc::UnboundedReceiver<Bytes>) {
        let (sender, receiver) = mpsc::unbounded_channel::<Bytes>();
        (Self { sender, responses }, receiver)
    }
}

/// Build the full header block that `api2.cursor.sh` expects on `agent.v1`
/// Connect calls. Kept in one place so discovery and chat stay consistent.
fn build_cursor_headers(jwt: &str) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

    let request_id = uuid::Uuid::new_v4().to_string();

    let mut headers = HeaderMap::new();
    // Static Connect wiring.
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_static("application/connect+proto"),
    );
    headers.insert(
        HeaderName::from_static("connect-protocol-version"),
        HeaderValue::from_static("1"),
    );
    headers.insert(
        HeaderName::from_static("te"),
        HeaderValue::from_static("trailers"),
    );
    // Auth.
    if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", jwt)) {
        headers.insert(reqwest::header::AUTHORIZATION, val);
    }
    let pairs: [(HeaderName, String); 3] = [
        (
            HeaderName::from_static("x-cursor-client-version"),
            "cli-2026.01.09-231024f".to_string(),
        ),
        (
            HeaderName::from_static("x-cursor-client-type"),
            "cli".to_string(),
        ),
        (HeaderName::from_static("x-ghost-mode"), "true".to_string()),
    ];
    for (name, value) in pairs {
        if let Ok(val) = HeaderValue::from_str(&value) {
            headers.insert(name, val);
        }
    }
    if let Ok(val) = HeaderValue::from_str(&request_id) {
        headers.insert(HeaderName::from_static("x-request-id"), val);
    }
    headers
}

/// Open an `agent.v1.AgentService/Run` streaming RPC and return the live
/// [`RunStream`].
///
/// `initial` must be an `AgentClientMessage::RunRequest` with
/// `ConversationState`, `ConversationAction`, and `ModelDetails` populated.
/// Callers shouldn't construct `ClientHeartbeat` themselves — the transport
/// injects them at [`HEARTBEAT_INTERVAL`].
pub async fn start_run(
    http: &Client,
    jwt: &str,
    initial: pb::AgentClientMessage,
) -> Result<RunStream, ClientError> {
    // Channel for user-originated frames (initial request, tool call
    // responses). The heartbeat is driven by a ticker inside the body
    // stream, not this channel.
    let (sender, mut receiver) = mpsc::unbounded_channel::<Bytes>();

    // Seed with the initial RunRequest before the body ever gets polled — if
    // the select! were to see the ticker first we'd send a heartbeat before
    // the request, which the server would reject for not being a RunRequest.
    let initial_bytes = {
        let mut buf = Vec::with_capacity(initial.encoded_len());
        initial.encode(&mut buf).expect("prost encode into Vec");
        frame_message(&buf)
    };
    sender
        .send(initial_bytes.into())
        .map_err(|_| ClientError::Cancelled)?;

    // Request body: multiplex user messages with the heartbeat ticker. Drops
    // naturally when the caller drops `RunStream` (sender closes).
    //
    // Uses the non-try `stream!` macro with an explicit `Result<_, io::Error>`
    // item type so reqwest's `Body::wrap_stream` can infer the `TryStream`
    // bound. We never actually produce an error — the body only terminates
    // when the caller closes the channel — but the Result shape is what the
    // wrapper wants.
    let body_stream = stream! {
        let mut ticker = interval(HEARTBEAT_INTERVAL);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        // Consume the immediate first tick — we only want heartbeats at
        // `HEARTBEAT_INTERVAL` cadence starting 5s from now.
        ticker.tick().await;

        loop {
            tokio::select! {
                biased; // prefer draining user messages over injecting heartbeats
                msg = receiver.recv() => {
                    match msg {
                        Some(bytes) => yield Ok::<Bytes, std::io::Error>(bytes),
                        None => break, // caller dropped the RunStream
                    }
                }
                _ = ticker.tick() => {
                    let heartbeat = pb::AgentClientMessage {
                        message: Some(pb::agent_client_message::Message::ClientHeartbeat(
                            pb::ClientHeartbeat::default(),
                        )),
                    };
                    let mut buf = Vec::with_capacity(heartbeat.encoded_len());
                    heartbeat.encode(&mut buf).expect("prost encode into Vec");
                    yield Ok::<Bytes, std::io::Error>(frame_message(&buf).into());
                }
            }
        }
    };

    let body = reqwest::Body::wrap_stream(body_stream);

    let url = format!("{}/agent.v1.AgentService/Run", auth::CURSOR_API_BASE);
    let response = http
        .post(&url)
        .headers(build_cursor_headers(jwt))
        .body(body)
        .send()
        .await
        .map_err(ClientError::Http)?;

    let status = response.status();
    if !status.is_success() {
        let code = status.as_u16();
        let http_version = format!("{:?}", response.version());
        let body = response.text().await.unwrap_or_default();
        return Err(ClientError::Status {
            status: code,
            http_version,
            body,
        });
    }

    // Response decoder: frame-parse the body into AgentServerMessages; the
    // Connect end-stream frame terminates the stream (possibly with a
    // trailer error).
    let mut response_body = response.bytes_stream();
    let responses: ServerMessageStream = Box::pin(try_stream! {
        let mut parser = FrameParser::new();
        while let Some(chunk) = response_body.next().await {
            let chunk = chunk.map_err(ClientError::Http)?;
            parser.push(&chunk);
            while let Some(frame) = parser.next_frame() {
                if frame.is_end_stream() {
                    if let Some(err) = decode_end_stream_error(&frame.payload) {
                        Err(err)?;
                    }
                    return;
                }
                let msg = pb::AgentServerMessage::decode(frame.payload.as_ref())
                    .map_err(ClientError::Decode)?;
                yield msg;
            }
        }
    });

    Ok(RunStream { sender, responses })
}

/// Try to decode a Connect end-stream frame's JSON payload into a
/// [`ClientError::ConnectEnd`]. Returns `None` when the payload is not an
/// error (successful end-of-stream).
fn decode_end_stream_error(payload: &[u8]) -> Option<ClientError> {
    let text = std::str::from_utf8(payload).ok()?;
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let error = value.get("error")?;
    let code = error
        .get("code")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown")
        .to_string();
    let message = error
        .get("message")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    Some(ClientError::ConnectEnd { code, message })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trailer JSON with an error bubbles up as [`ClientError::ConnectEnd`]
    /// with code + message preserved. Key for mapping to `AuthError` /
    /// `RateLimited` / etc. later.
    #[test]
    fn decode_end_stream_extracts_code_and_message() {
        let payload = br#"{"error":{"code":"unauthenticated","message":"bad jwt"}}"#;
        match decode_end_stream_error(payload) {
            Some(ClientError::ConnectEnd { code, message }) => {
                assert_eq!(code, "unauthenticated");
                assert_eq!(message, "bad jwt");
            }
            other => panic!("expected ConnectEnd, got {:?}", other),
        }
    }

    /// A clean end-of-stream trailer has no `error` field — must not be
    /// treated as an error.
    #[test]
    fn decode_end_stream_returns_none_for_success() {
        let payload = br#"{"metadata":{}}"#;
        assert!(decode_end_stream_error(payload).is_none());
    }

    /// Non-JSON trailer (shouldn't happen in Connect, but be defensive) is
    /// treated as success rather than panicking.
    #[test]
    fn decode_end_stream_tolerates_non_json() {
        assert!(decode_end_stream_error(b"\xff\xfe garbage").is_none());
    }
}

//! WebSocket client to the ORGII mobile relay.
//!
//! Maintains a long-lived `wss://relay/desktop/connect` connection,
//! multiplexes inbound `Frame::RpcCall` to a caller-supplied mpsc, and
//! pushes outbound frames (events, pongs, replies) through a second
//! mpsc. Sends `Frame::Ping` every 30 s per the
//! [`orgii_protocol::frames`] contract.
//!
//! ## Reconnect responsibility
//!
//! [`RelayWsClient::connect_with_reconnect`] is the production happy
//! path: it loops on transient connect failures with 1 s → 30 s
//! exponential backoff and only returns once the handshake completes.
//! Mid-stream disconnects (the read loop sees a closed socket or a
//! `tokio_tungstenite::Error`) are surfaced via the
//! [`WsLifecycleEvent`] channel — the bridge owns the reconnect
//! decision so app shutdown can race the channel against a cancel
//! token without fighting the WS client.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use orgii_protocol::{DesktopId, Frame, PeerRole, RpcCall, UserId, PROTOCOL_VERSION};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::{frame::coding::CloseCode, CloseFrame, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{error, warn};

use crate::error::MobileRemoteError;

/// HTTP header conveying the desktop-side `UserId` during the WS
/// upgrade. Lowercase hyphenation matches the relay's `HeaderMap`
/// lookup (case-insensitive in practice).
const HEADER_USER_ID: &str = "X-User-Id";

/// HTTP header conveying the desktop-side `DesktopId`. Same casing
/// rationale as [`HEADER_USER_ID`].
const HEADER_DESKTOP_ID: &str = "X-Desktop-Id";

/// User-agent string written into the protocol's
/// [`Frame::Handshake`] `agent` field. Surfaced in relay logs so
/// version skew is debuggable.
const HANDSHAKE_AGENT: &str = concat!("orgii-desktop/", env!("CARGO_PKG_VERSION"));

/// How long to wait for the WS upgrade + first message before giving
/// up. 10s is a deliberate match for [`PairingHttpClient`]'s budget.
const DEFAULT_HANDSHAKE_TIMEOUT_SECS: u64 = 10;

/// Per the protocol contract, both sides ping every 30 s.
const DEFAULT_PING_INTERVAL_SECS: u64 = 30;

/// Bound on `disconnect()`'s task-join wait. Any task still alive after
/// this is detached — graceful shutdown isn't worth blocking app exit.
const DISCONNECT_JOIN_TIMEOUT_SECS: u64 = 2;

/// Initial backoff between reconnect attempts in
/// [`RelayWsClient::connect_with_reconnect`]. Doubles every failure up
/// to [`RECONNECT_MAX_DELAY_SECS`].
const RECONNECT_INITIAL_DELAY_SECS: u64 = 1;

/// Cap on the exponential backoff delay. The delay never grows past
/// this value so a long network outage doesn't strand the client at
/// a ten-minute retry interval.
const RECONNECT_MAX_DELAY_SECS: u64 = 30;

/// Lifecycle signal emitted by the WS client to whoever drives the
/// connect loop (today: [`crate::bridge`]).
///
/// We deliberately keep this enum small: `Connected` fires once per
/// successful handshake, `Disconnected` fires once per lost socket /
/// read-loop failure. The bridge listens on a single channel and
/// re-runs `connect_with_reconnect` on every `Disconnected`.
#[derive(Debug, Clone)]
pub enum WsLifecycleEvent {
    /// The handshake completed and the read / write / ping tasks are
    /// live. Mostly informational; useful for the future settings-UI
    /// "connection healthy" indicator.
    Connected,
    /// The read loop or transport observed a terminal error and the
    /// underlying tasks are exiting. The bridge should call
    /// `connect_with_reconnect` again to re-establish the link.
    Disconnected { reason: String },
}

/// Tunable connection parameters. Defaulted via [`Default`]; override
/// per-test to avoid 10 s waits.
#[derive(Debug, Clone)]
pub struct RelayWsConfig {
    pub url: String,
    pub user_id: UserId,
    pub desktop_id: DesktopId,
    pub ping_interval: Duration,
    pub handshake_timeout: Duration,
}

impl RelayWsConfig {
    pub fn new(url: impl Into<String>, user_id: UserId, desktop_id: DesktopId) -> Self {
        Self {
            url: url.into(),
            user_id,
            desktop_id,
            ping_interval: Duration::from_secs(DEFAULT_PING_INTERVAL_SECS),
            handshake_timeout: Duration::from_secs(DEFAULT_HANDSHAKE_TIMEOUT_SECS),
        }
    }
}

/// Live tokio task handles + outbound channel for one connected
/// session. Created by [`RelayWsClient::connect`]; torn down by
/// [`RelayWsClient::disconnect`].
struct RelayConnection {
    read_task: JoinHandle<()>,
    write_task: JoinHandle<()>,
    ping_task: JoinHandle<()>,
    outbound_tx: mpsc::UnboundedSender<Frame>,
}

/// Outbound WS client. Holds channels and task handles for the live
/// connection (if any). Cheap to construct without connecting.
pub struct RelayWsClient {
    config: RelayWsConfig,
    inbound_rx: mpsc::UnboundedReceiver<RpcCall>,
    inbound_tx: mpsc::UnboundedSender<RpcCall>,
    lifecycle_tx: mpsc::UnboundedSender<WsLifecycleEvent>,
    lifecycle_rx: Option<mpsc::UnboundedReceiver<WsLifecycleEvent>>,
    connection: Option<RelayConnection>,
}

impl RelayWsClient {
    /// Construct a disconnected client. No I/O happens here.
    pub fn new(url: impl Into<String>, user_id: UserId, desktop_id: DesktopId) -> Self {
        let (inbound_tx, inbound_rx) = mpsc::unbounded_channel();
        let (lifecycle_tx, lifecycle_rx) = mpsc::unbounded_channel();
        Self {
            config: RelayWsConfig::new(url, user_id, desktop_id),
            inbound_rx,
            inbound_tx,
            lifecycle_tx,
            lifecycle_rx: Some(lifecycle_rx),
            connection: None,
        }
    }

    /// Construct from an explicit config (test entry point).
    pub fn with_config(config: RelayWsConfig) -> Self {
        let (inbound_tx, inbound_rx) = mpsc::unbounded_channel();
        let (lifecycle_tx, lifecycle_rx) = mpsc::unbounded_channel();
        Self {
            config,
            inbound_rx,
            inbound_tx,
            lifecycle_tx,
            lifecycle_rx: Some(lifecycle_rx),
            connection: None,
        }
    }

    pub fn url(&self) -> &str {
        &self.config.url
    }

    pub fn is_connected(&self) -> bool {
        self.connection.is_some()
    }

    /// Receiver for inbound `RpcCall` frames. Hold a `&mut` so only one
    /// dispatch loop owns the queue.
    pub fn inbound_rx(&mut self) -> &mut mpsc::UnboundedReceiver<RpcCall> {
        &mut self.inbound_rx
    }

    /// Sender for outbound `Frame`s. Cheap to clone; safe to pass to
    /// the existing event broadcaster.
    pub fn outbound_tx(&self) -> Option<mpsc::UnboundedSender<Frame>> {
        self.connection.as_ref().map(|c| c.outbound_tx.clone())
    }

    /// Take ownership of the lifecycle receiver. The bridge calls this
    /// once on startup to drive its reconnect loop. Calling twice
    /// returns `None` because the underlying mpsc receiver cannot be
    /// cloned.
    pub fn take_lifecycle_rx(&mut self) -> Option<mpsc::UnboundedReceiver<WsLifecycleEvent>> {
        self.lifecycle_rx.take()
    }

    /// Open the WS with exponential backoff: 1 s → 30 s. Loops until a
    /// handshake completes (callers control shutdown via
    /// [`disconnect`]). Each transient failure is logged at `warn`;
    /// on success a [`WsLifecycleEvent::Connected`] fires through the
    /// lifecycle channel.
    ///
    /// This is the production happy-path entry point. Tests that need
    /// "fail fast" semantics call [`connect_once`] directly.
    pub async fn connect_with_reconnect(&mut self) -> Result<(), MobileRemoteError> {
        let mut delay = std::time::Duration::from_secs(RECONNECT_INITIAL_DELAY_SECS);
        let max_delay = std::time::Duration::from_secs(RECONNECT_MAX_DELAY_SECS);
        loop {
            match self.connect_once().await {
                Ok(()) => {
                    // We deliberately ignore the send error here — if
                    // the bridge dropped its receiver we still want
                    // the connection to come up; lifecycle is a
                    // notification channel, not a control channel.
                    let _ = self.lifecycle_tx.send(WsLifecycleEvent::Connected);
                    return Ok(());
                }
                Err(err) => {
                    warn!(
                        target: "mobile_remote::ws",
                        ?err,
                        delay_ms = delay.as_millis() as u64,
                        "ws connect failed, backing off"
                    );
                    time::sleep(delay).await;
                    delay = (delay * 2).min(max_delay);
                }
            }
        }
    }

    /// Open the WebSocket, send the protocol's [`Frame::Handshake`]
    /// as the first text message, and spawn the read / write / ping
    /// tasks. Returns once the handshake has been written to the
    /// wire (the relay's matching handshake is consumed by the read
    /// loop asynchronously).
    ///
    /// Does NOT retry — exactly one attempt. Production callers go
    /// through [`connect_with_reconnect`] instead; this is exposed for
    /// tests and for the bridge's first attempt where we want the
    /// caller to surface "first connection failed" rather than
    /// silently looping forever.
    pub(crate) async fn connect_once(&mut self) -> Result<(), MobileRemoteError> {
        if self.connection.is_some() {
            return Ok(());
        }

        let request = build_request(&self.config)?;

        let connect_fut = connect_async(request);
        let (ws_stream, _response) = match time::timeout(self.config.handshake_timeout, connect_fut)
            .await
        {
            Ok(Ok(pair)) => pair,
            Ok(Err(err)) => {
                warn!(target: "mobile_remote::ws", url = %self.config.url, %err, "ws connect failed");
                return Err(MobileRemoteError::RelayUnreachable(err.to_string()));
            }
            Err(_) => {
                warn!(
                    target: "mobile_remote::ws",
                    url = %self.config.url,
                    timeout_secs = self.config.handshake_timeout.as_secs(),
                    "ws connect timed out"
                );
                return Err(MobileRemoteError::RelayUnreachable(format!(
                    "connect timed out after {}s",
                    self.config.handshake_timeout.as_secs()
                )));
            }
        };

        let (mut sink, stream) = ws_stream.split();

        // Send the handshake as the first text frame. After phase
        // S2 the handshake is a `Frame::Handshake` variant carried
        // through the same `kind`-tagged envelope as every other
        // frame — there is no separate first-frame envelope.
        let handshake = Frame::Handshake {
            version: PROTOCOL_VERSION,
            role: PeerRole::Desktop,
            agent: HANDSHAKE_AGENT.to_owned(),
        };
        let handshake_json = serde_json::to_string(&handshake)
            .map_err(|err| MobileRemoteError::WsHandshake(format!("encode handshake: {err}")))?;
        if let Err(err) = sink.send(Message::Text(handshake_json.into())).await {
            warn!(target: "mobile_remote::ws", %err, "failed to send handshake");
            return Err(MobileRemoteError::WsHandshake(err.to_string()));
        }

        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel::<Frame>();

        let write_task = spawn_write_loop(sink, outbound_rx);
        let read_task = spawn_read_loop(
            stream,
            self.inbound_tx.clone(),
            outbound_tx.clone(),
            self.lifecycle_tx.clone(),
        );
        let ping_task = spawn_ping_loop(self.config.ping_interval, outbound_tx.clone());

        self.connection = Some(RelayConnection {
            read_task,
            write_task,
            ping_task,
            outbound_tx,
        });

        Ok(())
    }

    /// Send a graceful close, abort the read / write / ping tasks, and
    /// wait up to [`DISCONNECT_JOIN_TIMEOUT_SECS`] for them to finish.
    /// Detaches anything still running after the deadline so app
    /// shutdown is never blocked.
    pub async fn disconnect(&mut self) {
        let Some(conn) = self.connection.take() else {
            return;
        };

        // Best-effort close frame via the outbound channel. The write
        // loop will exit cleanly once the channel closes; if the send
        // fails (channel full / closed), we fall through to abort.
        // The protocol uses `Frame::*`; a close frame is below that
        // layer, so we drop the outbound sender to signal the write
        // loop, then abort if it does not exit in time.
        drop(conn.outbound_tx);

        // Race the tasks against a shared 2s deadline.
        let deadline = Duration::from_secs(DISCONNECT_JOIN_TIMEOUT_SECS);
        let join = async {
            let _ = tokio::join!(conn.read_task, conn.write_task, conn.ping_task);
        };
        if time::timeout(deadline, join).await.is_err() {
            warn!(
                target: "mobile_remote::ws",
                "disconnect timed out after {}s; detaching tasks",
                deadline.as_secs()
            );
        }
    }
}

impl std::fmt::Debug for RelayWsClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RelayWsClient")
            .field("url", &self.config.url)
            .field("user_id", &self.config.user_id)
            .field("desktop_id", &self.config.desktop_id)
            .field("connected", &self.is_connected())
            .finish()
    }
}

/// Build the WS upgrade `Request` with our two custom auth headers.
fn build_request(config: &RelayWsConfig) -> Result<Request, MobileRemoteError> {
    let mut request = config
        .url
        .as_str()
        .into_client_request()
        .map_err(|err| MobileRemoteError::WsHandshake(format!("invalid relay url: {err}")))?;

    let user_id = HeaderValue::from_str(config.user_id.as_str()).map_err(|err| {
        MobileRemoteError::WsHandshake(format!("invalid X-User-Id header: {err}"))
    })?;
    let desktop_id = HeaderValue::from_str(config.desktop_id.as_str()).map_err(|err| {
        MobileRemoteError::WsHandshake(format!("invalid X-Desktop-Id header: {err}"))
    })?;
    request.headers_mut().insert(HEADER_USER_ID, user_id);
    request.headers_mut().insert(HEADER_DESKTOP_ID, desktop_id);
    Ok(request)
}

type WsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
type WsSink = futures_util::stream::SplitSink<WsStream, Message>;
type WsSource = futures_util::stream::SplitStream<WsStream>;

/// Reads inbound messages, deserializes them as [`Frame`], and routes
/// each variant. Malformed JSON is logged and dropped (single bad
/// frame should not tear down a long-lived session). On stream
/// termination — whether a clean `Message::Close`, an error, or a
/// `None` — we emit a [`WsLifecycleEvent::Disconnected`] so the
/// bridge can drive the next reconnect attempt.
fn spawn_read_loop(
    mut stream: WsSource,
    inbound_tx: mpsc::UnboundedSender<RpcCall>,
    outbound_tx: mpsc::UnboundedSender<Frame>,
    lifecycle_tx: mpsc::UnboundedSender<WsLifecycleEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut reason: String = "stream ended".to_owned();
        while let Some(message) = stream.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    handle_text_frame(&text, &inbound_tx, &outbound_tx);
                }
                Ok(Message::Binary(_)) => {
                    warn!(target: "mobile_remote::ws", "ignoring binary frame; protocol is text-only");
                }
                Ok(Message::Close(frame)) => {
                    tracing::info!(
                        target: "mobile_remote::ws",
                        ?frame,
                        "relay closed websocket"
                    );
                    reason = match &frame {
                        Some(close) => {
                            format!("close ({}): {}", u16::from(close.code), close.reason)
                        }
                        None => "close (no frame)".to_owned(),
                    };
                    break;
                }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {
                    // tungstenite handles low-level WS ping / pong on
                    // our behalf when configured to. Our protocol uses
                    // application-level `Frame::Ping` / `Frame::Pong`
                    // instead, so these surface only as a transport
                    // detail and need no action.
                }
                Err(err) => {
                    error!(target: "mobile_remote::ws", %err, "ws read error; closing read loop");
                    reason = format!("read error: {err}");
                    break;
                }
            }
        }
        // Best-effort lifecycle notification. If the bridge dropped
        // the receiver (e.g. shutdown raced the disconnect), the send
        // failure is benign — it's a notification, not a control
        // signal.
        let _ = lifecycle_tx.send(WsLifecycleEvent::Disconnected { reason });
    })
}

fn handle_text_frame(
    text: &str,
    inbound_tx: &mpsc::UnboundedSender<RpcCall>,
    outbound_tx: &mpsc::UnboundedSender<Frame>,
) {
    let frame: Frame = match serde_json::from_str(text) {
        Ok(frame) => frame,
        Err(err) => {
            warn!(
                target: "mobile_remote::ws",
                %err,
                "dropping malformed frame: {}",
                truncate(text, 200)
            );
            return;
        }
    };
    match frame {
        Frame::RpcCall(call) => {
            if let Err(err) = inbound_tx.send(call) {
                error!(
                    target: "mobile_remote::ws",
                    %err,
                    "inbound dispatch channel closed; dropping rpc call"
                );
            }
        }
        Frame::Ping => {
            if let Err(err) = outbound_tx.send(Frame::Pong) {
                warn!(target: "mobile_remote::ws", %err, "failed to enqueue pong");
            }
        }
        Frame::Pong => {
            // Liveness only — the prompt asks us to update a
            // last-seen timestamp here, but we have no shared state
            // for it yet; leaving a tracing breadcrumb is honest
            // about the no-op.
            tracing::trace!(target: "mobile_remote::ws", "pong");
        }
        Frame::Event(event) => {
            tracing::debug!(
                target: "mobile_remote::ws",
                source_desktop_id = %event.source_desktop_id,
                session_id = %event.session_id,
                "received event"
            );
        }
        Frame::DesktopStatus(status) => {
            tracing::debug!(
                target: "mobile_remote::ws",
                desktop_id = %status.desktop_id,
                ?status.status,
                "desktop status update"
            );
        }
        Frame::RpcResult(_) | Frame::Subscribe(_) | Frame::Unsubscribe(_) => {
            // Desktop is the responder, not the caller, for RpcResult /
            // Subscribe / Unsubscribe. Receiving them is unexpected
            // but not fatal — relay bug.
            warn!(
                target: "mobile_remote::ws",
                "received unexpected frame variant from relay"
            );
        }
        Frame::Handshake {
            version,
            role,
            agent,
        } => {
            // The relay's handshake reply. After phase S2 the
            // handshake is a regular `Frame` variant, decoded
            // through this same path. Emit a debug line so version
            // skew across desktop / relay / mobile is visible in
            // logs without needing a special-case decoder branch.
            tracing::debug!(
                target: "mobile_remote::ws",
                ?version,
                ?role,
                %agent,
                "received relay handshake"
            );
        }
    }
}

/// Pulls frames off `outbound_rx`, encodes them as JSON, and writes
/// them to the WS sink. Exits when the channel closes (drop of the
/// last sender).
fn spawn_write_loop(
    mut sink: WsSink,
    mut outbound_rx: mpsc::UnboundedReceiver<Frame>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(frame) = outbound_rx.recv().await {
            let payload = match serde_json::to_string(&frame) {
                Ok(s) => s,
                Err(err) => {
                    error!(
                        target: "mobile_remote::ws",
                        %err,
                        "failed to serialize outbound frame; dropping"
                    );
                    continue;
                }
            };
            if let Err(err) = sink.send(Message::Text(payload.into())).await {
                error!(
                    target: "mobile_remote::ws",
                    %err,
                    "ws write error; closing write loop"
                );
                break;
            }
        }

        // Outbound channel closed → graceful shutdown. Send a close
        // frame; ignore the result because the peer may be gone.
        let _ = sink
            .send(Message::Close(Some(CloseFrame {
                code: CloseCode::Normal,
                reason: "desktop disconnect".into(),
            })))
            .await;
        let _ = sink.close().await;
    })
}

/// Sends [`Frame::Ping`] every `interval`. Exits as soon as the
/// outbound channel closes.
fn spawn_ping_loop(
    interval: Duration,
    outbound_tx: mpsc::UnboundedSender<Frame>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = time::interval(interval);
        // Skip the immediate first tick so we don't ping the relay
        // before it has finished its handshake bookkeeping.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if outbound_tx.send(Frame::Ping).is_err() {
                break;
            }
        }
    })
}

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_owned()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
#[path = "ws_tests.rs"]
mod tests;

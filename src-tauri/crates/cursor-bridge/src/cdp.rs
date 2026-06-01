//! Minimal Chrome DevTools Protocol client.
//!
//! Speaks just enough CDP to:
//!  1. Discover available targets via `GET /json/list`.
//!  2. Open a WebSocket to a target's `webSocketDebuggerUrl`.
//!  3. Send `Runtime.evaluate` requests and parse responses.
//!
//! ## Why not a CDP crate from crates.io?
//!
//! Most existing CDP crates target browser automation (Puppeteer-style)
//! and pull in headless-chrome / Playwright-style abstractions plus
//! ~50 generated method bindings we don't need. We use exactly one
//! method (`Runtime.evaluate`) against Node's V8 inspector — the
//! 200-line subset below is enough and lets us iterate on the wire
//! format without fighting a third-party type system that assumes
//! Chrome semantics.
//!
//! ## Inspector vs Chromium DevTools
//!
//! Cursor's `--inspect-extensions=<port>` flag opens **Node's V8
//! inspector** (`node --inspect`-style), not Chromium's remote
//! debugging endpoint. The two speak the same JSON-RPC framing but
//! expose different domains:
//!
//!  - V8 inspector: `Runtime.*`, `Debugger.*`, `Profiler.*`, `HeapProfiler.*`.
//!  - Chromium DevTools: all of the above PLUS `Page.*`, `DOM.*`,
//!    `Network.*`, `Target.*`.
//!
//! `Runtime.evaluate` is in both, so this client works against either.
//! When Phase 2 wants renderer-side eval (e.g. `--remote-debugging-port`
//! against the Cursor workbench), the same code applies.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};
use tracing::{debug, trace, warn};

use crate::error::{CdpError, Result};

// ───────────────────────── Discovery ─────────────────────────

/// One entry from `/json/list`.
///
/// Fields not modeled (`description`, `devtoolsFrontendUrl`,
/// `faviconUrl`, `parentId`, `browserContextId`) are ignored — the
/// inspector ships them but we don't need them for `Runtime.evaluate`.
#[derive(Debug, Clone, Deserialize)]
pub struct Target {
    pub id: String,
    #[serde(rename = "type")]
    pub target_type: TargetType,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub ws_url: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetType {
    /// Node.js process inspected via `--inspect[=port]`. The extension
    /// host shows up here when Cursor is launched with
    /// `--inspect-extensions=<port>`.
    Node,
    /// Chromium-tab target. Only seen when using
    /// `--remote-debugging-port=<port>` instead of the V8 inspector.
    Page,
    /// Service worker / shared worker / dedicated worker.
    ServiceWorker,
    SharedWorker,
    Worker,
    /// Catch-all for inspector versions / debugger types we don't
    /// model; serde maps unknown variants here so we don't break on
    /// new entries.
    #[serde(other)]
    Other,
}

/// Hit `http://127.0.0.1:<port>/json/list` and parse the inspector's
/// target list.
///
/// `host` is configurable so a future Phase-2 over-ssh project can point
/// at a forwarded port; today the probe always passes `"127.0.0.1"`.
pub async fn discover_targets(
    client: &reqwest::Client,
    host: &str,
    port: u16,
) -> Result<Vec<Target>> {
    let endpoint = format!("http://{host}:{port}/json/list");
    debug!(%endpoint, "discovering CDP targets");

    let response =
        client
            .get(&endpoint)
            .send()
            .await
            .map_err(|source| CdpError::DiscoveryHttp {
                endpoint: endpoint.clone(),
                source,
            })?;

    let body = response
        .text()
        .await
        .map_err(|source| CdpError::DiscoveryHttp {
            endpoint: endpoint.clone(),
            source,
        })?;

    serde_json::from_str(&body).map_err(|source| CdpError::DiscoveryParse { endpoint, source })
}

// ─────────────────────── Wire format ───────────────────────

#[derive(Debug, Serialize)]
struct CdpRequest<'a> {
    id: u64,
    method: &'a str,
    params: serde_json::Value,
}

/// CDP responses look like one of these three shapes:
///
///  - `{ id, result: {...} }`       — successful method call.
///  - `{ id, error: { code, message } }` — protocol-level rejection.
///  - `{ method, params }`          — server-initiated event (e.g.
///    `Runtime.executionContextCreated`).
///
/// We dispatch by which fields are present; serde's `untagged` enum
/// machinery would technically work but produces awful error messages
/// when none of the variants match, so we parse to `Value` first and
/// fan out manually.
#[derive(Debug, Deserialize)]
struct RawCdpResponse {
    id: Option<u64>,
    result: Option<serde_json::Value>,
    error: Option<CdpProtocolError>,
    /// Server-pushed event method (e.g. `Runtime.executionContextCreated`).
    method: Option<String>,
    /// Payload of server-pushed events (e.g. `Runtime.bindingCalled` payload).
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct CdpProtocolError {
    code: i64,
    message: String,
}

// ─────────────────────── Runtime.evaluate ───────────────────────

#[derive(Debug, Serialize)]
struct EvaluateParams<'a> {
    expression: &'a str,
    /// Wait for the expression's promise (if any) to resolve before
    /// returning. We almost always want this.
    #[serde(rename = "awaitPromise")]
    await_promise: bool,
    /// Whether to inline the result value into the response, vs.
    /// returning a remote object id we'd have to dereference. `true`
    /// means "give me JSON", which is what we want for ~all probe
    /// queries.
    #[serde(rename = "returnByValue")]
    return_by_value: bool,
    /// `true` causes V8 to *not* halt on uncaught exceptions in the
    /// expression — we get the exception in the response instead. Set
    /// to `true` so a thrown `ReferenceError` doesn't pause the
    /// extension host.
    #[serde(rename = "silent")]
    silent: bool,
    /// Timeout in ms. CDP rejects calls running past this with a
    /// `Runtime.terminateExecution`-style failure. 30s is generous;
    /// real composer ops should be sub-second.
    #[serde(rename = "timeout")]
    timeout_ms: u64,
}

/// What V8 returns from a successful `Runtime.evaluate`. Matches
/// `Runtime.RemoteObject` but only the fields we use.
#[derive(Debug, Clone, Deserialize)]
pub struct EvalResult {
    /// `"object" | "function" | "string" | "number" | "boolean" | "undefined" | "symbol" | "bigint"`
    #[serde(rename = "type", default)]
    pub kind: String,
    /// Present when `returnByValue: true`. May be `null`/missing when
    /// the expression returned `undefined`.
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    /// Best-effort string description ("null", "undefined",
    /// "Promise<pending>", etc.). Useful for log lines.
    #[serde(default)]
    pub description: Option<String>,
}

/// V8 exception details, returned alongside `result` when an
/// expression threw. We expose this as a *separate* outcome from
/// `EvalResult` because the difference between "expression returned
/// `undefined`" and "expression threw" is meaningful at the call site.
#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeException {
    #[serde(default)]
    pub text: String,
    /// V8's `RemoteObject` for the exception. We surface its
    /// `description` (the stringified Error) since that's the most
    /// useful single field for debugging.
    #[serde(default)]
    pub exception: Option<EvalResult>,
    #[serde(rename = "lineNumber", default)]
    pub line_number: i64,
    #[serde(rename = "columnNumber", default)]
    pub column_number: i64,
}

#[derive(Debug, Deserialize)]
struct EvaluateResponse {
    result: EvalResult,
    #[serde(rename = "exceptionDetails", default)]
    exception_details: Option<RuntimeException>,
}

// ─────────────────────── Client ───────────────────────

/// Outcome of a `Runtime.evaluate` call.
///
/// `Ok(EvalResult)` = the expression evaluated to a value.
/// `Err(RuntimeException)` = the expression threw at runtime.
/// Transport-level failures escape as `CdpError` from the surrounding
/// `Result`.
pub type EvalOutcome = std::result::Result<EvalResult, RuntimeException>;

/// CDP client over a single WebSocket connection.
///
/// Owned by the caller's task. Spawns one background task internally
/// to drive the WS read loop and dispatch responses to pending
/// requests by `id`. Drop the client to close the connection.
///
/// Event subscriptions (e.g. `Runtime.bindingCalled`) are supported via
/// [`on_event`][CdpClient::on_event]. Each call registers a channel that
/// receives the `params` payload whenever the named event arrives.
pub struct CdpClient {
    next_id: AtomicU64,
    outbound: mpsc::UnboundedSender<Message>,
    pending: PendingMap,
    event_senders: EventSenderMap,
    /// Default timeout applied to every request. Override via
    /// `evaluate_with_timeout`.
    default_timeout: Duration,
}

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<RawCdpResponse>>>>;
type EventSenderMap = Arc<Mutex<HashMap<String, Vec<mpsc::UnboundedSender<Value>>>>>;

impl CdpClient {
    /// Connect to a target's `webSocketDebuggerUrl`.
    pub async fn connect(ws_url: &str) -> Result<Self> {
        let request = ws_url
            .into_client_request()
            .map_err(|source| CdpError::WsHandshake {
                url: ws_url.to_string(),
                source: Box::new(source),
            })?;

        let (ws, _response) =
            tokio_tungstenite::connect_async(request)
                .await
                .map_err(|source| CdpError::WsHandshake {
                    url: ws_url.to_string(),
                    source: Box::new(source),
                })?;

        Ok(Self::from_socket(ws))
    }

    fn from_socket(ws: WebSocketStream<MaybeTlsStream<TcpStream>>) -> Self {
        let (tx, rx) = mpsc::unbounded_channel::<Message>();
        let pending: PendingMap = Default::default();
        let event_senders: EventSenderMap = Default::default();

        let pending_for_loop = pending.clone();
        let event_senders_for_loop = event_senders.clone();
        tokio::spawn(read_write_loop(
            ws,
            rx,
            pending_for_loop,
            event_senders_for_loop,
        ));

        Self {
            next_id: AtomicU64::new(1),
            outbound: tx,
            pending,
            event_senders,
            default_timeout: Duration::from_secs(30),
        }
    }

    /// Register a listener for a named CDP server-push event.
    ///
    /// Returns a receiver that yields the `params` payload of each
    /// matching event. Multiple calls with the same `method` each get
    /// their own independent channel (fanout).
    ///
    /// The receiver is automatically cleaned up when it is dropped —
    /// the send loop silently removes dead senders.
    pub fn on_event(&self, method: &str) -> mpsc::UnboundedReceiver<Value> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.event_senders
            .lock()
            .expect("event_senders mutex poisoned")
            .entry(method.to_string())
            .or_default()
            .push(tx);
        rx
    }

    /// Call `Runtime.addBinding` to register `name` as a callable
    /// binding in the inspected JS context. Once registered, calling
    /// `window.<name>(payload)` from JS fires a
    /// `Runtime.bindingCalled` event that [`on_event`] subscribers
    /// receive.
    pub async fn add_binding(&self, name: &str) -> Result<()> {
        self.call("Runtime.addBinding", serde_json::json!({ "name": name }))
            .await?;
        Ok(())
    }

    /// Override the default per-request timeout. Mostly useful for the
    /// probe binary's `--timeout` flag.
    pub fn set_default_timeout(&mut self, timeout: Duration) {
        self.default_timeout = timeout;
    }

    /// Run a JavaScript expression in the inspected context.
    ///
    /// `awaitPromise` is unconditionally `true` — if the expression
    /// returns a promise, we wait on it; if it returns a value, we get
    /// the value. This avoids a class of "I forgot to `await`" probe
    /// bugs.
    pub async fn evaluate(&self, expression: &str) -> Result<EvalOutcome> {
        self.evaluate_with_timeout(expression, self.default_timeout)
            .await
    }

    pub async fn evaluate_with_timeout(
        &self,
        expression: &str,
        per_request_timeout: Duration,
    ) -> Result<EvalOutcome> {
        let raw = self
            .call_raw_with_timeout(
                "Runtime.evaluate",
                serde_json::to_value(EvaluateParams {
                    expression,
                    await_promise: true,
                    return_by_value: true,
                    silent: true,
                    timeout_ms: per_request_timeout.as_millis().min(u64::MAX as u128) as u64,
                })
                .expect("EvaluateParams always serializes"),
                per_request_timeout,
            )
            .await?;

        let parsed: EvaluateResponse =
            serde_json::from_value(raw.clone()).map_err(|source| CdpError::MalformedResponse {
                context: format!("could not deserialize EvaluateResponse: {source}"),
                body: raw.to_string(),
            })?;

        match parsed.exception_details {
            Some(ex) => Ok(Err(ex)),
            None => Ok(Ok(parsed.result)),
        }
    }

    /// Send an arbitrary CDP method (e.g. `Input.insertText`,
    /// `Input.dispatchKeyEvent`) and return the raw `result` JSON.
    ///
    /// `Runtime.evaluate` is wrapped by [`evaluate`] for ergonomics, but
    /// driving the chat input requires real input events that go
    /// through the `Input` domain — those land here.
    pub async fn call(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value> {
        self.call_raw_with_timeout(method, params, self.default_timeout)
            .await
    }

    async fn call_raw_with_timeout(
        &self,
        method: &str,
        params: serde_json::Value,
        per_request_timeout: Duration,
    ) -> Result<serde_json::Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        trace!(%id, %method, "CDP call");

        let request = CdpRequest { id, method, params };
        let body = serde_json::to_string(&request).expect("CDP request always serializes");

        let (response_tx, response_rx) = oneshot::channel();
        self.pending
            .lock()
            .expect("pending map mutex poisoned")
            .insert(id, response_tx);

        self.outbound
            .send(Message::Text(body.into()))
            .map_err(|_| CdpError::ConnectionClosed { request_id: id })?;

        let raw = match timeout(per_request_timeout, response_rx).await {
            Ok(Ok(raw)) => raw,
            Ok(Err(_)) => return Err(CdpError::ConnectionClosed { request_id: id }),
            Err(_) => {
                self.pending
                    .lock()
                    .expect("pending map mutex poisoned")
                    .remove(&id);
                return Err(CdpError::Timeout {
                    request_id: id,
                    timeout_ms: per_request_timeout.as_millis() as u64,
                });
            }
        };

        if let Some(error) = raw.error {
            return Err(CdpError::ProtocolError {
                code: error.code,
                message: error.message,
            });
        }

        raw.result.ok_or_else(|| CdpError::MalformedResponse {
            context: format!("{method} response missing both `result` and `error`"),
            body: "<lost — only RawCdpResponse retained>".to_string(),
        })
    }
}

async fn read_write_loop(
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    mut outbound_rx: mpsc::UnboundedReceiver<Message>,
    pending: PendingMap,
    event_senders: EventSenderMap,
) {
    let (mut ws_write, mut ws_read) = ws.split();

    loop {
        tokio::select! {
            // Outbound: forward queued requests onto the wire.
            maybe_msg = outbound_rx.recv() => {
                match maybe_msg {
                    Some(msg) => {
                        if let Err(err) = ws_write.send(msg).await {
                            warn!(?err, "CDP write failed; closing read loop");
                            break;
                        }
                    }
                    None => {
                        // Client dropped — close cleanly.
                        let _ = ws_write.close().await;
                        break;
                    }
                }
            }
            // Inbound: parse, dispatch by id or event method.
            maybe_frame = ws_read.next() => {
                match maybe_frame {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<RawCdpResponse>(&text) {
                            Ok(raw) => {
                                if let Some(id) = raw.id {
                                    let waker = pending
                                        .lock()
                                        .expect("pending map mutex poisoned")
                                        .remove(&id);
                                    if let Some(tx) = waker {
                                        let _ = tx.send(raw);
                                    } else {
                                        debug!(%id, "received CDP response with unknown id; dropping");
                                    }
                                } else if let Some(ref method) = raw.method {
                                    // Server-pushed event: fan out to registered listeners.
                                    let params = raw.params.unwrap_or(Value::Null);
                                    let mut guard = event_senders
                                        .lock()
                                        .expect("event_senders mutex poisoned");
                                    if let Some(senders) = guard.get_mut(method) {
                                        // Retain only live senders; drop dead ones.
                                        senders.retain(|tx| {
                                            tx.send(params.clone()).is_ok()
                                        });
                                    } else {
                                        trace!(%method, "CDP event with no listeners; dropping");
                                    }
                                }
                            }
                            Err(err) => {
                                warn!(?err, body = %text, "could not parse CDP frame");
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        debug!("CDP WS closed");
                        break;
                    }
                    Some(Ok(_)) => { /* ignore Binary/Ping/Pong/Frame */ }
                    Some(Err(err)) => {
                        warn!(?err, "CDP WS read error");
                        break;
                    }
                }
            }
        }
    }

    // Wake any still-pending requests so they fail fast instead of
    // timing out.
    let mut guard = pending.lock().expect("pending map mutex poisoned");
    guard.clear();
}

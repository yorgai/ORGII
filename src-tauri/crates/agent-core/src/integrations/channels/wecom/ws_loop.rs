//! Long-lived WebSocket task for WeCom: connect → authenticate → read/write loop → reconnect.
//!
//! Owns no shared state directly — all reply-correlation goes through
//! [`super::protocol::WeComState`] held behind a `Mutex`.

use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{debug, info, warn};

use super::inbound::on_inbound_message;
use super::outbound::send_outbound;
use super::protocol::{
    new_req_id, payload_req_id, WeComState, APP_CMD_CALLBACK, APP_CMD_LEGACY_CALLBACK,
    APP_CMD_PING, APP_CMD_SUBSCRIBE, HANDSHAKE_TIMEOUT_SECS, HEARTBEAT_SECS,
    RECONNECT_BACKOFF_SECS,
};
use crate::bus::{InboundMessage, OutboundMessage};

#[allow(clippy::too_many_arguments)]
pub(super) async fn wecom_ws_loop(
    ws_url: String,
    bot_id: String,
    secret: String,
    dm_policy: String,
    allow_from: Vec<String>,
    group_policy: String,
    group_allow_from: Vec<String>,
    running: Arc<AtomicBool>,
    ws_connected: Arc<AtomicBool>,
    last_error: Arc<RwLock<Option<String>>>,
    state: Arc<Mutex<WeComState>>,
    inbound_tx: mpsc::Sender<InboundMessage>,
    mut outbound_rx: mpsc::Receiver<OutboundMessage>,
    channel_name: String,
) {
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let mut backoff_idx = 0usize;

    while running.load(Ordering::Relaxed) {
        let (ws_stream, _) = match connect_async(&ws_url).await {
            Ok(pair) => pair,
            Err(err) => {
                let msg = format!("WeCom WS connect failed: {}", err);
                warn!("[{}] {}", channel_name, msg);
                *last_error.write().await = Some(msg);
                ws_connected.store(false, Ordering::Relaxed);

                let delay =
                    RECONNECT_BACKOFF_SECS[backoff_idx.min(RECONNECT_BACKOFF_SECS.len() - 1)];
                backoff_idx += 1;
                tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                continue;
            }
        };

        use futures_util::{SinkExt, StreamExt};
        let (mut sink, mut stream) = ws_stream.split();

        // ── Authenticate ────────────────────────────────────────────────────
        let sub_req_id = new_req_id("subscribe");
        let subscribe_payload = serde_json::json!({
            "cmd": APP_CMD_SUBSCRIBE,
            "headers": { "req_id": sub_req_id },
            "body": { "bot_id": bot_id, "secret": secret },
        });

        if let Err(err) = sink
            .send(Message::Text(subscribe_payload.to_string().into()))
            .await
        {
            warn!("[{}] Failed to send subscribe: {}", channel_name, err);
            backoff_idx += 1;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            continue;
        }

        let ack_result = tokio::time::timeout(
            std::time::Duration::from_secs(HANDSHAKE_TIMEOUT_SECS),
            wait_for_subscribe_ack(&mut stream, &sub_req_id),
        )
        .await;

        match ack_result {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                warn!("[{}] Subscribe failed: {}", channel_name, err);
                *last_error.write().await = Some(err);
                backoff_idx += 1;
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
            Err(_) => {
                warn!("[{}] Subscribe timed out", channel_name);
                backoff_idx += 1;
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        }

        info!("[{}] Connected and authenticated", channel_name);
        ws_connected.store(true, Ordering::Relaxed);
        *last_error.write().await = None;
        backoff_idx = 0;

        // Shared sink for heartbeat and outbound sender.
        let sink = Arc::new(tokio::sync::Mutex::new(sink));

        // ── Heartbeat task ───────────────────────────────────────────────────
        let hb_running = running.clone();
        let hb_sink = sink.clone();
        let hb_channel = channel_name.clone();
        let heartbeat_handle = tokio::spawn(async move {
            while hb_running.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_secs(HEARTBEAT_SECS)).await;
                if !hb_running.load(Ordering::Relaxed) {
                    break;
                }
                let ping = serde_json::json!({
                    "cmd": APP_CMD_PING,
                    "headers": { "req_id": new_req_id("ping") },
                    "body": {},
                });
                let mut s = hb_sink.lock().await;
                if let Err(err) = s.send(Message::Text(ping.to_string().into())).await {
                    debug!("[{}] Heartbeat send failed: {}", hb_channel, err);
                    break;
                }
            }
        });

        // ── Read + outbound loop ─────────────────────────────────────────────
        let mut connection_ok = true;
        while running.load(Ordering::Relaxed) {
            tokio::select! {
                biased;

                frame = tokio::time::timeout(
                    std::time::Duration::from_secs(90),
                    stream.next(),
                ) => {
                    let msg_opt = match frame {
                        Ok(Some(Ok(msg))) => msg,
                        Ok(Some(Err(err))) => {
                            warn!("[{}] WS error: {}", channel_name, err);
                            connection_ok = false;
                            break;
                        }
                        Ok(None) => {
                            warn!("[{}] WS stream closed", channel_name);
                            connection_ok = false;
                            break;
                        }
                        Err(_) => {
                            warn!("[{}] WS read timeout, reconnecting", channel_name);
                            connection_ok = false;
                            break;
                        }
                    };

                    let text = match msg_opt {
                        Message::Text(text) => text,
                        Message::Close(_) => {
                            info!("[{}] WS close frame received", channel_name);
                            connection_ok = false;
                            break;
                        }
                        _ => continue,
                    };

                    let payload: Value = match serde_json::from_str(&text) {
                        Ok(v) => v,
                        Err(err) => {
                            warn!(
                                "[{}] Dropped WS frame: invalid JSON payload: {} (frame head: {:?})",
                                channel_name,
                                err,
                                crate::utils::safe_truncate_chars(text, 120).to_string(),
                            );
                            continue;
                        }
                    };

                    let cmd = payload
                        .get("cmd")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string();

                    if cmd == APP_CMD_PING {
                        continue;
                    }

                    if cmd == APP_CMD_CALLBACK || cmd == APP_CMD_LEGACY_CALLBACK {
                        on_inbound_message(
                            &payload,
                            &dm_policy,
                            &allow_from,
                            &group_policy,
                            &group_allow_from,
                            &state,
                            &inbound_tx,
                            &channel_name,
                        )
                        .await;
                    }
                }

                outbound = outbound_rx.recv() => {
                    let Some(msg) = outbound else {
                        info!("[{}] Outbound channel closed", channel_name);
                        break;
                    };
                    if let Err(err) =
                        send_outbound(&sink, &state, &msg, &channel_name).await
                    {
                        warn!("[{}] Outbound send failed: {}", channel_name, err);
                    }
                }
            }
        }

        heartbeat_handle.abort();
        ws_connected.store(false, Ordering::Relaxed);

        if !running.load(Ordering::Relaxed) {
            break;
        }

        if connection_ok {
            break;
        }

        let delay = RECONNECT_BACKOFF_SECS[backoff_idx.min(RECONNECT_BACKOFF_SECS.len() - 1)];
        backoff_idx += 1;
        warn!("[{}] Reconnecting in {}s...", channel_name, delay);
        tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
    }

    info!("[{}] WS loop exited", channel_name);
}

async fn wait_for_subscribe_ack<S>(stream: &mut S, req_id: &str) -> Result<(), String>
where
    S: futures_util::StreamExt<
            Item = Result<
                tokio_tungstenite::tungstenite::Message,
                tokio_tungstenite::tungstenite::Error,
            >,
        > + Unpin,
{
    use tokio_tungstenite::tungstenite::Message;
    loop {
        match stream.next().await {
            Some(Ok(Message::Text(text))) => {
                let payload: Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(err) => {
                        warn!(
                            "wait_for_subscribe_ack: dropped WS frame, invalid JSON: {} \
                             (frame head: {:?})",
                            err,
                            crate::utils::safe_truncate_chars(text, 120).to_string(),
                        );
                        continue;
                    }
                };
                let cmd = payload.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
                if cmd == APP_CMD_PING {
                    continue;
                }
                let resp_req_id = payload_req_id(&payload);
                if resp_req_id != req_id {
                    continue;
                }
                let errcode = payload.get("errcode").and_then(|e| e.as_i64()).unwrap_or(0);
                if errcode != 0 {
                    let errmsg = payload
                        .get("errmsg")
                        .and_then(|m| m.as_str())
                        .unwrap_or("authentication failed");
                    return Err(format!(
                        "WeCom subscribe failed (errcode={}): {}",
                        errcode, errmsg
                    ));
                }
                return Ok(());
            }
            Some(Ok(Message::Close(_))) | None => {
                return Err("WS closed during authentication".into());
            }
            Some(Err(err)) => {
                return Err(format!("WS error during authentication: {}", err));
            }
            _ => continue,
        }
    }
}

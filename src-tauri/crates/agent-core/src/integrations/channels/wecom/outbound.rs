//! Outbound message framing for WeCom AI Bot WebSocket.
//!
//! If we have a pending inbound `req_id` for the chat, we use
//! `aibot_respond_msg` for a correlated in-thread reply; otherwise we fall
//! back to `aibot_send_msg` for a proactive message.

use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::debug;

use super::protocol::{new_req_id, WeComState, MAX_MESSAGE_LEN};
use crate::bus::OutboundMessage;

pub(super) type WsSink = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    tokio_tungstenite::tungstenite::Message,
>;

pub(super) async fn send_outbound(
    sink: &Arc<Mutex<WsSink>>,
    state: &Arc<Mutex<WeComState>>,
    msg: &OutboundMessage,
    channel_name: &str,
) -> Result<(), String> {
    use futures_util::SinkExt;
    use tokio_tungstenite::tungstenite::Message;

    let reply_to = {
        let mut st = state.lock().await;
        st.take(&msg.chat_id)
    };

    // Clip to WeCom's text limit at a UTF-8 boundary.
    let content = clip_utf8(&msg.content, MAX_MESSAGE_LEN);

    let (cmd, headers, body) = if let Some(req_id) = reply_to.as_ref() {
        let out_req_id = new_req_id("respond");
        let headers = serde_json::json!({
            "req_id": out_req_id,
            "reply_to": req_id,
        });
        let body = serde_json::json!({
            "msgtype": "markdown",
            "markdown": { "content": content },
        });
        ("aibot_respond_msg", headers, body)
    } else {
        let out_req_id = new_req_id("send");
        let headers = serde_json::json!({ "req_id": out_req_id });
        let body = serde_json::json!({
            "chatid": msg.chat_id,
            "msgtype": "markdown",
            "markdown": { "content": content },
        });
        ("aibot_send_msg", headers, body)
    };

    let payload = serde_json::json!({
        "cmd": cmd,
        "headers": headers,
        "body": body,
    });

    let mut s = sink.lock().await;
    s.send(Message::Text(payload.to_string().into()))
        .await
        .map_err(|err| format!("WS send failed: {}", err))?;

    debug!(
        "[{}] Sent outbound via {} (chat_id={}, len={})",
        channel_name,
        cmd,
        msg.chat_id,
        content.chars().count()
    );
    Ok(())
}

fn clip_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

//! WeCom (Enterprise WeChat) channel implementation.
//!
//! Connects to the WeCom AI Bot WebSocket gateway:
//! - Authenticates via `aibot_subscribe`
//! - Receives inbound messages via `aibot_msg_callback`
//! - Sends outbound markdown via `aibot_send_msg` (proactive) or
//!   `aibot_respond_msg` (correlated reply to the inbound request id)
//! - Sends application-level `ping` heartbeats every 30 seconds
//!
//! ## Submodules
//! - [`protocol`] — wire-level constants, req_id helpers, reply-correlation state
//! - [`channel`]  — `WeComChannel` struct + `Channel` trait impl (start/stop/send)
//! - [`ws_loop`]  — long-lived WebSocket task (connect, auth, read/write select loop)
//! - [`inbound`]  — payload parsing, policy gating, text extraction
//! - [`outbound`] — outbound framing (`aibot_send_msg` vs `aibot_respond_msg`) + UTF-8 clipping

mod channel;
mod inbound;
mod outbound;
mod protocol;
mod ws_loop;

pub use channel::WeComChannel;

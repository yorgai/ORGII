//! Feishu/Lark channel implementation.
//!
//! Connects to Feishu via WebSocket long connection for receiving messages
//! and uses the REST API for sending responses.
//!
//! The WebSocket protocol uses binary protobuf frames (pbbp2.proto from the
//! official Go SDK). We hand-code a minimal protobuf codec to avoid pulling
//! in prost + build.rs for just two tiny messages (Header, Frame).

mod api;
mod auth;
mod channel;
mod codec;
mod event;
mod ws;

// `FeishuChannel` is the only item external callers reach for —
// `gateway::channels_ops::register_enabled_channels` constructs it via
// `feishu::FeishuChannel`. The auth helper and upload helpers stay
// behind the `feishu::auth::*` / `feishu::api::*` paths and are
// pub(super) inside the module.
pub use channel::FeishuChannel;

#[cfg(test)]
#[path = "../tests/feishu_codec_tests.rs"]
mod codec_tests;

#[cfg(test)]
#[path = "../tests/feishu_event_tests.rs"]
mod event_tests;

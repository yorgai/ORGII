//! Chat channel integrations module.
//!
//! Provides `Channel` implementations for the messaging platforms below.
//! Canonical `channel_type` identifiers live in
//! [`config::channel_type`] — never compare against raw string literals.
//!
//! **Wired (registered in
//! [`crate::integrations::gateway::channels_ops::register_enabled_channels`]):**
//! Telegram, Discord, Feishu, WeCom, and Weixin.
//!
//! Other channel types appear in [`config::channel_type`] (Slack, WhatsApp,
//! iMessage, Signal, DingTalk, Zalo, LINE, MS Teams, Matrix, Google Chat,
//! Email) for the integrations UI's account/probe form, but they have no
//! `Channel` implementation here yet — the previous stub impls were
//! removed because nothing registered them. To wire one, add the impl
//! file, expose it from this module, and add a registration arm in
//! `register_enabled_channels` and `build_channel_for_toggle`.

pub mod config;
#[cfg(debug_assertions)]
pub mod debug_tap;
pub mod delivery;
pub mod discord;
pub mod feishu;
pub mod manager;
pub mod probe;
pub mod telegram;
pub mod traits;
pub mod wecom;
pub mod weixin;

pub use manager::ChannelManager;
pub use traits::Channel;

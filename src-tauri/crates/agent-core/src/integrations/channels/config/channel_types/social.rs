//! Social messaging channel configs: Telegram, Discord, WhatsApp, Signal, iMessage.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Telegram ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
    /// Optional outbound proxy URL (HTTP / SOCKS5) for Telegram Bot API.
    /// Wired via `build_http_client_with_proxy` when the channel is
    /// constructed; supports `http://`, `https://`, `socks5://`, and
    /// `socks5h://` schemes. Empty / `None` means direct connection.
    pub proxy: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramConfig {
    #[serde(default)]
    pub accounts: HashMap<String, TelegramAccountConfig>,
}

// ── Discord ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
    #[serde(default = "default_discord_gateway")]
    pub gateway_url: String,
    /// Discord Gateway intents bitmask forwarded into the identify
    /// payload. Default resolves to `37377` — `GUILDS`, `GUILD_MESSAGES`,
    /// `DIRECT_MESSAGES`, and `MESSAGE_CONTENT` — via `default_discord_intents()`.
    #[serde(default = "default_discord_intents")]
    pub intents: u64,
}

fn default_discord_gateway() -> String {
    "wss://gateway.discord.gg/?v=10&encoding=json".to_string()
}

fn default_discord_intents() -> u64 {
    37377 // GUILDS + GUILD_MESSAGES + DIRECT_MESSAGES + MESSAGE_CONTENT
}

impl Default for DiscordAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            token: String::new(),
            allow_from: Vec::new(),
            gateway_url: default_discord_gateway(),
            intents: default_discord_intents(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordConfig {
    #[serde(default)]
    pub accounts: HashMap<String, DiscordAccountConfig>,
}

// ── WhatsApp ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_whatsapp_bridge")]
    pub bridge_url: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

fn default_whatsapp_bridge() -> String {
    "ws://localhost:3001".to_string()
}

impl Default for WhatsAppAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bridge_url: default_whatsapp_bridge(),
            allow_from: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppConfig {
    #[serde(default)]
    pub accounts: HashMap<String, WhatsAppAccountConfig>,
}

// ── Signal ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub phone_number: String,
    #[serde(default = "default_signal_api")]
    pub api_url: String,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub send_read_receipts: bool,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

fn default_signal_api() -> String {
    "http://localhost:8080".to_string()
}

impl Default for SignalAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            phone_number: String::new(),
            api_url: default_signal_api(),
            auto_start: false,
            send_read_receipts: false,
            allow_from: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalConfig {
    #[serde(default)]
    pub accounts: HashMap<String, SignalAccountConfig>,
}

// ── iMessage ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IMessageAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_imessage_server")]
    pub server_url: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_imessage_service")]
    pub service: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

fn default_imessage_server() -> String {
    "http://localhost:1234".to_string()
}

fn default_imessage_service() -> String {
    "auto".to_string()
}

impl Default for IMessageAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            server_url: default_imessage_server(),
            password: String::new(),
            service: default_imessage_service(),
            region: String::new(),
            allow_from: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IMessageConfig {
    #[serde(default)]
    pub accounts: HashMap<String, IMessageAccountConfig>,
}

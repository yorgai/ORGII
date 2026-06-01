//! Channel configuration structs.
//!
//! Each messaging channel (Telegram, Discord, Slack, etc.) has an account-level
//! config struct and a wrapper that holds a `HashMap` of named accounts.

mod access_policy;
mod channel_types;

pub use access_policy::{is_peer_allowed, AccessPolicy};
pub use channel_types::*;

/// Canonical `channel_type` identifiers used across:
///
/// - `ChannelsConfig::enabled_flags()` (config-side enabled summary)
/// - `gateway::channels_ops::build_channel_for_toggle` (toggle dispatch)
/// - Frontend channel toggles & integration UI
/// - Persisted gateway state
///
/// **Wire format — do not change values without a migration.** Add new
/// channels by extending this module and the matching dispatch arms;
/// never compare against raw string literals at the call site.
///
/// Stubs (no live `Channel` impl wired into `ChannelManager`) are still
/// listed here because the config schema and frontend toggle list both
/// need a stable name for them.
pub mod channel_type {
    // Wired channels — registered in `register_enabled_channels`.
    pub const TELEGRAM: &str = "telegram";
    pub const DISCORD: &str = "discord";
    pub const FEISHU: &str = "feishu";
    pub const WECOM: &str = "wecom";
    pub const WEIXIN: &str = "weixin";
    // Stub channels — config schema present, no `Channel` impl wired yet.
    // See module docs of each `channels::*.rs` for status.
    pub const SLACK: &str = "slack";
    pub const WHATSAPP: &str = "whatsapp";
    pub const IMESSAGE: &str = "imessage";
    pub const SIGNAL: &str = "signal";
    pub const DINGTALK: &str = "dingtalk";
    pub const ZALO: &str = "zalo";
    pub const LINE: &str = "line";
    pub const MSTEAMS: &str = "msteams";
    pub const MATRIX: &str = "matrix";
    pub const GOOGLECHAT: &str = "googlechat";
    pub const EMAIL: &str = "email";
}

use serde::{Deserialize, Serialize};

use crate::integrations::gateway::ResetPolicy;

/// Model + account binding for channel-launched OS agent sessions.
///
/// These are intentionally separate from the desktop session's model — the
/// channel-side model is configured once via the Integrations UI and shared by
/// all channel-launched sessions.
///
/// When either field is `None`, the gateway still accepts inbound messages
/// (the inbound/outbound processors run regardless), but new sessions cannot
/// be initialized and a "not configured" reply is posted back to the channel.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayChannelConfig {
    /// LLM model identifier for channel-launched OS agent sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Key vault account id for channel-launched OS agent sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    /// Idle-reset policy for per-chat sessions.
    /// Default is `ResetMode::Idle` — sessions auto-reset after inactivity.
    #[serde(default)]
    pub reset_policy: ResetPolicy,
}

/// All channel configurations. Each type holds a map of named accounts.
///
/// **Wired channels:** `telegram`, `discord`, `feishu`, `wecom`,
/// `weixin`. These have a `Channel` impl in
/// `agent_core::channels::<name>::channel.rs` and a dispatch arm in
/// `gateway::channels_ops::register_enabled_channels` /
/// `build_channel_for_toggle`.
///
/// **Stub channels (config + UI only, no runtime `Channel` impl):**
/// `slack`, `whatsapp`, `imessage`, `signal`, `dingtalk`, `zalo`,
/// `line`, `msteams`, `matrix`, `googlechat`, `email`. The fields are
/// kept on the wire so the frontend toggle list and the channel type
/// registry have stable names; enabling an account on a stub channel
/// fails in `build_channel_for_toggle` with an explicit "stub"
/// error.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelsConfig {
    /// Model + account binding for channel-launched sessions. Independent from
    /// the desktop session's model; see [`GatewayChannelConfig`] for rationale.
    #[serde(default)]
    pub gateway: GatewayChannelConfig,
    /// When `true`, `sender_id` values are replaced with their first-16-hex-chars
    /// SHA-256 hash before being injected into the OS agent's context
    /// header. Reduces PII exposure in LLM conversation history.
    #[serde(default)]
    pub pii_redact_sender_id: bool,
    /// when `true`, the gateway session binding key includes
    /// `sender_id`, giving every participant in a shared chat (group, channel)
    /// their own isolated session. Default `true` — each user gets their own
    /// context, preventing cross-talk in group chats.
    ///
    /// Applied in `SessionKey::from_inbound`.
    #[serde(default = "app_utils::default_true")]
    pub group_sessions_per_user: bool,
    #[serde(default)]
    pub telegram: TelegramConfig,
    #[serde(default)]
    pub discord: DiscordConfig,
    #[serde(default)]
    pub slack: SlackConfig,
    #[serde(default)]
    pub whatsapp: WhatsAppConfig,
    #[serde(default)]
    pub imessage: IMessageConfig,
    #[serde(default)]
    pub signal: SignalConfig,
    #[serde(default)]
    pub feishu: FeishuConfig,
    #[serde(default)]
    pub wecom: WeComConfig,
    #[serde(default)]
    pub weixin: WeixinConfig,
    #[serde(default)]
    pub dingtalk: DingTalkConfig,
    #[serde(default)]
    pub zalo: ZaloConfig,
    #[serde(default)]
    pub line: LineConfig,
    #[serde(default)]
    pub msteams: MSTeamsConfig,
    #[serde(default)]
    pub matrix: MatrixConfig,
    #[serde(default)]
    pub googlechat: GoogleChatConfig,
    #[serde(default)]
    pub email: EmailConfig,
}

impl ChannelsConfig {
    /// Iterate over every known channel as `(channel_type_name, any_account_enabled)`.
    ///
    /// This is the single source of truth for the set of supported channel types.
    /// Both [`Self::has_enabled_account`] and [`Self::has_any_enabled`] are derived from it.
    fn enabled_flags(&self) -> [(&'static str, bool); 16] {
        use channel_type::*;
        [
            (TELEGRAM, self.telegram.accounts.values().any(|a| a.enabled)),
            (DISCORD, self.discord.accounts.values().any(|a| a.enabled)),
            (SLACK, self.slack.accounts.values().any(|a| a.enabled)),
            (WHATSAPP, self.whatsapp.accounts.values().any(|a| a.enabled)),
            (IMESSAGE, self.imessage.accounts.values().any(|a| a.enabled)),
            (SIGNAL, self.signal.accounts.values().any(|a| a.enabled)),
            (FEISHU, self.feishu.accounts.values().any(|a| a.enabled)),
            (WECOM, self.wecom.accounts.values().any(|a| a.enabled)),
            (WEIXIN, self.weixin.accounts.values().any(|a| a.enabled)),
            (DINGTALK, self.dingtalk.accounts.values().any(|a| a.enabled)),
            (ZALO, self.zalo.accounts.values().any(|a| a.enabled)),
            (LINE, self.line.accounts.values().any(|a| a.enabled)),
            (MSTEAMS, self.msteams.accounts.values().any(|a| a.enabled)),
            (MATRIX, self.matrix.accounts.values().any(|a| a.enabled)),
            (
                GOOGLECHAT,
                self.googlechat.accounts.values().any(|a| a.enabled),
            ),
            (EMAIL, self.email.accounts.values().any(|a| a.enabled)),
        ]
    }

    /// Check if any account is enabled for a given channel type.
    pub fn has_enabled_account(&self, channel_type: &str) -> bool {
        self.enabled_flags()
            .iter()
            .any(|(name, enabled)| *name == channel_type && *enabled)
    }

    /// Returns true if any account across all channel types is enabled.
    pub fn has_any_enabled(&self) -> bool {
        self.enabled_flags().iter().any(|(_, enabled)| *enabled)
    }
}

//! Asian platform channel configs: Feishu/Lark, DingTalk, Zalo, LINE.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Feishu / Lark ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub app_id: String,
    #[serde(default)]
    pub app_secret: String,
    #[serde(default)]
    pub encrypt_key: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
    #[serde(default = "default_feishu_domain")]
    pub domain: String,
    #[serde(default = "default_dm_policy")]
    pub dm_policy: String,
    #[serde(default = "default_group_policy")]
    pub group_policy: String,
    #[serde(default = "app_utils::default_true")]
    pub require_mention: bool,
    #[serde(default = "default_render_mode")]
    pub render_mode: String,
}

fn default_feishu_domain() -> String {
    "feishu".to_string()
}
fn default_dm_policy() -> String {
    "open".to_string()
}
fn default_group_policy() -> String {
    "allowlist".to_string()
}
fn default_render_mode() -> String {
    "auto".to_string()
}

impl Default for FeishuAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            app_id: String::new(),
            app_secret: String::new(),
            encrypt_key: String::new(),
            allow_from: Vec::new(),
            domain: default_feishu_domain(),
            dm_policy: default_dm_policy(),
            group_policy: default_group_policy(),
            require_mention: true,
            render_mode: default_render_mode(),
        }
    }
}

impl FeishuAccountConfig {
    pub fn api_base(&self) -> String {
        match self.domain.as_str() {
            "feishu" => "https://open.feishu.cn/open-apis".to_string(),
            "lark" => "https://open.larksuite.com/open-apis".to_string(),
            custom => custom.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConfig {
    #[serde(default)]
    pub accounts: HashMap<String, FeishuAccountConfig>,
}

// ── DingTalk ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkConfig {
    #[serde(default)]
    pub accounts: HashMap<String, DingTalkAccountConfig>,
}

// ── Zalo ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZaloAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub bot_token: String,
    #[serde(default)]
    pub token_file: String,
    #[serde(default)]
    pub webhook_url: String,
    #[serde(default)]
    pub webhook_secret: String,
    #[serde(default)]
    pub webhook_path: String,
    #[serde(default)]
    pub proxy: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZaloConfig {
    #[serde(default)]
    pub accounts: HashMap<String, ZaloAccountConfig>,
}

// ── WeCom (Enterprise WeChat) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeComAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub bot_id: String,
    #[serde(default)]
    pub secret: String,
    #[serde(default = "default_wecom_ws_url")]
    pub websocket_url: String,
    #[serde(default = "default_wecom_dm_policy")]
    pub dm_policy: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
    #[serde(default = "default_wecom_group_policy")]
    pub group_policy: String,
    #[serde(default)]
    pub group_allow_from: Vec<String>,
}

fn default_wecom_ws_url() -> String {
    "wss://openws.work.weixin.qq.com".to_string()
}
fn default_wecom_dm_policy() -> String {
    "open".to_string()
}
fn default_wecom_group_policy() -> String {
    "open".to_string()
}

impl Default for WeComAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bot_id: String::new(),
            secret: String::new(),
            websocket_url: default_wecom_ws_url(),
            dm_policy: default_wecom_dm_policy(),
            allow_from: Vec::new(),
            group_policy: default_wecom_group_policy(),
            group_allow_from: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeComConfig {
    #[serde(default)]
    pub accounts: HashMap<String, WeComAccountConfig>,
}

// ── Weixin (Personal WeChat via iLink Bot API) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeixinAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Bot token obtained via QR login (e.g. through hermes-agent tooling).
    #[serde(default)]
    pub token: String,
    /// Bot account id returned by the QR login flow.
    #[serde(default)]
    pub bot_account_id: String,
    /// iLink base URL; defaults to the public gateway.
    #[serde(default = "default_weixin_base_url")]
    pub base_url: String,
    /// DM policy: "open" / "allowlist" / "disabled".
    #[serde(default = "default_weixin_dm_policy")]
    pub dm_policy: String,
    /// Allow list of sender ids (used when `dm_policy == "allowlist"`).
    #[serde(default)]
    pub allow_from: Vec<String>,
    /// Group policy: "open" / "allowlist" / "disabled" (default: disabled for
    /// privacy; groups are opt-in).
    #[serde(default = "default_weixin_group_policy")]
    pub group_policy: String,
    /// Group allow list (room ids used when `group_policy == "allowlist"`).
    #[serde(default)]
    pub group_allow_from: Vec<String>,
}

fn default_weixin_base_url() -> String {
    "https://ilinkai.weixin.qq.com".to_string()
}
fn default_weixin_dm_policy() -> String {
    "open".to_string()
}
fn default_weixin_group_policy() -> String {
    "disabled".to_string()
}

impl Default for WeixinAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            token: String::new(),
            bot_account_id: String::new(),
            base_url: default_weixin_base_url(),
            dm_policy: default_weixin_dm_policy(),
            allow_from: Vec::new(),
            group_policy: default_weixin_group_policy(),
            group_allow_from: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeixinConfig {
    #[serde(default)]
    pub accounts: HashMap<String, WeixinAccountConfig>,
}

// ── LINE ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub channel_access_token: String,
    #[serde(default)]
    pub channel_secret: String,
    #[serde(default)]
    pub token_file: String,
    #[serde(default)]
    pub secret_file: String,
    #[serde(default)]
    pub webhook_path: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineConfig {
    #[serde(default)]
    pub accounts: HashMap<String, LineAccountConfig>,
}

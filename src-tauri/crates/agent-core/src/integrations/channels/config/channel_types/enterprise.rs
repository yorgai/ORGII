//! Enterprise / productivity channel configs: Slack, Email, MS Teams, Matrix, Google Chat.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Slack ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub bot_token: String,
    #[serde(default)]
    pub app_token: String,
    #[serde(default)]
    pub user_token: String,
    #[serde(default = "default_slack_mode")]
    pub mode: String,
    #[serde(default)]
    pub signing_secret: String,
    #[serde(default = "default_slack_webhook_path")]
    pub webhook_path: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

fn default_slack_mode() -> String {
    "socket".to_string()
}

fn default_slack_webhook_path() -> String {
    "/slack/events".to_string()
}

impl Default for SlackAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bot_token: String::new(),
            app_token: String::new(),
            user_token: String::new(),
            mode: default_slack_mode(),
            signing_secret: String::new(),
            webhook_path: default_slack_webhook_path(),
            allow_from: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlackConfig {
    #[serde(default)]
    pub accounts: HashMap<String, SlackAccountConfig>,
}

// ── Email ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub imap_host: String,
    #[serde(default = "default_imap_port")]
    pub imap_port: u16,
    #[serde(default)]
    pub imap_username: String,
    #[serde(default)]
    pub imap_password: String,
    #[serde(default = "default_imap_mailbox")]
    pub imap_mailbox: String,
    #[serde(default = "app_utils::default_true")]
    pub imap_use_ssl: bool,
    #[serde(default)]
    pub smtp_host: String,
    #[serde(default = "default_smtp_port")]
    pub smtp_port: u16,
    #[serde(default)]
    pub smtp_username: String,
    #[serde(default)]
    pub smtp_password: String,
    #[serde(default = "app_utils::default_true")]
    pub smtp_use_tls: bool,
    #[serde(default)]
    pub from_address: String,
    #[serde(default = "app_utils::default_true")]
    pub auto_reply_enabled: bool,
    #[serde(default = "default_poll_interval")]
    pub poll_interval_seconds: u64,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

fn default_imap_port() -> u16 {
    993
}
fn default_imap_mailbox() -> String {
    "INBOX".to_string()
}
fn default_smtp_port() -> u16 {
    587
}
fn default_poll_interval() -> u64 {
    30
}
impl Default for EmailAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            imap_host: String::new(),
            imap_port: default_imap_port(),
            imap_username: String::new(),
            imap_password: String::new(),
            imap_mailbox: default_imap_mailbox(),
            imap_use_ssl: true,
            smtp_host: String::new(),
            smtp_port: default_smtp_port(),
            smtp_username: String::new(),
            smtp_password: String::new(),
            smtp_use_tls: true,
            from_address: String::new(),
            auto_reply_enabled: true,
            poll_interval_seconds: default_poll_interval(),
            allow_from: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailConfig {
    #[serde(default)]
    pub accounts: HashMap<String, EmailAccountConfig>,
}

// ── Microsoft Teams ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MSTeamsAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub app_id: String,
    #[serde(default)]
    pub app_password: String,
    #[serde(default)]
    pub tenant_id: String,
    #[serde(default)]
    pub webhook_port: u16,
    #[serde(default)]
    pub webhook_path: String,
    #[serde(default)]
    pub share_point_site_id: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MSTeamsConfig {
    #[serde(default)]
    pub accounts: HashMap<String, MSTeamsAccountConfig>,
}

// ── Matrix ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_matrix_homeserver")]
    pub homeserver_url: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub device_name: String,
    #[serde(default)]
    pub encryption: bool,
    #[serde(default = "default_matrix_auto_join")]
    pub auto_join: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

fn default_matrix_homeserver() -> String {
    "https://matrix.org".to_string()
}

fn default_matrix_auto_join() -> String {
    "allowlist".to_string()
}

impl Default for MatrixAccountConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            homeserver_url: default_matrix_homeserver(),
            user_id: String::new(),
            access_token: String::new(),
            password: String::new(),
            device_name: String::new(),
            encryption: false,
            auto_join: default_matrix_auto_join(),
            allow_from: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixConfig {
    #[serde(default)]
    pub accounts: HashMap<String, MatrixAccountConfig>,
}

// ── Google Chat ──

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleChatAccountConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub webhook_url: String,
    #[serde(default)]
    pub service_account_key: String,
    #[serde(default)]
    pub webhook_path: String,
    #[serde(default)]
    pub audience_type: String,
    #[serde(default)]
    pub audience: String,
    #[serde(default)]
    pub bot_user: String,
    #[serde(default)]
    pub allow_from: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleChatConfig {
    #[serde(default)]
    pub accounts: HashMap<String, GoogleChatAccountConfig>,
}

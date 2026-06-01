//! Channel registration and toggle helpers used by `GatewayService`.
//!
//! These were factored out so the service body stays focused on the
//! public lifecycle (start/stop/status) while the per-channel wiring lives
//! alongside other channel plumbing.

use crate::channels::config::ChannelsConfig;
use crate::channels::{Channel, ChannelManager};

/// Register the channels that are enabled in `channels` into the given `ChannelManager`.
pub(super) async fn register_enabled_channels(
    manager: &mut ChannelManager,
    channels: &ChannelsConfig,
) {
    use crate::channels::discord::DiscordChannel;
    use crate::channels::feishu::FeishuChannel;
    use crate::channels::telegram::TelegramChannel;
    use crate::channels::wecom::WeComChannel;
    use crate::channels::weixin::WeixinChannel;

    for (acct_id, account) in &channels.telegram.accounts {
        if account.enabled {
            manager.register(Box::new(TelegramChannel::new(
                acct_id.clone(),
                account.clone(),
            )));
        }
    }
    for (acct_id, account) in &channels.discord.accounts {
        if account.enabled {
            manager.register(Box::new(DiscordChannel::new(
                acct_id.clone(),
                account.clone(),
            )));
        }
    }
    for (acct_id, account) in &channels.feishu.accounts {
        if account.enabled {
            manager.register(Box::new(FeishuChannel::new(
                acct_id.clone(),
                account.clone(),
            )));
        }
    }
    for (acct_id, account) in &channels.wecom.accounts {
        if account.enabled {
            manager.register(Box::new(WeComChannel::new(
                acct_id.clone(),
                account.clone(),
            )));
        }
    }
    for (acct_id, account) in &channels.weixin.accounts {
        if account.enabled {
            manager.register(Box::new(WeixinChannel::new(
                acct_id.clone(),
                account.clone(),
            )));
        }
    }
}

/// Build a `Channel` implementation for the given enable-toggle request.
///
/// This is the single source of truth for resolving `(channel_type, account_id)`
/// into a concrete channel instance so the toggle path stays declarative.
pub(super) async fn build_channel_for_toggle(
    channel_type: &str,
    account_id: &str,
    channels: &ChannelsConfig,
) -> Result<Box<dyn Channel>, String> {
    use crate::channels::config::channel_type;
    use crate::channels::discord::DiscordChannel;
    use crate::channels::feishu::FeishuChannel;
    use crate::channels::telegram::TelegramChannel;
    use crate::channels::wecom::WeComChannel;
    use crate::channels::weixin::WeixinChannel;

    match channel_type {
        channel_type::TELEGRAM => {
            let account =
                channels.telegram.accounts.get(account_id).ok_or_else(|| {
                    format!("Telegram account '{}' not found in config", account_id)
                })?;
            Ok(Box::new(TelegramChannel::new(
                account_id.to_string(),
                account.clone(),
            )))
        }
        channel_type::DISCORD => {
            let account =
                channels.discord.accounts.get(account_id).ok_or_else(|| {
                    format!("Discord account '{}' not found in config", account_id)
                })?;
            Ok(Box::new(DiscordChannel::new(
                account_id.to_string(),
                account.clone(),
            )))
        }
        channel_type::FEISHU => {
            let account =
                channels.feishu.accounts.get(account_id).ok_or_else(|| {
                    format!("Feishu account '{}' not found in config", account_id)
                })?;
            Ok(Box::new(FeishuChannel::new(
                account_id.to_string(),
                account.clone(),
            )))
        }
        channel_type::WECOM => {
            let account = channels
                .wecom
                .accounts
                .get(account_id)
                .ok_or_else(|| format!("WeCom account '{}' not found in config", account_id))?;
            Ok(Box::new(WeComChannel::new(
                account_id.to_string(),
                account.clone(),
            )))
        }
        channel_type::WEIXIN => {
            let account =
                channels.weixin.accounts.get(account_id).ok_or_else(|| {
                    format!("Weixin account '{}' not found in config", account_id)
                })?;
            Ok(Box::new(WeixinChannel::new(
                account_id.to_string(),
                account.clone(),
            )))
        }
        // Stub channels (`SLACK`, `WHATSAPP`, `IMESSAGE`, `SIGNAL`,
        // `DINGTALK`, `ZALO`, `LINE`, `MSTEAMS`, `MATRIX`,
        // `GOOGLECHAT`, `EMAIL`) — listed in `channel_type::*` and
        // surfaced in the frontend toggle list and `ChannelsConfig`
        // schema, but no live `Channel` impl is wired into
        // `ChannelManager`. Detect them here so the user sees an
        // explicit "this is a stub" error rather than the generic
        // Unsupported variant.
        other => {
            use crate::channels::config::channel_type;
            const STUB_CHANNELS: &[&str] = &[
                channel_type::SLACK,
                channel_type::WHATSAPP,
                channel_type::IMESSAGE,
                channel_type::SIGNAL,
                channel_type::DINGTALK,
                channel_type::ZALO,
                channel_type::LINE,
                channel_type::MSTEAMS,
                channel_type::MATRIX,
                channel_type::GOOGLECHAT,
                channel_type::EMAIL,
            ];
            if STUB_CHANNELS.contains(&other) {
                Err(format!(
                    "Channel type '{}' is a stub: the config schema and \
                     UI toggle exist, but no live `Channel` implementation \
                     is wired into `ChannelManager` yet. Wired channels: \
                     telegram, discord, feishu, wecom, weixin. Wiring a stub \
                     requires implementing the `Channel` trait in \
                     `agent_core::channels::<name>::channel.rs` and adding \
                     the dispatch arm here.",
                    other
                ))
            } else {
                Err(format!("Unsupported channel type: {}", other))
            }
        }
    }
}

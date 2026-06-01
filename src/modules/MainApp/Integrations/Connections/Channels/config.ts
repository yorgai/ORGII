/**
 * Integrations Page Configuration
 *
 * Channel type definitions.
 * Multi-account: each channel type has a map of named accounts under
 * `channels.<type>.accounts.<accountId>`.
 */
import { CHANNEL_TYPE, type ChannelType } from "./types";

export const LIVE_CHANNEL_TYPES: ChannelType[] = [
  { type: CHANNEL_TYPE.TELEGRAM, labelKey: "channels.telegram" },
  { type: CHANNEL_TYPE.DISCORD, labelKey: "channels.discord" },
  { type: CHANNEL_TYPE.FEISHU, labelKey: "channels.feishu" },
  { type: CHANNEL_TYPE.WEIXIN, labelKey: "channels.weixin" },
  { type: CHANNEL_TYPE.WECOM, labelKey: "channels.wecom" },
];

export const COMING_SOON_CHANNEL_TYPES: ChannelType[] = [
  { type: CHANNEL_TYPE.SLACK, labelKey: "channels.slack" },
  { type: CHANNEL_TYPE.WHATSAPP, labelKey: "channels.whatsapp" },
  { type: CHANNEL_TYPE.IMESSAGE, labelKey: "channels.imessage" },
  { type: CHANNEL_TYPE.SIGNAL, labelKey: "channels.signal" },
  { type: CHANNEL_TYPE.DINGTALK, labelKey: "channels.dingtalk" },
  { type: CHANNEL_TYPE.ZALO, labelKey: "channels.zalo" },
  { type: CHANNEL_TYPE.LINE, labelKey: "channels.line" },
  { type: CHANNEL_TYPE.MSTEAMS, labelKey: "channels.msteams" },
  { type: CHANNEL_TYPE.MATRIX, labelKey: "channels.matrix" },
  { type: CHANNEL_TYPE.GOOGLECHAT, labelKey: "channels.googlechat" },
  { type: CHANNEL_TYPE.EMAIL, labelKey: "channels.email" },
];

/** All integration channel types (multi-account) */
export const CHANNEL_TYPES: ChannelType[] = [
  ...LIVE_CHANNEL_TYPES,
  ...COMING_SOON_CHANNEL_TYPES,
];

/** Build the config path prefix for a channel account */
export function accountPathPrefix(
  channelType: string,
  accountId: string
): string {
  return `channels.${channelType}.accounts.${accountId}`;
}

// ── Channel defaults (must match Rust schema defaults) ──

export const CHANNEL_DEFAULTS = {
  weixin: {
    baseUrl: "https://ilinkai.weixin.qq.com",
    dmPolicy: "open",
    groupPolicy: "disabled",
  },
  wecom: {
    websocketUrl: "wss://openws.work.weixin.qq.com",
    dmPolicy: "open",
    groupPolicy: "open",
  },
  whatsapp: {
    bridgeUrl: "ws://localhost:3001",
  },
  email: {
    imapPort: 993,
    imapMailbox: "INBOX",
    imapUseSsl: true,
    smtpPort: 587,
    smtpUseTls: true,
    autoReplyEnabled: true,
    pollIntervalSeconds: 30,
  },
} as const;

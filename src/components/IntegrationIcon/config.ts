/**
 * IntegrationIcon Configuration
 *
 * SVG icon imports and mappings for integration types
 * (messaging channels + git providers).
 */
import React from "react";

// ============================================
// SVG Icon Imports
// ============================================
import DingTalkIcon from "@src/assets/channelIcons/dingtalk.svg";
import DiscordIcon from "@src/assets/channelIcons/discord.svg";
import FeishuIcon from "@src/assets/channelIcons/feishu.svg";
import GitHubIcon from "@src/assets/channelIcons/github.svg";
import GitLabIcon from "@src/assets/channelIcons/gitlab.svg";
import GoogleChatIcon from "@src/assets/channelIcons/googlechat.svg";
import IMessageIcon from "@src/assets/channelIcons/imessage.svg";
import LineIcon from "@src/assets/channelIcons/line.svg";
import LinearIcon from "@src/assets/channelIcons/linear.svg";
import MatrixIcon from "@src/assets/channelIcons/matrix.svg";
import MSTeamsIcon from "@src/assets/channelIcons/msteams.svg";
import SignalIcon from "@src/assets/channelIcons/signal.svg";
import SlackIcon from "@src/assets/channelIcons/slack.svg";
import TelegramIcon from "@src/assets/channelIcons/telegram.svg";
import WeChatIcon from "@src/assets/channelIcons/wechat.svg";
import WhatsAppIcon from "@src/assets/channelIcons/whatsapp.svg";
import ZaloIcon from "@src/assets/channelIcons/zalo.svg";

// ============================================
// Types
// ============================================

/** Integration types that have custom SVG brand icons */
export type BrandIntegrationType =
  | "telegram"
  | "discord"
  | "slack"
  | "whatsapp"
  | "imessage"
  | "signal"
  | "feishu"
  | "dingtalk"
  | "zalo"
  | "line"
  | "msteams"
  | "matrix"
  | "googlechat"
  | "wechat"
  | "weixin"
  | "wecom"
  | "github"
  | "gitlab"
  | "linear";

// ============================================
// Icon Map
// ============================================

/** Maps brand integration types to their corresponding SVG icon components */
export const INTEGRATION_ICON_MAP: Record<
  BrandIntegrationType,
  React.FC<React.SVGProps<SVGSVGElement>>
> = {
  telegram: TelegramIcon,
  discord: DiscordIcon,
  slack: SlackIcon,
  whatsapp: WhatsAppIcon,
  imessage: IMessageIcon,
  signal: SignalIcon,
  feishu: FeishuIcon,
  dingtalk: DingTalkIcon,
  zalo: ZaloIcon,
  line: LineIcon,
  msteams: MSTeamsIcon,
  matrix: MatrixIcon,
  googlechat: GoogleChatIcon,
  wechat: WeChatIcon,
  weixin: WeChatIcon,
  wecom: WeChatIcon,
  github: GitHubIcon,
  gitlab: GitLabIcon,
  linear: LinearIcon,
};

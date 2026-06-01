/**
 * ChannelDetailContent
 *
 * Renders the config form for a given channel type.
 */
import React from "react";

import {
  DingTalkConfig,
  DiscordConfig,
  EmailConfig,
  FeishuConfig,
  GoogleChatConfig,
  IMessageConfig,
  LineConfig,
  MSTeamsConfig,
  MatrixConfig,
  SignalConfig,
  SlackConfig,
  TelegramConfig,
  WeChatConfig,
  WeComConfig,
  WhatsAppConfig,
  ZaloConfig,
} from "./configs";

export interface ChannelDetailProps {
  channelType: string;
  config: Record<string, unknown>;
  update: (path: string, value: unknown) => void;
  pathPrefix: string;
}

type ChannelConfigComponent = React.ComponentType<
  Pick<ChannelDetailProps, "config" | "update" | "pathPrefix">
>;

const CHANNEL_CONFIG_COMPONENTS: Record<string, ChannelConfigComponent> = {
  telegram: TelegramConfig,
  discord: DiscordConfig,
  slack: SlackConfig,
  whatsapp: WhatsAppConfig,
  imessage: IMessageConfig,
  signal: SignalConfig,
  feishu: FeishuConfig,
  dingtalk: DingTalkConfig,
  zalo: ZaloConfig,
  line: LineConfig,
  msteams: MSTeamsConfig,
  matrix: MatrixConfig,
  googlechat: GoogleChatConfig,
  weixin: WeChatConfig,
  wecom: WeComConfig,
  email: EmailConfig,
};

const ChannelDetailContent: React.FC<ChannelDetailProps> = ({
  channelType,
  config,
  update,
  pathPrefix,
}) => {
  const props = { config, update, pathPrefix };
  const ConfigComponent = CHANNEL_CONFIG_COMPONENTS[channelType];
  if (!ConfigComponent) {
    return null;
  }
  return <ConfigComponent {...props} />;
};

export default ChannelDetailContent;

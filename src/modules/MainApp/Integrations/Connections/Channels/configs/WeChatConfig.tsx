/**
 * WeChat (Personal / Weixin via iLink Bot) Channel Configuration
 *
 * Corresponds to WeixinAccountConfig in
 * agent_core/integrations/channels/config/channel_types/asian.rs.
 *
 * iLink Bot API long-polls `getupdates` and sends via `sendmessage`; each
 * reply must carry a per-peer `contextToken`, which the backend persists in
 * memory. The frontend only needs the bot token + account id pair obtained
 * via QR login; the backend keeps track of tokens per peer.
 */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import Select from "@src/components/Select";

import {
  getNestedString,
  getNestedStringArray,
} from "../../../../AgentOrgs/config/osAgent/utils";
import type { ChannelConfigProps } from "../types";
import { parseCommaSeparated } from "../utils";

const WeChatConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const dmPolicyOptions = useMemo(
    () => [
      { label: t("channels.weixinDmPolicyOpen"), value: "open" },
      { label: t("channels.weixinDmPolicyAllowlist"), value: "allowlist" },
      { label: t("channels.weixinDmPolicyDisabled"), value: "disabled" },
    ],
    [t]
  );

  const groupPolicyOptions = useMemo(
    () => [
      { label: t("channels.weixinGroupPolicyOpen"), value: "open" },
      {
        label: t("channels.weixinGroupPolicyAllowlist"),
        value: "allowlist",
      },
      {
        label: t("channels.weixinGroupPolicyDisabled"),
        value: "disabled",
      },
    ],
    [t]
  );

  const token = getNestedString(config, `${pathPrefix}.token`, "");
  const botAccountId = getNestedString(
    config,
    `${pathPrefix}.botAccountId`,
    ""
  );
  const baseUrl = getNestedString(
    config,
    `${pathPrefix}.baseUrl`,
    "https://ilinkai.weixin.qq.com"
  );
  const dmPolicy = getNestedString(config, `${pathPrefix}.dmPolicy`, "open");
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);
  const groupPolicy = getNestedString(
    config,
    `${pathPrefix}.groupPolicy`,
    "disabled"
  );
  const groupAllowFrom = getNestedStringArray(
    config,
    `${pathPrefix}.groupAllowFrom`
  );

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.weixinToken")}
        description={t("channels.weixinTokenDesc")}
      >
        <Input
          value={token}
          onChange={(val: string) => update(`${pathPrefix}.token`, val)}
          style={SECTION_CONTROL_STYLE}
          type="password"
          placeholder="ilink_bot_token..."
        />
      </SectionRow>
      <SectionRow
        label={t("channels.weixinBotAccountId")}
        description={t("channels.weixinBotAccountIdDesc")}
      >
        <Input
          value={botAccountId}
          onChange={(val: string) => update(`${pathPrefix}.botAccountId`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="wxid_xxxxxxxx"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.weixinBaseUrl")}
        description={t("channels.weixinBaseUrlDesc")}
      >
        <Input
          value={baseUrl}
          onChange={(val: string) =>
            update(
              `${pathPrefix}.baseUrl`,
              val || "https://ilinkai.weixin.qq.com"
            )
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="https://ilinkai.weixin.qq.com"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.weixinDmPolicy")}
        description={t("channels.weixinDmPolicyDesc")}
      >
        <Select
          value={dmPolicy}
          onChange={(val) => update(`${pathPrefix}.dmPolicy`, val)}
          options={dmPolicyOptions}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow
        label={t("channels.allowFrom")}
        description={t("channels.allowFromDesc")}
      >
        <Input
          value={allowFrom.join(", ")}
          onChange={(val: string) =>
            update(`${pathPrefix}.allowFrom`, parseCommaSeparated(val))
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="wxid_aaa, wxid_bbb"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.weixinGroupPolicy")}
        description={t("channels.weixinGroupPolicyDesc")}
      >
        <Select
          value={groupPolicy}
          onChange={(val) => update(`${pathPrefix}.groupPolicy`, val)}
          options={groupPolicyOptions}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow
        label={t("channels.weixinGroupAllowFrom")}
        description={t("channels.weixinGroupAllowFromDesc")}
      >
        <Input
          value={groupAllowFrom.join(", ")}
          onChange={(val: string) =>
            update(`${pathPrefix}.groupAllowFrom`, parseCommaSeparated(val))
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="room_id_1, room_id_2"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default WeChatConfig;

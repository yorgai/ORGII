/**
 * WeCom (Enterprise WeChat) Channel Configuration
 *
 * Corresponds to WeComAccountConfig in agent_core/integrations/channels/config/channel_types/asian.rs
 * Uses WeCom AI Bot WebSocket API (wss://openws.work.weixin.qq.com).
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

const WeComConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const dmPolicyOptions = useMemo(
    () => [
      { label: t("channels.wecomDmPolicyOpen"), value: "open" },
      { label: t("channels.wecomDmPolicyAllowlist"), value: "allowlist" },
      { label: t("channels.wecomDmPolicyDisabled"), value: "disabled" },
    ],
    [t]
  );

  const groupPolicyOptions = useMemo(
    () => [
      { label: t("channels.wecomGroupPolicyOpen"), value: "open" },
      { label: t("channels.wecomGroupPolicyAllowlist"), value: "allowlist" },
      { label: t("channels.wecomGroupPolicyDisabled"), value: "disabled" },
    ],
    [t]
  );

  const botId = getNestedString(config, `${pathPrefix}.botId`, "");
  const secret = getNestedString(config, `${pathPrefix}.secret`, "");
  const websocketUrl = getNestedString(
    config,
    `${pathPrefix}.websocketUrl`,
    "wss://openws.work.weixin.qq.com"
  );
  const dmPolicy = getNestedString(config, `${pathPrefix}.dmPolicy`, "open");
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);
  const groupPolicy = getNestedString(
    config,
    `${pathPrefix}.groupPolicy`,
    "open"
  );
  const groupAllowFrom = getNestedStringArray(
    config,
    `${pathPrefix}.groupAllowFrom`
  );

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.wecomBotId")}
        description={t("channels.wecomBotIdDesc")}
      >
        <Input
          value={botId}
          onChange={(val: string) => update(`${pathPrefix}.botId`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.wecomSecret")}
        description={t("channels.wecomSecretDesc")}
      >
        <Input
          value={secret}
          onChange={(val: string) => update(`${pathPrefix}.secret`, val)}
          style={SECTION_CONTROL_STYLE}
          type="password"
          placeholder="secret..."
        />
      </SectionRow>
      <SectionRow
        label={t("channels.wecomWebsocketUrl")}
        description={t("channels.wecomWebsocketUrlDesc")}
      >
        <Input
          value={websocketUrl}
          onChange={(val: string) =>
            update(`${pathPrefix}.websocketUrl`, val || null)
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="wss://openws.work.weixin.qq.com"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.wecomDmPolicy")}
        description={t("channels.wecomDmPolicyDesc")}
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
          placeholder="@userid1, @userid2"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.wecomGroupPolicy")}
        description={t("channels.wecomGroupPolicyDesc")}
      >
        <Select
          value={groupPolicy}
          onChange={(val) => update(`${pathPrefix}.groupPolicy`, val)}
          options={groupPolicyOptions}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow
        label={t("channels.wecomGroupAllowFrom")}
        description={t("channels.wecomGroupAllowFromDesc")}
      >
        <Input
          value={groupAllowFrom.join(", ")}
          onChange={(val: string) =>
            update(`${pathPrefix}.groupAllowFrom`, parseCommaSeparated(val))
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="group_id_1, group_id_2"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default WeComConfig;

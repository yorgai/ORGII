import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import Select from "@src/components/Select";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { type ChannelFormProps, getString } from "./types";

const WeComForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");

  const dmPolicyOptions = useMemo(
    () => [
      { label: t("channels.wecomDmPolicyOpen"), value: "open" },
      { label: t("channels.wecomDmPolicyAllowlist"), value: "allowlist" },
      { label: t("channels.wecomDmPolicyDisabled"), value: "disabled" },
    ],
    [t]
  );

  return (
    <SectionContainer>
      <SectionRow label={t("channels.wecomBotId")} required>
        <Input
          value={getString(config, "botId")}
          onChange={(val: string) => onChange({ botId: val })}
          placeholder="wb_xxxxxxxx"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.wecomSecret")} required>
        <Input
          value={getString(config, "secret")}
          onChange={(val: string) => onChange({ secret: val })}
          placeholder="••••••••"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
          type="password"
        />
      </SectionRow>
      <SectionRow label={t("channels.wecomWebsocketUrl")}>
        <Input
          value={
            getString(config, "websocketUrl") ||
            "wss://openws.work.weixin.qq.com"
          }
          onChange={(val: string) => onChange({ websocketUrl: val })}
          placeholder="wss://openws.work.weixin.qq.com"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.wecomDmPolicy")}>
        <Select
          value={getString(config, "dmPolicy") || "open"}
          onChange={(val) => onChange({ dmPolicy: val })}
          options={dmPolicyOptions}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.allowFrom")}>
        <Input
          value={getString(config, "allowFrom")}
          onChange={(val: string) => onChange({ allowFrom: val })}
          placeholder="user1, user2"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default WeComForm;

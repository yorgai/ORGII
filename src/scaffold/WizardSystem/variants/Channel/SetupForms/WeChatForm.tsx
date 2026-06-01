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

const WeChatForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");

  const dmPolicyOptions = useMemo(
    () => [
      { label: t("channels.weixinDmPolicyOpen"), value: "open" },
      { label: t("channels.weixinDmPolicyAllowlist"), value: "allowlist" },
      { label: t("channels.weixinDmPolicyDisabled"), value: "disabled" },
    ],
    [t]
  );

  return (
    <SectionContainer>
      <SectionRow label={t("channels.weixinToken")} required>
        <Input
          value={getString(config, "token")}
          onChange={(val: string) => onChange({ token: val })}
          placeholder="ilink_bot_token..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
          type="password"
        />
      </SectionRow>
      <SectionRow label={t("channels.weixinBotAccountId")} required>
        <Input
          value={getString(config, "botAccountId")}
          onChange={(val: string) => onChange({ botAccountId: val })}
          placeholder="wxid_xxxxxxxx"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.weixinBaseUrl")}>
        <Input
          value={
            getString(config, "baseUrl") || "https://ilinkai.weixin.qq.com"
          }
          onChange={(val: string) => onChange({ baseUrl: val })}
          placeholder="https://ilinkai.weixin.qq.com"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.weixinDmPolicy")}>
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
          placeholder="wxid_aaa, wxid_bbb"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default WeChatForm;

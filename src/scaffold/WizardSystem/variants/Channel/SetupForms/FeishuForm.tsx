import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { type ChannelFormProps, getString } from "./types";

const FeishuForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");

  return (
    <SectionContainer>
      <SectionRow label={t("channels.feishuAppId")} required>
        <Input
          value={getString(config, "appId")}
          onChange={(val: string) => onChange({ appId: val })}
          placeholder="cli_..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.feishuAppSecret")} required>
        <Input
          value={getString(config, "appSecret")}
          onChange={(val: string) => onChange({ appSecret: val })}
          placeholder="******"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.feishuEncryptKey")}>
        <Input
          value={getString(config, "encryptKey")}
          onChange={(val: string) => onChange({ encryptKey: val })}
          placeholder="******"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.allowFrom")}>
        <Input
          value={getString(config, "allowFrom")}
          onChange={(val: string) => onChange({ allowFrom: val })}
          placeholder="ou_xxxxxxxx"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default FeishuForm;

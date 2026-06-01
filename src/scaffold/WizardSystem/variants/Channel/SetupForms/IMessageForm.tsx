import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { type ChannelFormProps, getString } from "./types";

const IMessageForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");
  return (
    <SectionContainer>
      <SectionRow label={t("channels.imessageServerUrl")} required>
        <Input
          value={getString(config, "serverUrl")}
          onChange={(val: string) => onChange({ serverUrl: val })}
          placeholder="http://localhost:1234"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.imessagePassword")} required>
        <Input
          value={getString(config, "password")}
          onChange={(val: string) => onChange({ password: val })}
          type="password"
          placeholder="••••••••"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.imessageService")}>
        <Input
          value={getString(config, "service")}
          onChange={(val: string) => onChange({ service: val })}
          placeholder="auto"
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
          placeholder="+1234567890, user@icloud.com"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default IMessageForm;

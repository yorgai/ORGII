import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { type ChannelFormProps, getString } from "./types";

const LineForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");
  return (
    <SectionContainer>
      <SectionRow label={t("channels.lineChannelAccessToken")} required>
        <Input
          value={getString(config, "channelAccessToken")}
          onChange={(val: string) => onChange({ channelAccessToken: val })}
          placeholder="Channel access token..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.lineChannelSecret")} required>
        <Input
          value={getString(config, "channelSecret")}
          onChange={(val: string) => onChange({ channelSecret: val })}
          type="password"
          placeholder="••••••••"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.lineWebhookPath")}>
        <Input
          value={getString(config, "webhookPath")}
          onChange={(val: string) => onChange({ webhookPath: val })}
          placeholder="/line/webhook"
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
          placeholder="U1234567890abcdef"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default LineForm;

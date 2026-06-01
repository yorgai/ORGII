import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { type ChannelFormProps, getString } from "./types";

const ZaloForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");
  return (
    <SectionContainer>
      <SectionRow label={t("channels.zaloBotToken")} required>
        <Input
          value={getString(config, "botToken")}
          onChange={(val: string) => onChange({ botToken: val })}
          placeholder="OA token..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.zaloWebhookUrl")}>
        <Input
          value={getString(config, "webhookUrl")}
          onChange={(val: string) => onChange({ webhookUrl: val })}
          placeholder="https://example.com/webhook/zalo"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.zaloWebhookSecret")}>
        <Input
          value={getString(config, "webhookSecret")}
          onChange={(val: string) => onChange({ webhookSecret: val })}
          type="password"
          placeholder="••••••••"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.zaloWebhookPath")}>
        <Input
          value={getString(config, "webhookPath")}
          onChange={(val: string) => onChange({ webhookPath: val })}
          placeholder="/zalo/webhook"
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
          placeholder="1234567890"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default ZaloForm;

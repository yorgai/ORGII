import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import { CHANNEL_DEFAULTS } from "@src/modules/MainApp/Integrations/Connections/Channels/config";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { type ChannelFormProps, getString } from "./types";

const WhatsAppForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");
  return (
    <SectionContainer>
      <SectionRow label={t("channels.whatsappBridge")}>
        <Input
          value={
            getString(config, "bridgeUrl") ||
            CHANNEL_DEFAULTS.whatsapp.bridgeUrl
          }
          onChange={(val: string) => onChange({ bridgeUrl: val })}
          placeholder={CHANNEL_DEFAULTS.whatsapp.bridgeUrl}
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
          placeholder="+1234567890"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default WhatsAppForm;

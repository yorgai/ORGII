import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { type ChannelFormProps, getString } from "./types";

const GoogleChatForm: React.FC<ChannelFormProps> = ({ config, onChange }) => {
  const { t } = useTranslation("integrations");
  return (
    <SectionContainer>
      <SectionRow label={t("channels.googlechatServiceAccountKey")} required>
        <Input
          value={getString(config, "serviceAccountKey")}
          onChange={(val: string) => onChange({ serviceAccountKey: val })}
          placeholder="/path/to/service-account.json"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.googlechatWebhookUrl")}>
        <Input
          value={getString(config, "webhookUrl")}
          onChange={(val: string) => onChange({ webhookUrl: val })}
          placeholder="https://chat.googleapis.com/v1/spaces/..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      <SectionRow label={t("channels.googlechatBotUser")}>
        <Input
          value={getString(config, "botUser")}
          onChange={(val: string) => onChange({ botUser: val })}
          placeholder="users/123456789"
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
          placeholder="user@workspace.com"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default GoogleChatForm;

/**
 * Google Chat Channel Configuration
 *
 * Google Workspace integration via service account or webhook.
 */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import React from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";

import {
  getNestedString,
  getNestedStringArray,
} from "../../../../AgentOrgs/config/osAgent/utils";
import type { ChannelConfigProps } from "../types";
import { parseCommaSeparated } from "../utils";

const GoogleChatConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const webhookUrl = getNestedString(config, `${pathPrefix}.webhookUrl`, "");
  const serviceAccountKey = getNestedString(
    config,
    `${pathPrefix}.serviceAccountKey`,
    ""
  );
  const webhookPath = getNestedString(config, `${pathPrefix}.webhookPath`, "");
  const audienceType = getNestedString(
    config,
    `${pathPrefix}.audienceType`,
    ""
  );
  const audience = getNestedString(config, `${pathPrefix}.audience`, "");
  const botUser = getNestedString(config, `${pathPrefix}.botUser`, "");
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.googlechatWebhookUrl")}
        description={t("channels.googlechatWebhookUrlDesc")}
      >
        <Input
          value={webhookUrl}
          onChange={(val: string) => update(`${pathPrefix}.webhookUrl`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="https://chat.googleapis.com/v1/spaces/..."
        />
      </SectionRow>
      <SectionRow
        label={t("channels.googlechatServiceAccountKey")}
        description={t("channels.googlechatServiceAccountKeyDesc")}
      >
        <Input
          value={serviceAccountKey}
          onChange={(val: string) =>
            update(`${pathPrefix}.serviceAccountKey`, val)
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="/path/to/service-account.json"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.googlechatWebhookPath")}
        description={t("channels.googlechatWebhookPathDesc")}
      >
        <Input
          value={webhookPath}
          onChange={(val: string) => update(`${pathPrefix}.webhookPath`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="/googlechat/webhook"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.googlechatAudienceType")}
        description={t("channels.googlechatAudienceTypeDesc")}
      >
        <Input
          value={audienceType}
          onChange={(val: string) => update(`${pathPrefix}.audienceType`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="app-url"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.googlechatAudience")}
        description={t("channels.googlechatAudienceDesc")}
      >
        <Input
          value={audience}
          onChange={(val: string) => update(`${pathPrefix}.audience`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder={t("channels.googlechatAudiencePlaceholder")}
        />
      </SectionRow>
      <SectionRow
        label={t("channels.googlechatBotUser")}
        description={t("channels.googlechatBotUserDesc")}
      >
        <Input
          value={botUser}
          onChange={(val: string) => update(`${pathPrefix}.botUser`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="users/123456789"
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
          placeholder="user@workspace.com"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default GoogleChatConfig;

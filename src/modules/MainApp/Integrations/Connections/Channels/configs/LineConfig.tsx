/**
 * LINE Channel Configuration
 *
 * LINE Messaging API integration (popular in Japan, Thailand, Taiwan).
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

const LineConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const channelAccessToken = getNestedString(
    config,
    `${pathPrefix}.channelAccessToken`,
    ""
  );
  const channelSecret = getNestedString(
    config,
    `${pathPrefix}.channelSecret`,
    ""
  );
  const tokenFile = getNestedString(config, `${pathPrefix}.tokenFile`, "");
  const secretFile = getNestedString(config, `${pathPrefix}.secretFile`, "");
  const webhookPath = getNestedString(config, `${pathPrefix}.webhookPath`, "");
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.lineChannelAccessToken")}
        description={t("channels.lineChannelAccessTokenDesc")}
      >
        <Input
          value={channelAccessToken}
          onChange={(val: string) =>
            update(`${pathPrefix}.channelAccessToken`, val)
          }
          style={SECTION_CONTROL_STYLE}
          placeholder={t("channels.lineTokenPlaceholder")}
        />
      </SectionRow>
      <SectionRow
        label={t("channels.lineChannelSecret")}
        description={t("channels.lineChannelSecretDesc")}
      >
        <Input
          value={channelSecret}
          onChange={(val: string) => update(`${pathPrefix}.channelSecret`, val)}
          style={SECTION_CONTROL_STYLE}
          type="password"
          placeholder="••••••••"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.lineTokenFile")}
        description={t("channels.lineTokenFileDesc")}
      >
        <Input
          value={tokenFile}
          onChange={(val: string) => update(`${pathPrefix}.tokenFile`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="/path/to/token.txt"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.lineSecretFile")}
        description={t("channels.lineSecretFileDesc")}
      >
        <Input
          value={secretFile}
          onChange={(val: string) => update(`${pathPrefix}.secretFile`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="/path/to/secret.txt"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.lineWebhookPath")}
        description={t("channels.lineWebhookPathDesc")}
      >
        <Input
          value={webhookPath}
          onChange={(val: string) => update(`${pathPrefix}.webhookPath`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="/line/webhook"
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
          placeholder="U1234567890abcdef"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default LineConfig;

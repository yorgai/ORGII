/**
 * Zalo Channel Configuration
 *
 * Bot API integration for Vietnam-focused messaging platform.
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

const ZaloConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const botToken = getNestedString(config, `${pathPrefix}.botToken`, "");
  const tokenFile = getNestedString(config, `${pathPrefix}.tokenFile`, "");
  const webhookUrl = getNestedString(config, `${pathPrefix}.webhookUrl`, "");
  const webhookSecret = getNestedString(
    config,
    `${pathPrefix}.webhookSecret`,
    ""
  );
  const webhookPath = getNestedString(config, `${pathPrefix}.webhookPath`, "");
  const proxy = getNestedString(config, `${pathPrefix}.proxy`, "");
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.zaloBotToken")}
        description={t("channels.zaloBotTokenDesc")}
      >
        <Input
          value={botToken}
          onChange={(val: string) => update(`${pathPrefix}.botToken`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="OA token..."
        />
      </SectionRow>
      <SectionRow
        label={t("channels.zaloTokenFile")}
        description={t("channels.zaloTokenFileDesc")}
      >
        <Input
          value={tokenFile}
          onChange={(val: string) => update(`${pathPrefix}.tokenFile`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="/path/to/token.txt"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.zaloWebhookUrl")}
        description={t("channels.zaloWebhookUrlDesc")}
      >
        <Input
          value={webhookUrl}
          onChange={(val: string) => update(`${pathPrefix}.webhookUrl`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="https://example.com/webhook/zalo"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.zaloWebhookSecret")}
        description={t("channels.zaloWebhookSecretDesc")}
      >
        <Input
          value={webhookSecret}
          onChange={(val: string) => update(`${pathPrefix}.webhookSecret`, val)}
          style={SECTION_CONTROL_STYLE}
          type="password"
          placeholder="••••••••"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.zaloWebhookPath")}
        description={t("channels.zaloWebhookPathDesc")}
      >
        <Input
          value={webhookPath}
          onChange={(val: string) => update(`${pathPrefix}.webhookPath`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="/zalo/webhook"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.zaloProxy")}
        description={t("channels.zaloProxyDesc")}
      >
        <Input
          value={proxy}
          onChange={(val: string) => update(`${pathPrefix}.proxy`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="http://proxy:8080"
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
          placeholder="1234567890"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default ZaloConfig;

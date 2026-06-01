/**
 * Microsoft Teams Channel Configuration
 *
 * Azure Bot Framework integration using Microsoft Graph API.
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

const MSTeamsConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const appId = getNestedString(config, `${pathPrefix}.appId`, "");
  const appPassword = getNestedString(config, `${pathPrefix}.appPassword`, "");
  const tenantId = getNestedString(config, `${pathPrefix}.tenantId`, "");
  const webhookPort = getNestedString(config, `${pathPrefix}.webhookPort`, "");
  const webhookPath = getNestedString(config, `${pathPrefix}.webhookPath`, "");
  const sharePointSiteId = getNestedString(
    config,
    `${pathPrefix}.sharePointSiteId`,
    ""
  );
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.msteamsAppId")}
        description={t("channels.msteamsAppIdDesc")}
      >
        <Input
          value={appId}
          onChange={(val: string) => update(`${pathPrefix}.appId`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.msteamsAppPassword")}
        description={t("channels.msteamsAppPasswordDesc")}
      >
        <Input
          value={appPassword}
          onChange={(val: string) => update(`${pathPrefix}.appPassword`, val)}
          style={SECTION_CONTROL_STYLE}
          type="password"
          placeholder="••••••••"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.msteamsTenantId")}
        description={t("channels.msteamsTenantIdDesc")}
      >
        <Input
          value={tenantId}
          onChange={(val: string) => update(`${pathPrefix}.tenantId`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.msteamsWebhookPort")}
        description={t("channels.msteamsWebhookPortDesc")}
      >
        <Input
          value={webhookPort}
          onChange={(val: string) =>
            update(`${pathPrefix}.webhookPort`, parseInt(val, 10) || 0)
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="3978"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.msteamsWebhookPath")}
        description={t("channels.msteamsWebhookPathDesc")}
      >
        <Input
          value={webhookPath}
          onChange={(val: string) => update(`${pathPrefix}.webhookPath`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="/api/messages"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.msteamsSharePointSiteId")}
        description={t("channels.msteamsSharePointSiteIdDesc")}
      >
        <Input
          value={sharePointSiteId}
          onChange={(val: string) =>
            update(`${pathPrefix}.sharePointSiteId`, val)
          }
          style={SECTION_CONTROL_STYLE}
          placeholder="contoso.sharepoint.com,guid1,guid2"
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
          placeholder="user@org.com"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default MSTeamsConfig;

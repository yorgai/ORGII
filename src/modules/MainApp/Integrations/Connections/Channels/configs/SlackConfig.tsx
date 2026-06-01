/**
 * Slack Channel Configuration
 *
 * Requires Bot Token + App Token (Socket Mode) from Slack API dashboard.
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

const SlackConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const botToken = getNestedString(config, `${pathPrefix}.botToken`, "");
  const appToken = getNestedString(config, `${pathPrefix}.appToken`, "");
  const userToken = getNestedString(config, `${pathPrefix}.userToken`, "");
  const mode = getNestedString(config, `${pathPrefix}.mode`, "socket");
  const signingSecret = getNestedString(
    config,
    `${pathPrefix}.signingSecret`,
    ""
  );
  const webhookPath = getNestedString(
    config,
    `${pathPrefix}.webhookPath`,
    "/slack/events"
  );
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.slackBotToken")}
        description={t("channels.slackBotTokenDesc")}
      >
        <Input
          value={botToken}
          onChange={(val: string) => update(`${pathPrefix}.botToken`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="xoxb-..."
        />
      </SectionRow>
      <SectionRow
        label={t("channels.slackAppToken")}
        description={t("channels.slackAppTokenDesc")}
      >
        <Input
          value={appToken}
          onChange={(val: string) => update(`${pathPrefix}.appToken`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="xapp-..."
        />
      </SectionRow>
      <SectionRow
        label={t("channels.slackUserToken")}
        description={t("channels.slackUserTokenDesc")}
      >
        <Input
          value={userToken}
          onChange={(val: string) => update(`${pathPrefix}.userToken`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="xoxp-..."
        />
      </SectionRow>
      <SectionRow
        label={t("channels.slackMode")}
        description={t("channels.slackModeDesc")}
      >
        <Input
          value={mode}
          onChange={(val: string) => update(`${pathPrefix}.mode`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="socket"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.slackSigningSecret")}
        description={t("channels.slackSigningSecretDesc")}
      >
        <Input
          value={signingSecret}
          onChange={(val: string) => update(`${pathPrefix}.signingSecret`, val)}
          style={SECTION_CONTROL_STYLE}
          type="password"
          placeholder="••••••••"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.slackWebhookPath")}
        description={t("channels.slackWebhookPathDesc")}
      >
        <Input
          value={webhookPath}
          onChange={(val: string) => update(`${pathPrefix}.webhookPath`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="/slack/events"
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
          placeholder="U01ABCDEF, U02GHIJKL"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default SlackConfig;

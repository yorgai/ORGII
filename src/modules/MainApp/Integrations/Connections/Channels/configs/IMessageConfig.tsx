/**
 * iMessage Channel Configuration
 *
 * Uses BlueBubbles server bridge for iMessage integration on macOS.
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

const IMessageConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const serverUrl = getNestedString(
    config,
    `${pathPrefix}.serverUrl`,
    "http://localhost:1234"
  );
  const password = getNestedString(config, `${pathPrefix}.password`, "");
  const service = getNestedString(config, `${pathPrefix}.service`, "auto");
  const region = getNestedString(config, `${pathPrefix}.region`, "");
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.imessageServerUrl")}
        description={t("channels.imessageServerUrlDesc")}
      >
        <Input
          value={serverUrl}
          onChange={(val: string) => update(`${pathPrefix}.serverUrl`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="http://localhost:1234"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.imessagePassword")}
        description={t("channels.imessagePasswordDesc")}
      >
        <Input
          value={password}
          onChange={(val: string) => update(`${pathPrefix}.password`, val)}
          style={SECTION_CONTROL_STYLE}
          type="password"
          placeholder="••••••••"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.imessageService")}
        description={t("channels.imessageServiceDesc")}
      >
        <Input
          value={service}
          onChange={(val: string) => update(`${pathPrefix}.service`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="auto"
        />
      </SectionRow>
      <SectionRow
        label={t("channels.imessageRegion")}
        description={t("channels.imessageRegionDesc")}
      >
        <Input
          value={region}
          onChange={(val: string) => update(`${pathPrefix}.region`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="US"
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
          placeholder="+1234567890, user@icloud.com"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default IMessageConfig;

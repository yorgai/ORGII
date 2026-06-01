/**
 * WhatsApp Channel Configuration
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

const WhatsAppConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const bridgeUrl = getNestedString(
    config,
    `${pathPrefix}.bridgeUrl`,
    "ws://localhost:3001"
  );
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.whatsappBridge")}
        description={t("channels.whatsappBridgeDesc")}
      >
        <Input
          value={bridgeUrl}
          onChange={(val: string) => update(`${pathPrefix}.bridgeUrl`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="ws://localhost:3001"
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
          placeholder="+1234567890"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default WhatsAppConfig;

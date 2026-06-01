/**
 * Discord Channel Configuration
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

const DiscordConfig: React.FC<ChannelConfigProps> = ({
  config,
  update,
  pathPrefix,
}) => {
  const { t } = useTranslation("integrations");

  const token = getNestedString(config, `${pathPrefix}.token`, "");
  const allowFrom = getNestedStringArray(config, `${pathPrefix}.allowFrom`);

  return (
    <SectionContainer>
      <SectionRow
        label={t("channels.discordToken")}
        description={t("channels.discordTokenDesc")}
      >
        <Input
          value={token}
          onChange={(val: string) => update(`${pathPrefix}.token`, val)}
          style={SECTION_CONTROL_STYLE}
          placeholder="MTk..."
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
          placeholder="123456789012345678"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default DiscordConfig;
